import { useEffect } from 'react';
import { useStore } from 'zustand';
import { useShallow } from 'zustand/react/shallow';
import type { BrokerSymbol } from '../../../shared/bridge/types';
import { defaultOrderVolume } from './defaultVolume';
import { useOrderTicketStores } from '../draft/orderTicketContext';

/**
 * Keeps the untouched Units-mode volume at the current symbol's minimum: it replaces the fallback once
 * metadata arrives and follows a symbol change. A volume the user typed (volumeManual) is never replaced,
 * and risk modes size their own volume.
 */
export function useOrderTicketDefaultVolume(instrument: BrokerSymbol | undefined): void {
  const stores = useOrderTicketStores();
  const setOrderVolume = stores.setters.draft.setOrderVolume;
  const { unitsMode, volumeManual, orderVolume } = useStore(
    stores.draft,
    useShallow((state) => ({
      unitsMode: state.unitsMode,
      volumeManual: state.volumeManual,
      orderVolume: state.orderVolume,
    })),
  );
  const defaultVolume = defaultOrderVolume(instrument);
  useEffect(() => {
    // A cleared field means the user is about to type a fresh volume: do not refill it underneath them.
    if (unitsMode === 'units' && !volumeManual && orderVolume.trim() !== '' && orderVolume !== defaultVolume) {
      setOrderVolume(defaultVolume);
    }
  }, [unitsMode, volumeManual, orderVolume, defaultVolume, setOrderVolume]);
}
