import type { AccountSnapshot, PortfolioSnapshot } from '../../shared/bridge/types';
import { closeTargetKey, type ExecutionCommandState } from '../execution/useExecutionCommands';
import { countLabel } from './countLabel';
import { PortfolioRow } from './PortfolioRow';

const MAX_VISIBLE_POSITIONS = 8;

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
  requestClosePosition: ExecutionCommandState['requestClosePosition'];
}) {
  if (portfolio.positions.length === 0) {
    return null;
  }

  return (
    <section className="portfolio-card" aria-label="Open positions">
      <div className="portfolio-heading">
        <h3>Positions</h3>
        <span>{countLabel(portfolio.positions.length, 'position')}</span>
      </div>
      <div className="portfolio-list">
        {portfolio.positions.slice(0, MAX_VISIBLE_POSITIONS).map((item) => (
          <PortfolioRow
            key={item.positionId}
            position={item}
            account={account}
            partialCloseAvailable={partialCloseAvailable}
            closing={closingTarget === closeTargetKey(item.positionId)}
            commandInFlight={closingTarget !== undefined}
            onOpenSymbol={onOpenSymbol}
            onClose={(volume) => requestClosePosition('portfolio', item.positionId, undefined, volume)}
          />
        ))}
      </div>
      {portfolio.positions.length > MAX_VISIBLE_POSITIONS && (
        <p className="portfolio-more">{portfolio.positions.length - MAX_VISIBLE_POSITIONS} more hidden</p>
      )}
    </section>
  );
}
