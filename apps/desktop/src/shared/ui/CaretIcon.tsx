/** 10px down-chevron drawn as SVG: deterministic size and vertical centering
 * (flex parents center the box, inline use rides the text via vertical-align) —
 * no font-glyph guessing like the old ▾/⌄ characters. */
export function CaretIcon() {
  return (
    <svg
      aria-hidden="true"
      className="ticket-caret"
      width="10"
      height="10"
      viewBox="0 0 10 10"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M2.5 3.5 5 6.5 7.5 3.5" />
    </svg>
  );
}
