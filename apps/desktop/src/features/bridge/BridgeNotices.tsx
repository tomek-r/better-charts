import { useMemo } from 'react';
import { BridgeRefusal, bridgeRefusal } from '../../shared/bridge/bridgeRefusal';
import { useDelayedReveal } from '../../shared/hooks/useDelayedReveal';
import { ErrorNotification, type NoticeAction } from '../../shared/ui/ErrorNotifications';
import { useAppSettingsActions, useSetupFlowOnScreen } from '../settings/AppSettingsProvider';
import { SetupGuideStep } from '../settings/useAppSettings';
import { useBridgeConnectionSelector, useHasCandles } from './BridgeSessionProvider';

/** How long a drawn chart may sit without a connected bridge before its notice shows. */
const DISCONNECTED_NOTICE_DELAY_MS = 3_000;

const TOKEN_MISMATCH_MESSAGE = 'MetaTrader 5 uses a different bridge token.';

const NOT_SENDING_DATA_MESSAGE =
  'MetaTrader 5 is not sending data. Check that it is running with the Better Charts EA attached and Algo Trading on.';

const NOT_CONNECTED_MESSAGE = 'MetaTrader 5 is not connected.';

/**
 * Every problem of a completed setup, as one notice each at the bottom right. Each retires by itself
 * once its condition ends: the data arriving, the bridge connecting, or the refusal lifting. A
 * refusal another surface already reports is left to it, an outdated EA being that case. While the
 * guide or its finished screen holds the window, the notices sending the user back to it stay away.
 */
export function BridgeNotices({ waitingTooLong }: { waitingTooLong: boolean }) {
  const { openSetupGuide } = useAppSettingsActions();
  const setupFlowOnScreen = useSetupFlowOnScreen();
  // One stable action per fix: the notice store compares a notice's button by its label, so a fresh
  // object on every render would still be idle, but a memoised one keeps the effect from re-running.
  const connectGuideAction = useMemo<NoticeAction>(
    () => ({ label: 'Open setup guide', run: () => openSetupGuide(SetupGuideStep.Connect) }),
    [openSetupGuide],
  );
  const installGuideAction = useMemo<NoticeAction>(
    () => ({ label: 'Install again', run: () => openSetupGuide(SetupGuideStep.Install) }),
    [openSetupGuide],
  );
  const refusal = useBridgeConnectionSelector(({ status }) => bridgeRefusal(status));
  const bridgeState = useBridgeConnectionSelector(({ status }) => status.state);
  // The refusal's own words, as a primitive: a heartbeat that keeps the same refusal reaches nothing here.
  const refusalMessage = useBridgeConnectionSelector(({ status }) =>
    bridgeRefusal(status) === BridgeRefusal.Other ? status.message : undefined,
  );
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
          message as the key here too keeps it one notice: a completed setup adds its fix, the install
          step, to the toast. */}
      <ErrorNotification noticeKey={refusalMessage} message={refusalMessage} action={installGuideAction} />
    </>
  );
}
