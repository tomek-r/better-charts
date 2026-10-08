import type { OrderCheckResult, OrderKind, RiskPreview, RiskSide, TimeInForce } from '../../../shared/bridge/types';
import type { MutableRefObject } from 'react';
import type { SetStateAction } from 'react';
import { createDomainStore, type DomainStore } from '../../../shared/state/domainStore';

export type FieldSetters<T extends object> = {
  [K in keyof T as `set${Capitalize<string & K>}`]: (action: SetStateAction<T[K]>) => void;
};

function createFieldSetters<T extends object>(store: DomainStore<T>): FieldSetters<T> {
  const setters = {} as FieldSetters<T>;
  for (const key of Object.keys(store.getState()) as Array<keyof T>) {
    const setter = (action: SetStateAction<T[typeof key]>) => store.setField(key, action);
    (setters as unknown as Record<string, (action: SetStateAction<T[typeof key]>) => void>)[
      `set${String(key).charAt(0).toUpperCase()}${String(key).slice(1)}`
    ] = setter;
  }
  return setters;
}

type OrderCheckPending = {
  generation: number;
  draftVersion: number;
  symbol: string;
  accountLogin: string;
  brokerServer: string;
};

export type OrderTicketCoordination = {
  submitSwapPendingRef: MutableRefObject<boolean>;
  stagedPrevPriceRef: MutableRefObject<number | undefined>;
  riskVersion: MutableRefObject<number>;
  pendingRiskRequestRef: MutableRefObject<(() => Promise<unknown>) | undefined>;
  orderCheckGeneration: MutableRefObject<number>;
  orderCheckPending: MutableRefObject<OrderCheckPending | undefined>;
  unitsAutoMode: MutableRefObject<'money' | 'equity'>;
  riskBrokerVersion: MutableRefObject<number | undefined>;
  riskPreviewDisplayRef: MutableRefObject<RiskPreview | undefined>;
};

export type OrderTicketDraftStore = {
  draftVersion: number;
  riskSide: RiskSide;
  entry: string;
  stopLoss: string;
  takeProfit: string;
  equityAllocationPercent: string;
  riskAmount: string;
  orderKind: OrderKind;
  timeInForce: TimeInForce;
  limitPrice: string;
  ticketStage: 'edit' | 'review';
  priceMode: 'offset' | 'absolute';
  priceReference: 'ask' | 'bid';
  priceOffset: string;
  unitsMode: 'money' | 'equity' | 'units';
  tpOn: boolean;
  slOn: boolean;
  slUnit: 'ticks' | 'price';
  tpUnit: 'ticks' | 'price';
  stagedOnChart: boolean;
  stagedDragging: boolean;
  dragSlMoney: string | undefined;
  orderVolume: string;
  volumeManual: boolean;
};

export type OrderTicketBrokerStore = {
  riskPreview: RiskPreview | undefined;
  riskProjection: RiskPreview | undefined;
  riskLoading: boolean;
  riskError: string | undefined;
  orderCheck: OrderCheckResult | undefined;
  orderCheckLoading: boolean;
  orderCheckError: string | undefined;
  submittingSide: RiskSide | undefined;
  submitStatus: { kind: 'locked' | 'error'; text: string } | undefined;
};

export type OrderTicketEditorStore = {
  exitsOpen: boolean;
  extraSettingsOpen: boolean;
};

export function createOrderTicketStores() {
  const draft = createDomainStore<OrderTicketDraftStore>({
    draftVersion: 0,
    riskSide: '',
    entry: '',
    stopLoss: '',
    takeProfit: '',
    equityAllocationPercent: '100',
    riskAmount: '',
    orderKind: 'market',
    timeInForce: 'gtc',
    limitPrice: '',
    ticketStage: 'edit',
    priceMode: 'absolute',
    priceReference: 'ask',
    priceOffset: '0',
    unitsMode: 'units',
    tpOn: false,
    slOn: false,
    slUnit: 'ticks',
    tpUnit: 'ticks',
    stagedOnChart: false,
    stagedDragging: false,
    dragSlMoney: undefined,
    orderVolume: '1',
    volumeManual: false,
  });
  const broker = createDomainStore<OrderTicketBrokerStore>({
    riskPreview: undefined,
    riskProjection: undefined,
    riskLoading: false,
    riskError: undefined,
    orderCheck: undefined,
    orderCheckLoading: false,
    orderCheckError: undefined,
    submittingSide: undefined,
    submitStatus: undefined,
  });
  const editor = createDomainStore<OrderTicketEditorStore>({ exitsOpen: true, extraSettingsOpen: false });
  const coordination: OrderTicketCoordination = {
    submitSwapPendingRef: { current: false },
    stagedPrevPriceRef: { current: undefined },
    riskVersion: { current: 0 },
    pendingRiskRequestRef: { current: undefined },
    orderCheckGeneration: { current: 0 },
    orderCheckPending: { current: undefined },
    unitsAutoMode: { current: 'money' },
    riskBrokerVersion: { current: undefined },
    riskPreviewDisplayRef: { current: undefined },
  };
  return {
    draft,
    broker,
    editor,
    setters: {
      draft: createFieldSetters(draft),
      broker: createFieldSetters(broker),
      editor: createFieldSetters(editor),
    },
    coordination,
  };
}

export type OrderTicketStores = ReturnType<typeof createOrderTicketStores>;
