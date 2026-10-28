import { parseHexColor, solidHexColor } from '../../theme/hexColor';

/** The colours the user added with "+", newest first, kept across sessions. Opacity is not part of a saved colour. */

export const CUSTOM_COLORS_KEY = 'better-charts.custom-colors.v1';
export const MAX_CUSTOM_COLORS = 10;

/** The list with `color` first, any earlier copy of it removed and the oldest dropped past the cap. */
export function addCustomColor(colors: readonly string[], color: string): string[] {
  const solid = solidHexColor(color).toLowerCase();
  return [solid, ...colors.filter((existing) => existing !== solid)].slice(0, MAX_CUSTOM_COLORS);
}

/** The saved colours; missing, malformed or unreadable storage yields none. `storage` is injectable for tests. */
export function loadCustomColors(storage?: Pick<Storage, 'getItem'>): string[] {
  try {
    const raw = (storage ?? localStorage).getItem(CUSTOM_COLORS_KEY);
    const value: unknown = raw === null ? [] : JSON.parse(raw);
    if (!Array.isArray(value)) {
      return [];
    }
    const colors = value.filter(
      (item): item is string => typeof item === 'string' && parseHexColor(item) !== undefined,
    );
    return colors.reduceRight<string[]>((kept, color) => addCustomColor(kept, color), []);
  } catch {
    return [];
  }
}

export function saveCustomColors(colors: readonly string[], storage?: Pick<Storage, 'setItem'>): void {
  try {
    (storage ?? localStorage).setItem(CUSTOM_COLORS_KEY, JSON.stringify(colors));
  } catch {
    /* storage is optional: the colours then last until the picker closes */
  }
}
