import { useLayoutEffect, useRef, useState, type DragEvent, type KeyboardEvent, type RefObject } from 'react';
import { arrowStep, type ArrowSteps } from '../../shared/ui/keyboard/arrowStep';
import { dropEdgeAt, dropTargetIndex, type DropEdge, type DropIndicator } from './layerDropTarget';
import { focusRowNameAt, walkRowFocus } from './objectTreeRowFocus';

/** What a reorderable row spreads on its `<li>`: the HTML5 drag events, and the attributes object-tree.css selects. */
export interface ReorderableRowItemProps {
  readonly draggable: true;
  readonly 'data-row-index': number;
  /** 'true' while this row is the dragged one, which dims it. */
  readonly 'data-dragging': 'true' | undefined;
  /** The side of this row a drop would land on: undefined for every row the pointer is not over. */
  readonly 'data-drop-edge': DropEdge | undefined;
  readonly onDragStart: (event: DragEvent<HTMLLIElement>) => void;
  readonly onDragOver: (event: DragEvent<HTMLLIElement>) => void;
  readonly onDragLeave: () => void;
  readonly onDrop: (event: DragEvent<HTMLLIElement>) => void;
  readonly onDragEnd: () => void;
}

/** Everything one row needs to take part in the reordering. */
export interface RowReorder {
  readonly listItemProps: ReorderableRowItemProps;
  /** The row's name-button keys: Alt+Arrow moves the row, a plain arrow walks focus to the next one. */
  readonly onNameKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => void;
}

export interface RowReorderList {
  readonly forRow: (rowIndex: number) => RowReorder;
  /** The list the moved row's focus is handed back through. */
  readonly listRef: RefObject<HTMLUListElement | null>;
}

/** Alt+Arrow moves the row one place: up the tree is toward the top of the list. */
const MOVE_STEPS: ArrowSteps = { ArrowUp: -1, ArrowDown: 1 };

/**
 * Reordering of a topmost-first row list: a row drags with HTML5 drag and drop, or moves with Alt+Arrow while
 * it holds focus. Both hand the move to `moveRow`, which owns what it does — a drawing moves through the
 * chart, an indicator through the saved settings — and a keyboard move keeps focus on the moved row. The
 * price pane's rows cross kinds, so one list holds the drawings, the price bars and its indicators together.
 */
export function useLayerReorder(
  rowCount: number,
  moveRow: (fromIndex: number, toIndex: number) => void,
): RowReorderList {
  const listRef = useRef<HTMLUListElement>(null);
  const [draggingIndex, setDraggingIndex] = useState<number | null>(null);
  const [dropIndicator, setDropIndicator] = useState<DropIndicator | null>(null);
  const [focusAfterMove, setFocusAfterMove] = useState<number | null>(null);

  // The moved row is another element after the re-render, so its focus is handed back here.
  useLayoutEffect(() => {
    if (focusAfterMove === null || listRef.current === null) {
      return;
    }
    focusRowNameAt(listRef.current, focusAfterMove);
    setFocusAfterMove(null);
  }, [focusAfterMove]);

  const endDrag = () => {
    setDraggingIndex(null);
    setDropIndicator(null);
  };

  const moveRowByKey = (rowIndex: number, step: number) => {
    const targetIndex = rowIndex + step;
    if (targetIndex < 0 || targetIndex >= rowCount) {
      return;
    }
    moveRow(rowIndex, targetIndex);
    setFocusAfterMove(targetIndex);
  };

  const onDragOver = (rowIndex: number, event: DragEvent<HTMLLIElement>) => {
    if (draggingIndex === null) {
      return;
    }
    // preventDefault is what makes this row a drop target.
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    const edge = dropEdgeAt(event);
    setDropIndicator((current) =>
      current?.index === rowIndex && current.edge === edge ? current : { index: rowIndex, edge },
    );
  };

  const onDrop = (rowIndex: number, event: DragEvent<HTMLLIElement>) => {
    event.preventDefault();
    const source = draggingIndex;
    endDrag();
    if (source === null) {
      return;
    }
    // A drop on the row's own place moves nothing.
    const targetIndex = dropTargetIndex(source, rowIndex, dropEdgeAt(event));
    if (targetIndex !== source) {
      moveRow(source, targetIndex);
    }
  };

  const forRow = (rowIndex: number): RowReorder => ({
    listItemProps: {
      draggable: true,
      'data-row-index': rowIndex,
      'data-dragging': draggingIndex === rowIndex ? 'true' : undefined,
      'data-drop-edge': dropIndicator?.index === rowIndex ? dropIndicator.edge : undefined,
      onDragStart: (event) => {
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('text/plain', String(rowIndex));
        setDraggingIndex(rowIndex);
      },
      onDragOver: (event) => onDragOver(rowIndex, event),
      onDragLeave: () => setDropIndicator(null),
      onDrop: (event) => onDrop(rowIndex, event),
      onDragEnd: endDrag,
    },
    onNameKeyDown: (event) => {
      const step = arrowStep(event.key, MOVE_STEPS);
      if (event.altKey && step !== undefined) {
        event.preventDefault();
        moveRowByKey(rowIndex, step);
        return;
      }
      walkRowFocus(event);
    },
  });

  return { forRow, listRef };
}
