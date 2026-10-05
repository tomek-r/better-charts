import { useCallback, useLayoutEffect, useRef } from 'react';

/** Event handlers retain their identity and read the latest committed callback. */
export function useEventCallback<Args extends unknown[], Result>(callback: (...args: Args) => Result) {
  const callbackRef = useRef(callback);
  useLayoutEffect(() => {
    callbackRef.current = callback;
  }, [callback]);
  return useCallback((...args: Args): Result => callbackRef.current(...args), []);
}
