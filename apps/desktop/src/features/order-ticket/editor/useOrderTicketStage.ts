import { useStore } from 'zustand';
import { useOrderTicketStores } from '../state/orderTicketContext';

export function useOrderTicketStage(): 'edit' | 'review' {
  const { draft } = useOrderTicketStores();
  return useStore(draft, (state) => state.ticketStage);
}
