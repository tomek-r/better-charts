import type { PositionDrag } from './positionOverlayTypes';

type DragKind = PositionDrag['kind'];

/** The dragged line renders at the preview price; every other line keeps its own. */
export function dragPrice(drag: PositionDrag | null, kind: DragKind, id: string, base: number | undefined) {
  return drag && drag.kind === kind && drag.id === id ? drag.price : base;
}

/** The live money label of the dragged level, else the committed one. */
export function dragMoney(drag: PositionDrag | null, kind: DragKind, id: string, fallback: string | undefined) {
  return drag && drag.kind === kind && drag.id === id && drag.money !== undefined ? drag.money : fallback;
}
