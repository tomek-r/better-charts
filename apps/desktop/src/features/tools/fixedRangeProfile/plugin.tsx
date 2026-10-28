import type { ChartToolPlugin } from '../chartToolPlugin';
import { FIXED_RANGE_PROFILE_POINTS } from './drawing/fixedRangeProfilePoints';
import { FIXED_RANGE_PROFILE_INPUTS, FIXED_RANGE_PROFILE_STYLES, FixedRangeProfileTool } from './tool';

export const fixedRangeProfilePlugin: ChartToolPlugin<'fixedRangeProfile'> = {
  id: 'fixedRangeProfile',
  label: 'Fixed range volume profile',
  icon: {
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
  cursor: 'crosshair',
  placesDrawings: true,
  inputs: FIXED_RANGE_PROFILE_INPUTS,
  styles: FIXED_RANGE_PROFILE_STYLES,
  points: FIXED_RANGE_PROFILE_POINTS,
  toolClass: FixedRangeProfileTool,
};
