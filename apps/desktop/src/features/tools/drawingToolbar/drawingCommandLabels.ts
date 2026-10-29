import type { ToggleCommandLabels } from '../../../shared/ui/button/ToggleCommandButton';

/**
 * The names of the drawing commands the floating toolbar and the object tree both offer. One name per
 * command, so both places read the same and their buttons still match after a rename. A toggle names
 * the state it leads to: `off` while the drawing is unlocked or shown, `on` once it is locked or hidden.
 */

export const DRAWING_SETTINGS_LABEL = 'Drawing settings';

export const DRAWING_LOCK_LABELS: ToggleCommandLabels = { off: 'Lock drawing', on: 'Unlock drawing' };

export const DRAWING_VISIBILITY_LABELS: ToggleCommandLabels = { off: 'Hide drawing', on: 'Show drawing' };

export const REMOVE_DRAWING_LABEL = 'Remove drawing';
