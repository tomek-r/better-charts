import { timeframeOptions } from '../../../shared/bridge/timeframes';

export const timeframeFavoritesKey = 'better-charts.timeframe-favorites.v1';

export const DEFAULT_TIMEFRAME_FAVORITES: readonly string[] = ['M1', 'M5', 'M15', 'H1', 'H4', 'D1', 'MN1'];

const knownCodes = new Set(timeframeOptions.map((option) => option.wire));

/** Wire codes the user starred. Missing or malformed storage yields the defaults;
 * an empty array is a deliberate choice and is kept. `storage` is injectable for tests. */
export function loadTimeframeFavorites(storage?: Pick<Storage, 'getItem'>): string[] {
  try {
    const raw = (storage ?? localStorage).getItem(timeframeFavoritesKey);
    if (raw === null) {
      return [...DEFAULT_TIMEFRAME_FAVORITES];
    }
    const value: unknown = JSON.parse(raw);
    if (!Array.isArray(value)) {
      return [...DEFAULT_TIMEFRAME_FAVORITES];
    }
    const known = value.filter((item): item is string => typeof item === 'string' && knownCodes.has(item));
    return [...new Set(known)];
  } catch {
    return [...DEFAULT_TIMEFRAME_FAVORITES];
  }
}

export function saveTimeframeFavorites(favorites: readonly string[], storage?: Pick<Storage, 'setItem'>) {
  try {
    (storage ?? localStorage).setItem(timeframeFavoritesKey, JSON.stringify(favorites));
  } catch {
    /* storage is optional */
  }
}
