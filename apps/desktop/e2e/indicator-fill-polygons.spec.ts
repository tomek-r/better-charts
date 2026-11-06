import { expect, test } from '@playwright/test';
import { fillPolygons } from '../src/features/chart/engine/indicators/indicatorFillPolygons';

/**
 * The geometry of an indicator fill: one polygon per unbroken run of bars, running along the `from`
 * edge and back along the `to` edge, with every bar that breaks the band splitting the run.
 */

test('a band of three columns is one polygon along both edges', () => {
  const polygons = fillPolygons([
    { x: 0, from: 10, to: 20 },
    { x: 10, from: 11, to: 21 },
    { x: 20, from: 12, to: 22 },
  ]);

  expect(polygons).toEqual([
    [
      { x: 0, y: 10 },
      { x: 10, y: 11 },
      { x: 20, y: 12 },
      { x: 20, y: 22 },
      { x: 10, y: 21 },
      { x: 0, y: 20 },
    ],
  ]);
});

test('a missing edge splits the band into the runs around it', () => {
  const polygons = fillPolygons([
    { x: 0, from: 10, to: 20 },
    { x: 10, from: 11, to: 21 },
    { x: 20, from: null, to: 22 },
    { x: 30, from: 13, to: 23 },
    { x: 40, from: 14, to: 24 },
  ]);

  expect(polygons).toEqual([
    [
      { x: 0, y: 10 },
      { x: 10, y: 11 },
      { x: 10, y: 21 },
      { x: 0, y: 20 },
    ],
    [
      { x: 30, y: 13 },
      { x: 40, y: 14 },
      { x: 40, y: 24 },
      { x: 30, y: 23 },
    ],
  ]);
});

test('a run of one column is dropped', () => {
  const polygons = fillPolygons([
    { x: 0, from: 10, to: 20 },
    { x: 10, from: null, to: null },
    { x: 20, from: 12, to: 22 },
    { x: 30, from: null, to: 23 },
    { x: 40, from: 14, to: 24 },
  ]);

  expect(polygons).toEqual([]);
});

test('no columns produce no polygons', () => {
  expect(fillPolygons([])).toEqual([]);
});
