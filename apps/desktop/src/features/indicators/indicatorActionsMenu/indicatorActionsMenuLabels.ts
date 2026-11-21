/** The name the indicator actions menu announces, whether a legend row or an object tree row opened it. */
export const INDICATOR_ACTIONS_MENU_LABEL = 'Indicator actions';

/** The words of the indicator actions menu's rows. */
export const INDICATOR_ACTION_LABELS = {
  visualOrder: 'Visual order',
  bringToFront: 'Bring to front',
  sendToBack: 'Send to back',
  visibilityOnIntervals: 'Visibility on intervals…',
  hide: 'Hide',
  show: 'Show',
  remove: 'Remove',
  settings: 'Settings…',
} as const;

/** Why an indicator with a pane of its own has no paint order to move in, which its disabled Visual order row says. */
export const OWN_PANE_VISUAL_ORDER_TITLE =
  'Only an indicator on the price pane can move in front of or behind the others';
