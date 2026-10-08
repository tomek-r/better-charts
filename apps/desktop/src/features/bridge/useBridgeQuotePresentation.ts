import { useShallow } from 'zustand/react/shallow';
import { deriveQuotePresentation } from '../../shared/format';
import { useBridgeQuoteSelector } from './BridgeSessionProvider';

export function useBridgeQuotePresentation(pointSize?: string) {
  const quote = useBridgeQuoteSelector(
    useShallow((value) => (value ? { bid: value.bid, ask: value.ask, last: value.last } : undefined)),
  );
  return deriveQuotePresentation(quote, pointSize);
}
