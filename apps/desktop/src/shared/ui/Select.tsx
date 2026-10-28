import { useId, useRef, useState, type KeyboardEvent } from 'react';
import { CaretIcon } from './CaretIcon';
import { SelectList, type SelectOption } from './SelectList';

export type { SelectOption };

/** Keys that open a closed select, besides the click that Enter and Space already make on a button. */
const OPENING_KEYS: ReadonlySet<string> = new Set(['ArrowDown', 'ArrowUp']);

interface SelectProps {
  readonly options: readonly SelectOption[];
  readonly value: string;
  readonly onChange: (value: string) => void;
  /** The button's id, which a `<label htmlFor>` points at. */
  readonly id?: string;
  /** The accessible name when no visible `<label>` names the button. */
  readonly ariaLabel?: string;
  readonly disabled?: boolean;
  readonly invalid?: boolean;
  readonly title?: string;
  readonly describedBy?: string;
  readonly className?: string;
  /** Extra class on the open list, which is portalled to the body and so styled on its own (e.g. its font size). */
  readonly listClassName?: string;
}

/**
 * An app-styled single choice, in place of the native `<select>` whose popup the operating system draws.
 * The button shows the chosen option; the list is an ARIA listbox opened by click, Enter, Space or the
 * up and down arrows, moved with the arrows, Home, End or a typed first letter, and closed by Escape, Tab
 * or a press outside it.
 */
export function Select({
  options,
  value,
  onChange,
  id,
  ariaLabel,
  disabled,
  invalid,
  title,
  describedBy,
  className,
  listClassName,
}: SelectProps) {
  const generatedId = useId();
  const buttonId = id ?? generatedId;
  const listId = `${generatedId}-list`;
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);

  const close = (returnFocus: boolean) => {
    setOpen(false);
    if (returnFocus) {
      buttonRef.current?.focus();
    }
  };
  const choose = (next: string) => {
    onChange(next);
    close(true);
  };
  const openWithArrow = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (OPENING_KEYS.has(event.key)) {
      event.preventDefault();
      setOpen(true);
    }
  };

  return (
    <>
      <button
        ref={buttonRef}
        id={buttonId}
        type="button"
        className={`select-button${className ? ` ${className}` : ''}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-label={ariaLabel}
        aria-describedby={describedBy}
        aria-invalid={invalid}
        title={title}
        disabled={disabled}
        onClick={() => setOpen((current) => !current)}
        onKeyDown={openWithArrow}
      >
        <span className="select-value">{options.find((option) => option.value === value)?.label ?? ''}</span>
        <CaretIcon className="select-caret" />
      </button>
      {open ? (
        <SelectList
          id={listId}
          buttonId={buttonId}
          options={options}
          value={value}
          anchorRef={buttonRef}
          onChoose={choose}
          onClose={close}
          listClassName={listClassName}
        />
      ) : null}
    </>
  );
}
