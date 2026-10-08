import { useStore } from 'zustand';
import { useOrderTicketStores } from '../state/orderTicketContext';
import type { OrderTicketExtraSettingsProps } from './orderTicketEditorTypes';

export function useOrderTicketExtraSettings(): OrderTicketExtraSettingsProps {
  const stores = useOrderTicketStores();
  const open = useStore(stores.editor, (state) => state.extraSettingsOpen);
  const timeInForce = useStore(stores.draft, (state) => state.timeInForce);
  return {
    open,
    setOpen: stores.setters.editor.setExtraSettingsOpen,
    timeInForce,
    setTimeInForce: stores.setters.draft.setTimeInForce,
  };
}
