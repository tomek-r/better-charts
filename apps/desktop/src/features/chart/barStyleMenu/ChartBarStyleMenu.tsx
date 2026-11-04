import { Fragment, useLayoutEffect, useRef, type RefObject } from 'react';
import { CaretIcon } from '../../../shared/ui/icons/CaretIcon';
import { CheckIcon } from '../../../shared/ui/icons/CheckIcon';
import { useOutsidePress } from '../../../shared/ui/popup/useOutsidePress';
import { usePopupPlacement } from '../../../shared/ui/popup/usePopupPlacement';
import { useChartSettings } from '../chartSettings/ChartSettingsProvider';
import { withBarStyle } from '../chartSettings/chartSettings';
import { BAR_STYLE_GROUPS, barStyleLabel, type BarStyle, type BarStyleOption } from '../engine/barStyle/barStyles';
import { BarStyleIcon } from './BarStyleIcon';
import { focusCheckedRow, handleMenuKey, useBarStyleMenu } from './useBarStyleMenu';
import './bar-style-menu.css';

/** One row of the menu: the bar type's icon and name, with a tick on the one the chart draws. */
function BarStyleMenuRow({
  option,
  checked,
  onChoose,
}: {
  readonly option: BarStyleOption;
  readonly checked: boolean;
  readonly onChoose: () => void;
}) {
  return (
    <button
      type="button"
      role="menuitemradio"
      aria-checked={checked}
      className="popup-menu-row bar-style-menu-row"
      onClick={onChoose}
    >
      <BarStyleIcon style={option.style} />
      <span className="bar-style-menu-label">{option.label}</span>
      {checked ? <CheckIcon className="bar-style-menu-check" /> : null}
    </button>
  );
}

/** Every bar type of every group, with a separator between the groups. */
function BarStyleMenuGroups({
  current,
  onChoose,
}: {
  readonly current: BarStyle;
  readonly onChoose: (style: BarStyle) => void;
}) {
  return (
    <>
      {BAR_STYLE_GROUPS.map((group, index) => (
        <Fragment key={group[0].style}>
          {index > 0 ? <div role="separator" className="bar-style-menu-separator" /> : null}
          {group.map((option) => (
            <BarStyleMenuRow
              key={option.style}
              option={option}
              checked={option.style === current}
              onChoose={() => onChoose(option.style)}
            />
          ))}
        </Fragment>
      ))}
    </>
  );
}

/** The open menu: it hangs under its trigger, takes the focus on the drawn bar type, and closes on a choice. */
function BarStyleMenuPanel({
  triggerRef,
  current,
  onChoose,
  onClose,
  onDismiss,
}: {
  readonly triggerRef: RefObject<HTMLButtonElement | null>;
  readonly current: BarStyle;
  readonly onChoose: (style: BarStyle) => void;
  /** Closes the menu and hands the focus back to the trigger. */
  readonly onClose: () => void;
  /** Closes the menu for a press elsewhere on the page. */
  readonly onDismiss: () => void;
}) {
  const menuRef = useRef<HTMLDivElement>(null);
  usePopupPlacement(triggerRef, menuRef);
  useOutsidePress(menuRef, triggerRef, onDismiss);
  // The focus lands on the bar type the chart draws as the menu opens, so the keys walk the list straight away.
  useLayoutEffect(() => {
    focusCheckedRow(menuRef.current);
  }, []);
  return (
    <div
      ref={menuRef}
      className="popup-surface bar-style-menu"
      role="menu"
      aria-label="Bar type"
      onKeyDown={(event) => handleMenuKey(event, menuRef.current, onClose)}
    >
      <BarStyleMenuGroups current={current} onChoose={onChoose} />
    </div>
  );
}

/**
 * The bar type button beside the timeframes: it shows the icon of the bar type the chart draws and opens the
 * list of the twelve in their groups. Choosing one saves it with the chart's settings.
 */
export function ChartBarStyleMenu() {
  const { settings, keep } = useChartSettings();
  const { open, triggerRef, toggle, close, dismiss } = useBarStyleMenu();
  const current = settings.barStyle;
  const choose = (style: BarStyle) => {
    close();
    keep(withBarStyle(settings, style));
  };
  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className="bar-style-trigger"
        aria-label="Bar type"
        aria-haspopup="menu"
        aria-expanded={open}
        title={barStyleLabel(current)}
        onClick={toggle}
      >
        <BarStyleIcon style={current} />
        <CaretIcon className="bar-style-trigger-caret" />
      </button>
      {open ? (
        <BarStyleMenuPanel
          triggerRef={triggerRef}
          current={current}
          onChoose={choose}
          onClose={close}
          onDismiss={dismiss}
        />
      ) : null}
    </>
  );
}
