import { useCallback } from 'react';
import type { SetStateAction } from 'react';
import { useStore } from 'zustand';
import { useShallow } from 'zustand/react/shallow';
import { createStore, type StoreApi } from 'zustand/vanilla';

export type FieldSetters<T extends object> = {
  [K in keyof T as `set${Capitalize<string & K>}`]: (action: SetStateAction<T[K]>) => void;
};

export type DomainStore<T extends object> = StoreApi<T> & {
  setField<K extends keyof T>(key: K, action: SetStateAction<T[K]>): void;
  setters: FieldSetters<T>;
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
  const writableStore = Object.assign(store, { setField });
  const setters = createFieldSetters(writableStore);
  return Object.assign(writableStore, { setters });
}

function createFieldSetters<T extends object>(
  store: Pick<StoreApi<T>, 'getState'> & Pick<DomainStore<T>, 'setField'>,
): FieldSetters<T> {
  const setters = {} as FieldSetters<T>;
  for (const key of Object.keys(store.getState()) as Array<keyof T>) {
    const setter = (action: SetStateAction<T[typeof key]>) => store.setField(key, action);
    (setters as unknown as Record<string, (action: SetStateAction<T[typeof key]>) => void>)[
      `set${String(key).charAt(0).toUpperCase()}${String(key).slice(1)}`
    ] = setter;
  }
  return setters;
}

export function useDomainField<T extends object, K extends keyof T>(
  store: DomainStore<T>,
  key: K,
): readonly [T[K], (action: SetStateAction<T[K]>) => void] {
  const value = useStore(store, (state) => state[key]);
  const setValue = useCallback((action: SetStateAction<T[K]>) => store.setField(key, action), [store, key]);
  return [value, setValue];
}

/** Selects stable write-only setters without subscribing to store state. */
export function useFieldSetterSelector<T extends object, Selection>(
  store: DomainStore<T>,
  selector: (setters: FieldSetters<T>) => Selection,
): Selection {
  return useShallow(selector)(store.setters);
}
