import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';

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
    <DismissContext.Provider value={{ closing, dismiss }}>
      <div className={`notification notification-${role}${closing ? ' is-closing' : ''}`} role={role}>
        {children}
      </div>
    </DismissContext.Provider>
  );
}

function Status({ children }: { children: ReactNode }) {
  return <Frame role="status">{children}</Frame>;
}

function Alert({ children }: { children: ReactNode }) {
  return <Frame role="alert">{children}</Frame>;
}

function Dismiss({ onDismiss, label }: { onDismiss: () => void; label: string }) {
  const lifecycle = useContext(DismissContext);
  if (!lifecycle) {
    throw new Error('Notification.Dismiss requires a Notification.Status or Notification.Alert.');
  }
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

export const Notification = { Region, Status, Alert, Dismiss };
