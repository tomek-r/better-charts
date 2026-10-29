import { useEffect, useRef, useState } from 'react';

type SizingModeTrigger = 'label' | 'indicator';

// TV-style sizing-mode menu for the ONE Units input: opens from the row label
// or the in-field indicator, closes on select / outside press / Escape, and is
// fully keyboard operable (buttons + menu/menuitemradio roles + arrow keys).
// UI-local state (document listeners + focus restore) with no execution/data
// interaction, so it lives with the row instead of the app root.
export function useSizingModeMenu() {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const labelTriggerRef = useRef<HTMLButtonElement>(null);
  const indicatorTriggerRef = useRef<HTMLButtonElement>(null);
  const lastTrigger = useRef<SizingModeTrigger>('label');
  const toggleFrom = (trigger: SizingModeTrigger) => {
    lastTrigger.current = trigger;
    setOpen((wasOpen) => !wasOpen);
  };
  const close = () => {
    setOpen(false);
    (lastTrigger.current === 'indicator' ? indicatorTriggerRef.current : labelTriggerRef.current)?.focus();
  };
  useEffect(() => {
    if (!open) {
      return;
    }
    const onPointerDownOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      if (
        menuRef.current?.contains(target) ||
        labelTriggerRef.current?.contains(target) ||
        indicatorTriggerRef.current?.contains(target)
      ) {
        return;
      }
      setOpen(false);
    };
    const onKeyDownOutside = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        close();
      }
    };
    document.addEventListener('mousedown', onPointerDownOutside);
    document.addEventListener('keydown', onKeyDownOutside);
    // Move focus into the menu: the checked item, else the first enabled one.
    const checked =
      menuRef.current?.querySelector<HTMLElement>('[aria-checked="true"]:not(:disabled)') ??
      menuRef.current?.querySelector<HTMLElement>('[role="menuitemradio"]:not(:disabled)');
    checked?.focus();
    return () => {
      document.removeEventListener('mousedown', onPointerDownOutside);
      document.removeEventListener('keydown', onKeyDownOutside);
    };
  }, [open]);
  return { open, menuRef, labelTriggerRef, indicatorTriggerRef, toggleFrom, close };
}
