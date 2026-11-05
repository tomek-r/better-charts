import { SettingsIcon } from '../../../shared/ui/icons/SettingsIcon';
import { useOpenChartSettings } from '../chartSettings/dialog/ChartSettingsDialogHost';

/** The chart's settings, in the dialog the chart's own menu and its scales menu open. */
function ChartSettingsHeaderButton() {
  const openChartSettings = useOpenChartSettings();
  return (
    <button
      type="button"
      className="chart-header-button chart-header-icon-button"
      aria-label="Settings"
      title="Settings"
      onClick={() => openChartSettings()}
    >
      <SettingsIcon className="chart-header-icon" />
    </button>
  );
}

/** The buttons at the far right of the chart header: the chart's settings dialog. */
export function ChartHeaderEndButtons() {
  return (
    <div className="chart-header-end">
      <ChartSettingsHeaderButton />
    </div>
  );
}
