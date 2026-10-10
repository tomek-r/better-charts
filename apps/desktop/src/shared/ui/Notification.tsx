import { createContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { useRequiredContext } from '../state/useRequiredContext';

const DismissContext = createContext<{ closing: boolean; dismiss: (action: () => void) => void } | null>(null);

function Region({ children }: { children: ReactNode }) {
  return (
    <div className="notification-layer">
      <div className="notification-region">{children}</div>
    </div>
  );
}

function Frame({ children, role }: { children: ReactNode; role: 'status' | 'alert' }) {
  const [closing, setClosing] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const dismiss = (action: () => void) => {
    if (timer.current !== undefined) {
      return;
    }
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      action();
      return;
    }
    setClosing(true);
    timer.current = setTimeout(action, 180);
  };
  return (
    <DismissContext value={{ closing, dismiss }}>
      <div className={`notification notification-${role}${closing ? ' is-closing' : ''}`} role={role}>
        {role === 'alert' ? (
          <svg
            className="notification-icon notification-icon-error"
            width="20"
            height="20"
            viewBox="0 0 20 20"
            aria-hidden="true"
          >
            <circle cx="10" cy="10" r="8" />
            <path d="M10 5.5v5M10 14v.5" />
          </svg>
        ) : (
          <svg
            className="notification-icon notification-icon-info"
            width="20"
            height="20"
            viewBox="0 0 20 20"
            aria-hidden="true"
          >
            <circle cx="10" cy="10" r="8" />
            <path d="M10 6v.5M10 9v5" />
          </svg>
        )}
        {children}
      </div>
    </DismissContext>
  );
}

function Status({ children }: { children: ReactNode }) {
  return <Frame role="status">{children}</Frame>;
}

function Alert({ children }: { children: ReactNode }) {
  return <Frame role="alert">{children}</Frame>;
}

function Message({ children }: { children: string }) {
  const text = children.trimStart();
  return <span>{text.charAt(0).toUpperCase() + text.slice(1)}</span>;
}

function Dismiss({ onDismiss, label }: { onDismiss: () => void; label: string }) {
  const lifecycle = useRequiredContext(
    DismissContext,
    'Notification.Dismiss requires a Notification.Status or Notification.Alert.',
  );
  return (
    <button
      type="button"
      className="notification-dismiss"
      aria-label={label}
      disabled={lifecycle.closing}
      onClick={() => lifecycle.dismiss(onDismiss)}
    >
      <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
        <path d="M3 3l8 8M11 3l-8 8" />
      </svg>
    </button>
  );
}

export const Notification = { Region, Status, Alert, Message, Dismiss };
