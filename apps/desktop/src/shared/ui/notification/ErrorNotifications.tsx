import { createContext, useEffect, useState, type ReactNode } from 'react';
import { useStore } from 'zustand';
import { createFieldStore, type FieldStore } from '../../store/fieldStore';
import { useRequiredContext } from '../../context/useRequiredContext';
import { Notification } from './Notification';

/** The fix a notice offers: the text of its button, and what pressing it does. */
export interface NoticeAction {
  label: string;
  run: () => void;
}

interface ErrorNotice {
  id: number;
  /** What makes two notices the same one: the stable key when given, otherwise the message itself. */
  identity: string;
  message: string;
  action: NoticeAction | undefined;
}

interface ErrorNoticeState {
  notices: ErrorNotice[];
}

type ErrorNoticeStore = FieldStore<ErrorNoticeState> & {
  show: (message: string, noticeKey?: string, action?: NoticeAction) => void;
  dismiss: (id: number) => void;
  retire: (identity: string) => void;
};

const ErrorNotificationsContext = createContext<ErrorNoticeStore | null>(null);

/**
 * Whether the notice already reads like the one being shown. Only the label is compared, so a caller
 * may build its action fresh on every render without driving a show loop through the store.
 */
function statesSameNotice(notice: ErrorNotice, message: string, action: NoticeAction | undefined): boolean {
  return notice.message === message && notice.action?.label === action?.label;
}

export function ErrorNotificationsProvider({ children }: { children: ReactNode }) {
  const [store] = useState<ErrorNoticeStore>(() => {
    const state = createFieldStore<ErrorNoticeState>({ notices: [] });
    let nextId = 0;
    return Object.assign(state, {
      show: (message: string, noticeKey?: string, action?: NoticeAction) => {
        const identity = noticeKey ?? message;
        state.setField('notices', (current) => {
          const existing = current.find((notice) => notice.identity === identity);
          if (!existing) {
            return [...current.slice(-4), { id: ++nextId, identity, message, action }];
          }
          // A keyed notice keeps its id so the rendered alert updates in place instead of remounting.
          if (noticeKey === undefined || statesSameNotice(existing, message, action)) {
            return current;
          }
          return current.map((notice) => (notice === existing ? { ...existing, message, action } : notice));
        });
      },
      dismiss: (id: number) => state.setField('notices', (current) => current.filter((notice) => notice.id !== id)),
      retire: (identity: string) =>
        state.setField('notices', (current) => current.filter((notice) => notice.identity !== identity)),
    });
  });

  return <ErrorNotificationsContext value={store}>{children}</ErrorNotificationsContext>;
}

function useErrorNotifications(): ErrorNoticeStore {
  return useRequiredContext(ErrorNotificationsContext, 'Error notifications require ErrorNotificationsProvider.');
}

export function useErrorNotification(message: string | undefined) {
  const { show } = useErrorNotifications();
  useEffect(() => {
    if (message) {
      show(message);
    }
  }, [message, show]);
}

export function useNotifyError() {
  return useErrorNotifications().show;
}

/**
 * `noticeKey` marks a notice whose text changes while it stays the same problem (e.g. a live price):
 * the text updates in place. Without it, every distinct message is its own notice. `action` adds the
 * button that fixes the problem.
 */
export function ErrorNotification({
  message,
  noticeKey,
  action,
}: {
  message: string | undefined;
  noticeKey?: string;
  action?: NoticeAction;
}) {
  const { show, retire } = useErrorNotifications();
  const hasMessage = Boolean(message);
  useEffect(() => {
    if (!message) {
      return;
    }
    show(message, noticeKey, action);
    // Field validation clears as soon as the input is corrected. Runtime
    // failures reported through useErrorNotification remain until dismissed.
    // A keyed notice is retired by the effect below, not on each text change.
    return noticeKey === undefined ? () => retire(message) : undefined;
  }, [action, message, noticeKey, retire, show]);
  useEffect(() => {
    if (noticeKey === undefined || !hasMessage) {
      return;
    }
    return () => retire(noticeKey);
  }, [noticeKey, hasMessage, retire]);
  return null;
}

export function ErrorNotifications() {
  const store = useErrorNotifications();
  const notices = useStore(store, (state) => state.notices);
  return notices.map((notice) => (
    <Notification.Alert key={notice.id}>
      <Notification.Message>{notice.message}</Notification.Message>
      {notice.action ? (
        <button type="button" className="primary-button notification-action" onClick={notice.action.run}>
          {notice.action.label}
        </button>
      ) : null}
      <Notification.Dismiss label="Dismiss error notification" onDismiss={() => store.dismiss(notice.id)} />
    </Notification.Alert>
  ));
}
