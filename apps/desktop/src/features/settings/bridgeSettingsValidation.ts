import { FRAME_BYTES } from '../../shared/bridge/config';
import type { MT5BridgeSettings } from '../../shared/bridge/types';
import type { AppSettingsData } from './appSettingsData';

const MIN_PORT = 1;
const MAX_PORT = 65535;
const MAX_IPV4_OCTET = 255;

/** Loopback host and port; compiled once rather than on every save. */
const LOOPBACK_ADDRESS = /^(127(?:\.[0-9]{1,3}){3}|\[::1\]):([0-9]+)$/;

function isLoopbackAddress(value: string): boolean {
  const address = LOOPBACK_ADDRESS.exec(value.trim());
  if (!address) {
    return false;
  }
  const [, host, port] = address;
  return (
    Number(port) >= MIN_PORT &&
    Number(port) <= MAX_PORT &&
    (host === '[::1]' || !host.split('.').some((octet) => Number(octet) > MAX_IPV4_OCTET))
  );
}

/** The first reason the MT5 setup draft cannot be saved, or `undefined` when every value is acceptable. */
export function bridgeSettingsIssue(
  draft: MT5BridgeSettings,
  platform: AppSettingsData['platform'] | undefined,
): string | undefined {
  if (!draft.token.trim()) {
    return 'Enter a nonempty token and use the same token in the MT5 EA.';
  }
  if (!isLoopbackAddress(draft.address)) {
    return `Use a local address with a port from ${MIN_PORT} to ${MAX_PORT}, for example 127.0.0.1:8765.`;
  }
  if (
    !Number.isInteger(draft.maxFrameBytes) ||
    draft.maxFrameBytes < FRAME_BYTES.min ||
    draft.maxFrameBytes > FRAME_BYTES.max
  ) {
    return `Maximum frame bytes must be an integer from ${FRAME_BYTES.min} to ${FRAME_BYTES.max}.`;
  }
  if (
    draft.autoStartMt5 &&
    (!draft.terminalPath.trim() || (platform !== 'windows' && (!draft.winePrefix.trim() || !draft.wineBinary.trim())))
  ) {
    return 'Provide the terminal path and, on macOS or Linux, the Wine binary and prefix.';
  }
  return undefined;
}
