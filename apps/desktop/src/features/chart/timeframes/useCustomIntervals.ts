import { useCallback, useState } from 'react';
import { loadCustomIntervals, saveCustomIntervals, withCustomInterval, withoutCustomInterval } from './customIntervals';

export function useCustomIntervals() {
  const [customIntervals, setCustomIntervals] = useState<readonly string[]>(() => loadCustomIntervals());
  const addCustomInterval = useCallback((wire: string) => {
    setCustomIntervals((current) => {
      const next = withCustomInterval(current, wire);
      saveCustomIntervals(next);
      return next;
    });
  }, []);
  const removeCustomInterval = useCallback((wire: string) => {
    setCustomIntervals((current) => {
      const next = withoutCustomInterval(current, wire);
      saveCustomIntervals(next);
      return next;
    });
  }, []);
  return { customIntervals, addCustomInterval, removeCustomInterval };
}
