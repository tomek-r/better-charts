import { useState } from 'react';
import {
  sameTimeframeVisibility,
  type DrawingTimeframeVisibility,
} from '../../../chart/engine/drawings/timeframeVisibility';
import type { TimeframeVisibilityEditing } from './VisibilityTab';

/** The draft of a drawing's timeframe setting, and which value to save: only an edited one. */
export interface TimeframeVisibilityDraft extends TimeframeVisibilityEditing {
  /** The edited setting, or undefined while it still equals the stored one. */
  changedValue(): DrawingTimeframeVisibility | undefined;
}

export function useTimeframeVisibilityDraft(initial: DrawingTimeframeVisibility): TimeframeVisibilityDraft {
  const [value, setValue] = useState(initial);
  return {
    value,
    onChange: setValue,
    changedValue: () => (sameTimeframeVisibility(value, initial) ? undefined : value),
  };
}
