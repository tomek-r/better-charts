/** The surface a row opens the menu from: the legend's More button, or a right press on an object tree row. */
export type IndicatorActionsMenuOrigin = 'legend' | 'objectTree';

/** One opening of the actions menu: the indicator it acts on, where it hangs from, and what takes the focus back. */
export interface IndicatorActionsMenuRequest {
  readonly instanceId: string;
  /** The window point the menu opens under, in client pixels. */
  readonly x: number;
  readonly y: number;
  /** The button or the row name that opened the menu, which Escape gives the focus back to. */
  readonly returnFocus: HTMLElement;
  /** The row that opened the menu; only the legend's menu offers the way to the Object tree drawer. */
  readonly origin: IndicatorActionsMenuOrigin;
}

/** The request a row's More button makes: the menu opens under the button's left corner. */
export function actionsMenuUnderButton(instanceId: string, button: HTMLElement): IndicatorActionsMenuRequest {
  const { left, bottom } = button.getBoundingClientRect();
  return { instanceId, x: left, y: bottom, returnFocus: button, origin: 'legend' };
}

/** The request a right-press on a row makes: the menu opens at the pointer, and the row's name keeps the focus. */
export function actionsMenuAtPointer(
  instanceId: string,
  press: { readonly clientX: number; readonly clientY: number },
  rowName: HTMLElement,
): IndicatorActionsMenuRequest {
  return { instanceId, x: press.clientX, y: press.clientY, returnFocus: rowName, origin: 'objectTree' };
}
