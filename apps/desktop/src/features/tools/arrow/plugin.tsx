import type { ChartToolPlugin } from '../chartToolPlugin';
import { ArrowTool } from './tool';

/** The default tool: no drawing is placed and the chart pans as usual. */
export const arrowPlugin: ChartToolPlugin<'arrow'> = {
  id: 'arrow',
  label: 'Arrow pointer',
  icon: {
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
  railGroup: { id: 'pointers', label: 'Pointer tools' },
  placesDrawings: false,
  toolClass: ArrowTool,
};
