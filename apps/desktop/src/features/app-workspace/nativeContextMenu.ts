import { offersTextEditing } from '../../shared/ui/textEditing/textEditingTarget';

/**
 * Production builds install this: the WebView's default context menu has no use in the app, and on macOS it holds the
 * main thread while open, so Tauri events stop arriving and the chart freezes. Text-editing targets keep it for copy
 * and paste, and dev builds leave it alone so Inspect Element reaches the dev tools.
 */
export function suppressNativeContextMenu(root: Document): void {
  root.addEventListener('contextmenu', (event) => {
    if (!offersTextEditing(event.target)) {
      event.preventDefault();
    }
  });
}
