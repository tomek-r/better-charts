import { useChartSettings } from '../chartSettings/ChartSettingsProvider';
import { withScalesValue } from '../chartSettings/chartSettings';
import { scalesAppearanceOf } from '../chartSettings/scalesAppearanceSetting';
import type { ChartSettingValue } from '../chartSettings/settingFields';
import { bidAskDrawingModeOf, bidAskDrawingsOf, type BidAskDrawings } from './bidAskDrawingMode';
import { ScalesAndLinesMenuRow } from './ScalesAndLinesMenuRow';
import type { SubmenuName } from './scalesAndLinesMenuRows';

interface ScalesAndLinesSubmenuRowsProps {
  readonly submenu: SubmenuName;
  /** Runs after one of the boxes is saved, so the menu closes behind it. */
  readonly onSaved: () => void;
}

/**
 * The boxes of one of the menu's submenus: what the price axis writes beside its prices, or what it draws
 * of the quote. Each box is saved the way the dialog's rows save their fields.
 */
export function ScalesAndLinesSubmenuRows({ submenu, onSaved }: ScalesAndLinesSubmenuRowsProps) {
  const { settings, keep } = useChartSettings();
  const scales = scalesAppearanceOf(settings.scales);
  const bidAsk = bidAskDrawingsOf(scales.bidAsk.mode);
  const save = (key: string, value: ChartSettingValue) => {
    keep(withScalesValue(settings, key, value));
    onSaved();
  };
  /** The quote keeps its own colours and stores the one drawing the flipped box left it. */
  const saveDrawings = (drawings: BidAskDrawings) =>
    save('bidAsk', { ...scales.bidAsk, mode: bidAskDrawingModeOf(drawings) });

  if (submenu === 'lines') {
    return (
      <ScalesAndLinesMenuRow
        kind="checkbox"
        checked={bidAsk.lines}
        label="Bid and ask lines"
        onActivate={() => saveDrawings({ ...bidAsk, lines: !bidAsk.lines })}
      />
    );
  }
  return (
    <>
      <ScalesAndLinesMenuRow
        kind="checkbox"
        checked={scales.symbolNameLabel}
        label="Symbol name label"
        onActivate={() => save('symbolNameLabel', !scales.symbolNameLabel)}
      />
      <ScalesAndLinesMenuRow
        kind="checkbox"
        checked={bidAsk.labels}
        label="Bid and ask labels"
        onActivate={() => saveDrawings({ ...bidAsk, labels: !bidAsk.labels })}
      />
      <ScalesAndLinesMenuRow
        kind="checkbox"
        checked={scales.countdown}
        label="Countdown to bar close"
        onActivate={() => save('countdown', !scales.countdown)}
      />
    </>
  );
}
