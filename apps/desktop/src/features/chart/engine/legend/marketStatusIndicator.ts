import { NO_MARKET_SESSION_LABEL, type MarketStatus } from './marketStatus';

/** The dot's own class, plus the market-status class that colours it. */
const CLASS_BY_STATUS: Record<MarketStatus, string> = {
  open: 'chart-market-dot chart-market-open',
  closed: 'chart-market-dot chart-market-closed',
  unknown: 'chart-market-dot chart-market-unknown',
};

/**
 * The market-session dot beside the legend's OHLC text: green while the shown symbol's market is
 * open, red while it is closed, grey while that is unknown. The verdict travels as the dot's
 * tooltip and screen-reader label, so the caller words it.
 */
export class MarketStatusIndicator {
  private readonly element: HTMLSpanElement;

  constructor(container: HTMLElement) {
    this.element = document.createElement('span');
    this.element.setAttribute('role', 'status');
    container.appendChild(this.element);
    this.set('unknown', NO_MARKET_SESSION_LABEL);
  }

  set(status: MarketStatus, label: string): void {
    this.element.className = CLASS_BY_STATUS[status];
    this.element.setAttribute('aria-label', label);
    this.element.title = label;
  }

  destroy(): void {
    this.element.remove();
  }
}
