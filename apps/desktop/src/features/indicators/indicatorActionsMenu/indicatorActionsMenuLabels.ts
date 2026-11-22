/** The name the indicator actions menu announces, whether a legend row or an object tree row opened it. */
export const INDICATOR_ACTIONS_MENU_LABEL = 'Indicator actions';

/** The words of the indicator actions menu's rows. */
export const INDICATOR_ACTION_LABELS = {
  visualOrder: 'Visual order',
  bringToFront: 'Bring to front',
  sendToBack: 'Send to back',
  bringForward: 'Bring forward',
  sendBackward: 'Send backward',
  visibilityOnIntervals: 'Visibility on intervals…',
  hide: 'Hide',
  show: 'Show',
  remove: 'Remove',
  objectTree: 'Object tree',
  settings: 'Settings…',
} as const;

/** The key the chart's selection answers to, which the Remove row names at its far end. */
export const REMOVE_SHORTCUT_HINT = 'Del';

/** Why the paint-order commands cannot move an indicator with a pane of its own, which their disabled rows say. */
export const OWN_PANE_VISUAL_ORDER_TITLE =
  'Only an indicator on the price pane can move in front of or behind the others';
