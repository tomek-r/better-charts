const TEXT_EDITING_SELECTOR = 'input, textarea, [contenteditable]:not([contenteditable="false"])';

/** True when the event target is a field the user types into, where global shortcuts and menus must stand aside. */
export function offersTextEditing(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest(TEXT_EDITING_SELECTOR) !== null;
}
