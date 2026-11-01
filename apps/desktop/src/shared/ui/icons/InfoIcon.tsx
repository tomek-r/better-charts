/** The info mark: an outlined ring around an outlined i, drawn on the 16-unit grid the small icons use.
 * Size comes from CSS, as it does for the 24-unit outline icons. */
export function InfoIcon() {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.3"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="8" cy="8" r="7" />
      <circle cx="8" cy="4.9" r="0.9" />
      <rect x="7.1" y="7" width="1.8" height="4.6" rx="0.9" />
    </svg>
  );
}
