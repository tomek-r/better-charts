import { OutlineIcon } from './OutlineIcon';
import { OBJECT_SETTINGS_ICON_PATHS } from './objectSettingsIcon';

/**
 * The settings icon: a hexagon around a hub, the outline the drawing toolbar and the Object tree draw.
 * The engine's price-scale corner button draws this same path.
 */
export const SETTINGS_ICON_PATH = OBJECT_SETTINGS_ICON_PATHS.join(' ');

/**
 * The settings icon: a hexagon around a hub, the same icon the drawing toolbar and the Object tree use.
 * Both subpaths are drawn as one `d`, so the corner button can hold the identical glyph.
 */
export function SettingsIcon({ className }: { className: string }) {
  return (
    <OutlineIcon className={className}>
      <path d={SETTINGS_ICON_PATH} />
    </OutlineIcon>
  );
}
