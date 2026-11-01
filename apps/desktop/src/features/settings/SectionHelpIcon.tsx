/** The help mark beside a settings heading: a circled question mark, the glyph TradingView shows for help. */
export function SectionHelpIcon() {
  return (
    <svg viewBox="0 0 16 16" width="18" height="18" aria-hidden="true">
      <circle cx="8" cy="8" r="7" fill="none" stroke="currentColor" strokeWidth="1.3" />
      <path
        d="M6.1 6.1a2 2 0 0 1 3.9.6c0 1.3-2 1.9-2 3"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="8" cy="11.7" r="0.8" fill="currentColor" stroke="none" />
    </svg>
  );
}
