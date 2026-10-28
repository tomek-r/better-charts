import { useBridgeConnectionSelector } from '../bridge/bridgeSelectors';

/** Whether the connected bridge negotiated the partial-close capability. */
export function usePartialCloseAvailable(): boolean {
  return useBridgeConnectionSelector(({ status }) => status.partialClose === true);
}
