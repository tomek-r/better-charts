import { act, createElement, Fragment, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { createDomainStore, useDomainField, useFieldSetterSelector } from '../src/shared/state/domainStore';
import { useOrderTicketSizing } from '../src/features/order-ticket/state/useOrderTicketSizing';
import { createOrderTicketStores } from '../src/features/order-ticket/state/orderTicketStores';

interface DomainStoreHarnessWindow extends Window {
  __domainStoreNotifications: { first: number; second: number };
  __domainStoreSetterMetrics: { writerRenders: number; stableAcrossRenders: boolean };
}

const getHarnessWindow = () => window as unknown as DomainStoreHarnessWindow;
let cleanupHarness: (() => void) | undefined;

export function mountDomainStoreHarness(): void {
  const firstStore = createDomainStore({ count: 0 });
  const secondStore = createDomainStore({ count: 10 });
  const sizingStores = createOrderTicketStores();
  const notifications = { first: 0, second: 0 };
  const setterMetrics = { writerRenders: 0, stableAcrossRenders: true };
  const unsubscribeFirst = firstStore.subscribe(() => notifications.first++);
  const unsubscribeSecond = secondStore.subscribe(() => notifications.second++);

  function Counter({ id, store }: { id: string; store: typeof firstStore }) {
    const [count, setCount] = useDomainField(store, 'count');
    return createElement(
      'button',
      { 'data-testid': id, onClick: () => setCount((previous) => previous + 1) },
      String(count),
    );
  }

  function WriteOnlyCounter({ store }: { store: typeof firstStore }) {
    const setters = useFieldSetterSelector(store, (availableSetters) => ({ setCount: availableSetters.setCount }));
    const previousSetters = useRef(setters);
    const [localVersion, setLocalVersion] = useState(0);
    setterMetrics.writerRenders++;
    setterMetrics.stableAcrossRenders &&=
      previousSetters.current === setters && previousSetters.current.setCount === setters.setCount;
    previousSetters.current = setters;
    return createElement(
      Fragment,
      null,
      createElement(
        'button',
        { 'data-testid': 'write-only-counter', onClick: () => setters.setCount((value) => value + 1) },
        'write',
      ),
      createElement(
        'button',
        { 'data-testid': 'rerender-writer', onClick: () => setLocalVersion((value) => value + 1) },
        String(localVersion),
      ),
    );
  }

  function SizingCommandConsumer() {
    const { applyUnitsMode, setRiskAmountFromInput } = useOrderTicketSizing(sizingStores, () => undefined);
    const [result, setResult] = useState('ready');
    return createElement(
      Fragment,
      null,
      createElement(
        'button',
        {
          'data-testid': 'run-sizing-commands',
          onClick: () => {
            applyUnitsMode('equity');
            setRiskAmountFromInput('150');
            const equityInput = sizingStores.draft.getState().riskAmount;
            applyUnitsMode('money');
            setRiskAmountFromInput('50');
            applyUnitsMode('units');
            const finalState = sizingStores.draft.getState();
            setResult(`${equityInput}:${finalState.unitsMode}:${finalState.riskAmount}`);
          },
        },
        'Run sizing commands',
      ),
      createElement('output', { 'data-testid': 'sizing-command-result' }, result),
    );
  }

  const container = document.createElement('div');
  container.id = 'domain-store-harness';
  document.body.append(container);
  const root = createRoot(container);
  act(() => {
    root.render(
      createElement(
        Fragment,
        null,
        createElement(Counter, { id: 'first-counter', store: firstStore }),
        createElement(Counter, { id: 'second-counter', store: secondStore }),
        createElement(WriteOnlyCounter, { store: firstStore }),
        createElement(SizingCommandConsumer),
      ),
    );
  });

  firstStore.setField('count', 0);
  getHarnessWindow().__domainStoreNotifications = notifications;
  getHarnessWindow().__domainStoreSetterMetrics = setterMetrics;
  cleanupHarness = () => {
    root.unmount();
    unsubscribeFirst();
    unsubscribeSecond();
    container.remove();
    cleanupHarness = undefined;
  };
}

export function unmountDomainStoreHarness(): void {
  cleanupHarness?.();
}
