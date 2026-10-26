/**
 * `Storage` stand-ins for the pure storage helpers of specs that run in Node: no browser, and
 * nothing left behind between tests. Each one carries only the members its helper asks for.
 */

/** A storage that answers like the browser's, holding `initial` until a test writes over it. */
export function memoryStorage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
  };
}

/** A storage that answers one fixed raw value, so a test can hand a helper exactly what it must read. */
export const fixedStorage = (value: string | null) => ({ getItem: () => value });

/** A storage that refuses every call, as a full disk or a locked-down page does. */
export const blockedStorage = {
  getItem: (): string => {
    throw new Error('storage is blocked');
  },
  setItem: (): void => {
    throw new Error('storage is blocked');
  },
};
