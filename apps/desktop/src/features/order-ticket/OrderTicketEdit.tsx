import { type Dispatch, type MutableRefObject, type SetStateAction } from 'react';
import type {
  AccountSnapshot,
  BrokerSymbol,
  OrderKind,
  QuoteSnapshot,
  RiskSide,
  TimeInForce,
} from '../../shared/bridge/types';
import { orderEntryPrice, riskRewardRatio, type StopDistanceGuard } from './ticketRules';
import { formatQuote } from '../../shared/format';
import { TicketExitRow } from './TicketExitRow';
import { UnitsSizingRow } from './UnitsSizingRow';

export interface OrderTicketEditProps {
  quote: {
    value: QuoteSnapshot | undefined;
    precision: number;
    spread: string;
    spreadBadge: string;
    spreadPoints: number | null;
    side: RiskSide;
    stageFromQuote: (side: RiskSide) => void;
  };
  pricing: {
    instrument: BrokerSymbol | undefined;
    orderKind: OrderKind;
    setOrderKind: Dispatch<SetStateAction<OrderKind>>;
    entry: string;
    setEntry: Dispatch<SetStateAction<string>>;
    priceMode: 'offset' | 'absolute';
    priceOffset: string;
    setPriceOffset: Dispatch<SetStateAction<string>>;
    priceReference: 'ask' | 'bid' | 'last';
    setPriceReference: Dispatch<SetStateAction<'ask' | 'bid' | 'last'>>;
    priceSwapDisabled: boolean;
    priceSwapTitle: string;
    togglePriceMode: () => void;
    limitPrice: string;
    setLimitPrice: Dispatch<SetStateAction<string>>;
    limitPriceValid: boolean;
    limitPriceMisaligned: boolean;
  };
  sizing: {
    account: AccountSnapshot | undefined;
    unitsMode: 'money' | 'equity' | 'units';
    orderVolume: string;
    setOrderVolume: Dispatch<SetStateAction<string>>;
    setVolumeManual: Dispatch<SetStateAction<boolean>>;
    riskAmount: string;
    setRiskAmount: (value: string) => void;
    applyUnitsMode: (mode: 'money' | 'equity' | 'units') => void;
    unitsAutoMode: MutableRefObject<'money' | 'equity'>;
    volumeIssue: string | undefined;
    equityValue: number | undefined;
    riskModeHint: string | undefined;
    tickValueText: string;
  };
  exits: {
    open: boolean;
    setOpen: Dispatch<SetStateAction<boolean>>;
    stopGuard: StopDistanceGuard | undefined;
    tickKnown: boolean;
    tpOn: boolean;
    slOn: boolean;
    tpUnit: 'ticks' | 'price';
    slUnit: 'ticks' | 'price';
    tpTicksView: string;
    slTicksView: string;
    takeProfit: string;
    setTakeProfit: Dispatch<SetStateAction<string>>;
    stopLoss: string;
    setStopLoss: Dispatch<SetStateAction<string>>;
    toggleExit: (kind: 'sl' | 'tp', on: boolean) => void;
    applyExitTicks: (kind: 'sl' | 'tp', text: string) => void;
    swapExitUnit: (kind: 'sl' | 'tp') => void;
  };
  extra: {
    open: boolean;
    setOpen: Dispatch<SetStateAction<boolean>>;
    timeInForce: TimeInForce;
    setTimeInForce: Dispatch<SetStateAction<TimeInForce>>;
  };
  action: {
    stagedOnChart: boolean;
    canCheckOrder: boolean;
    orderCheckLoading: boolean;
    startOrderReview: () => void;
  };
}

export function OrderTicketEdit({ quote, pricing, sizing, exits, extra, action }: OrderTicketEditProps) {
  const {
    value: quoteValue,
    precision: quotePrecision,
    spread,
    spreadBadge,
    spreadPoints,
    side: riskSide,
    stageFromQuote,
  } = quote;
  const {
    instrument,
    orderKind,
    setOrderKind,
    entry,
    setEntry,
    priceMode,
    priceOffset,
    setPriceOffset,
    priceReference,
    setPriceReference,
    priceSwapDisabled,
    priceSwapTitle,
    togglePriceMode,
    limitPrice,
    setLimitPrice,
    limitPriceValid,
    limitPriceMisaligned,
  } = pricing;
  const displayedPriceReference = (() => {
    if (orderKind !== 'market') {
      return priceReference;
    }
    return riskSide === 'buy' ? 'ask' : 'bid';
  })();
  const {
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
    tickValueText,
  } = sizing;
  const {
    open: exitsOpen,
    setOpen: setExitsOpen,
    stopGuard,
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
  } = exits;
  const { open: extraOpen, setOpen: setExtraOpen, timeInForce, setTimeInForce } = extra;
  const { stagedOnChart, canCheckOrder, orderCheckLoading, startOrderReview } = action;
  const riskRewardLabel =
    tpOn && slOn
      ? riskRewardRatio(riskSide, orderEntryPrice(orderKind, entry, limitPrice), stopLoss, takeProfit)
      : undefined;

  return (
    <>
      <div className="ticket-quote" role="group" aria-label="Order side">
        <button
          className={`ticket-quote-side sell${riskSide === 'sell' ? ' active' : ''}`}
          aria-pressed={riskSide === 'sell'}
          onClick={() => stageFromQuote('sell')}
        >
          <small>Sell</small>
          <b>{quoteValue ? formatQuote(quoteValue.bid, quotePrecision) : '—'}</b>
        </button>
        <span
          className="ticket-spread"
          title={
            spreadPoints !== null
              ? `${spreadPoints} pts · ${spread} price units`
              : 'Instrument point size unknown — raw price spread'
          }
        >
          {spreadBadge}
        </span>
        <button
          className={`ticket-quote-side buy${riskSide === 'buy' ? ' active' : ''}`}
          aria-pressed={riskSide === 'buy'}
          onClick={() => stageFromQuote('buy')}
        >
          <small>Buy</small>
          <b>{quoteValue ? formatQuote(quoteValue.ask, quotePrecision) : '—'}</b>
        </button>
      </div>
      <div className="ticket-type-tabs" role="group" aria-label="Order type">
        <button
          className={`ticket-type-tab${orderKind === 'market' ? ' active' : ''}`}
          aria-pressed={orderKind === 'market'}
          onClick={() => setOrderKind('market')}
        >
          Market
        </button>
        <button
          className={`ticket-type-tab${orderKind === 'limit' ? ' active' : ''}`}
          aria-pressed={orderKind === 'limit'}
          onClick={() => setOrderKind('limit')}
        >
          Limit
        </button>
        <button
          className={`ticket-type-tab${orderKind === 'stop' ? ' active' : ''}`}
          aria-pressed={orderKind === 'stop'}
          onClick={() => setOrderKind('stop')}
        >
          Stop
        </button>
        <button
          className={`ticket-type-tab${orderKind === 'stop_limit' ? ' active' : ''}`}
          aria-pressed={orderKind === 'stop_limit'}
          onClick={() => setOrderKind('stop_limit')}
        >
          Stop Limit
        </button>
      </div>
      <div className={`ticket-row${orderKind === 'market' ? ' disabled' : ''}`}>
        <span className="ticket-row-label">{orderKind === 'stop_limit' ? 'Trigger price' : 'Price offset'}</span>
        <div className="ticket-field">
          <select
            className="ticket-ref"
            value={displayedPriceReference}
            disabled={priceMode === 'absolute' || !quoteValue || orderKind === 'market'}
            onChange={(event) => setPriceReference(event.target.value as 'ask' | 'bid' | 'last')}
            aria-label="Price reference"
          >
            <option value="ask">Ask</option>
            <option value="bid">Bid</option>
            <option value="last">Last</option>
          </select>
          <button
            className="ticket-swap"
            disabled={priceSwapDisabled}
            onClick={togglePriceMode}
            aria-label={
              priceMode === 'absolute' ? 'Enter price as an offset from the reference' : 'Enter an absolute price'
            }
            title={priceSwapTitle}
          >
            ⇄
          </button>
          {priceMode === 'absolute' ? (
            <input
              autoComplete="one-time-code"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
              className="ticket-value"
              inputMode="decimal"
              value={entry}
              disabled={orderKind === 'market'}
              onChange={(event) => setEntry(event.target.value)}
              placeholder="Price"
              aria-label="Order price"
            />
          ) : (
            <input
              autoComplete="one-time-code"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
              className="ticket-value"
              inputMode="decimal"
              value={priceOffset}
              onChange={(event) => setPriceOffset(event.target.value)}
              placeholder="Ticks"
              aria-label="Price offset in ticks"
            />
          )}
          <span className="ticket-unit">{priceMode === 'absolute' ? 'price' : 'ticks'}</span>
        </div>
      </div>
      {orderKind === 'stop_limit' && (
        <div className="ticket-row">
          <span className="ticket-row-label">Limit price</span>
          <div className="ticket-field">
            <input
              autoComplete="one-time-code"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
              className="ticket-value"
              inputMode="decimal"
              value={limitPrice}
              onChange={(event) => setLimitPrice(event.target.value)}
              placeholder="Price"
              aria-label="Limit price"
            />
            <span className="ticket-unit">price</span>
          </div>
        </div>
      )}
      {orderKind === 'stop_limit' && !limitPriceValid && (
        <p className="ticket-hint error">
          stop_limit requires limit price — enter the resting limit price after the trigger.
        </p>
      )}
      {orderKind === 'stop_limit' && limitPriceMisaligned && (
        <p className="ticket-hint">Limit price is not tick-aligned (step {instrument?.tickSize}).</p>
      )}
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
      <div className="ticket-row static">
        <span className="ticket-row-label">Tick value</span>
        <div className="ticket-field">
          {instrument ? (
            <>
              <b className="ticket-tick-value">
                ≈ {tickValueText} {account?.currency ?? ''}
              </b>
            </>
          ) : (
            <span className="ticket-hint">Instrument metadata unknown</span>
          )}
        </div>
      </div>
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
              priceInvalid={stagedOnChart && stopGuard?.tpTooClose}
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
              priceInvalid={stagedOnChart && stopGuard?.slTooClose}
            />
            {riskRewardLabel && <p className="ticket-hint ticket-risk-reward">RR {riskRewardLabel}</p>}
            {!tickKnown && <p className="ticket-hint">Tick size unknown — ticks⇄price conversion disabled.</p>}
          </div>
        )}
      </div>
      <div className="ticket-collapse">
        <button className="ticket-collapse-head" aria-expanded={extraOpen} onClick={() => setExtraOpen(!extraOpen)}>
          Extra settings <span aria-hidden="true">{extraOpen ? '▾' : '▸'}</span>
        </button>
        {extraOpen && (
          <div className="ticket-collapse-body">
            <div className="ticket-row">
              <span className="ticket-row-label">Time in force</span>
              <select
                className="ticket-mode"
                value={timeInForce}
                onChange={(event) => setTimeInForce(event.target.value as TimeInForce)}
                aria-label="Time in force"
              >
                <option value="gtc">GTC</option>
                <option value="day">Day</option>
                <option value="ioc">IOC</option>
                <option value="fok">FOK</option>
              </select>
            </div>
          </div>
        )}
      </div>
      <button
        className={`ticket-cta side-${riskSide}`}
        disabled={!canCheckOrder || orderCheckLoading}
        aria-busy={orderCheckLoading}
        onClick={startOrderReview}
      >
        {orderCheckLoading ? 'Checking with MT5…' : 'Start creating order'}
      </button>
    </>
  );
}
