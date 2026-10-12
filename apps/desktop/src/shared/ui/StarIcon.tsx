/** Favorite star shared by the symbol search and the timeframe menu; it takes
 * its colour from `currentColor`, filled when the item is a favorite. */
export function StarIcon({ filled }: { filled: boolean }) {
  return (
    <svg aria-hidden="true" focusable="false" width="18" height="18" viewBox="0 0 24 24">
      <path
        d="m12 2.75 2.85 5.78 6.38.93-4.62 4.5 1.09 6.36L12 17.32l-5.7 3 1.09-6.36-4.62-4.5 6.38-.93L12 2.75Z"
        fill={filled ? 'currentColor' : 'none'}
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
    </svg>
  );
}
