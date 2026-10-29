import { useCallback } from 'react';
import { defaultOrderVolume } from '../sizing/defaultVolume';
import type { OrderTicketInputs } from './orderTicketInputs';
import type { OrderTicketStores } from './orderTicketStores';

/** The two ways to clear the draft: just the order levels, or the whole ticket back to its defaults. */
export function useOrderTicketResets(instrument: OrderTicketInputs['instrument'], stores: OrderTicketStores) {
  const setters = stores.setters.draft;

  const resetOrderDraft = useCallback(() => {
    setters.setSlOn(false);
    setters.setTpOn(false);
    setters.setStopLoss('');
    setters.setTakeProfit('');
    setters.setEntry('');
  }, [setters]);

  const resetTicketToDefaults = useCallback(() => {
    resetOrderDraft();
    setters.setRiskSide('');
    setters.setRiskAmount('');
    setters.setOrderKind('market');
    setters.setLimitPrice('');
    setters.setTimeInForce('gtc');
    setters.setUnitsMode('units');
    setters.setOrderVolume(defaultOrderVolume(instrument));
    setters.setVolumeManual(false);
    setters.setSlUnit('ticks');
    setters.setTpUnit('ticks');
    setters.setPriceMode('absolute');
    setters.setPriceReference('ask');
    setters.setPriceOffset('0');
    setters.setTicketStage('edit');
  }, [resetOrderDraft, setters, instrument]);

  return { resetOrderDraft, resetTicketToDefaults };
}
