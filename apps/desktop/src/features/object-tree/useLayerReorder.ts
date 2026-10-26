import { useLayoutEffect, useRef, useState, type DragEvent, type KeyboardEvent, type RefObject } from 'react';
import { useChartResources } from '../chart/ChartWorkspaceProvider';
import { dropEdgeAt, dropTargetIndex, type DropEdge, type LayerDropIndicator } from './layerDropTarget';
import { focusLayerNameAt, walkRowFocus } from './objectTreeRowFocus';

/** What a row spreads on its `<li>`: the HTML5 drag events, and the attributes object-tree.css selects. */
export interface LayerRowListItemProps {
  readonly draggable: true;
  readonly 'data-layer-index': number;
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
export interface LayerRowReorder {
  readonly listItemProps: LayerRowListItemProps;
  /** The row's name-button keys: Alt+Arrow moves the row, a plain arrow walks focus to the next one. */
  readonly onNameKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => void;
}

export interface LayerReorder {
  readonly forRow: (layerIndex: number) => LayerRowReorder;
  /** The list the moved row's focus is handed back through. */
  readonly listRef: RefObject<HTMLUListElement | null>;
}

/** Alt+Arrow moves the row one place: up the tree is toward the top of the list. */
const MOVE_STEPS: Readonly<Partial<Record<string, number>>> = { ArrowUp: -1, ArrowDown: 1 };

/**
 * Reordering of the topmost-first layer list: a row drags with HTML5 drag and drop, or moves with
 * Alt+Arrow while it holds focus. Both move one entry through the chart, which saves the order and
 * repaints by itself; a keyboard move also keeps focus on the moved row.
 */
export function useLayerReorder(layerCount: number): LayerReorder {
  const { chart } = useChartResources();
  const listRef = useRef<HTMLUListElement>(null);
  const [draggingIndex, setDraggingIndex] = useState<number | null>(null);
  const [dropIndicator, setDropIndicator] = useState<LayerDropIndicator | null>(null);
  const [focusAfterMove, setFocusAfterMove] = useState<number | null>(null);

  // The moved row is another element after the re-render, so its focus is handed back here.
  useLayoutEffect(() => {
    if (focusAfterMove === null || listRef.current === null) {
      return;
    }
    focusLayerNameAt(listRef.current, focusAfterMove);
    setFocusAfterMove(null);
  }, [focusAfterMove]);

  const endDrag = () => {
    setDraggingIndex(null);
    setDropIndicator(null);
  };

  const moveRowByKey = (layerIndex: number, step: number) => {
    const targetIndex = layerIndex + step;
    if (targetIndex < 0 || targetIndex >= layerCount) {
      return;
    }
    chart.current?.drawings.moveLayer(layerIndex, targetIndex);
    setFocusAfterMove(targetIndex);
  };

  const onDragOver = (layerIndex: number, event: DragEvent<HTMLLIElement>) => {
    if (draggingIndex === null) {
      return;
    }
    // preventDefault is what makes this row a drop target.
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    const edge = dropEdgeAt(event);
    setDropIndicator((current) =>
      current?.index === layerIndex && current.edge === edge ? current : { index: layerIndex, edge },
    );
  };

  const onDrop = (layerIndex: number, event: DragEvent<HTMLLIElement>) => {
    event.preventDefault();
    const source = draggingIndex;
    endDrag();
    if (source !== null) {
      chart.current?.drawings.moveLayer(source, dropTargetIndex(source, layerIndex, dropEdgeAt(event)));
    }
  };

  const forRow = (layerIndex: number): LayerRowReorder => ({
    listItemProps: {
      draggable: true,
      'data-layer-index': layerIndex,
      'data-dragging': draggingIndex === layerIndex ? 'true' : undefined,
      'data-drop-edge': dropIndicator?.index === layerIndex ? dropIndicator.edge : undefined,
      onDragStart: (event) => {
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('text/plain', String(layerIndex));
        setDraggingIndex(layerIndex);
      },
      onDragOver: (event) => onDragOver(layerIndex, event),
      onDragLeave: () => setDropIndicator(null),
      onDrop: (event) => onDrop(layerIndex, event),
      onDragEnd: endDrag,
    },
    onNameKeyDown: (event) => {
      const step = MOVE_STEPS[event.key];
      if (event.altKey && step !== undefined) {
        event.preventDefault();
        moveRowByKey(layerIndex, step);
        return;
      }
      walkRowFocus(event);
    },
  });

  return { forRow, listRef };
}
