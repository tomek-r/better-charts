import { createContext, useEffect, useState, type ReactNode } from 'react';
import { useStore } from 'zustand';
import { useEventCallback } from '../hooks/useEventCallback';
import { createDomainStore, type DomainStore } from '../state/domainStore';
import { useRequiredContext } from '../state/useRequiredContext';
import { Notification } from './Notification';

/** A one-click remedy shown beside the message; running it is the user's decision. */
export interface ErrorNoticeAction {
  label: string;
  run: () => void;
}

interface ErrorNotice {
  id: number;
  /** What makes two notices the same one: the stable key when given, otherwise the message itself. */
  identity: string;
  message: string;
  action?: ErrorNoticeAction;
}

interface ErrorNoticeState {
  notices: ErrorNotice[];
}

type ErrorNoticeStore = DomainStore<ErrorNoticeState> & {
  show: (message: string, action?: ErrorNoticeAction, noticeKey?: string) => void;
  dismiss: (id: number) => void;
  retire: (identity: string) => void;
};

const ErrorNotificationsContext = createContext<ErrorNoticeStore | null>(null);

export function ErrorNotificationsProvider({ children }: { children: ReactNode }) {
  const [store] = useState<ErrorNoticeStore>(() => {
    const state = createDomainStore<ErrorNoticeState>({ notices: [] });
    let nextId = 0;
    return Object.assign(state, {
      show: (message: string, action?: ErrorNoticeAction, noticeKey?: string) => {
        const identity = noticeKey ?? message;
        state.setField('notices', (current) => {
          const existing = current.find((notice) => notice.identity === identity);
          if (!existing) {
            return [...current.slice(-4), { id: ++nextId, identity, message, action }];
          }
          // A keyed notice keeps its id so the rendered alert updates in place instead of remounting.
          return noticeKey === undefined
            ? current
            : current.map((notice) => (notice === existing ? { ...existing, message, action } : notice));
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
 * the text updates in place. Without it, every distinct message is its own notice.
 */
export function ErrorNotification({
  message,
  action,
  noticeKey,
}: {
  message: string | undefined;
  action?: ErrorNoticeAction;
  noticeKey?: string;
}) {
  const { show, retire } = useErrorNotifications();
  // The notice outlives renders, so it must call the latest action, not the one captured when it appeared.
  const runLatestAction = useEventCallback(() => action?.run());
  const actionLabel = action?.label;
  const hasMessage = Boolean(message);
  useEffect(() => {
    if (!message) {
      return;
    }
    show(message, actionLabel === undefined ? undefined : { label: actionLabel, run: runLatestAction }, noticeKey);
    // Field validation clears as soon as the input is corrected. Runtime
    // failures reported through useErrorNotification remain until dismissed.
    // A keyed notice is retired by the effect below, not on each text change.
    return noticeKey === undefined ? () => retire(message) : undefined;
  }, [message, actionLabel, noticeKey, show, retire, runLatestAction]);
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
      {notice.action && <Notification.Action label={notice.action.label} onAction={notice.action.run} />}
      <Notification.Dismiss label="Dismiss error notification" onDismiss={() => store.dismiss(notice.id)} />
    </Notification.Alert>
  ));
}
