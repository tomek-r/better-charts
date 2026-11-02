/** The info mark: a thin circled i, drawn on the 24-unit grid.
 * Size comes from CSS, as it does for the other 24-unit outline icons. */
export function InfoIcon() {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
    >
      <circle cx="12" cy="12" r="10.25" />
      <circle cx="12" cy="7.5" r="1" fill="currentColor" stroke="none" />
      <path d="M12 11v6.5" />
    </svg>
  );
}
