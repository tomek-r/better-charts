import { test, expect } from '@playwright/test';
import { GOLDEN } from './helpers/positionOverlayGolden';
import {
  describeOps,
  hitData,
  renderFrames,
  scenarios,
  viewport,
  type RenderedOverlay,
} from './helpers/positionOverlayScenarios';

/**
 * Characterization of the live position overlay: for each fixture, the exact paint
 * operations (styles, fonts, texts, extents, order) and every hit rectangle, circle
 * and id (including the `order:` prefixed ones) in both z-order passes.
 */

const entryLabelWidth = (rendered: RenderedOverlay) => rendered.hit.labels?.find((label) => label.level === 'entry')?.w;

for (const [name, frame] of Object.entries(scenarios)) {
  for (const pass of ['lines', 'labels'] as const) {
    test(`${name} / ${pass}`, () => {
      const { ops, hit } = renderFrames(pass, [frame]);
      const golden = GOLDEN[`${name} / ${pass}`];

      expect(describeOps(ops)).toBe(golden.ops);
      expect(hitData(hit)).toEqual(JSON.parse(golden.hit));
      expect(hit.toPrice?.(viewport.priceToY(150))).toBeCloseTo(150, 9);
    });
  }
}

test('lines pass never records label hit state', () => {
  const { hit } = renderFrames('lines', [scenarios['buy position with SL and TP']]);

  expect(hit.labels).toEqual([]);
  expect(hit.posCloses).toEqual([]);
  expect(hit.slClears).toEqual([]);
});

test('a pane without size records only an empty label list and paints nothing', () => {
  const { ops, hit } = renderFrames('labels', [scenarios['buy position with SL and TP']], 0);

  expect(ops).toEqual([]);
  expect(hit).toEqual({ labels: [] });
});

test('the P&L column keeps its widest amount until the position disappears', () => {
  const position = scenarios['buy position with SL and TP'].positions[0];
  const wide = { ...scenarios['buy position with SL and TP'], positions: [{ ...position, pnl: '+1000.00 USD' }] };
  const narrow = { ...scenarios['buy position with SL and TP'], positions: [{ ...position, pnl: '+1.00 USD' }] };
  const gone = { ...narrow, positions: [] };

  const widest = entryLabelWidth(renderFrames('labels', [wide]));
  const kept = entryLabelWidth(renderFrames('labels', [wide, narrow]));
  const forgotten = entryLabelWidth(renderFrames('labels', [wide, gone, narrow]));
  const fresh = entryLabelWidth(renderFrames('labels', [narrow]));

  expect(kept).toBe(widest);
  expect(forgotten).toBe(fresh);
  expect(fresh).toBeLessThan(widest ?? 0);
});
