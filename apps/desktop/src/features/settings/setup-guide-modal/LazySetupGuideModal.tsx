import { Suspense, lazy, type ComponentProps } from 'react';
import { Loader } from '../../../shared/ui/Loader';
import type { SetupGuideModal } from './SetupGuideModal';

const loadSetupGuideModal = () => import('./SetupGuideModal');

/** Starts loading the guide's chunk ahead of the first open; repeated calls reuse the same import. */
export function preloadSetupGuide(): void {
  void loadSetupGuideModal();
}

// Most launches never open the guide, so its steps, install hook and styles load on first use only.
const SetupGuideModalChunk = lazy(() => loadSetupGuideModal().then((module) => ({ default: module.SetupGuideModal })));

/** Stands where the guide will open while its chunk loads, so the press always answers. */
function SetupGuideLoading() {
  return (
    <div className="setup-guide-loading" role="status" aria-label="Loading setup guide">
      <Loader />
    </div>
  );
}

/** The guide, loaded on first use; the loader stands in until the chunk arrives. */
export function LazySetupGuideModal(props: ComponentProps<typeof SetupGuideModal>) {
  return (
    <Suspense fallback={<SetupGuideLoading />}>
      <SetupGuideModalChunk {...props} />
    </Suspense>
  );
}
