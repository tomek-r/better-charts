/** Whether a value is a finite number above zero; null and undefined are not. */
export function isPositiveFinite(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

/** Decimal-string wire value to a finite number; blank, null and non-numeric are undefined. */
export function parseToFiniteNumber(value: string | null | undefined): number | undefined {
  return value !== null && value !== undefined && value.trim() !== '' && Number.isFinite(Number(value))
    ? Number(value)
    : undefined;
}
