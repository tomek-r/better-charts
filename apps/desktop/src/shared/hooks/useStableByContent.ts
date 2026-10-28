import { useMemo } from 'react';

/** Returns the same object while the value's JSON content is unchanged, so equal values never retrigger effects keyed on identity. */
export function useStableByContent<T extends object>(value: T | undefined): T | undefined {
  const json = JSON.stringify(value);
  return useMemo(() => (json === undefined ? undefined : (JSON.parse(json) as T)), [json]);
}
