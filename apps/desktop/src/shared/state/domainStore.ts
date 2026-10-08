import { useCallback } from 'react';
import type { SetStateAction } from 'react';
import { useStore } from 'zustand';
import { createStore, type StoreApi } from 'zustand/vanilla';

export type DomainStore<T extends object> = StoreApi<T> & {
  setField<K extends keyof T>(key: K, action: SetStateAction<T[K]>): void;
};

export function createDomainStore<T extends object>(initialState: T): DomainStore<T> {
  const store = createStore<T>()(() => initialState);
  const setField: DomainStore<T>['setField'] = (key, action) => {
    store.setState((state) => {
      const value =
        typeof action === 'function' ? (action as (previous: T[typeof key]) => T[typeof key])(state[key]) : action;
      return Object.is(state[key], value) ? state : ({ [key]: value } as unknown as Partial<T>);
    });
  };

  return Object.assign(store, { setField });
}

export function useDomainField<T extends object, K extends keyof T>(
  store: DomainStore<T>,
  key: K,
): readonly [T[K], (action: SetStateAction<T[K]>) => void] {
  const value = useStore(store, (state) => state[key]);
  const setValue = useCallback((action: SetStateAction<T[K]>) => store.setField(key, action), [store, key]);
  return [value, setValue];
}
