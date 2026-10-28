import { useState } from 'react';
import type { AccountSnapshot, OpenPosition } from '../../shared/bridge/types';
import { PartialCloseMenuButton } from '../partial-close/PartialCloseMenuButton';
import { PartialCloseVolumePopover } from '../partial-close/PartialCloseVolumePopover';
import { partialCloseLimits, partialCloseTitle } from '../../shared/trading/partialCloseVolume';
import { EMPTY_VALUE, volumeWithUnit } from '../../shared/format';
import { formatAccountAmount } from './accountAmount';

interface PortfolioRowProps {
  position: OpenPosition;
  account: AccountSnapshot | undefined;
  /** Bridge capability: false/absent means partial close is never offered. */
  partialCloseAvailable: boolean;
  /** True while this row's close command is in flight. */
  closing: boolean;
  /** True while any command is in flight. */
  commandInFlight: boolean;
  onOpenSymbol: (symbol: string) => Promise<void>;
  /** `null` closes the whole position. */
  onClose: (volume: string | null) => Promise<void>;
}

const FINISH_PARTIAL_FIRST = 'Finish or cancel the partial close first';

/** A bought position is long, a sold one short. */
const POSITION_DIRECTION: Record<string, string> = { buy: 'long', sell: 'short' };

export function PortfolioRow({
  position,
  account,
  partialCloseAvailable,
  closing,
  commandInFlight,
  onOpenSymbol,
  onClose,
}: PortfolioRowProps) {
  const [customVolumeOpen, setCustomVolumeOpen] = useState(false);
  const limits = partialCloseLimits(position, partialCloseAvailable);
  const accountUnavailable = !account?.accountLogin || !account?.brokerServer;
  const locked = accountUnavailable || commandInFlight;
  const profitText = formatAccountAmount(position.profit, account);

  return (
    <div className="portfolio-item">
      <div className="portfolio-row">
        <div className="portfolio-header">
          {/* The header is ONE button that opens the symbol on the chart (its ::after stretches over
              the whole row); Close stays a sibling action, never a button inside one. */}
          <button
            className="portfolio-open"
            aria-label={`Open ${position.symbol} chart`}
            onClick={() => void onOpenSymbol(position.symbol)}
          >
            <strong>{position.symbol}</strong>
            <span className={`portfolio-side side-${position.side}`}>
              {POSITION_DIRECTION[position.side] ?? position.side}
            </span>
            <span className="portfolio-volume">{volumeWithUnit(position.volume)}</span>
          </button>
          <div className="portfolio-actions">
            <div className="split-close">
              <button
                className="action-button portfolio-action"
                disabled={locked || customVolumeOpen}
                title={customVolumeOpen ? FINISH_PARTIAL_FIRST : undefined}
                aria-busy={closing}
                onClick={() => void onClose(null)}
              >
                {closing ? 'Closing…' : 'Close'}
              </button>
              {limits && (
                <PartialCloseMenuButton
                  limits={limits}
                  className="action-button partial-caret"
                  disabled={locked || customVolumeOpen}
                  onClosePart={(volume) => void onClose(volume)}
                  onCustomVolume={() => setCustomVolumeOpen(true)}
                />
              )}
            </div>
          </div>
        </div>
        <dl className="portfolio-figures">
          <dt>P/L</dt>
          <dd>{profitText}</dd>
          <dt>Price</dt>
          <dd>{position.priceCurrent}</dd>
          <dt>SL</dt>
          <dd>{position.stopLoss ?? EMPTY_VALUE}</dd>
          <dt>TP</dt>
          <dd>{position.takeProfit ?? EMPTY_VALUE}</dd>
          {position.swap && (
            <>
              <dt>Swap</dt>
              <dd>{formatAccountAmount(position.swap, account)}</dd>
            </>
          )}
        </dl>
      </div>
      {limits && customVolumeOpen && (
        <PartialCloseVolumePopover
          title={partialCloseTitle(position)}
          limits={limits}
          onDismiss={() => setCustomVolumeOpen(false)}
          onConfirm={(volume) => {
            setCustomVolumeOpen(false);
            void onClose(volume);
          }}
        />
      )}
    </div>
  );
}
