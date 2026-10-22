import { BridgeRefusal, bridgeRefusal } from '../../../../shared/bridge/bridgeRefusal';
import { useDelayedReveal } from '../../../../shared/hooks/useDelayedReveal';
import { LoadingMessage } from '../../../../shared/ui/LoadingMessage';
import { useBridgeConnectionSelector } from '../../../bridge/BridgeSessionProvider';

/** How long the connection may wait before the step spells out what still has to happen in MT5. */
const NO_CONNECTION_HINT_DELAY_MS = 20_000;

const TOKEN_MISMATCH_HINT = 'MetaTrader 5 uses a different bridge token.';
const OUTDATED_HINT_FALLBACK = 'The installed BetterChartsBridge is not the version this app requires.';
const NO_CONNECTION_HINT = 'No EA has connected yet. Attach BetterChartsBridge to a chart and turn on Algo Trading.';

const CONNECT_CHECKLIST = [
  'BetterChartsBridge is attached to a chart',
  'Algo Trading is on in MetaTrader 5',
  "The EA uses this app's token (Install and restart MT5 sets it)",
] as const;

/** What the step says about a bridge that has not answered, and whether reinstalling fixes it. */
type ConnectHint =
  | { kind: 'tokenMismatch'; message: string }
  | { kind: 'outdated'; message: string }
  | { kind: 'waiting'; message: string };

/**
 * A refusal the install fixes wins over the wait; `waitingHint` is the wait once it lasted long enough.
 * `refusalMessage` is the bridge's own wording, which only the outdated hint shows.
 */
function connectHint(
  refusal: BridgeRefusal | undefined,
  refusalMessage: string | undefined,
  waitingHint: string | undefined,
): ConnectHint | undefined {
  if (refusal === BridgeRefusal.TokenMismatch) {
    return { kind: 'tokenMismatch', message: TOKEN_MISMATCH_HINT };
  }
  if (refusal === BridgeRefusal.ComponentOutdated) {
    return { kind: 'outdated', message: refusalMessage ?? OUTDATED_HINT_FALLBACK };
  }
  if (waitingHint !== undefined) {
    return { kind: 'waiting', message: waitingHint };
  }
  return undefined;
}

/**
 * Step 3: waits for the EA, naming what has to be true in MetaTrader 5 for it to
 * answer. The bridge's own connection finishes the setup while this step is open.
 */
export function ConnectStep({ onBack, onInstallAgain }: { onBack: () => void; onInstallAgain: () => void }) {
  const state = useBridgeConnectionSelector(({ status }) => status.state);
  const refusal = useBridgeConnectionSelector(({ status }) => bridgeRefusal(status));
  const refusalMessage = useBridgeConnectionSelector(({ status }) => status.message);
  const noConnectionYet = useDelayedReveal(state !== 'connected', NO_CONNECTION_HINT_DELAY_MS);
  const hint = connectHint(refusal, refusalMessage, noConnectionYet ? NO_CONNECTION_HINT : undefined);

  return (
    <section className="setup-guide-step" aria-labelledby="setup-guide-connect-title">
      <h3 className="setup-guide-title" id="setup-guide-connect-title">
        Connect
      </h3>
      <LoadingMessage title="Waiting for the EA to connect…" hint="The chart appears as soon as the EA answers." />
      <ul className="setup-guide-checklist">
        {CONNECT_CHECKLIST.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
      {hint !== undefined && (
        <div className="setup-guide-connect-hint">
          <p role="status">{hint.message}</p>
          {hint.kind !== 'waiting' && (
            <button type="button" className="setup-guide-install-run" onClick={onInstallAgain}>
              Install again
            </button>
          )}
        </div>
      )}
      <div className="setup-guide-step-actions">
        <button type="button" className="setup-guide-secondary setup-guide-install-back" onClick={onBack}>
          Back
        </button>
      </div>
    </section>
  );
}
