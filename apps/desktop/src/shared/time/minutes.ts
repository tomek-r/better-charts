export const MS_PER_MINUTE = 60_000;

/** The instant rounded to the nearest whole minute (30 s rounds up). */
export function nearestMinuteMs(timeMs: number): number {
  return Math.round(timeMs / MS_PER_MINUTE) * MS_PER_MINUTE;
}
