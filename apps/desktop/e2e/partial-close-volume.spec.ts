import { expect, test } from '@playwright/test';
import {
  checkPartialVolume,
  partialCloseLimits,
  presetVolume,
  remainingVolume,
  sliderPositionVolume,
  snapSliderMove,
  snapSliderPosition,
  snapVolumeText,
  stepVolumeText,
  volumeSliderPosition,
  volumeSliderScale,
  type PartialCloseLimits,
} from '../src/features/partial-close/partialCloseVolume';

// Pure-module coverage (no browser): the rules mirror the Rust domain module.
const limits = (volume: string, min = '0.01', step = '0.01'): PartialCloseLimits => ({ volume, min, step });

test('partial close is only offered for a splittable position with a capability and broker limits', () => {
  const position = { volume: '0.10', volumeMin: '0.01', volumeStep: '0.01' };
  expect(partialCloseLimits(position, true)).toEqual(limits('0.10'));
  expect(partialCloseLimits(position, false)).toBeUndefined();
  expect(partialCloseLimits({ ...position, volumeMin: null }, true)).toBeUndefined();
  expect(partialCloseLimits({ ...position, volumeStep: undefined }, true)).toBeUndefined();
  expect(partialCloseLimits({ ...position, volume: '0.01' }, true)).toBeUndefined();
  expect(partialCloseLimits({ ...position, volume: '0.02' }, true)).toBeDefined();
  expect(partialCloseLimits({ ...position, volumeStep: '0' }, true)).toBeUndefined();
});

test('checkPartialVolume validates min, position, step and remainder exactly', () => {
  const l = limits('1.00');
  expect(checkPartialVolume(l, '0.30')).toEqual({ ok: true, volume: '0.3', closesAll: false });
  expect(checkPartialVolume(l, '0,3')).toEqual({ ok: true, volume: '0.3', closesAll: false });
  expect(checkPartialVolume(l, '1')).toEqual({ ok: true, volume: '1', closesAll: true });
  expect(checkPartialVolume(l, '0.005')).toEqual({ ok: false, issue: 'below-min' });
  expect(checkPartialVolume(l, '1.01')).toEqual({ ok: false, issue: 'above-position' });
  expect(checkPartialVolume(l, '0.305')).toEqual({ ok: false, issue: 'off-step' });
  expect(checkPartialVolume(l, '')).toEqual({ ok: false, issue: 'unreadable' });
  expect(checkPartialVolume(l, 'abc')).toEqual({ ok: false, issue: 'unreadable' });
  expect(checkPartialVolume(l, '-1')).toEqual({ ok: false, issue: 'unreadable' });
  expect(checkPartialVolume(limits('0.10'), '0.10')).toMatchObject({ ok: true, closesAll: true });
  expect(checkPartialVolume(limits('0.10', '0.04', '0.01'), '0.07')).toEqual({
    ok: false,
    issue: 'remainder-below-min',
  });
  // 0.1 + 0.2 style float traps must not matter.
  expect(checkPartialVolume(limits('0.3', '0.1', '0.1'), '0.1')).toMatchObject({ ok: true });
  expect(checkPartialVolume(limits('0.3', '0.1', '0.1'), '0.2')).toMatchObject({ ok: true });
  expect(checkPartialVolume(limits('0.3', '0.1', '0.1'), '0.15')).toEqual({ ok: false, issue: 'off-step' });
});

test('presets round down to the step and are hidden when not a valid partial volume', () => {
  expect(presetVolume(limits('1.00'), 25)).toBe('0.25');
  expect(presetVolume(limits('0.10'), 25)).toBe('0.02');
  expect(presetVolume(limits('0.10'), 75)).toBe('0.07');
  expect(presetVolume(limits('0.02'), 25)).toBeUndefined();
  expect(presetVolume(limits('0.02'), 50)).toBe('0.01');
  expect(presetVolume(limits('0.05'), 75)).toBe('0.03');
  expect(presetVolume(limits('1.00', '0.10', '0.10'), 25)).toBe('0.2');
  expect(presetVolume(limits('1', '1', '1'), 50)).toBeUndefined();
  expect(presetVolume(limits('10', '1', '1'), 25)).toBe('2');
  // Rounded volume leaves a remainder below min: hidden.
  expect(presetVolume(limits('0.05', '0.03', '0.01'), 50)).toBeUndefined();
});

test('snap, step and remaining volume stay on the lot grid', () => {
  const l = limits('1.00');
  expect(snapVolumeText(l, '0,337')).toBe('0.33');
  expect(snapVolumeText(l, 'x')).toBe('x');
  expect(stepVolumeText(l, '0.30', 1)).toBe('0.31');
  expect(stepVolumeText(l, '0.30', -1)).toBe('0.29');
  expect(stepVolumeText(l, '0.01', -1)).toBe('0.01');
  expect(stepVolumeText(l, '1.00', 1)).toBe('1');
  expect(stepVolumeText(l, '', 1)).toBe('0.02');
  expect(remainingVolume(l, '0.30')).toBe('0.7');
});

test('results derived from 8-decimal limits carry no trailing zeros', () => {
  const l = limits('0.10000000', '0.01000000', '0.01000000');
  expect(presetVolume(l, 50)).toBe('0.05');
  expect(remainingVolume(l, '0.05')).toBe('0.05');
  expect(stepVolumeText(l, '0.05', 1)).toBe('0.06');
  expect(snapVolumeText(l, '0.057')).toBe('0.05');
  expect(checkPartialVolume(l, '0.05')).toEqual({ ok: true, volume: '0.05', closesAll: false });
});

test('slider positions are whole lot steps mapped to exact decimals', () => {
  const l = limits('0.10');
  expect(volumeSliderScale(l)).toEqual({ min: 1, max: 10 });
  expect(volumeSliderPosition(l, '0.05')).toBe(5);
  expect(volumeSliderPosition(l, '0.1')).toBe(10);
  expect(volumeSliderPosition(l, 'abc')).toBeUndefined();
  expect(sliderPositionVolume(l, 7)).toBe('0.07');
  expect(sliderPositionVolume(l, 10)).toBe('0.1');
  expect(snapSliderPosition(l, 0)).toBe(1);
  expect(snapSliderPosition(l, 99)).toBe(10);
  const coarse = limits('1', '0.1', '0.1');
  expect(volumeSliderScale(coarse)).toEqual({ min: 1, max: 10 });
  expect(sliderPositionVolume(coarse, 3)).toBe('0.3');
  expect(sliderPositionVolume(coarse, 10)).toBe('1');
});

test('slider snaps the invalid remainder gap to V - m or V', () => {
  // V 0.10, m 0.04: positions 7, 8, 9 would leave less than 0.04.
  const l = limits('0.10', '0.04', '0.01');
  expect(volumeSliderScale(l)).toEqual({ min: 4, max: 10 });
  expect(snapSliderPosition(l, 6)).toBe(6);
  expect(snapSliderPosition(l, 7)).toBe(6);
  expect(snapSliderPosition(l, 8)).toBe(6);
  expect(snapSliderPosition(l, 9)).toBe(10);
  expect(sliderPositionVolume(l, 9)).toBe('0.1');
  expect(sliderPositionVolume(l, 7)).toBe('0.06');
  // A single step crosses the gap in its own direction instead of snapping back.
  expect(snapSliderMove(l, 6, 7)).toBe(10);
  expect(snapSliderMove(l, 10, 9)).toBe(6);
  expect(snapSliderMove(l, 3, 9)).toBe(10);
  for (let position = 1; position <= 12; position += 1) {
    const volume = sliderPositionVolume(l, position);
    expect(checkPartialVolume(l, volume).ok).toBe(true);
  }
});
