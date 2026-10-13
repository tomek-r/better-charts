import { useEffect, useId, useRef, type ComponentProps, type ReactNode, type RefObject } from 'react';

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function focusableElements(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
}

/** Footer action styled for a modal; `primary` is the filled accent button, `secondary` the outlined one. */
export function ModalDialogButton({
  variant = 'primary',
  className,
  type = 'button',
  ...rest
}: ComponentProps<'button'> & { variant?: 'primary' | 'secondary' }) {
  const classes = `modal-dialog-button ${variant}${className ? ` ${className}` : ''}`;
  return <button type={type} className={classes} {...rest} />;
}

/**
 * Generic modal: backdrop, titled panel, body and a footer for actions.
 * Focus starts on `initialFocusRef` (else the first focusable element), Tab/Shift+Tab cycle inside the panel,
 * Escape calls `onDismiss`, and focus returns to the previously focused element on unmount.
 */
export function ModalDialog({
  title,
  children,
  actions,
  onDismiss,
  initialFocusRef,
  width = 440,
}: {
  title: ReactNode;
  children?: ReactNode;
  actions?: ReactNode;
  onDismiss: () => void;
  initialFocusRef?: RefObject<HTMLElement | null>;
  /** Maximum panel width in px; the panel shrinks on narrow viewports. */
  width?: number;
}) {
  const titleId = useId();
  const panel = useRef<HTMLDivElement>(null);
  // Latest callback without re-running the focus effect (which would steal and restore focus).
  const dismissRef = useRef(onDismiss);
  useEffect(() => {
    dismissRef.current = onDismiss;
  });

  useEffect(() => {
    const previous = document.activeElement;
    const panelElement = panel.current;
    (initialFocusRef?.current ?? (panelElement ? focusableElements(panelElement)[0] : null) ?? panelElement)?.focus();
    const onKey = (event: KeyboardEvent) => {
      // Modal keystrokes must not reach the chart's order/drawing shortcuts.
      event.stopImmediatePropagation();
      if (event.key === 'Escape') {
        event.preventDefault();
        dismissRef.current();
        return;
      }
      if (event.key !== 'Tab' || !panelElement) {
        return;
      }
      event.preventDefault();
      const focusable = focusableElements(panelElement);
      if (focusable.length === 0) {
        panelElement.focus();
        return;
      }
      const index = focusable.indexOf(document.activeElement as HTMLElement);
      const step = event.shiftKey ? -1 : 1;
      const fallback = event.shiftKey ? focusable.length - 1 : 0;
      focusable[index === -1 ? fallback : (index + step + focusable.length) % focusable.length]?.focus();
    };
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      if (previous instanceof HTMLElement && previous.isConnected) {
        previous.focus();
      }
    };
  }, [initialFocusRef]);

  return (
    <div className="modal-dialog-backdrop">
      <div
        ref={panel}
        className="modal-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        style={{ width: `min(${width}px, 100%)` }}
        data-modal-dialog
      >
        <h2 id={titleId} className="modal-dialog-title">
          {title}
        </h2>
        {children}
        {actions ? <div className="modal-dialog-footer">{actions}</div> : null}
      </div>
    </div>
  );
}
