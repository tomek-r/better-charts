import { DrawingToolIcon } from './DrawingToolIcon';
import type { ChartToolId, RegisteredChartToolPlugin } from './registry';

const GROUP_ICON_SIZE_PX = 22;
const FLYOUT_ROW_ICON_SIZE_PX = 18;

export interface RailGroup {
  id: string;
  label: string;
  members: RegisteredChartToolPlugin[];
}

/** The chevron of the group's arrow tab; CSS rotates it while the menu is open. */
function RailArrowGlyph() {
  return (
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
  );
}

interface DrawingToolRailGroupProps {
  readonly group: RailGroup;
  readonly activeChartToolId: ChartToolId;
  readonly flyoutOpen: boolean;
  readonly revealed: boolean;
  readonly onToggleFlyout: (groupId: string) => void;
  readonly onReveal: (groupId: string | null) => void;
  readonly onRegisterHead: (groupId: string, element: HTMLButtonElement | null) => void;
  readonly onPick: (tool: ChartToolId) => void;
}

/** One flyout group of the rail: the icon of its current member, the arrow tab and, while open, the menu. */
export function DrawingToolRailGroup({
  group,
  activeChartToolId,
  flyoutOpen,
  revealed,
  onToggleFlyout,
  onReveal,
  onRegisterHead,
  onPick,
}: DrawingToolRailGroupProps) {
  // The member the group's button represents: the active one, else the
  // group's first — so the icon always names what it is while the group
  // owns the active tool, and what it would activate when it does not.
  const activeMember = group.members.find((member) => member.id === activeChartToolId);
  const groupHead = activeMember ?? group.members[0];
  return (
    <div className="tool-rail-group">
      <div
        className={`tool-rail-split${revealed || flyoutOpen ? ' open' : ''}`}
        onPointerEnter={() => onReveal(group.id)}
        onPointerLeave={() => onReveal(null)}
      >
        <button
          type="button"
          className={`tool-rail-btn${activeMember ? ' active' : ''}`}
          aria-label={group.label}
          title={groupHead.label}
          aria-haspopup="menu"
          aria-expanded={flyoutOpen}
          ref={(element) => {
            onRegisterHead(group.id, element);
          }}
          onClick={() => onToggleFlyout(group.id)}
        >
          <DrawingToolIcon name={groupHead.id} size={GROUP_ICON_SIZE_PX} />
        </button>
        <button
          type="button"
          className="tool-rail-arrow"
          aria-haspopup="menu"
          aria-expanded={flyoutOpen}
          aria-label={`Open ${group.label.toLowerCase()}`}
          onClick={() => onToggleFlyout(group.id)}
        >
          <RailArrowGlyph />
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
              onClick={() => onPick(id)}
            >
              <DrawingToolIcon name={id} size={FLYOUT_ROW_ICON_SIZE_PX} />
              <span className="tool-flyout-label">{label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
