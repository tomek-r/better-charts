import type { ChartIndicators } from '../indicators/chartIndicators';
import type { OhlcReadout } from './ohlcReadout';
import type { ChartStatusLineAppearance } from './statusLineAppearance';

/**
 * What the settings dialog's Status line tab commands: an appearance reaches both lines the tab draws,
 * while the symbol's description belongs to the OHLC line alone.
 */
export interface ChartStatusLine {
  setAppearance(appearance: ChartStatusLineAppearance): void;
  setSymbolDescription(description: string | undefined): void;
}

/** One command surface over the OHLC line and the indicator rows it sits above. */
export function chartStatusLine(
  readout: OhlcReadout,
  indicators: Pick<ChartIndicators, 'setStatusLine'>,
): ChartStatusLine {
  return {
    setAppearance: (appearance) => {
      readout.setAppearance(appearance);
      indicators.setStatusLine(appearance);
    },
    setSymbolDescription: (description) => readout.setSymbolDescription(description),
  };
}
