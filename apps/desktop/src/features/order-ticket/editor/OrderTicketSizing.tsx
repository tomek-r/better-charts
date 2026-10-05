import { UnitsSizingRow } from './UnitsSizingRow';
import { useOrderTicketSizing } from '../OrderTicketProvider';

export function OrderTicketSizing() {
  const {
    stagedOnChart,
    slOn,
    stopLoss,
    account,
    unitsMode,
    orderVolume,
    setOrderVolume,
    setVolumeManual,
    riskAmount,
    setRiskAmount,
    applyUnitsMode,
    unitsAutoMode,
    volumeIssue,
    equityValue,
    riskModeHint,
  } = useOrderTicketSizing();
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
        account={account}
      />
      {volumeIssue && (
        <p className="ticket-hint error" role="alert">
          {volumeIssue}
        </p>
      )}
      {stagedOnChart && unitsMode !== 'units' && !slOn && (
        <p className="ticket-hint error">
          Money/% sizing needs a stop distance — enable Stop loss or switch to Units mode.
        </p>
      )}
      {stagedOnChart && unitsMode !== 'units' && slOn && !stopLoss.trim() && (
        <p className="ticket-hint">Risk sizing needs the stop distance — set the Stop loss price.</p>
      )}
      {riskModeHint && <p className={`ticket-hint${equityValue !== undefined ? '' : ' error'}`}>{riskModeHint}</p>}
    </>
  );
}
