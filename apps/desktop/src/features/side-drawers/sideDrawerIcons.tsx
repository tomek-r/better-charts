import { OutlineIcon } from '../../shared/ui/icons/OutlineIcon';

/** The class the drawer strip's buttons draw their glyph in, which the strip's stylesheet sizes. */
const STRIP_ICON_CLASS = 'side-drawer-icon';

/** TradingView's layers glyph: two stacked rhombi, which the Object tree's button and the indicator menu draw. */
const LAYERS_PATHS = ['M12 4 21 9l-9 5-9-5z', 'm3 14 9 5 9-5'];

/** Window with a right-hand column: the trade panel glyph, redrawn in the shared 24px frame. */
export function TradePanelIcon() {
  return (
    <OutlineIcon className={STRIP_ICON_CLASS}>
      <rect x="3" y="4.5" width="18" height="15" rx="2" />
      <path d="M15 4.5v15" />
    </OutlineIcon>
  );
}

/** TradingView's layers glyph: two stacked rhombi, drawn in the size the caller's class names. */
export function LayersIcon({ className }: { className: string }) {
  return (
    <OutlineIcon className={className}>
      {LAYERS_PATHS.map((path) => (
        <path key={path} d={path} />
      ))}
    </OutlineIcon>
  );
}

/** The Object tree drawer's glyph: the layers its tree lists, at the size the strip draws its buttons. */
export function ObjectTreeIcon() {
  return <LayersIcon className={STRIP_ICON_CLASS} />;
}
