import { useMemo } from 'react';
import { BridgeRefusal } from '../../../shared/bridge/bridgeRefusal';
import { useDelayedReveal } from '../../../shared/hooks/useDelayedReveal';
import { ErrorNotification, type NoticeAction } from '../../../shared/ui/notification/ErrorNotifications';
import { useAppSettingsActions, useSetupFlowOnScreen } from '../AppSettingsProvider';
import { useBridgeConnectionSelector, useHasCandles } from '../../bridge/bridgeSelectors';
import { useBridgeRefusal, useBridgeRefusalMessage } from '../../bridge/useBridgeRefusal';

/** How long a drawn chart may sit without a connected bridge before its notice shows. */
const DISCONNECTED_NOTICE_DELAY_MS = 3_000;

const TOKEN_MISMATCH_MESSAGE = 'MetaTrader 5 uses a different bridge token.';

const NOT_SENDING_DATA_MESSAGE =
  'MetaTrader 5 is not sending data. Check that it is running with the Better Charts EA attached and Algo Trading on.';

const NOT_CONNECTED_MESSAGE = 'MetaTrader 5 is not connected.';

/**
 * One stable action per fix: the notice store compares a notice's button by its label, so a fresh
 * object on every render would still be idle, but a memoised one keeps the effect from re-running.
 */
function useSetupGuideAction(label: string): NoticeAction {
  const { openSetupGuide } = useAppSettingsActions();
  return useMemo<NoticeAction>(() => ({ label, run: () => openSetupGuide() }), [label, openSetupGuide]);
}

/**
 * Every problem of a completed setup, as one notice each at the bottom right. Each retires by itself
 * once its condition ends: the data arriving, the bridge connecting, or the refusal lifting. A
 * refusal another surface already reports is left to it, an outdated EA being that case. While the
 * guide or its finished screen holds the window, the notices sending the user back to it stay away.
 */
export function BridgeNotices({ waitingTooLong }: { waitingTooLong: boolean }) {
  const setupFlowOnScreen = useSetupFlowOnScreen();
  const connectGuideAction = useSetupGuideAction('Open setup guide');
  const installGuideAction = useSetupGuideAction('Install again');
  const refusal = useBridgeRefusal();
  const bridgeState = useBridgeConnectionSelector(({ status }) => status.state);
  // The refusal's own words, as a primitive: a heartbeat that keeps the same refusal reaches nothing here.
  const refusalMessage = useBridgeRefusalMessage(BridgeRefusal.Other);
  const hasCandles = useHasCandles();
  const disconnectedNoticeShown = useDelayedReveal(
    hasCandles && bridgeState !== 'connected' && refusal === undefined && !setupFlowOnScreen,
    DISCONNECTED_NOTICE_DELAY_MS,
  );
  return (
    <>
      <ErrorNotification
        noticeKey="mt5-token-mismatch"
        message={refusal === BridgeRefusal.TokenMismatch ? TOKEN_MISMATCH_MESSAGE : undefined}
        action={installGuideAction}
      />
      <ErrorNotification
        noticeKey="mt5-not-sending-data"
        message={waitingTooLong && !setupFlowOnScreen ? NOT_SENDING_DATA_MESSAGE : undefined}
        action={connectGuideAction}
      />
      <ErrorNotification
        noticeKey="mt5-not-connected"
        message={disconnectedNoticeShown ? NOT_CONNECTED_MESSAGE : undefined}
        action={connectGuideAction}
      />
      {/* The chart already toasts this refusal for every device, keyed by its own message, so using that
          message as the key here too keeps it one notice: a completed setup adds its fix to the toast. */}
      <ErrorNotification noticeKey={refusalMessage} message={refusalMessage} action={installGuideAction} />
    </>
  );
}
