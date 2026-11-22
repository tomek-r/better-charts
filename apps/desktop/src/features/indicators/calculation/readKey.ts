/** The reads this app has keyed, in the order it started them. */
let nextReadNumber = 1;

/**
 * A key no other read holds, so two reads never consume each other's answer. The host routes answers by it and
 * accepts 1–64 characters of `[A-Za-z0-9_:-]`, which `prefix` plus a number always is.
 */
export function readKey(prefix: string): string {
  const key = `${prefix}${nextReadNumber}`;
  nextReadNumber += 1;
  return key;
}
