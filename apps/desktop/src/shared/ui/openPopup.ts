/**
 * Whether a popup (a drop-down list, a colour picker) is open. Popups are portalled to the body and own the
 * keyboard while open, so a window-level key shortcut cannot tell from the event target that Escape belongs
 * to the popup, and must check this first. The popup itself is looked for, not an expanded trigger: a button
 * that opened a dialog (the setup guide) also stays expanded, and that dialog must keep its own Escape.
 */
export function popupOwnsKeyboard(): boolean {
  return document.querySelector('.popup-surface') !== null;
}
