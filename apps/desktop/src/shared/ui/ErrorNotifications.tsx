import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Notification } from './Notification';

interface ErrorNotice {
  id: number;
  message: string;
}

const ErrorNotificationsContext = createContext<{
  notices: ErrorNotice[];
  show: (message: string) => void;
  dismiss: (id: number) => void;
  retire: (message: string) => void;
} | null>(null);

export function ErrorNotificationsProvider({ children }: { children: ReactNode }) {
  const [notices, setNotices] = useState<ErrorNotice[]>([]);
  const nextId = useRef(0);
  const show = useCallback((message: string) => {
    const id = ++nextId.current;
    setNotices((current) =>
      current.some((notice) => notice.message === message) ? current : [...current.slice(-4), { id, message }],
    );
  }, []);
  const dismiss = useCallback((id: number) => {
    setNotices((current) => current.filter((notice) => notice.id !== id));
  }, []);
  const retire = useCallback((message: string) => {
    setNotices((current) => current.filter((notice) => notice.message !== message));
  }, []);
  const value = useMemo(() => ({ notices, show, dismiss, retire }), [notices, show, dismiss, retire]);
  return <ErrorNotificationsContext.Provider value={value}>{children}</ErrorNotificationsContext.Provider>;
}

function useErrorNotifications() {
  const value = useContext(ErrorNotificationsContext);
  if (!value) {
    throw new Error('Error notifications require ErrorNotificationsProvider.');
  }
  return value;
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
  const { notices, dismiss } = useErrorNotifications();
  return notices.map((notice) => (
    <Notification.Alert key={notice.id}>
      <Notification.Message>{notice.message}</Notification.Message>
      <Notification.Dismiss label="Dismiss error notification" onDismiss={() => dismiss(notice.id)} />
    </Notification.Alert>
  ));
}
