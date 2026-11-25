/**
 * The footprint settings a volume footprint appearance starts on: the summary under the columns, the imbalance
 * marks in each side's colour, the point of control in white, the cells of each side graded through their own four
 * shades in two columns, and the value area marked. The engine's appearance starts on them, the series draws from
 * them, and an older saved appearance that holds none of them falls back to them.
 */
export const DEFAULT_FOOTPRINT_SETTINGS = {
  gradient: true,
  display: 'cluster',
  type: 'buySell',
  values: 'volume',
  sellShades: ['#ff99a0', '#f7525f', '#cc2f3c', '#801922'],
  buyShades: ['#5cc4b4', '#089981', '#056656', '#004d40'],
  showValueArea: true,
  stackedImbalance: { visible: false, count: 3 },
  showSummary: true,
  imbalanceHighlight: { visible: true, buyColor: '#089981', sellColor: '#F23645' },
  poc: { visible: true, color: '#ffffff' },
};
