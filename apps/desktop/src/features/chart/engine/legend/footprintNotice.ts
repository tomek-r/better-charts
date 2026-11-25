/** What the footprint data behind the drawn bars does not cover, as the legend reports it. */
export interface FootprintNotices {
  /** The opening time of the newest bar the host stopped reading inside; null when it read every bar whole. */
  readonly incompleteBeforeMs: number | null;
  /** Whether the volumes drawn are the trades the host counted, because it reports no volume of its own. */
  readonly tickVolume: boolean;
}

/** The label the notice starts with, the two things it can say, and what separates them. */
const NOTICE_LABEL = 'Footprint: ';
const INCOMPLETE_TEXT = 'incomplete tick data before ';
const TICK_VOLUME_TEXT = 'volume = tick count';
const NOTICE_SEPARATOR = ' · ';
/** The gap the notice keeps from the legend text before it, in host CSS px. */
const NOTICE_GAP = '8px';
/** The class of the market-session dot the notice sits in front of. */
const MARKET_DOT_CLASS = 'chart-market-dot';

/** Nothing to report: every bar was read whole and its volumes are the broker's own. */
export const NO_FOOTPRINT_NOTICES: FootprintNotices = { incompleteBeforeMs: null, tickVolume: false };

/**
 * What the legend says about `notices`, empty while the data is complete and counted in lots. The date is
 * written by `timeLabel`, the chart's own time format, so the notice reads like the axis and the pointer.
 */
export function footprintNoticeText(notices: FootprintNotices, timeLabel: (atMs: number) => string): string {
  const parts: string[] = [];
  if (notices.incompleteBeforeMs !== null) {
    parts.push(`${INCOMPLETE_TEXT}${timeLabel(notices.incompleteBeforeMs)}`);
  }
  if (notices.tickVolume) {
    parts.push(TICK_VOLUME_TEXT);
  }
  if (parts.length === 0) {
    return '';
  }
  return `${NOTICE_LABEL}${parts.join(NOTICE_SEPARATOR)}`;
}

/**
 * The footprint notice beside the legend's OHLC text: in the legend only while it has something to report,
 * just in front of the market-session dot that sits next to it, so a quiet legend keeps just its own spans.
 */
export class FootprintNotice {
  private readonly container: HTMLElement;
  private readonly element: HTMLSpanElement;

  constructor(container: HTMLElement) {
    this.container = container;
    this.element = document.createElement('span');
    this.element.className = 'chart-footprint-notice';
    this.element.setAttribute('role', 'status');
    this.element.style.marginLeft = NOTICE_GAP;
    this.element.hidden = true;
  }

  /**
   * Writes what `notices` says in the chart's own time format. Something to say puts the notice in the legend
   * in front of the market dot; nothing to say takes it back out of the DOM.
   */
  set(notices: FootprintNotices, timeLabel: (atMs: number) => string): void {
    const text = footprintNoticeText(notices, timeLabel);
    this.element.textContent = text;
    this.element.hidden = text === '';
    if (text === '') {
      this.element.remove();
      return;
    }
    this.container.insertBefore(this.element, this.insertionPoint());
  }

  destroy(): void {
    this.element.remove();
  }

  /** The dot the notice goes before, or the legend's last span, or null when it simply belongs at the end. */
  private insertionPoint(): Element | null {
    const dot = this.container.querySelector(`.${MARKET_DOT_CLASS}`);
    if (dot !== null) {
      return dot;
    }
    const last = this.container.lastElementChild;
    return last instanceof HTMLSpanElement && last !== this.element ? last : null;
  }
}
