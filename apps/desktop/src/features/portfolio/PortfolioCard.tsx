import type { AccountSnapshot, PendingModification, PortfolioSnapshot } from '../../shared/bridge/types';
import { PortfolioRow } from './PortfolioRow';

export function PortfolioCard({
  portfolio,
  account,
  onOpenSymbol,
  partialCloseAvailable,
  closingTarget,
  requestClosePosition,
}: {
  portfolio: PortfolioSnapshot;
  account: AccountSnapshot | undefined;
  onOpenSymbol: (symbol: string) => Promise<void>;
  partialCloseAvailable: boolean;
  closingTarget: string | undefined;
  requestClosePosition: (
    source: 'portfolio' | 'draft',
    positionId: string,
    actedDraft?: PendingModification,
    volume?: string | null,
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
        {portfolio.positions.slice(0, 8).map((item) => (
          <PortfolioRow
            key={item.positionId}
            position={item}
            account={account}
            partialCloseAvailable={partialCloseAvailable}
            closing={closingTarget === `Close:position:${item.positionId}`}
            commandInFlight={closingTarget !== undefined}
            onOpenSymbol={onOpenSymbol}
            onClose={(volume) => requestClosePosition('portfolio', item.positionId, undefined, volume)}
          />
        ))}
      </div>
      {portfolio.positions.length > 8 && <p className="portfolio-more">{portfolio.positions.length - 8} more hidden</p>}
    </section>
  );
}
