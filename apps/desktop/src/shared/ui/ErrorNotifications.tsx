import { createContext, useEffect, useState, type ReactNode } from 'react';
import { useStore } from 'zustand';
import { createDomainStore, type DomainStore } from '../state/domainStore';
import { useRequiredContext } from '../state/useRequiredContext';
import { Notification } from './Notification';

interface ErrorNotice {
  id: number;
  message: string;
}

interface ErrorNoticeState {
  notices: ErrorNotice[];
}

type ErrorNoticeStore = DomainStore<ErrorNoticeState> & {
  show: (message: string) => void;
  dismiss: (id: number) => void;
  retire: (message: string) => void;
};

const ErrorNotificationsContext = createContext<ErrorNoticeStore | null>(null);

export function ErrorNotificationsProvider({ children }: { children: ReactNode }) {
  const [store] = useState<ErrorNoticeStore>(() => {
    const state = createDomainStore<ErrorNoticeState>({ notices: [] });
    let nextId = 0;
    return Object.assign(state, {
      show: (message: string) => {
        const id = ++nextId;
        state.setField('notices', (current) =>
          current.some((notice) => notice.message === message) ? current : [...current.slice(-4), { id, message }],
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

export function ErrorNotification({ message }: { message: string | undefined }) {
  const { show, retire } = useErrorNotifications();
  useEffect(() => {
    if (!message) {
      return;
    }
    show(message);
    // Field validation clears as soon as the input is corrected. Runtime
    // failures reported through useErrorNotification remain until dismissed.
    return () => retire(message);
  }, [message, show, retire]);
  return null;
}

export function ErrorNotifications() {
  const store = useErrorNotifications();
  const notices = useStore(store, (state) => state.notices);
  return notices.map((notice) => (
    <Notification.Alert key={notice.id}>
      <Notification.Message>{notice.message}</Notification.Message>
      <Notification.Dismiss label="Dismiss error notification" onDismiss={() => store.dismiss(notice.id)} />
    </Notification.Alert>
  ));
}
