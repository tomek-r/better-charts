import { useEffect } from 'react';
import { toolFlyoutOpen } from '../../shared/ui/popup/popupKeyboardOwnership';

/** Ctrl or Cmd+K opens the search and Escape closes it, unless a modal dialog or the tool flyout has the keyboard. */
export function useSymbolSearchHotkeys(requestClose: () => void, setSearchOpen: (open: boolean) => void): void {
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (document.querySelector('[data-modal-dialog]')) {
        return;
      }
      if (event.key === 'Escape' && toolFlyoutOpen()) {
        return;
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        event.stopPropagation();
        setSearchOpen(true);
      }
      if (event.key === 'Escape') {
        requestClose();
      }
    };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [requestClose, setSearchOpen]);
}
