import type { Dispatch, RefObject, SetStateAction } from 'react';
import type {
  AccountSnapshot,
  BrokerSymbol,
  OrderKind,
  QuoteSnapshot,
  RiskSide,
  TimeInForce,
} from '../../../shared/bridge/types';

export interface OrderTicketQuoteProps {
  value: QuoteSnapshot | undefined;
  precision: number;
  spread: string;
  spreadBadge: string;
  spreadPoints: number | null;
  side: RiskSide;
  stageFromQuote: (side: RiskSide) => void;
}

export interface OrderTicketPricingProps {
  instrument: BrokerSymbol | undefined;
  orderKind: OrderKind;
  setOrderKind: Dispatch<SetStateAction<OrderKind>>;
  entry: string;
  setEntry: Dispatch<SetStateAction<string>>;
  priceMode: 'offset' | 'absolute';
  priceOffset: string;
  setPriceOffset: Dispatch<SetStateAction<string>>;
  priceReference: 'ask' | 'bid';
  setPriceReference: Dispatch<SetStateAction<'ask' | 'bid'>>;
  priceSwapDisabled: boolean;
  priceSwapTitle: string;
  togglePriceMode: () => void;
  limitPrice: string;
  setLimitPrice: Dispatch<SetStateAction<string>>;
  limitPriceValid: boolean;
  limitPriceMisaligned: boolean;
  side: RiskSide;
  hasQuote: boolean;
}

export interface OrderTicketSizingProps {
  account: AccountSnapshot | undefined;
  unitsMode: 'money' | 'equity' | 'units';
  orderVolume: string;
  setOrderVolume: Dispatch<SetStateAction<string>>;
  setVolumeManual: Dispatch<SetStateAction<boolean>>;
  riskAmount: string;
  setRiskAmount: (value: string) => void;
  applyUnitsMode: (mode: 'money' | 'equity' | 'units') => void;
  unitsAutoMode: RefObject<'money' | 'equity'>;
  volumeIssue: string | undefined;
  equityValue: number | undefined;
  riskModeHint: string | undefined;
  stagedOnChart: boolean;
  slOn: boolean;
  stopLoss: string;
}

export interface OrderTicketExitsProps {
  riskRewardLabel: string | undefined;
  open: boolean;
  setOpen: Dispatch<SetStateAction<boolean>>;
  slTooClose: boolean;
  tpTooClose: boolean;
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
  side: RiskSide;
  orderKind: OrderKind;
  entry: string;
  limitPrice: string;
  stagedOnChart: boolean;
}

export interface OrderTicketExtraSettingsProps {
  open: boolean;
  setOpen: Dispatch<SetStateAction<boolean>>;
  timeInForce: TimeInForce;
  setTimeInForce: Dispatch<SetStateAction<TimeInForce>>;
}

export interface OrderTicketActionProps {
  canCheckOrder: boolean;
  orderCheckLoading: boolean;
  startOrderReview: () => void;
  side: RiskSide;
}

export interface OrderTicketTickValueProps {
  hasInstrument: boolean;
  tickValueText: string;
  currency: string | undefined;
}
