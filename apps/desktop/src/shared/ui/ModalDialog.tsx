import {
  useEffect,
  useId,
  useRef,
  type ComponentProps,
  type ReactNode,
  type Ref,
  type RefObject,
  type SubmitEvent,
} from 'react';

// `:not(:disabled)` (not `[disabled]`) so controls inside a disabled fieldset are skipped too.
const FOCUSABLE_SELECTOR =
  'a[href], button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])';

const OWNS_KEYBOARD_SELECTOR = '[role="dialog"], [aria-haspopup][aria-expanded="true"]';

/** `compact` for short confirmations, `wide` for a tall multi-section dialog. */
export type ModalDialogSize = 'compact' | 'wide';

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

/** The "×" for `headerActions`: dismisses the dialog without going through a footer button. */
export function ModalDialogCloseButton({
  label,
  ...rest
}: Omit<ComponentProps<'button'>, 'aria-label'> & { label: string }) {
  return (
    <button type="button" className="modal-dialog-close" aria-label={label} {...rest}>
      ×
    </button>
  );
}

/**
 * Generic modal: backdrop, titled panel, body and a footer for actions.
 * Focus starts on `initialFocusRef` (else the first focusable element), Tab/Shift+Tab cycle inside the panel,
 * Escape calls `onDismiss`, and focus returns to the previously focused element on unmount.
 *
 * Keystrokes from outside the panel never reach the page's shortcuts; keystrokes from inside it (typing in an
 * input, Enter to submit) reach their own handlers, while the page's global shortcuts yield to `[data-modal-dialog]`.
 *
 * `layout="scrollable"` gives a fixed header and footer with a body that fills the remaining height, for
 * dialogs with their own scrolling regions. Pass `onSubmit` to wrap body and footer in a `<form>` so a
 * `type="submit"` footer button submits it.
 */
export function ModalDialog({
  title,
  children,
  actions,
  footerNote,
  headerActions,
  overlay,
  onDismiss,
  onSubmit,
  initialFocusRef,
  size = 'compact',
  layout = 'compact',
  bodyDisabled = false,
  bodyClassName,
  className,
  backdropClassName,
  backdropRef,
  closing = false,
}: {
  title: ReactNode;
  children?: ReactNode;
  actions?: ReactNode;
  /** Small text at the left of the footer actions. */
  footerNote?: ReactNode;
  /** Controls at the right of the title, e.g. a `ModalDialogCloseButton`. */
  headerActions?: ReactNode;
  /** A dialog nested over the panel; outside the body so `bodyDisabled` does not disable it. */
  overlay?: ReactNode;
  onDismiss: () => void;
  onSubmit?: (event: SubmitEvent) => void;
  initialFocusRef?: RefObject<HTMLElement | null>;
  /**
   * Named panel size; the pixel values are tokens in modal-dialog.css. The panel shrinks on narrow viewports, and
   * `wide` also has a fixed height (capped by the viewport) for `layout="scrollable"`.
   */
  size?: ModalDialogSize;
  layout?: 'compact' | 'scrollable';
  /** Disables every control in the body while an action is in flight; `layout="scrollable"` only. */
  bodyDisabled?: boolean;
  bodyClassName?: string;
  className?: string;
  backdropClassName?: string;
  backdropRef?: Ref<HTMLDivElement>;
  /** Plays the exit animation; the owner unmounts the dialog when it ends (see `afterExitAnimation`). */
  closing?: boolean;
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
      // A dialog nested in the panel (e.g. a guide opened from the body) owns the keyboard, and so does a
      // popup (a drop-down list, a colour picker) opened by a control of the panel: it is portalled out of
      // the panel, so its keys would otherwise be swallowed here and Escape would close the whole modal.
      if (panelElement?.querySelector(OWNS_KEYBOARD_SELECTOR)) {
        return;
      }
      const isModalKey = event.key === 'Escape' || event.key === 'Tab';
      // Keystrokes aimed outside the panel must not reach the chart's order/drawing shortcuts; ones aimed
      // inside must still reach the focused control's own handlers.
      if (isModalKey || !(event.target instanceof Node && panelElement?.contains(event.target))) {
        event.stopImmediatePropagation();
      }
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

  const scrollable = layout === 'scrollable';
  const footer =
    actions || footerNote ? (
      <div className="modal-dialog-footer">
        {footerNote ? <p className="modal-dialog-footer-note">{footerNote}</p> : null}
        {actions}
      </div>
    ) : null;
  const content = scrollable ? (
    <>
      <fieldset className={`modal-dialog-body${bodyClassName ? ` ${bodyClassName}` : ''}`} disabled={bodyDisabled}>
        {children}
      </fieldset>
      {footer}
    </>
  ) : (
    <>
      {children}
      {footer}
    </>
  );
  const modifiers = scrollable ? ' scrollable' : '';

  return (
    <div
      ref={backdropRef}
      className={`modal-dialog-backdrop${modifiers}${closing ? ' is-closing' : ''}${backdropClassName ? ` ${backdropClassName}` : ''}`}
    >
      <div
        ref={panel}
        className={`modal-dialog${modifiers}${className ? ` ${className}` : ''}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        data-size={size}
        data-modal-dialog
      >
        <header className="modal-dialog-header">
          <h2 id={titleId} className="modal-dialog-title">
            {title}
          </h2>
          {headerActions}
        </header>
        {onSubmit ? (
          <form className="modal-dialog-form" onSubmit={onSubmit} noValidate>
            {content}
          </form>
        ) : (
          content
        )}
        {overlay}
      </div>
    </div>
  );
}
