import type { AccountSnapshot, PendingModification, PortfolioSnapshot } from '../../shared/bridge/types';
import { accountAmount } from './accountAmount';

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

  return (
    <section className="portfolio-card" aria-label="Open positions">
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
                    {item.priceCurrent} · P/L {accountAmount(item.profit, account?.currency, account?.currencyDigits)}
                    {item.swap ? ` · Swap ${accountAmount(item.swap, account?.currency, account?.currencyDigits)}` : ''}
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
      {portfolio.positions.length > 8 && <p className="portfolio-more">{portfolio.positions.length - 8} more hidden</p>}
    </section>
  );
}
