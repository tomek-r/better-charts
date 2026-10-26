import { newChartDrawingId, type ChartDrawingPoint, type ChartToolDrawingRecord } from './drawingRecord';
import { resolveToolInputValues, type ToolInputValues } from './toolInputs';
import type {
  ChartDrawingAnchor,
  ChartDrawingFactory,
  ChartDrawingPointRule,
  ChartDrawingRules,
  ChartDrawingShape,
  ChartToolDrawings,
} from './toolDrawings';

/** The check one anchor kind makes of a stored point; keyed by kind, so adding one is one entry here. */
const ANCHOR_HELD: Record<ChartDrawingAnchor, (point: ChartDrawingPoint) => boolean> = {
  time: (point) => point.timeMs !== null,
  price: (point) => point.price !== null,
  timePrice: (point) => point.timeMs !== null && point.price !== null,
};

/** Whether a stored anchor list is the shape one drawing of the tool always carries. */
function pointsHeldByRule(points: readonly ChartDrawingPoint[], rule: ChartDrawingPointRule): boolean {
  const { min, max, anchor } = rule;
  const countHeld = points.length >= min && points.length <= max;
  return countHeld && points.every((point) => ANCHOR_HELD[anchor](point));
}

/** One drawing with the state the collection owns for it. */
export interface ChartDrawingEntry<Drawing extends ChartDrawingShape> {
  readonly id: string;
  readonly drawing: Drawing;
  readonly locked: boolean;
  readonly visible: boolean;
  readonly inputs: ToolInputValues;
  readonly selected: boolean;
}

/** The state a drawing joins the collection with; what is left out starts at the tool's default. */
export interface ChartDrawingStart {
  /** The id the app stored it under; a drawing added without one gets a fresh id. */
  readonly id?: string;
  readonly locked?: boolean;
  readonly visible?: boolean;
  readonly inputs?: ToolInputValues;
}

/** One drawing as the collection keeps it: the lock, the visibility and the settings change in place. */
interface KeptDrawing<Drawing extends ChartDrawingShape> {
  readonly id: string;
  readonly drawing: Drawing;
  locked: boolean;
  visible: boolean;
  inputs: ToolInputValues;
}

/**
 * Everything the drawings of one tool share: the paint order (the last drawing is the topmost), the
 * selection, each drawing's lock, visibility and settings, and the records the app stores. What stays
 * with the tool is the gesture that places a drawing, how a drawing paints itself and how it is hit.
 *
 * The settings and the anchors are checked against the tool's own rules, so a stored record the tool
 * could not paint again is dropped before it reaches a drawing.
 */
export class ChartDrawingCollection<Drawing extends ChartDrawingShape> implements ChartToolDrawings {
  /** Paint order: the last drawing sits on top and is the first one a hit test finds. */
  private readonly kept: KeptDrawing<Drawing>[] = [];
  private selectedId: string | null = null;

  constructor(
    private readonly rules: ChartDrawingRules,
    private readonly factory: ChartDrawingFactory<Drawing>,
    private readonly requestRepaint: () => void,
  ) {}

  /**
   * Adds a drawing on top of the paint order, unlocked, visible and with the tool's default settings
   * unless the state says otherwise, and answers its id. The drawing hears its visibility at once, so
   * it starts or suspends whatever work it owns.
   */
  add(drawing: Drawing, state: ChartDrawingStart = {}): string {
    const id = this.keep(drawing, state);
    this.requestRepaint();
    return id;
  }

  /** Every drawing, bottom to top, with the state a paint pass or a gesture needs. */
  entries(): readonly ChartDrawingEntry<Drawing>[] {
    return this.kept.map(({ id, drawing, locked, visible, inputs }) => ({
      id,
      drawing,
      locked,
      visible,
      inputs,
      selected: id === this.selectedId,
    }));
  }

  isLocked(drawingId: string): boolean {
    return this.find(drawingId)?.locked ?? false;
  }

  isVisible(drawingId: string): boolean {
    return this.find(drawingId)?.visible ?? false;
  }

  /** Whether that drawing is visible and holds the pane point: the test the chart's stacking order walks. */
  hits(drawingId: string, x: number, y: number): boolean {
    const entry = this.find(drawingId);
    return entry !== undefined && entry.visible && entry.drawing.contains(x, y);
  }

  /** The ids of the drawings, bottom to top: cheap, because the points of a drawing are not read. */
  drawingIds(): readonly string[] {
    return this.kept.map(({ id }) => id);
  }

  /** Reorders the drawings to the given ids, ignoring unknown ones and keeping unlisted ones on top. */
  arrange(drawingIds: readonly string[]): void {
    const listed = drawingIds.flatMap((drawingId) => {
      const entry = this.find(drawingId);
      return entry === undefined ? [] : [entry];
    });
    const listedSet = new Set(listed);
    this.kept.splice(0, this.kept.length, ...listed, ...this.kept.filter((entry) => !listedSet.has(entry)));
    this.requestRepaint();
  }

  /** Paints the highlight on one drawing; an id the collection does not hold clears the selection. */
  select(drawingId: string | null): void {
    const selectedId = drawingId !== null && this.find(drawingId) !== undefined ? drawingId : null;
    if (selectedId === this.selectedId) {
      return;
    }
    this.selectedId = selectedId;
    this.requestRepaint();
  }

  /** Removes one drawing and lets it release what it holds; false when the collection does not hold that id. */
  delete(drawingId: string): boolean {
    const index = this.kept.findIndex((entry) => entry.id === drawingId);
    if (index < 0) {
      return false;
    }
    const [entry] = this.kept.splice(index, 1);
    if (this.selectedId === entry.id) {
      this.selectedId = null;
    }
    entry.drawing.dispose();
    this.requestRepaint();
    return true;
  }

  /** A locked drawing ignores edit gestures; false when the collection does not hold that id. */
  setLocked(drawingId: string, locked: boolean): boolean {
    const entry = this.find(drawingId);
    if (entry === undefined) {
      return false;
    }
    entry.locked = locked;
    this.requestRepaint();
    return true;
  }

  /** Hides or shows one drawing; it hears about a real change only, and a hidden drawing loses the selection. */
  setVisible(drawingId: string, visible: boolean): boolean {
    const entry = this.find(drawingId);
    if (entry === undefined) {
      return false;
    }
    if (entry.visible !== visible) {
      entry.visible = visible;
      entry.drawing.visibilityChanged(visible);
    }
    if (!visible && this.selectedId === entry.id) {
      this.selectedId = null;
    }
    this.requestRepaint();
    return true;
  }

  /** Replaces one drawing's settings with the values the tool's definitions accept. */
  setInputs(drawingId: string, inputs: ToolInputValues): boolean {
    const entry = this.find(drawingId);
    if (entry === undefined) {
      return false;
    }
    entry.inputs = resolveToolInputValues(this.rules.inputs, inputs);
    this.requestRepaint();
    return true;
  }

  exportRecords(): ChartToolDrawingRecord[] {
    return this.kept.map(({ id, drawing, locked, visible, inputs }) => ({
      id,
      locked,
      visible,
      inputs,
      points: drawing.points(),
    }));
  }

  /** Replaces the whole set; a record whose anchors or settings the tool cannot paint again is dropped. */
  importRecords(records: readonly ChartToolDrawingRecord[]): void {
    this.forgetEveryDrawing();
    for (const record of records) {
      if (!pointsHeldByRule(record.points, this.rules.points)) {
        continue;
      }
      const drawing = this.factory.restore(record.points);
      if (drawing !== undefined) {
        this.keep(drawing, record);
      }
    }
    this.requestRepaint();
  }

  /** Drops every drawing, e.g. when the instrument it was drawn on went away, and the selection with it. */
  clear(): void {
    this.forgetEveryDrawing();
    this.requestRepaint();
  }

  /** Holds one drawing without reporting a repaint, so an import repaints once for the whole set. */
  private keep(drawing: Drawing, state: ChartDrawingStart): string {
    const kept: KeptDrawing<Drawing> = {
      id: state.id ?? newChartDrawingId(),
      drawing,
      locked: state.locked ?? false,
      visible: state.visible ?? true,
      inputs: resolveToolInputValues(this.rules.inputs, state.inputs),
    };
    this.kept.push(kept);
    drawing.visibilityChanged(kept.visible);
    return kept.id;
  }

  private forgetEveryDrawing(): void {
    for (const entry of this.kept.splice(0, this.kept.length)) {
      entry.drawing.dispose();
    }
    this.selectedId = null;
  }

  private find(drawingId: string): KeptDrawing<Drawing> | undefined {
    return this.kept.find((entry) => entry.id === drawingId);
  }
}
