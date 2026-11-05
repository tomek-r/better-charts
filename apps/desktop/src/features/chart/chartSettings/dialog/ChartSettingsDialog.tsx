import { useId, useState, type SubmitEvent } from 'react';
import { createPortal } from 'react-dom';
import { ModalDialog, ModalDialogButton, ModalDialogCloseButton } from '../../../../shared/ui/dialog/ModalDialog';
import { useModalExit } from '../../../../shared/ui/dialog/useModalExit';
import { SettingsNav, settingsNavTabId } from '../../../../shared/ui/settingsNav/SettingsNav';
import { useChartSettings } from '../ChartSettingsProvider';
import type { ChartSettings } from '../chartSettings';
import { CHART_SETTINGS_TABS } from './chartSettingsTabs';

/**
 * The chart's settings, TradingView-style: a column of tabs on the left and the selected tab's panel
 * beside it, in the frame the app's own settings use — the same title, header divider, content padding
 * and footer buttons. Every edit shows on the chart at once, OK keeps it and stores it, and Cancel, the
 * × and Escape put back exactly what the chart showed when the dialog opened.
 *
 * It is portalled to the page body because the chart frame is a clipped stacking context: the modal has
 * to cover the whole window.
 */
export function ChartSettingsDialog({ onClose, initialTabId }: { onClose: () => void; initialTabId?: string }) {
  const { settings, preview, keep, revert } = useChartSettings();
  // The dialog edits a draft of the settings it opened on, so Cancel has something exact to put back.
  const [draft, setDraft] = useState(settings);
  const [selectedTabId, setSelectedTabId] = useState(initialTabId ?? CHART_SETTINGS_TABS[0].id);
  const panelId = useId();
  const { backdropRef, closing, close } = useModalExit(onClose);
  const selectedTab = CHART_SETTINGS_TABS.find((tab) => tab.id === selectedTabId) ?? CHART_SETTINGS_TABS[0];

  const edit = (next: ChartSettings) => {
    setDraft(next);
    preview(next);
  };
  const cancel = () => {
    revert();
    close();
  };
  const submit = (event: SubmitEvent) => {
    event.preventDefault();
    keep(draft);
    close();
  };

  return createPortal(
    <ModalDialog
      title="Settings"
      layout="scrollable"
      size="wide"
      bodyClassName="settings-body"
      backdropRef={backdropRef}
      closing={closing}
      onDismiss={cancel}
      onSubmit={submit}
      headerActions={<ModalDialogCloseButton label="Close chart settings" onClick={cancel} />}
      actions={
        <>
          <ModalDialogButton variant="secondary" onClick={cancel}>
            Cancel
          </ModalDialogButton>
          <ModalDialogButton type="submit">OK</ModalDialogButton>
        </>
      }
    >
      <SettingsNav
        label="Chart settings"
        selection={{ kind: 'tabs', panelId }}
        tabs={CHART_SETTINGS_TABS}
        selectedId={selectedTab.id}
        onSelect={setSelectedTabId}
      />
      <div
        id={panelId}
        className="settings-content"
        role="tabpanel"
        aria-labelledby={settingsNavTabId(panelId, selectedTab.id)}
      >
        <selectedTab.Panel settings={draft} onChange={edit} />
      </div>
    </ModalDialog>,
    document.body,
  );
}
