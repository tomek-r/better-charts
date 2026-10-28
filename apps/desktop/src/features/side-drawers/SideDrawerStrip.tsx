import type { ReactElement } from 'react';
import { useChartDrawn } from '../chart/useChartDrawn';
import { useSideDrawerActions, useSideDrawerOpen, type SideDrawerId } from './SideDrawerProvider';
import { ObjectTreeIcon, TradePanelIcon } from './sideDrawerIcons';

interface SideDrawerButtonSpec {
  drawer: SideDrawerId;
  label: string;
  Icon: () => ReactElement;
}

/** The strip's buttons, in display order: one per drawer. */
const SIDE_DRAWER_BUTTONS: readonly SideDrawerButtonSpec[] = [
  { drawer: 'tradePanel', label: 'Trade panel', Icon: TradePanelIcon },
  { drawer: 'objectTree', label: 'Object tree', Icon: ObjectTreeIcon },
];

/** One strip button, pressed while its drawer is the open one. */
function SideDrawerStripButton({ drawer, label, Icon }: SideDrawerButtonSpec) {
  const open = useSideDrawerOpen(drawer);
  const { toggleDrawer } = useSideDrawerActions();
  return (
    <button
      type="button"
      className={`tool-rail-btn${open ? ' active' : ''}`}
      aria-pressed={open}
      aria-label={label}
      title={label}
      onClick={() => toggleDrawer(drawer)}
    >
      <Icon />
    </button>
  );
}

/**
 * Right-edge icon strip mirroring the tool rail: it sits below the topbar and
 * opens one side drawer at a time. Hidden while no chart is drawn yet, so it
 * cannot open drawers over a workspace that is still loading.
 */
export function SideDrawerStrip() {
  const chartDrawn = useChartDrawn();
  return (
    <nav className={`side-drawer-strip${chartDrawn ? '' : ' side-drawer-strip-waiting'}`} aria-label="Side panels">
      {SIDE_DRAWER_BUTTONS.map(({ drawer, label, Icon }) => (
        <SideDrawerStripButton key={drawer} drawer={drawer} label={label} Icon={Icon} />
      ))}
    </nav>
  );
}
