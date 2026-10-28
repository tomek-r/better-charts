import { useRef } from 'react';
import { CHART_TOOL_PLUGINS, type ChartToolId, type RegisteredChartToolPlugin } from './registry';
import { DrawingToolIcon } from './DrawingToolIcon';
import { DrawingToolRailGroup, type RailGroup } from './DrawingToolRailGroup';
import { useRailFlyout } from './useRailFlyout';
import { useChartDrawn } from '../chart/useChartDrawn';

const DIRECT_BUTTON_ICON_SIZE_PX = 26;

/** Splits the registry into flyout groups and direct buttons, both in registry order. */
function railLayout(plugins: readonly RegisteredChartToolPlugin[]): {
  groups: RailGroup[];
  direct: RegisteredChartToolPlugin[];
} {
  const groups: RailGroup[] = [];
  const direct: RegisteredChartToolPlugin[] = [];
  for (const plugin of plugins) {
    if (!plugin.railGroup) {
      direct.push(plugin);
      continue;
    }
    const { id, label } = plugin.railGroup;
    const group = groups.find((candidate) => candidate.id === id);
    if (group) {
      group.members.push(plugin);
    } else {
      groups.push({ id, label, members: [plugin] });
    }
  }
  return { groups, direct };
}

const RAIL_LAYOUT = railLayout(CHART_TOOL_PLUGINS);

/**
 * Compact tool rail built from the tool registry (`CHART_TOOL_PLUGINS`): plugins
 * sharing a `railGroup` (the arrow / crosshair pointers) sit behind one button
 * with a flyout; every other plugin gets a direct button after a separator.
 * The group button shows whichever member is active (the first member, the arrow
 * pointer, while none is).
 *
 * The group's icon and the arrow tab beside it both open the group's menu. The
 * chevron is always drawn pointing at the menu; while the menu is open CSS rotates
 * it 180 degrees to point back at the rail. Picking a row makes that tool active. Escape closes the menu — and only
 * the menu — returning focus to the group's icon and taking the chevron away
 * with it; a click outside closes it too. The tab is revealed by the pointer,
 * so it reappears on the next hover.
 */
export function DrawingToolRail({
  activeChartToolId,
  onPick,
}: {
  activeChartToolId: ChartToolId;
  onPick: (tool: ChartToolId) => void;
}) {
  /** Hidden while no chart is drawn: the tools would have nothing to act on. */
  const chartDrawn = useChartDrawn();
  const railRef = useRef<HTMLElement>(null);
  const { openGroupId, revealedGroupId, setRevealedGroupId, closeFlyout, toggleFlyout, registerHead } =
    useRailFlyout(railRef);
  const pick = (tool: ChartToolId) => {
    closeFlyout();
    onPick(tool);
  };
  return (
    <nav className={`tool-rail${chartDrawn ? '' : ' tool-rail-waiting'}`} aria-label="Drawing tools" ref={railRef}>
      {RAIL_LAYOUT.groups.map((group) => (
        <DrawingToolRailGroup
          key={group.id}
          group={group}
          activeChartToolId={activeChartToolId}
          flyoutOpen={openGroupId === group.id}
          revealed={revealedGroupId === group.id}
          onToggleFlyout={toggleFlyout}
          onReveal={setRevealedGroupId}
          onRegisterHead={registerHead}
          onPick={pick}
        />
      ))}
      <span className="tool-rail-sep" aria-hidden="true" />
      {RAIL_LAYOUT.direct.map(({ id, label }) => (
        <button
          key={id}
          type="button"
          className={`tool-rail-btn${activeChartToolId === id ? ' active' : ''}`}
          aria-label={label}
          title={label}
          aria-pressed={activeChartToolId === id}
          onClick={() => pick(id)}
        >
          <DrawingToolIcon name={id} size={DIRECT_BUTTON_ICON_SIZE_PX} />
        </button>
      ))}
    </nav>
  );
}
