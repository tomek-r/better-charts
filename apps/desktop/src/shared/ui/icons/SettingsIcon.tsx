import { OutlineIcon } from './OutlineIcon';

/**
 * A gear's outline: eight teeth around a hub, in the 24-unit square the outline icons are drawn in.
 * The engine's corner button draws this same path, because the axes it sits on are a canvas.
 */
export const SETTINGS_ICON_PATH = [
  'M9.8 2.6 14.2 2.6 14 5.3 17.1 3.9 20.1 6.9 18.2 8.7 21.4 9.8 21.4 14.2 18.7 14 20.1 17.1',
  '17.1 20.1 15.3 18.2 14.2 21.4 9.8 21.4 10 18.7 6.9 20.1 3.9 17.1 5.8 15.3 2.6 14.2 2.6 9.8',
  '5.3 10 3.9 6.9 6.9 3.9 8.7 5.8Z',
  'M12 9.2a2.8 2.8 0 1 0 0 5.6 2.8 2.8 0 0 0 0-5.6',
].join(' ');

/** The chart's settings: the gear its menu row and the corner of the chart both offer. */
export function SettingsIcon({ className }: { className: string }) {
  return (
    <OutlineIcon className={className}>
      <path d={SETTINGS_ICON_PATH} />
    </OutlineIcon>
  );
}
