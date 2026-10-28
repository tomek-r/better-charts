import { act, createElement, Fragment, useState, type ComponentProps, type ReactElement } from 'react';
import { createRoot } from 'react-dom/client';
import { ModalDialog, ModalDialogButton, ModalDialogCloseButton } from '../../src/shared/ui/dialog/ModalDialog';

type HarnessProps = Partial<ComponentProps<typeof ModalDialog>>;

const BASIC_ACTIONS = createElement(
  Fragment,
  null,
  createElement(ModalDialogButton, { variant: 'secondary' }, 'Cancel'),
  createElement(ModalDialogButton, { variant: 'primary' }, 'Confirm'),
);

/** Mounts an opener button; activating it opens `modal` so focus restore can be observed. */
function mountOpenerWithModal(modal: (close: () => void) => ReactElement): void {
  function Harness() {
    const [open, setOpen] = useState(false);
    return createElement(
      Fragment,
      null,
      createElement('button', { 'data-testid': 'open-modal', onClick: () => setOpen(true) }, 'Open'),
      open ? modal(() => setOpen(false)) : null,
    );
  }

  const appRoot = document.getElementById('root');
  if (appRoot) {
    appRoot.style.display = 'none';
  }
  const container = document.createElement('div');
  document.body.append(container);
  act(() => {
    createRoot(container).render(createElement(Harness));
  });
}

/** A two-action modal. */
export function mountModalDialogHarness(): void {
  mountOpenerWithModal((close) =>
    createElement(
      ModalDialog,
      { title: 'Generic modal', onDismiss: close, actions: BASIC_ACTIONS },
      createElement('p', null, 'Body'),
    ),
  );
}

/**
 * A scrollable modal with a close button, a footer note, a form and an input. `window.__modalKeys` records the
 * keys the input's own handler saw and `window.__modalSubmits` counts submissions.
 */
export function mountScrollableModalHarness(): void {
  const recorder = window as unknown as { __modalKeys: string[]; __modalSubmits: number };
  recorder.__modalKeys = [];
  recorder.__modalSubmits = 0;
  mountOpenerWithModal((close) => {
    const props: HarnessProps & { title: string; onDismiss: () => void } = {
      title: 'Scrollable modal',
      layout: 'scrollable',
      size: 'wide',
      onDismiss: close,
      onSubmit: (event) => {
        event.preventDefault();
        recorder.__modalSubmits += 1;
      },
      headerActions: createElement(ModalDialogCloseButton, { label: 'Close scrollable', onClick: close }),
      footerNote: 'Footer note text',
      actions: createElement(ModalDialogButton, { type: 'submit' }, 'Submit'),
    };
    return createElement(
      ModalDialog,
      props,
      createElement(
        'div',
        { 'data-testid': 'scroller', style: { height: '100%', overflow: 'auto' } },
        createElement('input', {
          'aria-label': 'Probe input',
          onKeyDown: (event: { key: string }) => recorder.__modalKeys.push(event.key),
        }),
        createElement('div', { style: { height: 2000 } }, 'Tall content'),
      ),
    );
  });
}
