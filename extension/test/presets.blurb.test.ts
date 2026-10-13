// The settings page describes each preset: its own words while the levels are
// the stock ones, and exactly what it now does once a level was changed.
import { describe, expect, it } from 'vitest';
import { DEFAULT_PRESETS } from '../src/shared/settings';
import { presetBlurb } from '../src/ui/LimitBuy';

const classic = DEFAULT_PRESETS.find((p) => p.id === 'classic')!;

describe('preset blurbs', () => {
  it('keeps the friendly words while the levels are untouched', () => {
    expect(presetBlurb(classic)).toBe(classic.blurb);
  });
  it('says what the preset now does once a level changes', () => {
    const edited = { ...classic, tps: [{ x: 3, pct: 40 }, ...classic.tps.slice(1)], slX: 0.75 };
    expect(presetBlurb(edited)).toBe('3x 40% · 5x 25% · SL −25%');
  });
});
