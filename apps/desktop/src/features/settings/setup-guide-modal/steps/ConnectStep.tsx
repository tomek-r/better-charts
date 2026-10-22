import { LoadingMessage } from '../../../../shared/ui/LoadingMessage';

const CONNECT_CHECKLIST = [
  'BetterChartsBridge is attached to a chart',
  'Algo Trading is on in MetaTrader 5',
  "The EA uses this app's token (Install and restart MT5 sets it)",
] as const;

/**
 * Step 3: waits for the EA, naming what has to be true in MetaTrader 5 for it to
 * answer. The bridge's own connection finishes the setup while this step is open; a
 * refusal the bridge reports is the bottom-right notices' job, so nothing here repeats
 * or outlives what they say.
 */
export function ConnectStep() {
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
    </section>
  );
}
