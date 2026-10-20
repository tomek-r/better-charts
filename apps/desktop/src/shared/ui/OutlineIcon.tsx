import type { ReactNode } from 'react';

/** Shared 24x24 outline-icon frame: stroked in the surrounding text colour, round caps and joins, hidden
 * from assistive tech (the text next to it carries the meaning). */
export function OutlineIcon({ className, children }: { className: string; children: ReactNode }) {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {children}
    </svg>
  );
}
