import { useEffect, useRef, useState } from 'react';
import type { ChartToolPlugin } from './chartToolPlugin';
import { CHART_TOOL_PLUGINS, type ChartToolId } from './registry';
import { DrawingToolIcon } from './DrawingToolIcon';
import { useChartDrawn } from '../chart/useChartDrawn';

/** A registered plugin, with its id narrowed to the known tool ids. */
type RegisteredToolPlugin = ChartToolPlugin<ChartToolId>;

interface RailGroup {
  id: string;
  label: string;
  members: RegisteredToolPlugin[];
}

/** Splits the registry into flyout groups and direct buttons, both in registry order. */
function railLayout(plugins: readonly RegisteredToolPlugin[]): { groups: RailGroup[]; direct: RegisteredToolPlugin[] } {
  const groups: RailGroup[] = [];
  const direct: RegisteredToolPlugin[] = [];
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
  /** The group whose flyout is open, if any. */
  const [openGroupId, setOpenGroupId] = useState<string | null>(null);
  /**
   * Whether the arrow tab is showing. The pointer reveals it and takes it away
   * again on leave; Escape clears it explicitly, because the pointer is usually
   * still resting on the tab it just clicked and CSS :hover would keep the
   * chevron on screen after the menu it belongs to is gone.
   */
  const [revealedGroupId, setRevealedGroupId] = useState<string | null>(null);
  const railRef = useRef<HTMLElement>(null);
  /** Each group's icon button: Escape hands focus back to the open group's. */
  const headRefs = useRef(new Map<string, HTMLButtonElement | null>());
  const pick = (tool: ChartToolId) => {
    setOpenGroupId(null);
    onPick(tool);
  };
  const toggleFlyout = (groupId: string) => {
    setOpenGroupId((open) => (open === groupId ? null : groupId));
  };
  useEffect(() => {
    if (openGroupId === null) {
      return;
    }
    const onPointerDownOutside = (event: MouseEvent) => {
      if (!railRef.current?.contains(event.target as Node)) {
        setOpenGroupId(null);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') {
        return;
      }
      // The menu owns this Escape: stopping propagation keeps the chart's own
      // Escape (deselect the active tool / unstage a draft) from also running.
      event.stopPropagation();
      setOpenGroupId(null);
      setRevealedGroupId(null);
      headRefs.current.get(openGroupId)?.focus();
    };
    document.addEventListener('mousedown', onPointerDownOutside);
    document.addEventListener('keydown', onKeyDown);
    // Move focus into the menu: the checked row, else the first one.
    const checked = railRef.current?.querySelector<HTMLElement>('[role="menuitemradio"][aria-checked="true"]');
    const first = railRef.current?.querySelector<HTMLElement>('[role="menuitemradio"]');
    (checked ?? first)?.focus();
    return () => {
      document.removeEventListener('mousedown', onPointerDownOutside);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [openGroupId]);
  return (
    <nav className={`tool-rail${chartDrawn ? '' : ' tool-rail-waiting'}`} aria-label="Drawing tools" ref={railRef}>
      {RAIL_LAYOUT.groups.map((group) => {
        // The member the group's button represents: the active one, else the
        // group's first — so the icon always names what it is while the group
        // owns the active tool, and what it would activate when it does not.
        const activeMember = group.members.find((member) => member.id === activeChartToolId);
        const groupHead = activeMember ?? group.members[0];
        const flyoutOpen = openGroupId === group.id;
        return (
          <div className="tool-rail-group" key={group.id}>
            <div
              className={`tool-rail-split${revealedGroupId === group.id || flyoutOpen ? ' open' : ''}`}
              onPointerEnter={() => setRevealedGroupId(group.id)}
              onPointerLeave={() => setRevealedGroupId(null)}
            >
              <button
                type="button"
                className={`tool-rail-btn${activeMember ? ' active' : ''}`}
                aria-label={group.label}
                title={groupHead.label}
                aria-haspopup="menu"
                aria-expanded={flyoutOpen}
                ref={(element) => {
                  headRefs.current.set(group.id, element);
                }}
                onClick={() => toggleFlyout(group.id)}
              >
                <DrawingToolIcon name={groupHead.id} size={22} />
              </button>
              <button
                type="button"
                className="tool-rail-arrow"
                aria-haspopup="menu"
                aria-expanded={flyoutOpen}
                aria-label={`Open ${group.label.toLowerCase()}`}
                onClick={() => toggleFlyout(group.id)}
              >
                <svg
                  className="tool-rail-arrow-glyph"
                  width="14"
                  height="14"
                  viewBox="0 0 14 14"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                  focusable="false"
                >
                  <path d="M5.5 3.5 9 7l-3.5 3.5" />
                </svg>
              </button>
            </div>
            {flyoutOpen && (
              <div className="tool-flyout" role="menu" aria-label={group.label}>
                {group.members.map(({ id, label }) => (
                  <button
                    key={id}
                    type="button"
                    role="menuitemradio"
                    aria-checked={activeChartToolId === id}
                    className={`tool-flyout-row${activeChartToolId === id ? ' selected' : ''}`}
                    onClick={() => pick(id)}
                  >
                    <DrawingToolIcon name={id} size={18} />
                    <span className="tool-flyout-label">{label}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        );
      })}
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
          <DrawingToolIcon name={id} size={26} />
        </button>
      ))}
    </nav>
  );
}
