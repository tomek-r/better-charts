import { Fragment, useEffect, useState, type PointerEvent, type RefObject } from 'react';
import { ResetViewIcon } from '../../../shared/ui/icons/ResetViewIcon';
import { SettingsIcon } from '../../../shared/ui/icons/SettingsIcon';
import { useAppPlatform } from '../../settings/AppSettingsProvider';
import { useChartSettings } from '../chartSettings/ChartSettingsProvider';
import { withScalesValue } from '../chartSettings/chartSettings';
import { scalesAppearanceOf } from '../chartSettings/scalesAppearanceSetting';
import type { ChartSettingValue } from '../chartSettings/settingFields';
import { resetViewShortcutLabel } from '../contextMenu/resetViewShortcutLabel';
import { ScalesAndLinesMenuRow } from './ScalesAndLinesMenuRow';
import { ScalesAndLinesSubmenu } from './ScalesAndLinesSubmenu';
import { ScalesAndLinesSubmenuRows } from './ScalesAndLinesSubmenuRows';
import {
  carriesSubmenu,
  focusEndRow,
  handleMenuKey,
  menuRowUnder,
  submenuHoldsFocus,
  type SubmenuName,
  type SubmenuOpening,
} from './scalesAndLinesMenuRows';

/** The submenus, in the order their rows are drawn, under the label each row shows. */
const SUBMENUS: readonly { readonly name: SubmenuName; readonly label: string }[] = [
  { name: 'labels', label: 'Labels' },
  { name: 'lines', label: 'Lines' },
];

const SEPARATOR = <div role="separator" className="chart-context-menu-separator" />;

/** The shortcut as the platform writes it, which `useScalesAndLinesShortcuts` listens for on every platform. */
function altShortcut(key: string, macos: boolean): string {
  return macos ? `⌥${key}` : `Alt+${key}`;
}

/** A row that opened a submenu, with the submenu it opened and how it was opened. */
interface OpenSubmenu {
  readonly name: SubmenuName;
  readonly row: HTMLButtonElement;
  readonly opening: SubmenuOpening;
}

interface ScalesAndLinesMenuProps {
  /** The menu's own element, which the host measures to hang the menu above the gear. */
  readonly menuRef: RefObject<HTMLDivElement | null>;
  /** Whether the price scale fits the visible data right now, as the engine reports it. */
  readonly autoScale: boolean;
  readonly onSetAutoScale: (on: boolean) => void;
  readonly onResetView: () => void;
  readonly onOpenSettings: () => void;
  /** Closes the menu and hands the focus back to the gear it opened from. */
  readonly onClose: () => void;
}

/**
 * The Scales and lines menu the gear in the chart's corner opens: the scale's view commands, the shape it
 * saves, the submenus of what the price labels and lines draw, and the way into the dialog's remaining
 * settings. A row that changes something closes the menu behind it, the way TradingView's do.
 */
export function ScalesAndLinesMenu({
  menuRef,
  autoScale,
  onSetAutoScale,
  onResetView,
  onOpenSettings,
  onClose,
}: ScalesAndLinesMenuProps) {
  const { settings, keep } = useChartSettings();
  const platform = useAppPlatform();
  const macos = platform === 'macos';
  const scales = scalesAppearanceOf(settings.scales);
  const [openSubmenu, setOpenSubmenu] = useState<OpenSubmenu>();

  // The first row takes the focus as the menu opens, so the arrow keys walk the menu straight away.
  useEffect(() => {
    focusEndRow(menuRef.current, 'first');
  }, [menuRef]);

  const saveAndClose = (key: string, value: ChartSettingValue) => {
    keep(withScalesValue(settings, key, value));
    onClose();
  };
  /**
   * Closes the open submenu, along with the pointer leaving the menu and the submenu hanging beside it. A
   * submenu the keys opened holds the focus, so it goes back to the row that opened it and the keys walk on
   * from there; a submenu the pointer opened holds none, so the focus stays where it was.
   */
  const closeSubmenu = () => {
    if (openSubmenu === undefined) {
      return;
    }
    const { row } = openSubmenu;
    const holdsFocus = submenuHoldsFocus();
    setOpenSubmenu(undefined);
    if (holdsFocus) {
      row.focus();
    }
  };
  /** Opens the row's submenu as a press or a key asked it, so the submenu moves the focus onto its first row. */
  const activateSubmenu = (name: SubmenuName, row: HTMLButtonElement) =>
    setOpenSubmenu({ name, row, opening: 'activate' });
  /** Opens the row's submenu as the pointer's hover found it, which leaves the focus on the row it was on. */
  const hoverSubmenu = (name: SubmenuName, row: HTMLButtonElement) => {
    if (openSubmenu?.name === name) {
      return;
    }
    closeSubmenu();
    setOpenSubmenu({ name, row, opening: 'hover' });
  };
  /**
   * Any other row of the menu closes the open submenu. A row that carries a submenu is left to its own hover,
   * which opens or keeps that one, so the pointer switches from one submenu to the other the way it reads.
   */
  const hoverMenuRow = (event: PointerEvent<HTMLDivElement>) => {
    const row = menuRowUnder(event.target);
    if (row === undefined || carriesSubmenu(row)) {
      return;
    }
    closeSubmenu();
  };

  return (
    <div
      ref={menuRef}
      className="ticket-menu chart-context-menu scales-and-lines-menu"
      role="menu"
      aria-label="Scales and lines"
      onKeyDown={(event) => handleMenuKey(event, menuRef.current, onClose)}
      onPointerOver={hoverMenuRow}
      onPointerLeave={closeSubmenu}
    >
      {!autoScale && (
        <>
          <ScalesAndLinesMenuRow
            kind="command"
            icon={<ResetViewIcon className="chart-context-menu-icon" />}
            label="Reset price scale"
            shortcut={platform && resetViewShortcutLabel(platform)}
            onActivate={onResetView}
          />
          {SEPARATOR}
        </>
      )}
      <ScalesAndLinesMenuRow
        kind="checkbox"
        checked={autoScale}
        label="Auto (fits data to screen)"
        onActivate={() => onSetAutoScale(!autoScale)}
      />
      <ScalesAndLinesMenuRow
        kind="checkbox"
        checked={scales.invertScale}
        label="Invert scale"
        shortcut={altShortcut('I', macos)}
        onActivate={() => saveAndClose('invertScale', !scales.invertScale)}
      />
      {SEPARATOR}
      <ScalesAndLinesMenuRow
        kind="radio"
        checked={scales.priceScaleMode === 'regular'}
        label="Regular"
        onActivate={() => saveAndClose('priceScaleMode', 'regular')}
      />
      <ScalesAndLinesMenuRow
        kind="radio"
        checked={scales.priceScaleMode === 'logarithmic'}
        label="Logarithmic"
        shortcut={altShortcut('L', macos)}
        onActivate={() => saveAndClose('priceScaleMode', 'logarithmic')}
      />
      {SEPARATOR}
      {SUBMENUS.map(({ name, label }) => (
        <Fragment key={name}>
          <ScalesAndLinesMenuRow
            kind="submenu"
            name={name}
            label={label}
            expanded={openSubmenu?.name === name}
            onActivate={(row) => activateSubmenu(name, row)}
            onHover={(row) => hoverSubmenu(name, row)}
          />
          {openSubmenu !== undefined && openSubmenu.name === name && (
            <ScalesAndLinesSubmenu
              label={label}
              row={openSubmenu.row}
              opening={openSubmenu.opening}
              onClose={() => setOpenSubmenu(undefined)}
            >
              <ScalesAndLinesSubmenuRows submenu={name} onSaved={onClose} />
            </ScalesAndLinesSubmenu>
          )}
        </Fragment>
      ))}
      {SEPARATOR}
      <ScalesAndLinesMenuRow
        kind="command"
        icon={<SettingsIcon className="chart-context-menu-icon" />}
        label="More settings"
        onActivate={onOpenSettings}
      />
    </div>
  );
}
