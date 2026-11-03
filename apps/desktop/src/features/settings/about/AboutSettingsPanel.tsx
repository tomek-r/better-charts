import type { ReactNode } from 'react';
import { openUrl } from '@tauri-apps/plugin-opener';

const TRADINGVIEW_URL = 'https://www.tradingview.com/';
const LIGHTWEIGHT_CHARTS_LICENSE_URL = 'https://github.com/tradingview/lightweight-charts/blob/master/LICENSE';

/** A link to a page outside the app. The webview cannot open the system browser itself, so the click
 * hands the address to the opener plugin and the app stays where it is. */
function ExternalLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a
      className="settings-link"
      href={href}
      onClick={(event) => {
        event.preventDefault();
        void openUrl(href);
      }}
    >
      {children}
    </a>
  );
}

export function AboutSettingsPanel() {
  return (
    <>
      <h3>Third-party software</h3>
      <p className="settings-hint">
        Charts are drawn with TradingView Lightweight Charts™, licensed under the{' '}
        <ExternalLink href={LIGHTWEIGHT_CHARTS_LICENSE_URL}>Apache License 2.0</ExternalLink>.
      </p>
      <p className="settings-hint">
        TradingView Lightweight Charts™ Copyright © 2025 TradingView, Inc.{' '}
        <ExternalLink href={TRADINGVIEW_URL}>tradingview.com</ExternalLink>
      </p>
    </>
  );
}
