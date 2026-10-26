import { useState } from 'react';
import { createTauriChartDrawingStore, type ChartDrawingStore } from './chartDrawingStore';
import { useChartDrawingPersistence } from './useChartDrawingPersistence';

/** Renders nothing: hung inside the chart canvas, so the drawings live exactly as long as the chart does. */
export function ChartDrawingPersistence(): null {
  // One store for the lifetime of the chart: it holds nothing but the two commands.
  const [store] = useState<ChartDrawingStore>(createTauriChartDrawingStore);
  useChartDrawingPersistence(store);
  return null;
}
