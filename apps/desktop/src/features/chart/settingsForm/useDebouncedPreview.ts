import { useEffect, useEffectEvent, useRef } from 'react';

import type { SettingValues } from '../engine/settings/settingInputs';
import { areSettingValuesValid, withStoredValuesForInvalidInactiveInputs } from '../engine/settings/settingsSchema';
import type { SettingsFormSchema } from './settingsTabModel';

// A short pause after the last edit keeps typing responsive while the chart still follows along.
const PREVIEW_DELAY_MS = 250;

/**
 * Shows the draft on the chart once the edits rest, as OK would save it. Every edit restarts the pause,
 * unmounting cancels it, and an invalid draft shows nothing. An untouched draft never previews, whatever
 * `initialValues` object the owner passes: it is compared with the draft the form opened with.
 */
export function useDebouncedPreview(
  values: SettingValues,
  initialValues: SettingValues,
  settings: SettingsFormSchema,
  onPreview: ((values: SettingValues) => void) | undefined,
): void {
  const previewsDraft = onPreview !== undefined;
  // An owner may hand a new `initialValues` object on every render, so that prop's identity says nothing
  // about an untouched draft; the draft the form opened with, taken once, does.
  const openedWith = useRef(values);
  const previewSettledDraft = useEffectEvent(() => {
    if (values === openedWith.current || !areSettingValuesValid(settings, values)) {
      return;
    }
    onPreview?.(withStoredValuesForInvalidInactiveInputs(settings, values, initialValues));
  });

  // Keyed on the draft alone: a preview rewrites the settings read here, which must not reschedule the pause.
  useEffect(() => {
    if (!previewsDraft) {
      return;
    }
    const previewTimer = window.setTimeout(previewSettledDraft, PREVIEW_DELAY_MS);
    return () => window.clearTimeout(previewTimer);
  }, [values, previewsDraft]);
}
