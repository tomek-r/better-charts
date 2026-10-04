import type { ReactNode } from 'react';
import type { DrawingTool } from './toolTypes';

/** One glyph plus the stroke settings it is drawn with (they differ per icon). */
interface IconSpec {
  node: ReactNode;
  viewBox?: string;
  strokeWidth?: number;
  linecap?: 'butt' | 'round';
  linejoin?: 'miter' | 'round';
}

const icons: Record<Exclude<DrawingTool, null> | 'cursor', IconSpec> = {
  cursor: {
    node: (
      <path
        d="M6.5 3v16.6l4.3-4.7 3.4 5.7 2.9-1.7-3.5-5.8 5.9-1Z"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.1}
      />
    ),
    strokeWidth: 2.2,
    linecap: 'round',
    linejoin: 'round',
  },
  // Cross: a full-height vertical axis with a horizontal one broken at the
  // centre — the crosshair the tool draws on the chart.
  crosshair: {
    node: (
      <>
        <path d="M12 2.5v19" />
        <path d="M2.5 12h6.5M15 12h6.5" />
      </>
    ),
    strokeWidth: 1.2,
    linecap: 'butt',
    linejoin: 'miter',
  },
  fixedRangeProfile: {
    node: (
      <>
        <path d="M4.5 4.5v16M21.5 6.5V22" />
        <circle cx="4.5" cy="22" r="1.5" />
        <circle cx="21.5" cy="5" r="1.5" />
        <path d="M4.5 7.5H13v2H4.5m0 1.5h6v2h-6m0 1.5h11v2h-11m0 1.5h7v2h-7" />
      </>
    ),
    viewBox: '0 0 26 26',
    strokeWidth: 1,
    linecap: 'butt',
    linejoin: 'miter',
  },
};

export function DrawingToolIcon({
  name,
  size = 18,
  className,
}: {
  name: keyof typeof icons;
  size?: number;
  className?: string;
}) {
  const spec = icons[name];
  return (
    <svg
      className={`drawing-tool-icon${className ? ` ${className}` : ''}`}
      data-icon={name}
      width={size}
      height={size}
      viewBox={spec.viewBox ?? '0 0 24 24'}
      fill="none"
      stroke="currentColor"
      strokeWidth={spec.strokeWidth ?? 2.2}
      strokeLinecap={spec.linecap ?? 'round'}
      strokeLinejoin={spec.linejoin ?? 'round'}
      aria-hidden="true"
      focusable="false"
    >
      {spec.node}
    </svg>
  );
}
