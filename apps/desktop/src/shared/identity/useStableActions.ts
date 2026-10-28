import { useLayoutEffect, useMemo, useRef } from 'react';

type Action = (...args: never[]) => unknown;

/**
 * `useEventCallback` for a whole set of actions: the returned object and each function in it keep their
 * identity for the component's lifetime (as long as the key set is unchanged) and call the latest committed action.
 */
export function useStableActions<Actions extends Record<string, Action>>(actions: Actions): Actions {
  const actionsRef = useRef(actions);
  useLayoutEffect(() => {
    actionsRef.current = actions;
  }, [actions]);
  const keySignature = Object.keys(actions).join('\n');
  return useMemo(() => {
    const stable: Record<string, Action> = {};
    for (const key of keySignature.split('\n')) {
      stable[key] = (...args) => (actionsRef.current[key] as (...callArgs: unknown[]) => unknown)(...args);
    }
    return stable as Actions;
  }, [keySignature]);
}
