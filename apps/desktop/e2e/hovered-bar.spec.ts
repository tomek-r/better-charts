import { expect, test } from '@playwright/test';
import type { IChartApi, MouseEventParams, Time, UTCTimestamp } from 'lightweight-charts';

import type { RenderBar } from '../src/features/chart/engine/bars/renderBar';
import { HoveredBar } from '../src/features/chart/engine/legend/hoveredBar';

/** Three bar times, in the UTC seconds the chart reports. */
const BAR_TIMES = [1_000, 2_000, 3_000] as UTCTimestamp[];

/** Bars at the given times, which the hovered bar resolves by time alone. */
function barsAt(times: readonly number[]): RenderBar[] {
  return times.map((time) => ({ time, open: 1, close: 2, high: 2, low: 1, volume: 0 }));
}

/** A chart whose crosshair the test moves by hand, so the hovered bar is read without a browser. */
function crosshairStub(): { chart: IChartApi; hover(time: Time | undefined): void } {
  let subscribed: ((param: MouseEventParams<Time>) => void) | null = null;
  const chart = {
    subscribeCrosshairMove: (listener: (param: MouseEventParams<Time>) => void) => {
      subscribed = listener;
    },
    unsubscribeCrosshairMove: () => {
      subscribed = null;
    },
  };
  return {
    chart: chart as unknown as IChartApi,
    hover: (time) => subscribed?.({ time } as MouseEventParams<Time>),
  };
}

test('the hovered bar is the bar at the pointer time, or the last bar while no bar has it', () => {
  const stub = crosshairStub();
  const hovered = new HoveredBar(stub.chart, () => barsAt(BAR_TIMES));

  expect(hovered.index()).toBe(BAR_TIMES.length - 1);

  stub.hover(BAR_TIMES[0]);

  expect(hovered.index()).toBe(0);

  stub.hover((BAR_TIMES[1]! + 0.5) as UTCTimestamp);

  expect(hovered.index()).toBe(BAR_TIMES.length - 1);
});

test('the hovered bar reads no bar at all while the chart holds none', () => {
  const stub = crosshairStub();
  const hovered = new HoveredBar(stub.chart, () => []);

  stub.hover(BAR_TIMES[0]);

  expect(hovered.index()).toBe(-1);
});

test('the hovered bar keeps reading the same bar once older bars arrive under a parked pointer', () => {
  const stub = crosshairStub();
  let bars = barsAt(BAR_TIMES);
  const hovered = new HoveredBar(stub.chart, () => bars);
  stub.hover(BAR_TIMES[1]);

  bars = barsAt([-2_000, -1_000, ...BAR_TIMES]);

  expect(hovered.index()).toBe(BAR_TIMES.length);
});

test('the hovered bar tells its listeners only when the pointer reaches another time', () => {
  const stub = crosshairStub();
  const hovered = new HoveredBar(stub.chart, () => barsAt(BAR_TIMES));
  const heard: number[] = [];
  const stopHearing = hovered.subscribe(() => heard.push(hovered.index()));

  stub.hover(BAR_TIMES[0]);
  stub.hover(BAR_TIMES[0]);
  stub.hover(BAR_TIMES[1]);
  stopHearing();
  stub.hover(BAR_TIMES[2]);

  expect(heard).toEqual([0, 1]);
});

test('a text time from the chart reads as no bar, and repeating it tells nobody', () => {
  const stub = crosshairStub();
  const hovered = new HoveredBar(stub.chart, () => barsAt(BAR_TIMES));
  let heard = 0;
  hovered.subscribe(() => {
    heard += 1;
  });

  stub.hover(BAR_TIMES[0]);
  stub.hover('2024-01-01');
  stub.hover('2024-01-02');

  expect(heard).toBe(2);
  expect(hovered.index()).toBe(BAR_TIMES.length - 1);
});

test('a destroyed hovered bar stops hearing the crosshair', () => {
  const stub = crosshairStub();
  const hovered = new HoveredBar(stub.chart, () => barsAt(BAR_TIMES));

  hovered.destroy();
  stub.hover(BAR_TIMES[0]);

  expect(hovered.index()).toBe(BAR_TIMES.length - 1);
});
