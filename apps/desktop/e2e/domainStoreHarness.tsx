import { act, createElement, Fragment } from 'react';
import { createRoot } from 'react-dom/client';
import { createDomainStore, useDomainField } from '../src/shared/state/domainStore';

interface DomainStoreHarnessWindow extends Window {
  __domainStoreNotifications: { first: number; second: number };
}

const getHarnessWindow = () => window as unknown as DomainStoreHarnessWindow;
let cleanupHarness: (() => void) | undefined;

export function mountDomainStoreHarness(): void {
  const firstStore = createDomainStore({ count: 0 });
  const secondStore = createDomainStore({ count: 10 });
  const notifications = { first: 0, second: 0 };
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
      ),
    );
  });

  firstStore.setField('count', 0);
  getHarnessWindow().__domainStoreNotifications = notifications;
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
