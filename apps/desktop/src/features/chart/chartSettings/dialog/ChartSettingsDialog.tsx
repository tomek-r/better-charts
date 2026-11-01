import { useId, useState, type SubmitEvent } from 'react';
import { createPortal } from 'react-dom';
import { ModalDialog, ModalDialogButton, ModalDialogCloseButton } from '../../../../shared/ui/dialog/ModalDialog';
import { useChartSettings } from '../ChartSettingsProvider';
import type { ChartSettings } from '../chartSettings';
import { CHART_SETTINGS_TABS } from './chartSettingsTabs';

/**
 * The chart's settings, TradingView-style: a column of tabs on the left and the selected tab's panel
 * beside it. Every edit shows on the chart at once, OK keeps it and stores it, and Cancel, the × and
 * Escape put back exactly what the chart showed when the dialog opened.
 *
 * It is portalled to the page body because the chart frame is a clipped stacking context: the modal has
 * to cover the whole window.
 */
export function ChartSettingsDialog({ onClose }: { onClose: () => void }) {
  const { settings, preview, keep, revert } = useChartSettings();
  // The dialog edits a draft of the settings it opened on, so Cancel has something exact to put back.
  const [draft, setDraft] = useState(settings);
  const [selectedTabId, setSelectedTabId] = useState(CHART_SETTINGS_TABS[0].id);
  const panelId = useId();
  const selectedTab = CHART_SETTINGS_TABS.find((tab) => tab.id === selectedTabId) ?? CHART_SETTINGS_TABS[0];

  const edit = (next: ChartSettings) => {
    setDraft(next);
    preview(next);
  };
  const cancel = () => {
    revert();
    onClose();
  };
  const submit = (event: SubmitEvent) => {
    event.preventDefault();
    keep(draft);
    onClose();
  };

  return createPortal(
    <ModalDialog
      title="Settings"
      size="wide"
      onDismiss={cancel}
      onSubmit={submit}
      headerActions={<ModalDialogCloseButton label="Close chart settings" onClick={cancel} />}
    >
      <div className="chart-settings">
        <div className="chart-settings-tabs" role="tablist" aria-label="Chart settings" aria-orientation="vertical">
          {CHART_SETTINGS_TABS.map(({ id, title, Icon }) => (
            <button
              key={id}
              type="button"
              role="tab"
              id={`${panelId}-tab-${id}`}
              className="chart-settings-tab"
              aria-selected={id === selectedTab.id}
              aria-controls={panelId}
              onClick={() => setSelectedTabId(id)}
            >
              <Icon />
              <span>{title}</span>
            </button>
          ))}
        </div>
        <div
          id={panelId}
          className="chart-settings-tab-panel"
          role="tabpanel"
          aria-labelledby={`${panelId}-tab-${selectedTab.id}`}
        >
          <selectedTab.Panel settings={draft} onChange={edit} />
        </div>
      </div>
      <div className="modal-dialog-footer">
        <ModalDialogButton variant="secondary" onClick={cancel}>
          Cancel
        </ModalDialogButton>
        <ModalDialogButton type="submit">OK</ModalDialogButton>
      </div>
    </ModalDialog>,
    document.body,
  );
}
