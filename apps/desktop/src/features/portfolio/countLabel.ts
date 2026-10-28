/** "1 position", "2 positions": the noun is plural for every count but one. */
export function countLabel(count: number, singularNoun: string): string {
  return `${count} ${singularNoun}${count === 1 ? '' : 's'}`;
}
