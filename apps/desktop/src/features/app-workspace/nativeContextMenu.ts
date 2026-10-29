const TEXT_EDITING_SELECTOR = 'input, textarea, [contenteditable]:not([contenteditable="false"])';

function offersTextEditing(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest(TEXT_EDITING_SELECTOR) !== null;
}

/**
 * The WebView's default context menu has no use in the app, and on macOS it holds the main thread while open, so
 * Tauri events stop arriving and the chart freezes. Text-editing targets keep it for copy and paste.
 */
export function suppressNativeContextMenu(root: Document): void {
  root.addEventListener('contextmenu', (event) => {
    if (!offersTextEditing(event.target)) {
      event.preventDefault();
    }
  });
}
