import { TicketExitRow } from './TicketExitRow';
import { useOrderTicketExits } from '../OrderTicketProvider';

export function OrderTicketExits() {
  const {
    riskRewardLabel,
    open: exitsOpen,
    setOpen: setExitsOpen,
    slTooClose,
    tpTooClose,
    tickKnown,
    tpOn,
    slOn,
    tpUnit,
    slUnit,
    tpTicksView,
    slTicksView,
    takeProfit,
    setTakeProfit,
    stopLoss,
    setStopLoss,
    toggleExit,
    applyExitTicks,
    swapExitUnit,
  } = useOrderTicketExits();
  return (
    <div className="ticket-collapse">
      <button className="ticket-collapse-head" aria-expanded={exitsOpen} onClick={() => setExitsOpen(!exitsOpen)}>
        Exits <span aria-hidden="true">{exitsOpen ? '▾' : '▸'}</span>
      </button>
      {exitsOpen && (
        <div className="ticket-collapse-body">
          <TicketExitRow
            label="Take profit"
            ticksMode={tpUnit === 'ticks' && tickKnown}
            on={tpOn}
            onToggle={(checked) => toggleExit('tp', checked)}
            price={takeProfit}
            ticks={tpTicksView}
            onTicks={(value) => applyExitTicks('tp', value)}
            onPrice={setTakeProfit}
            onSwap={() => swapExitUnit('tp')}
            swapDisabled={!tickKnown}
            priceInvalid={tpTooClose}
          />
          <TicketExitRow
            label="Stop loss"
            ticksMode={slUnit === 'ticks' && tickKnown}
            on={slOn}
            onToggle={(checked) => toggleExit('sl', checked)}
            price={stopLoss}
            ticks={slTicksView}
            onTicks={(value) => applyExitTicks('sl', value)}
            onPrice={setStopLoss}
            onSwap={() => swapExitUnit('sl')}
            swapDisabled={!tickKnown}
            priceInvalid={slTooClose}
          />
          {riskRewardLabel && <p className="ticket-hint ticket-risk-reward">RR {riskRewardLabel}</p>}
          {!tickKnown && <p className="ticket-hint">Tick size unknown — ticks⇄price conversion disabled.</p>}
        </div>
      )}
    </div>
  );
}
