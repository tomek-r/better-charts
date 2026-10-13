import { act, createElement, Fragment, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ModalDialog, ModalDialogButton } from '../../src/shared/ui/ModalDialog';

/** Mounts an opener button; activating it opens a two-action modal so focus restore can be observed. */
export function mountModalDialogHarness(): void {
  function Harness() {
    const [open, setOpen] = useState(false);
    return createElement(
      Fragment,
      null,
      createElement('button', { 'data-testid': 'open-modal', onClick: () => setOpen(true) }, 'Open'),
      open
        ? createElement(
            ModalDialog,
            {
              title: 'Generic modal',
              onDismiss: () => setOpen(false),
              actions: createElement(
                Fragment,
                null,
                createElement(ModalDialogButton, { variant: 'secondary' }, 'Cancel'),
                createElement(ModalDialogButton, { variant: 'primary' }, 'Confirm'),
              ),
            },
            createElement('p', null, 'Body'),
          )
        : null,
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
