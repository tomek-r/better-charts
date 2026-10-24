import { Suspense, lazy, type ComponentProps } from 'react';
import type { SetupGuideModal } from './SetupGuideModal';

const loadSetupGuideModal = () => import('./SetupGuideModal');

/** Starts loading the guide's chunk ahead of the first open; repeated calls reuse the same import. */
export function preloadSetupGuide(): void {
  void loadSetupGuideModal();
}

// Most launches never open the guide, so its steps, install hook and styles load on first use only.
const SetupGuideModalChunk = lazy(() => loadSetupGuideModal().then((module) => ({ default: module.SetupGuideModal })));

/** The guide, loaded on first use; nothing shows until its chunk arrives. */
export function LazySetupGuideModal(props: ComponentProps<typeof SetupGuideModal>) {
  return (
    <Suspense fallback={null}>
      <SetupGuideModalChunk {...props} />
    </Suspense>
  );
}
