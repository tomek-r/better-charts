/** How far each arrow key moves along a sequence of items; keys that do not move it are absent. */
export type ArrowSteps = Readonly<Partial<Record<string, number>>>;

/** The step the key takes, or undefined when it is not one of the steps' keys. */
export function arrowStep(key: string, steps: ArrowSteps): number | undefined {
  return steps[key];
}

/** The index `step` places away from `index`, wrapping around both ends of `count` items. */
export function wrapIndex(index: number, step: number, count: number): number {
  return (index + step + count) % count;
}
