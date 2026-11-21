import { useEffect, useRef, useState, type KeyboardEvent, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { initialOptionIndex, movedOptionIndex, typedOptionIndex } from './selectNavigation';
import type { SelectOption } from './selectOption';
import { useOutsidePress } from '../popup/useOutsidePress';
import { usePopupPlacement } from '../popup/usePopupPlacement';

export type { SelectOption };

interface SelectListProps {
  readonly id: string;
  /** The id of the button that opened the list, which names it. */
  readonly buttonId: string;
  readonly options: readonly SelectOption[];
  readonly value: string;
  readonly anchorRef: RefObject<HTMLElement | null>;
  readonly onChoose: (value: string) => void;
  /** Closes the list; `returnFocus` is false when the user pressed elsewhere and focus should stay there. */
  readonly onClose: (returnFocus: boolean) => void;
  /** Extra class on the list, which is portalled to the body and so styled on its own (e.g. its font size). */
  readonly listClassName?: string;
}

function optionId(listId: string, index: number): string {
  return `${listId}-option-${index}`;
}

/**
 * The open list of a `Select`. It is portalled to the page body and fixed to the window, so no ancestor's
 * overflow clips it. Focus stays on the list itself and the highlight follows `aria-activedescendant`.
 * A disabled choice is listed, with its tooltip, and no key, hover or click can pick it.
 */
export function SelectList({
  id,
  buttonId,
  options,
  value,
  anchorRef,
  onChoose,
  onClose,
  listClassName,
}: SelectListProps) {
  const listRef = useRef<HTMLUListElement>(null);
  const [activeIndex, setActiveIndex] = useState(() => initialOptionIndex(options, value));
  usePopupPlacement(anchorRef, listRef, { matchAnchorWidth: true });
  useOutsidePress(listRef, anchorRef, () => onClose(false));

  useEffect(() => {
    listRef.current?.focus();
  }, []);
  useEffect(() => {
    document.getElementById(optionId(id, activeIndex))?.scrollIntoView({ block: 'nearest' });
  }, [id, activeIndex]);

  const choose = (option: SelectOption) => {
    if (option.disabled !== true) {
      onChoose(option.value);
    }
  };
  const chooseActive = () => {
    const active = options[activeIndex];
    if (active !== undefined) {
      choose(active);
    }
  };
  const highlight = (index: number, option: SelectOption) => {
    if (option.disabled !== true) {
      setActiveIndex(index);
    }
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLUListElement>) => {
    const moved = movedOptionIndex(event.key, activeIndex, options);
    if (moved !== undefined) {
      event.preventDefault();
      setActiveIndex(moved);
    } else if (event.key === 'Enter') {
      // Prevented so no keypress follows to the button that takes the focus back.
      event.preventDefault();
      chooseActive();
    } else if (event.key === ' ') {
      // Chosen on keyup: choosing on keydown would hand the focus, and the key's release, to the button.
      event.preventDefault();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      onClose(true);
    } else if (event.key === 'Tab') {
      onClose(true);
    } else if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
      const typed = typedOptionIndex(event.key, activeIndex, options);
      if (typed !== undefined) {
        setActiveIndex(typed);
      }
    }
  };

  const handleKeyUp = (event: KeyboardEvent<HTMLUListElement>) => {
    if (event.key === ' ') {
      event.preventDefault();
      chooseActive();
    }
  };

  return createPortal(
    <ul
      ref={listRef}
      id={id}
      className={`select-list popup-surface${listClassName ? ` ${listClassName}` : ''}`}
      role="listbox"
      tabIndex={-1}
      aria-labelledby={buttonId}
      aria-activedescendant={optionId(id, activeIndex)}
      onKeyDown={handleKeyDown}
      onKeyUp={handleKeyUp}
    >
      {options.map((option, index) => (
        <li
          key={option.value}
          id={optionId(id, index)}
          className="select-option"
          role="option"
          aria-selected={option.value === value}
          aria-disabled={option.disabled === true ? true : undefined}
          title={option.title}
          data-active={index === activeIndex}
          onMouseMove={() => highlight(index, option)}
          onClick={() => choose(option)}
        >
          <span>{option.label}</span>
          <span className="select-check" aria-hidden="true">
            ✓
          </span>
        </li>
      ))}
    </ul>,
    document.body,
  );
}
