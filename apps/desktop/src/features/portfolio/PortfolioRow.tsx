import { useEffect, useRef, useState } from 'react';
import type { AccountSnapshot, OpenPosition } from '../../shared/bridge/types';
import { PartialCloseMenuButton } from '../partial-close/PartialCloseMenuButton';
import { PartialCloseVolumePopover } from '../partial-close/PartialCloseVolumePopover';
import { partialCloseLimits, partialCloseTitle } from '../partial-close/partialCloseVolume';
import { volumeWithUnit } from '../../shared/format';
import { accountAmount } from './accountAmount';

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
  const itemRef = useRef<HTMLDivElement>(null);

  // The popover floats below the row inside the scrolling drawer; for the last row it extends
  // the drawer's scroll area rather than being clipped, so bring it into view when it opens.
  useEffect(() => {
    if (customVolumeOpen) {
      itemRef.current?.querySelector('.partial-popover')?.scrollIntoView({ block: 'nearest' });
    }
  }, [customVolumeOpen]);

  return (
    <div className="portfolio-item" ref={itemRef}>
      <div className="portfolio-row">
        {/* Row body is ONE button that opens the symbol on the chart;
            Close stays a sibling action, never a button inside one. */}
        <button
          className="portfolio-open"
          aria-label={`Open ${position.symbol} chart`}
          onClick={() => void onOpenSymbol(position.symbol)}
        >
          <div>
            <strong>{position.symbol}</strong>
            <span>
              Position · {position.side} · {volumeWithUnit(position.volume)}
            </span>
          </div>
          <div>
            <span>
              {position.priceCurrent} · P/L {accountAmount(position.profit, account?.currency, account?.currencyDigits)}
              {position.swap
                ? ` · Swap ${accountAmount(position.swap, account?.currency, account?.currencyDigits)}`
                : ''}
            </span>
            <small>
              SL {position.stopLoss ?? '—'} · TP {position.takeProfit ?? '—'}
            </small>
          </div>
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
