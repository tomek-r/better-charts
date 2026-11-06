import { useRef, useState, type RefObject } from 'react';

/** The menu's open state, the trigger it hangs from, and the ways it closes. */
export interface BarStyleMenuState {
  readonly open: boolean;
  readonly triggerRef: RefObject<HTMLButtonElement | null>;
  /** Opens the menu, or closes it and hands the focus back to the trigger. */
  toggle(): void;
  /** Closes the menu and hands the focus back to the trigger, as Escape and a chosen row ask. */
  close(): void;
  /** Closes the menu for a press elsewhere on the page, which leaves the focus where the press put it. */
  dismiss(): void;
}

/** The bar type menu's open state, with the trigger every close hands the focus back to. */
export function useBarStyleMenu(): BarStyleMenuState {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const close = () => {
    setOpen(false);
    triggerRef.current?.focus();
  };
  return {
    open,
    triggerRef,
    toggle: () => setOpen((current) => !current),
    close,
    dismiss: () => setOpen(false),
  };
}
