import { BridgeRefusal, bridgeRefusal } from '../../shared/bridge/bridgeRefusal';
import { useBridgeConnectionSelector } from './bridgeSelectors';

/** The refusal kind alone, as a primitive: a heartbeat that keeps the same refusal reaches nothing. */
export function useBridgeRefusal(): BridgeRefusal | undefined {
  return useBridgeConnectionSelector(({ status }) => bridgeRefusal(status));
}

/** The bridge's own words while it refuses for `kind`, so a surface reports only the refusal it owns. */
export function useBridgeRefusalMessage(kind: BridgeRefusal): string | undefined {
  return useBridgeConnectionSelector(({ status }) => (bridgeRefusal(status) === kind ? status.message : undefined));
}
