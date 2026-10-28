import type { ChartToolPlugin } from '../chartToolPlugin';
import { CrosshairTool } from './crosshairTool';

/** Draws the crosshair lines while active; the axis labels follow every tool. */
export const crosshairPlugin: ChartToolPlugin<'crosshair'> = {
  id: 'crosshair',
  label: 'Crosshair pointer',
  // A full-height vertical axis with a horizontal one broken at the centre.
  icon: {
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
  cursor: 'crosshair',
  railGroup: { id: 'pointers', label: 'Pointer tools' },
  placesDrawings: false,
  toolClass: CrosshairTool,
};
