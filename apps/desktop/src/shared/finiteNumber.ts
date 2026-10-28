/** Whether a value is a finite number above zero; null and undefined are not. */
export function isPositiveFinite(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}
