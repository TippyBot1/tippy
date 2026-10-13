import { describe, expect, it } from 'vitest';
import { MISS_GAP_MS, MISS_MS, MISS_READS, Presence } from '../src/background/presence';

const T0 = 1_700_000_000_000;
const K = 'coin:1399811149';

describe('Presence (is a coin really gone?)', () => {
  it('needs several consecutive misses spanning enough time', () => {
    const p = new Presence();
    p.record([K], new Set(), T0);
    p.record([K], new Set(), T0 + 9_000);
    expect(p.gone(K, T0 + 9_000)).toBe(false); // 2 reads
    p.record([K], new Set(), T0 + 18_000);
    expect(p.gone(K, T0 + 18_000)).toBe(false); // 3 reads but only 18s
    p.record([K], new Set(), T0 + MISS_MS + 1);
    expect(p.gone(K, T0 + MISS_MS + 1)).toBe(true);
  });

  it('one sighting resets the count', () => {
    const p = new Presence();
    for (let i = 0; i < MISS_READS; i++) p.record([K], new Set(), T0 + i * 15_000);
    p.record([K], new Set([K]), T0 + 50_000);
    p.record([K], new Set(), T0 + 60_000);
    expect(p.gone(K, T0 + 60_000)).toBe(false);
  });

  it('a long gap between reads (logged out / asleep) restarts the count', () => {
    const p = new Presence();
    p.record([K], new Set(), T0);
    p.record([K], new Set(), T0 + 15_000);
    p.record([K], new Set(), T0 + 15_000 + MISS_GAP_MS + 1);
    expect(p.gone(K, T0 + 15_000 + MISS_GAP_MS + 1)).toBe(false);
  });

  it('reset() forgets everything, and stale confirmations expire', () => {
    const p = new Presence();
    for (let i = 0; i <= MISS_READS; i++) p.record([K], new Set(), T0 + i * 12_000);
    expect(p.gone(K, T0 + MISS_READS * 12_000)).toBe(true);
    expect(p.gone(K, T0 + MISS_READS * 12_000 + MISS_GAP_MS + 1)).toBe(false); // no fresh read since
    p.reset();
    expect(p.gone(K, T0 + MISS_READS * 12_000)).toBe(false);
  });

  it('drops coins that are no longer guarded', () => {
    const p = new Presence();
    for (let i = 0; i <= MISS_READS; i++) p.record([K], new Set(), T0 + i * 12_000);
    p.record([], new Set(), T0 + 50_000);
    p.record([K], new Set(), T0 + 55_000);
    expect(p.gone(K, T0 + 55_000)).toBe(false);
  });
});
