import { useEffect } from 'react';
import { useChartResources } from '../chart/ChartWorkspaceProvider';
import { popupOwnsKeyboard, toolFlyoutOpen } from '../../shared/ui/popup/popupKeyboardOwnership';
import { useIndicatorRowCommands } from './useIndicatorCommands';

/** Whether `target` is a field the user types in, which owns Delete and Backspace for its own text. */
function isTextEntry(target: EventTarget | null): boolean {
  if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
    return true;
  }
  return target instanceof HTMLElement && target.isContentEditable;
}

/** Whether a dialog or an open menu owns the keyboard, so the chart's own shortcuts must stay out of the way. */
function dialogOrMenuOwnsKeyboard(): boolean {
  return document.querySelector('[data-modal-dialog]') !== null || popupOwnsKeyboard() || toolFlyoutOpen();
}

/**
 * The keys of the selected indicator, wherever the keyboard focus rests: Delete or Backspace removes it
 * and Escape clears the selection, unless a text field, a dialog or an open menu owns the key.
 */
export function ChartIndicatorSelectionKeys() {
  const { chart } = useChartResources();
  const { remove } = useIndicatorRowCommands();

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (isTextEntry(event.target) || dialogOrMenuOwnsKeyboard()) {
        return;
      }
      const selection = chart.current?.indicatorSelection;
      const selectedInstanceId = selection?.selected() ?? null;
      if (selection === undefined || selectedInstanceId === null) {
        return;
      }
      if (event.key === 'Escape') {
        selection.clear();
        return;
      }
      if (event.key !== 'Delete' && event.key !== 'Backspace') {
        return;
      }
      event.preventDefault();
      remove(selectedInstanceId);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [chart, remove]);

  return null;
}
