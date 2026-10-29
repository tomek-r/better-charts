/** The option an arrow, Home or End key moves the highlight to; undefined for any other key. The ends do not wrap. */
export function movedOptionIndex(key: string, activeIndex: number, optionCount: number): number | undefined {
  const last = optionCount - 1;
  switch (key) {
    case 'ArrowDown':
      return Math.min(activeIndex + 1, last);
    case 'ArrowUp':
      return Math.max(activeIndex - 1, 0);
    case 'Home':
      return 0;
    case 'End':
      return last;
    default:
      return undefined;
  }
}

/**
 * The next option whose label starts with the typed character, searching after the highlighted one and
 * wrapping round to it; undefined when no label starts with it.
 */
export function typedOptionIndex(
  character: string,
  activeIndex: number,
  labels: readonly string[],
): number | undefined {
  const wanted = character.toLowerCase();
  for (let step = 1; step <= labels.length; step += 1) {
    const index = (activeIndex + step) % labels.length;
    if (labels[index].toLowerCase().startsWith(wanted)) {
      return index;
    }
  }
  return undefined;
}
