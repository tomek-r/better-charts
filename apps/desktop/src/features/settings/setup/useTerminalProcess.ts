import { useEffect, useState } from 'react';
import type { TerminalProcess } from '../../../shared/bridge/types';
import { loadTerminalProcess } from './terminalProcessCommand';

/** While the notice is up the user may start MT5 or attach the EA, so its wording follows what they do. */
const TERMINAL_PROCESS_RECHECK_MS = 5_000;

/**
 * The terminal process state while `active`: asked once at once, then every 5 s. An answer that arrives
 * after the hook went inactive, or after a newer question, is dropped; nothing is asked while inactive.
 */
export function useTerminalProcess(active: boolean): TerminalProcess | undefined {
  const [terminalProcess, setTerminalProcess] = useState<TerminalProcess | undefined>(undefined);

  useEffect(() => {
    if (!active) {
      return undefined;
    }
    let latestRequest = 0;
    let stillActive = true;
    const ask = () => {
      const request = ++latestRequest;
      void loadTerminalProcess().then((answer) => {
        if (stillActive && request === latestRequest) {
          setTerminalProcess(answer);
        }
      });
    };
    ask();
    const recheck = setInterval(ask, TERMINAL_PROCESS_RECHECK_MS);
    return () => {
      stillActive = false;
      clearInterval(recheck);
      // A later show must not flash the previous show's wording before its own answer.
      setTerminalProcess(undefined);
    };
  }, [active]);

  return terminalProcess;
}
