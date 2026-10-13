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
  message: string;
  action?: ErrorNoticeAction;
}

interface ErrorNoticeState {
  notices: ErrorNotice[];
}

type ErrorNoticeStore = DomainStore<ErrorNoticeState> & {
  show: (message: string, action?: ErrorNoticeAction) => void;
  dismiss: (id: number) => void;
  retire: (message: string) => void;
};

const ErrorNotificationsContext = createContext<ErrorNoticeStore | null>(null);

export function ErrorNotificationsProvider({ children }: { children: ReactNode }) {
  const [store] = useState<ErrorNoticeStore>(() => {
    const state = createDomainStore<ErrorNoticeState>({ notices: [] });
    let nextId = 0;
    return Object.assign(state, {
      show: (message: string, action?: ErrorNoticeAction) => {
        const id = ++nextId;
        state.setField('notices', (current) =>
          current.some((notice) => notice.message === message)
            ? current
            : [...current.slice(-4), { id, message, action }],
        );
      },
      dismiss: (id: number) => state.setField('notices', (current) => current.filter((notice) => notice.id !== id)),
      retire: (message: string) =>
        state.setField('notices', (current) => current.filter((notice) => notice.message !== message)),
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

export function ErrorNotification({ message, action }: { message: string | undefined; action?: ErrorNoticeAction }) {
  const { show, retire } = useErrorNotifications();
  // The notice outlives renders, so it must call the latest action, not the one captured when it appeared.
  const runLatestAction = useEventCallback(() => action?.run());
  const actionLabel = action?.label;
  useEffect(() => {
    if (!message) {
      return;
    }
    show(message, actionLabel === undefined ? undefined : { label: actionLabel, run: runLatestAction });
    // Field validation clears as soon as the input is corrected. Runtime
    // failures reported through useErrorNotification remain until dismissed.
    return () => retire(message);
  }, [message, actionLabel, show, retire, runLatestAction]);
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
