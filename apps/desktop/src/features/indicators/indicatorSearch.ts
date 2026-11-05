type SearchableIndicator = {
  readonly title: string;
  readonly shortTitle: string;
};

function includesNeedle(text: string, needle: string): boolean {
  return text.toLowerCase().includes(needle);
}

/**
 * Filters the indicators the dialog lists: a trimmed, case-insensitive substring of the title or of the
 * short title keeps an indicator, and an empty query keeps every indicator in registry order.
 */
export function matchingIndicators<Plugin extends SearchableIndicator>(
  plugins: readonly Plugin[],
  query: string,
): Plugin[] {
  const needle = query.trim().toLowerCase();
  if (needle === '') {
    return [...plugins];
  }

  return plugins.filter((plugin) => includesNeedle(plugin.title, needle) || includesNeedle(plugin.shortTitle, needle));
}
