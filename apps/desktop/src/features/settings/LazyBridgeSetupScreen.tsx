import { Suspense, lazy } from 'react';

// Devices that finished the setup never show this screen again, so its code loads on first need.
const BridgeSetupScreenChunk = lazy(() =>
  import('./BridgeSetupScreen').then((module) => ({ default: module.BridgeSetupScreen })),
);

/**
 * The first-run setup screen, loaded on first use: devices that finished the setup never mount it,
 * so they never load its chunk. Until it arrives, the plain blurred backdrop of the screen itself
 * stands in, so a first launch never flashes the bare workspace.
 */
export function LazyBridgeSetupScreen() {
  return (
    <Suspense fallback={<div className="bridge-screen" aria-hidden="true" />}>
      <BridgeSetupScreenChunk />
    </Suspense>
  );
}
