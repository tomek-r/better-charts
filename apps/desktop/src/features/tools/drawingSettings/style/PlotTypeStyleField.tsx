import { useLayoutEffect, useRef, useState, type KeyboardEvent, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import type { SettingValue, SettingValues } from '../../../chart/engine/settings/settingInputs';
import {
  settingStyleKey,
  type SettingStyleChoiceOption,
  type SettingStylePlotType,
} from '../../../chart/engine/settings/settingStyles';
import { focusCheckedRow, handleMenuKey } from '../../../../shared/ui/popup/popupMenuKeys';
import { useOutsidePress } from '../../../../shared/ui/popup/useOutsidePress';
import { usePopupPlacement } from '../../../../shared/ui/popup/usePopupPlacement';
import { stringText } from '../inputs/settingInputFields';
import type { SettingStyleFieldProps } from './settingStyleFieldProps';
import { plotTypeIcon } from './plotTypeIcons';

/** The switch every plot offers above its list of types: whether a line is drawn at its last value. */
const CURRENT_VALUE_LINE_LABEL = 'Current value line';

/** The entry `value` names, or nothing when the list has no such entry. */
function optionNamed(
  options: readonly SettingStyleChoiceOption[],
  value: string,
): SettingStyleChoiceOption | undefined {
  return options.find((option) => option.value === value);
}

/** Runs the key the menu answers to, keeping Escape in it so the settings dialog under it keeps its own. */
function handlePlotTypeMenuKey(
  event: KeyboardEvent<HTMLDivElement>,
  menu: HTMLElement | null,
  onClose: () => void,
): void {
  if (event.key === 'Escape') {
    event.stopPropagation();
  }
  handleMenuKey(event, menu, onClose);
}

/** One plot type of the list: its icon and its name; the one in use is shown by its highlight alone. */
function PlotTypeRow({
  option,
  checked,
  onChoose,
}: {
  readonly option: SettingStyleChoiceOption;
  readonly checked: boolean;
  readonly onChoose: () => void;
}) {
  return (
    <button
      type="button"
      role="menuitemradio"
      aria-checked={checked}
      className="popup-menu-row drawing-settings-plot-type-row"
      onClick={onChoose}
    >
      {plotTypeIcon(option.value)}
      <span className="drawing-settings-plot-type-label">{option.title}</span>
    </button>
  );
}

/** The switch above the list, drawn as a track whose thumb sits right while the price line is on. */
function PriceLineRow({ checked, onToggle }: { readonly checked: boolean; readonly onToggle: () => void }) {
  return (
    <button
      type="button"
      role="menuitemcheckbox"
      aria-checked={checked}
      className="popup-menu-row drawing-settings-plot-type-row"
      onClick={onToggle}
    >
      <span className="drawing-settings-plot-type-label">{CURRENT_VALUE_LINE_LABEL}</span>
      <span className="drawing-settings-plot-type-switch" aria-hidden="true">
        <span />
      </span>
    </button>
  );
}

interface PlotTypeMenuProps {
  readonly definition: SettingStylePlotType;
  readonly values: SettingValues;
  readonly onChange: (key: string, value: SettingValue) => void;
  /** The button the menu hangs from, which an outside press counts as inside. */
  readonly anchorRef: RefObject<HTMLButtonElement | null>;
  /** Saves the chosen type, closes the menu and hands the focus back to its button. */
  readonly onChoose: (value: string) => void;
  /** Closes the menu for Escape, handing the focus back to its button. */
  readonly onClose: () => void;
  /** Closes the menu for a press elsewhere on the page, which leaves the focus where the press put it. */
  readonly onDismiss: () => void;
}

/**
 * The open list: the Current value line switch, a separator, then every plot type. It is portalled to the page
 * body so the dialog's scrolling panel cannot clip it, and the switch leaves it open while a type closes it.
 */
function PlotTypeMenu({ definition, values, onChange, anchorRef, onChoose, onClose, onDismiss }: PlotTypeMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  usePopupPlacement(anchorRef, menuRef);
  useOutsidePress(menuRef, anchorRef, onDismiss);
  // The focus lands on the type in use as the menu opens, so the keys walk the list straight away.
  useLayoutEffect(() => {
    focusCheckedRow(menuRef.current);
  }, []);
  const priceLineKey = settingStyleKey(definition.priceLineId, 'visible');
  const priceLineOn = values[priceLineKey] === true;
  const currentType = stringText(values[definition.id]);
  return createPortal(
    <div
      ref={menuRef}
      className="popup-surface drawing-settings-plot-type-menu"
      role="menu"
      aria-label={definition.title}
      onKeyDown={(event) => handlePlotTypeMenuKey(event, menuRef.current, onClose)}
    >
      <PriceLineRow checked={priceLineOn} onToggle={() => onChange(priceLineKey, !priceLineOn)} />
      <div role="separator" className="drawing-settings-plot-type-separator" />
      {definition.options.map((option) => (
        <PlotTypeRow
          key={option.value}
          option={option}
          checked={option.value === currentType}
          onChoose={() => onChoose(option.value)}
        />
      ))}
    </div>,
    document.body,
  );
}

/**
 * The Plot type button of a plot: it shows how the plot is drawn and opens the list of the ways it could be.
 * It draws no title of its own, so a style row can draw it beside that row's own controls. A press elsewhere
 * closes the list alone, so the settings dialog under it stays open.
 */
export function PlotTypeButton({ definition, values, onChange, disabled }: SettingStyleFieldProps<'plotType'>) {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const currentType = stringText(values[definition.id]);
  const current = optionNamed(definition.options, currentType);
  const close = (): void => {
    setOpen(false);
    buttonRef.current?.focus();
  };
  const choose = (value: string): void => {
    onChange(definition.id, value);
    close();
  };
  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className="drawing-settings-plot-type-trigger"
        aria-label={definition.title}
        aria-haspopup="menu"
        aria-expanded={open}
        title={current?.title ?? currentType}
        disabled={disabled}
        onClick={() => setOpen((currentOpen) => !currentOpen)}
      >
        {plotTypeIcon(currentType)}
      </button>
      {open ? (
        <PlotTypeMenu
          definition={definition}
          values={values}
          onChange={onChange}
          anchorRef={buttonRef}
          onChoose={choose}
          onClose={close}
          onDismiss={() => setOpen(false)}
        />
      ) : null}
    </>
  );
}

/** The Style row of a plot that keeps a row of its own: its title, then the Plot type button. */
export function PlotTypeStyleField(props: SettingStyleFieldProps<'plotType'>) {
  return (
    <>
      <span className="drawing-settings-style-title">{props.definition.title}</span>
      <PlotTypeButton {...props} />
    </>
  );
}
