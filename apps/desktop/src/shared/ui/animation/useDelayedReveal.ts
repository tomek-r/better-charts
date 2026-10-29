import { useEffect, useMemo, useState } from 'react';

/** Identity of one stretch of `active`, so the reveal of an earlier one cannot outlive it. */
interface Activation {
  active: boolean;
}

/**
 * Whether `active` has held for `delayMs`, so a state that flashes at app start stays out of the way
 * until it settles. Leaving `active` hides the reveal again and restarts the delay.
 */
export function useDelayedReveal(active: boolean, delayMs: number): boolean {
  // A fresh token per stretch of `active` keeps the reset out of the effect: the reveal recorded by
  // the timer belongs to the stretch it started in, and the timeout is the only state writer.
  const activation = useMemo<Activation>(() => ({ active }), [active]);
  const [revealedActivation, setRevealedActivation] = useState<Activation | undefined>(undefined);

  useEffect(() => {
    if (!active) {
      return;
    }
    const timer = setTimeout(() => setRevealedActivation(activation), delayMs);
    return () => {
      clearTimeout(timer);
    };
  }, [activation, active, delayMs]);

  return active && revealedActivation === activation;
}
