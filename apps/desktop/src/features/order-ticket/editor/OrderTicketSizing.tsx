import { ErrorNotification } from '../../../shared/ui/ErrorNotifications';
import { equityAllocationIssue } from '../domain/ticketRules';
import { UnitsSizingRow } from './UnitsSizingRow';
import { useOrderTicketSizing } from './useOrderTicketSizing';

export function OrderTicketSizing() {
  const {
    stagedOnChart,
    slOn,
    stopLoss,
    currency,
    unitsMode,
    orderVolume,
    setOrderVolume,
    setVolumeManual,
    equityAllocationPercent,
    setEquityAllocationPercent,
    riskAmount,
    setRiskAmount,
    applyUnitsMode,
    unitsAutoMode,
    volumeIssue,
    equityValue,
    riskModeHint,
  } = useOrderTicketSizing();
  const riskEntered = riskAmount.trim() !== '';
  const allocationIssue = unitsMode === 'units' ? undefined : equityAllocationIssue(equityAllocationPercent);
  const allocationHint = {
    units: 'Equity allocation applies to automatic sizing.',
    equity: 'Risk % uses this share of equity. Margin is capped by free margin.',
    money: 'Maximum margin per order. The money risk budget stays fixed.',
  }[unitsMode];
  return (
    <>
      <UnitsSizingRow
        unitsMode={unitsMode}
        orderVolume={orderVolume}
        riskAmount={riskAmount}
        setOrderVolume={setOrderVolume}
        setVolumeManual={setVolumeManual}
        setRiskAmount={setRiskAmount}
        applyUnitsMode={applyUnitsMode}
        unitsAutoMode={unitsAutoMode}
        currency={currency}
      />
      <div className="ticket-row">
        <label className="ticket-row-label" htmlFor="equity-allocation">
          Equity use
        </label>
        <div className="ticket-field">
          <input
            id="equity-allocation"
            className={`ticket-value${allocationIssue ? ' invalid' : ''}`}
            type="number"
            inputMode="decimal"
            min="0"
            max="100"
            step="any"
            value={equityAllocationPercent}
            onChange={(event) => setEquityAllocationPercent(event.target.value)}
            aria-label="Equity allocation percent"
            aria-invalid={Boolean(allocationIssue)}
            aria-describedby="equity-allocation-hint"
            disabled={unitsMode === 'units'}
          />
          <span className="ticket-mode">%</span>
        </div>
      </div>
      <p id="equity-allocation-hint" className="ticket-hint">
        {allocationHint}
      </p>
      {allocationIssue && <ErrorNotification message={allocationIssue} />}
      {volumeIssue && (unitsMode === 'units' || riskEntered) && <ErrorNotification message={volumeIssue} />}
      {stagedOnChart && unitsMode !== 'units' && riskEntered && !slOn && (
        <ErrorNotification message="Money/% sizing needs a stop distance — enable Stop loss or switch to Units mode." />
      )}
      {stagedOnChart && unitsMode !== 'units' && slOn && !stopLoss.trim() && (
        <p className="ticket-hint">Risk sizing needs the stop distance — set the Stop loss price.</p>
      )}
      {riskEntered &&
        riskModeHint &&
        (equityValue !== undefined ? (
          <p className="ticket-hint">{riskModeHint}</p>
        ) : (
          <ErrorNotification message={riskModeHint} />
        ))}
    </>
  );
}
