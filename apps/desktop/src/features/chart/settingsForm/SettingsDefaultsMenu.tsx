import { useEffect, useRef, useState, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { ModalDialogButton } from '../../../shared/ui/dialog/ModalDialog';
import { useEscapeDismissal } from '../../../shared/ui/popup/useDismissal';
import { useOutsidePress } from '../../../shared/ui/popup/useOutsidePress';
import { usePopupPlacement } from '../../../shared/ui/popup/usePopupPlacement';

/** The footer button and the menu it opens. */
const MENU_LABEL = 'Defaults';
/** The menu's single row: it puts every setting back to its declared default without saving. */
const RESET_ROW_LABEL = 'Reset settings';

interface SettingsDefaultsMenuProps {
  /** Rebuilds the draft from every input's and style's declared default; OK is what saves it. */
  readonly onReset: () => void;
}

interface OpenDefaultsMenuProps {
  readonly anchor: RefObject<HTMLButtonElement | null>;
  readonly onReset: () => void;
  /** Closes the menu where the press outside it already moved the focus. */
  readonly onClose: () => void;
  /** Closes the menu and hands the keyboard back to the button that opened it. */
  readonly onDismiss: () => void;
}

/** The open menu: one row, portalled out of the dialog so its scrolling region cannot clip it. */
function OpenDefaultsMenu({ anchor, onReset, onClose, onDismiss }: OpenDefaultsMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const rowRef = useRef<HTMLButtonElement>(null);
  usePopupPlacement(anchor, menuRef);
  useOutsidePress(menuRef, anchor, onClose);
  useEscapeDismissal(onDismiss);
  useEffect(() => {
    rowRef.current?.focus();
  }, []);
  return createPortal(
    <div ref={menuRef} className="popup-surface drawing-settings-defaults-menu" role="menu" aria-label={MENU_LABEL}>
      <button
        ref={rowRef}
        type="button"
        role="menuitem"
        className="popup-menu-row"
        onClick={() => {
          onReset();
          onDismiss();
        }}
      >
        {RESET_ROW_LABEL}
      </button>
    </div>,
    document.body,
  );
}

/**
 * The footer's left action: a "Defaults" button that opens a one-row menu. Its `aria-expanded` also tells the
 * dialog around it to yield Escape and Tab to the open menu, as it does for the other popups on the form.
 */
export function SettingsDefaultsMenu({ onReset }: SettingsDefaultsMenuProps) {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const close = () => setOpen(false);
  const dismiss = () => {
    setOpen(false);
    buttonRef.current?.focus();
  };
  return (
    <>
      <ModalDialogButton
        ref={buttonRef}
        variant="secondary"
        className="drawing-settings-defaults"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        {MENU_LABEL}
      </ModalDialogButton>
      {open ? <OpenDefaultsMenu anchor={buttonRef} onReset={onReset} onClose={close} onDismiss={dismiss} /> : null}
    </>
  );
}
