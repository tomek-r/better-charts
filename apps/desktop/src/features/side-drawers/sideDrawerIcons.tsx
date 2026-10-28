import { OutlineIcon } from '../../shared/ui/icons/OutlineIcon';

/** Window with a right-hand column: the trade panel glyph, redrawn in the shared 24px frame. */
export function TradePanelIcon() {
  return (
    <OutlineIcon className="side-drawer-icon">
      <rect x="3" y="4.5" width="18" height="15" rx="2" />
      <path d="M15 4.5v15" />
    </OutlineIcon>
  );
}

/** TradingView's layers glyph: two stacked rhombi. */
export function ObjectTreeIcon() {
  return (
    <OutlineIcon className="side-drawer-icon">
      <path d="M12 4 21 9l-9 5-9-5z" />
      <path d="m3 14 9 5 9-5" />
    </OutlineIcon>
  );
}
