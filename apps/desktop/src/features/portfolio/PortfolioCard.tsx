import type { AccountSnapshot, PendingModification, PortfolioSnapshot } from '../../shared/bridge/types';

/** MT5-style 2-decimal account figure for the live-trading account bar. */
function accountAmount(value?: string): string {
  const text = value?.trim();
  if (!text) {
    return '—';
  }
  const parsed = Number(text);
  return Number.isFinite(parsed)
    ? parsed.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : text;
}

export function PortfolioCard({
  portfolio,
  account,
  onOpenSymbol,
  closingTarget,
  requestClosePosition,
}: {
  portfolio: PortfolioSnapshot;
  account: AccountSnapshot | undefined;
  onOpenSymbol: (symbol: string) => Promise<void>;
  closingTarget: string | undefined;
  requestClosePosition: (
    source: 'portfolio' | 'draft',
    positionId: string,
    actedDraft?: PendingModification,
  ) => Promise<void>;
}) {
  if (portfolio.positions.length === 0) {
    return null;
  }

  const hasPositions = portfolio.positions.length > 0;

  return (
    <section className="portfolio-card" aria-label="Open positions">
      {/* Account state bar (MT5 layout): shown while at least one position is
          live, so balance/equity/margin sit with the trade that moves them. */}
      {hasPositions && account && (
        <div className="portfolio-account" aria-label="Account state">
          <span>
            <small>Balance</small>
            <b>
              {accountAmount(account.balance)}
              {account.currency ? ` ${account.currency}` : ''}
            </b>
          </span>
          <span>
            <small>Equity</small>
            <b>{accountAmount(account.equity)}</b>
          </span>
          <span>
            <small>Margin</small>
            <b>{accountAmount(account.margin)}</b>
          </span>
          <span>
            <small>Free margin</small>
            <b>{accountAmount(account.freeMargin)}</b>
          </span>
          <span>
            <small>Margin level</small>
            <b>{account.marginLevel ? `${accountAmount(account.marginLevel)} %` : '—'}</b>
          </span>
        </div>
      )}
      {hasPositions && (
        <>
          <div className="portfolio-heading">
            <h3>Positions</h3>
            <span>{portfolio.positions.length} positions</span>
          </div>
          <div className="portfolio-list">
            {portfolio.positions.slice(0, 8).map((item) => {
              const actionKey = `Close:position:${item.positionId}`;
              const actionBusy = closingTarget === actionKey;
              return (
                <div className="portfolio-row" key={item.positionId}>
                  {/* Row body is ONE button that opens the symbol on the chart;
                      Close stays a sibling action, never a button inside one. */}
                  <button
                    className="portfolio-open"
                    aria-label={`Open ${item.symbol} chart`}
                    onClick={() => void onOpenSymbol(item.symbol)}
                  >
                    <div>
                      <strong>{item.symbol}</strong>
                      <span>
                        Position · {item.side} · {item.volume}
                      </span>
                    </div>
                    <div>
                      <span>
                        {item.priceCurrent} · P/L {item.profit ?? '—'}
                        {item.swap ? ` · Swap ${item.swap}` : ''}
                      </span>
                      <small>
                        SL {item.stopLoss ?? '—'} · TP {item.takeProfit ?? '—'}
                      </small>
                    </div>
                  </button>
                  <div className="portfolio-actions">
                    <button
                      className="portfolio-action"
                      disabled={!account?.accountLogin || !account?.brokerServer || closingTarget !== undefined}
                      aria-busy={actionBusy}
                      onClick={() => void requestClosePosition('portfolio', item.positionId)}
                    >
                      {actionBusy ? 'Closing…' : 'Close'}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
      {portfolio.positions.length > 8 && <p className="portfolio-more">{portfolio.positions.length - 8} more hidden</p>}
    </section>
  );
}
