import { useShallow } from 'zustand/react/shallow';
import { accountMoneyBasis } from '../../../../shared/money';
import { useBridgeAccountSelector, useBridgeMarketSelector } from '../../../bridge/BridgeSessionProvider';
import type { OrderTicketTickValueProps } from '../orderTicketEditorProps';

export function useOrderTicketTickValueProps(): OrderTicketTickValueProps {
  const { instrument } = useBridgeMarketSelector((market) => ({ instrument: market.instrument }));
  const { currency, currencyDigits } = useBridgeAccountSelector(
    useShallow((account) => ({ currency: account?.currency, currencyDigits: account?.currencyDigits })),
  );
  const tickValueRaw = accountMoneyBasis(instrument, currency, currencyDigits)?.tickValueProfit ?? NaN;
  const tickValueText =
    Number.isFinite(tickValueRaw) && tickValueRaw > 0 ? String(Number(tickValueRaw.toPrecision(8))) : '—';
  return { hasInstrument: instrument !== undefined, tickValueText, currency };
}
