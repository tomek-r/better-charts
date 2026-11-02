/**
 * How one stored setting value is read: the backend hands over whatever it saved, so every field a
 * setting names is read through these guards, and a field that does not read keeps its default.
 */

/** A stored setting object to read fields off; anything else stored for the key is unreadable. */
export function isSettingRecord(raw: unknown): raw is Readonly<Record<string, unknown>> {
  return typeof raw === 'object' && raw !== null;
}

/** The option `raw` names; a stored name this build does not know reads as the default one. */
export function readOption<Option extends string>(raw: unknown, options: readonly Option[], fallback: Option): Option {
  return options.find((option) => option === raw) ?? fallback;
}

export function readColor(raw: unknown, fallback: string): string {
  return typeof raw === 'string' ? raw : fallback;
}

export function readNumber(raw: unknown, fallback: number): number {
  return typeof raw === 'number' && Number.isFinite(raw) ? raw : fallback;
}

export function readBoolean(raw: unknown, fallback: boolean): boolean {
  return typeof raw === 'boolean' ? raw : fallback;
}
