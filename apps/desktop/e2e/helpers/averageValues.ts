/** The mean of every window of `length` values, with a null until the first window is full. */
export function averageOf(values: readonly number[], length: number): (number | null)[] {
  return values.map((_, index) => {
    if (index + 1 < length) {
      return null;
    }
    const window = values.slice(index + 1 - length, index + 1);
    return window.reduce((total, value) => total + value, 0) / length;
  });
}
