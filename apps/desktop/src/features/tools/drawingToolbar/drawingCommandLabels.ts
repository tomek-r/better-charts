/**
 * The names of the drawing commands the floating toolbar and the object tree both offer. One name per
 * command, so both places read the same and their buttons still match after a rename.
 */

/**
 * A command that names the state it leads to: `off` while the drawing is unlocked or shown, `on` once
 * it is locked or hidden, which is also the pressed state of the button that offers it.
 */
export interface DrawingToggleLabels {
  readonly off: string;
  readonly on: string;
}

export const DRAWING_LOCK_LABELS: DrawingToggleLabels = { off: 'Lock drawing', on: 'Unlock drawing' };

export const DRAWING_VISIBILITY_LABELS: DrawingToggleLabels = { off: 'Hide drawing', on: 'Show drawing' };

export const REMOVE_DRAWING_LABEL = 'Remove drawing';
