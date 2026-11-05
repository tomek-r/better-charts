import { createElement, Fragment, useState, type ComponentProps, type ReactElement } from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { ModalDialog, ModalDialogButton, ModalDialogCloseButton } from '../../src/shared/ui/dialog/ModalDialog';
import { useModalExit, type ModalExit } from '../../src/shared/ui/dialog/useModalExit';

type HarnessProps = Partial<ComponentProps<typeof ModalDialog>>;

/** The props that make a harness dialog leave with the exit animation, as every app modal does. */
type ModalExitProps = Pick<ModalExit, 'backdropRef' | 'closing'>;

/**
 * Builds the harness's dialog: `dismiss` runs the exit its own controls start, and `exit` carries the props
 * its `ModalDialog` renders with.
 */
type HarnessModal = (dismiss: () => void, exit: ModalExitProps) => ReactElement;

const BASIC_ACTIONS = createElement(
  Fragment,
  null,
  createElement(ModalDialogButton, { variant: 'secondary' }, 'Cancel'),
  createElement(ModalDialogButton, { variant: 'primary' }, 'Confirm'),
);

/** The harness's dialog, closed the way the app closes its own: it fades out before the harness unmounts it. */
function ExitAnimatedModal({ onClosed, modal }: { onClosed: () => void; modal: HarnessModal }) {
  const { backdropRef, closing, close } = useModalExit(onClosed);
  return modal(close, { backdropRef, closing });
}

/** Mounts an opener button; activating it opens `modal` so focus restore can be observed. */
function mountOpenerWithModal(modal: HarnessModal): void {
  function Harness() {
    const [open, setOpen] = useState(false);
    return createElement(
      Fragment,
      null,
      createElement('button', { 'data-testid': 'open-modal', onClick: () => setOpen(true) }, 'Open'),
      open ? createElement(ExitAnimatedModal, { onClosed: () => setOpen(false), modal }) : null,
    );
  }

  const appRoot = document.getElementById('root');
  if (appRoot) {
    appRoot.style.display = 'none';
  }
  const container = document.createElement('div');
  document.body.append(container);
  // Renders synchronously so the spec can query the DOM at once; act() is for test runners, not a real browser.
  flushSync(() => {
    createRoot(container).render(createElement(Harness));
  });
}

/** A two-action modal. */
export function mountModalDialogHarness(): void {
  mountOpenerWithModal((dismiss, exit) =>
    createElement(
      ModalDialog,
      { ...exit, title: 'Generic modal', onDismiss: dismiss, actions: BASIC_ACTIONS },
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
  mountOpenerWithModal((dismiss, exit) => {
    const props: HarnessProps & { title: string; onDismiss: () => void } = {
      ...exit,
      title: 'Scrollable modal',
      layout: 'scrollable',
      size: 'wide',
      onDismiss: dismiss,
      onSubmit: (event) => {
        event.preventDefault();
        recorder.__modalSubmits += 1;
      },
      headerActions: createElement(ModalDialogCloseButton, { label: 'Close scrollable', onClick: dismiss }),
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
