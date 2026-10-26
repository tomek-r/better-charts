import type { ReactNode } from 'react';

/**
 * Right-side drawer chrome: fixed to the strip's inner edge below the topbar.
 * Closed, it is translated off-screen AND visibility-hidden (see the stylesheet),
 * so it cannot catch pointer events, focus, or Playwright hits.
 */
export function SideDrawer({
  open,
  className,
  label,
  children,
}: {
  open: boolean;
  className: string;
  label?: string;
  children?: ReactNode;
}) {
  return (
    <aside className={`side-drawer ${className}${open ? ' open' : ''}`} aria-label={label}>
      {children}
    </aside>
  );
}
