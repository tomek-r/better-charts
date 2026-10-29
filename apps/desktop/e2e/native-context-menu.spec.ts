import { expect, test, type Page } from '@playwright/test';
import { gotoWithStub } from './helpers/tauriStub';

interface ContextMenuCase {
  name: string;
  appendedMarkup: string;
  targetSelector: string;
  menuSuppressed: boolean;
}

const CASES: ContextMenuCase[] = [
  { name: 'page body', appendedMarkup: '', targetSelector: 'body', menuSuppressed: true },
  { name: 'chart area', appendedMarkup: '', targetSelector: '.chart-host', menuSuppressed: true },
  { name: 'input', appendedMarkup: '<input id="probe">', targetSelector: '#probe', menuSuppressed: false },
  {
    name: 'textarea',
    appendedMarkup: '<textarea id="probe"></textarea>',
    targetSelector: '#probe',
    menuSuppressed: false,
  },
  {
    name: 'editable element',
    appendedMarkup: '<div id="probe" contenteditable="true"></div>',
    targetSelector: '#probe',
    menuSuppressed: false,
  },
  {
    name: 'non-editable element',
    appendedMarkup: '<div id="probe" contenteditable="false"></div>',
    targetSelector: '#probe',
    menuSuppressed: true,
  },
];

async function contextMenuWasSuppressed(page: Page, appendedMarkup: string, targetSelector: string): Promise<boolean> {
  return page.evaluate(
    ({ appendedMarkup: markup, targetSelector: selector }) => {
      document.body.insertAdjacentHTML('beforeend', markup);
      const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
      document.querySelector(selector)!.dispatchEvent(event);
      return event.defaultPrevented;
    },
    { appendedMarkup, targetSelector },
  );
}

test.describe('native context menu', () => {
  for (const { name, appendedMarkup, targetSelector, menuSuppressed } of CASES) {
    test(`${menuSuppressed ? 'is suppressed' : 'is kept'} on ${name}`, async ({ page }) => {
      await gotoWithStub(page);
      expect(await contextMenuWasSuppressed(page, appendedMarkup, targetSelector)).toBe(menuSuppressed);
    });
  }
});
