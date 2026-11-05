import type { SettingValue, SettingValues } from '../engine/settings/settingInputs';
import { isPlainRecord } from '../engine/settings/settingInputs';

/** A chart indicator as it travels in the chart's settings document. */
export interface SavedIndicator {
  readonly instanceId: string;
  readonly definitionId: string;
  /** What the user changed; omitted settings take their defaults. */
  readonly settings: SettingValues;
  /** Present only while the user has hidden the indicator: it stays attached and draws nothing. */
  readonly hidden?: true;
}

/**
 * Reads the indicators stored in a chart settings document.
 * Entries that do not read are dropped; unknown definition ids are kept,
 * because a newer build may have saved them. The first entry wins for a
 * repeated instance id, since a chart can only attach one instance per id.
 */
export function readSavedIndicators(raw: unknown): readonly SavedIndicator[] | undefined {
  if (!Array.isArray(raw)) {
    return undefined;
  }

  const indicators: SavedIndicator[] = [];
  const seenInstanceIds = new Set<string>();

  for (const entry of raw) {
    const indicator = readSavedIndicator(entry);
    if (indicator === undefined) {
      continue;
    }
    if (seenInstanceIds.has(indicator.instanceId)) {
      continue;
    }
    seenInstanceIds.add(indicator.instanceId);
    indicators.push(indicator);
  }

  return indicators;
}

/** True when both lists hold the same indicators, in the same order, the same settings and the same hidden state. */
export function sameSavedIndicators(left: readonly SavedIndicator[], right: readonly SavedIndicator[]): boolean {
  if (left.length !== right.length) {
    return false;
  }

  return left.every((indicator, index) => sameSavedIndicator(indicator, right[index]));
}

function readSavedIndicator(raw: unknown): SavedIndicator | undefined {
  if (!isPlainRecord(raw)) {
    return undefined;
  }

  const instanceId = raw.instanceId;
  const definitionId = raw.definitionId;
  if (!isNonEmptyString(instanceId) || !isNonEmptyString(definitionId)) {
    return undefined;
  }

  return { instanceId, definitionId, settings: readSettingValues(raw.settings), ...hiddenFlag(raw.hidden) };
}

/** The `hidden` flag as a spreadable field, so a shown indicator carries no `hidden` key at all. */
function hiddenFlag(raw: unknown): { hidden?: true } {
  return raw === true ? { hidden: true } : {};
}

function readSettingValues(raw: unknown): SettingValues {
  if (!isPlainRecord(raw)) {
    return {};
  }

  const settings: Record<string, SettingValue> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (isSettingValue(value)) {
      settings[key] = value;
    }
  }

  return settings;
}

function isSettingValue(value: unknown): value is SettingValue {
  if (typeof value === 'boolean' || typeof value === 'string') {
    return true;
  }

  return typeof value === 'number' && Number.isFinite(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value !== '';
}

function sameSavedIndicator(left: SavedIndicator, right: SavedIndicator): boolean {
  return (
    left.instanceId === right.instanceId &&
    left.definitionId === right.definitionId &&
    left.hidden === right.hidden &&
    sameSettingValues(left.settings, right.settings)
  );
}

function sameSettingValues(left: SettingValues, right: SettingValues): boolean {
  const leftKeys = Object.keys(left);
  if (leftKeys.length !== Object.keys(right).length) {
    return false;
  }

  return leftKeys.every((key) => left[key] === right[key]);
}
