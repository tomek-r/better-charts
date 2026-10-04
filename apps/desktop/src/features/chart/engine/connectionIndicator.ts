import type { BridgeState } from '../../../shared/bridge/types';

const LABELS: Record<BridgeState, string> = {
  connected: 'MT5 connected',
  connecting: 'MT5 connecting',
  protocol_error: 'MT5 connection error',
  disconnected: 'MT5 disconnected',
};

/**
 * The MT5 connection dot beside the legend. It maps a bridge state to the
 * `.chart-connection-<state>` class the stylesheet colours, and to the
 * screen-reader label and tooltip that go with it.
 *
 * The state names are the transport's own, so the class suffix, the label table
 * and `BridgeState` have to move together.
 */
export class ConnectionIndicator {
  private readonly element: HTMLSpanElement;

  constructor(container: HTMLElement) {
    this.element = document.createElement('span');
    this.element.className = 'chart-connection-dot chart-connection-disconnected';
    this.element.setAttribute('role', 'status');
    this.element.setAttribute('aria-label', 'MT5 disconnected');
    this.element.title = 'MT5 disconnected';
    container.appendChild(this.element);
  }

  set(state: BridgeState, message?: string): void {
    const label = LABELS[state];
    this.element.className = `chart-connection-dot chart-connection-${state}`;
    this.element.setAttribute('aria-label', label);
    this.element.title = message ?? label;
  }

  destroy(): void {
    this.element.remove();
  }
}
