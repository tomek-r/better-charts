import type { BarStyleAppearance } from '../barStyleAppearance';

/**
 * The zoom the footprint style is drawn at, in host CSS px per bar. The sell column, the thin candle and
 * the buy column share the bar's body width, so at the default spacing each of them is a couple of pixels
 * wide and nothing in them can be read; a bar this wide leaves every column room for its volume.
 */
export const FOOTPRINT_BAR_SPACING = 160;

/** Two spacings this close are the same zoom: the library reports back the spacing it applied. */
const SPACING_TOLERANCE = 0.5;

/** What the zoom needs of the pane: its spacing, the index at its right edge, and a write that keeps it. */
export interface FootprintZoomPane {
  /** The zoom in force now, in host CSS px per bar. */
  barSpacing(): number;
  /** The logical range on screen, whose `to` is the right edge a zoom keeps in place; null before any bars. */
  visibleRange(): { from: number; to: number } | null;
  /** Sets the zoom while keeping the right edge index `to`, so the view does not jump sideways. */
  restoreViewport(to: number, barSpacing: number): void;
  /** The logical index of the newest bar; null before any bars. */
  newestBarIndex(): number | null;
}

/**
 * Gives the footprint style the room its columns need: choosing that style zooms the pane in to
 * FOOTPRINT_BAR_SPACING, and leaving it puts the spacing the user had back.
 *
 * Both writes keep the right edge index while it lies on a bar, so the bar at the right of the pane stays there,
 * and the width in px of any empty space past the newest bar otherwise. The spacing in
 * force before the zoom is remembered only while the style is shown, and it is put back only while the
 * pane still draws at FOOTPRINT_BAR_SPACING: a spacing the user zoomed to themselves is theirs to keep.
 */
export class FootprintZoom {
  /** Whether the footprint style is the one chosen, which is what makes the other calls mean anything. */
  private shown = false;
  /** The spacing the pane had when the style zoomed it in; null while the style needed no zoom. */
  private spacingBeforeZoom: number | null = null;

  constructor(private readonly pane: FootprintZoomPane) {}

  /** Follows a bar style change; applying the style already shown changes nothing. */
  followStyle(style: BarStyleAppearance['style']): void {
    if (style === 'volumeFootprint') {
      this.show();
      return;
    }
    this.hide();
  }

  /**
   * Puts the room back after the pane was reset to the default zoom. A chart opened on the saved footprint
   * style is reset on its first history load, which is what brings the bars this zoom needs.
   */
  ensureRoom(): void {
    if (!this.shown) {
      return;
    }
    this.zoomIn();
  }

  private show(): void {
    if (this.shown) {
      return;
    }
    this.shown = true;
    this.zoomIn();
  }

  private hide(): void {
    if (!this.shown) {
      return;
    }
    this.shown = false;
    const spacing = this.spacingBeforeZoom;
    this.spacingBeforeZoom = null;
    if (spacing === null || !this.drawsAtFootprintSpacing()) {
      return;
    }
    this.zoomTo(spacing);
  }

  /**
   * Zooms in unless the pane already has the room the style needs, remembering the spacing it had. With no
   * bar on screen yet there is no right edge to keep, so the room waits for `ensureRoom` after a reset.
   */
  private zoomIn(): void {
    const current = this.pane.barSpacing();
    if (current >= FOOTPRINT_BAR_SPACING) {
      return;
    }
    this.spacingBeforeZoom = current;
    this.zoomTo(FOOTPRINT_BAR_SPACING);
  }

  /** Whether the user has not zoomed away from the spacing this class applied. */
  private drawsAtFootprintSpacing(): boolean {
    return Math.abs(this.pane.barSpacing() - FOOTPRINT_BAR_SPACING) <= SPACING_TOLERANCE;
  }

  private zoomTo(barSpacing: number): void {
    const range = this.pane.visibleRange();
    if (range === null) {
      return;
    }
    this.pane.restoreViewport(this.rightEdgeAt(range.to, barSpacing), barSpacing);
  }

  /**
   * The right edge index a zoom to `barSpacing` keeps. Inside the bars it is the same index, so the bar there
   * stays put. Past the newest bar the empty space keeps its width in px instead: keeping its index would let a
   * zoom in fill the pane with that empty space and carry every bar off screen.
   */
  private rightEdgeAt(to: number, barSpacing: number): number {
    const newest = this.pane.newestBarIndex();
    if (newest === null || to <= newest) {
      return to;
    }
    return newest + ((to - newest) * this.pane.barSpacing()) / barSpacing;
  }
}
