import { useEffect, useRef } from 'react';

/** Modal notice that the MT5 login changed; the only control is Dismiss. */
export function AccountSwitchDialog({ message, onDismiss }: { message: string; onDismiss: () => void }) {
  const dismiss = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const previous = document.activeElement;
    dismiss.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      // Modal keystrokes must not reach the chart's order/drawing shortcuts.
      event.stopImmediatePropagation();
      if (event.key === 'Escape') {
        event.preventDefault();
        onDismiss();
      } else if (event.key === 'Tab') {
        // Dismiss is the only control, so the focus trap is "stay on it".
        event.preventDefault();
        dismiss.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      if (previous instanceof HTMLElement && previous.isConnected) {
        previous.focus();
      }
    };
  }, [onDismiss]);
  return (
    <div className="account-switch-backdrop">
      <div
        className="account-switch-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="account-switch-title"
        data-account-switch-dialog
      >
        <h2 id="account-switch-title">{message}</h2>
        <p>Drafts, staged orders and checks from the previous account were cleared.</p>
        <button ref={dismiss} type="button" className="account-switch-dismiss" onClick={onDismiss}>
          Dismiss
        </button>
      </div>
    </div>
  );
}
