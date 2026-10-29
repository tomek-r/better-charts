import { useEffect, useRef } from 'react';
import type { BridgeState } from '../../../shared/bridge/types';
import { useBridgeConnection } from '../../bridge/bridgeSelectors';
import { useAppSettingsActions, useSetupGuideOpen } from '../AppSettingsProvider';

/**
 * The guide has nothing left to do once the bridge answers, so reaching "connected" while it is
 * open finishes the setup and shows the finished screen. Only a state change during the guide
 * counts: a guide opened on an already connected bridge stays open.
 */
export function useCompleteSetupOnConnect(): void {
  const { status } = useBridgeConnection();
  const setupGuideOpen = useSetupGuideOpen();
  const { completeSetup } = useAppSettingsActions();
  const stateWhileGuideOpen = useRef<BridgeState | undefined>(undefined);

  useEffect(() => {
    if (!setupGuideOpen) {
      stateWhileGuideOpen.current = undefined;
      return;
    }
    const previousState = stateWhileGuideOpen.current;
    stateWhileGuideOpen.current = status.state;
    if (previousState !== undefined && previousState !== 'connected' && status.state === 'connected') {
      completeSetup();
    }
  }, [completeSetup, setupGuideOpen, status.state]);
}
