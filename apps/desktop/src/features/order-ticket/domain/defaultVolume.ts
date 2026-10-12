import type { BrokerSymbol } from '../../../shared/bridge/types';
import { formatVolume } from '../../../shared/format';

/** Until symbol metadata arrives the ticket starts at one unit. */
export const FALLBACK_ORDER_VOLUME = '1';

/** Default Units-mode volume: the symbol's minimum volume as a decimal string, else the fallback. */
export function defaultOrderVolume(instrument: Pick<BrokerSymbol, 'volumeMin'> | undefined): string {
  const minimum = instrument ? formatVolume(instrument.volumeMin) : '';
  const value = Number(minimum);
  return minimum !== '' && Number.isFinite(value) && value > 0 ? minimum : FALLBACK_ORDER_VOLUME;
}
