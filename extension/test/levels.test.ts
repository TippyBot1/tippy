// The ✎ level editor: converting a take-profit / stop loss between a multiple,
// an exact price and a market cap, and what actually gets armed.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { buildPlan } from '../src/engine/orders';
import type { Trigger, TriggerKind } from '../src/engine/types';
import { pctFmt } from '../src/ui/format';
import { equivalents, fieldText, levelFromPct, levelProblem, levelShort, levelText, levelX, parseField, parseLevel, parsePct, pctBoxText, priceText, relToNow, rowHint, sortByLevel, stopOrderNote, toText, vsEntry } from '../src/ui/levels';

const now = { priceUSD: 0.002, mc: 2_000_000 };

describe('level conversions', () => {
  it('shows a take-profit in every unit', () => {
    const tp: Trigger = { kind: 'x', value: 2 };
    expect(toText(tp, 'x', 'tp', now)).toBe('2');
    expect(toText(tp, 'price', 'tp', now)).toBe('0.004');
    expect(toText(tp, 'mc', 'tp', now)).toBe('4M');
    expect(equivalents(tp, 'tp', now)).toEqual(['$0.004', '$4M MC']);
    expect(rowHint(tp, 'tp', now)).toBe('≈$4M');
  });

  it('reads a market cap or price back into a level', () => {
    const mc = parseLevel('$5M', 'mc', 'tp')!;
    expect(mc).toEqual({ kind: 'mc', value: 5_000_000 });
    expect(levelX(mc, now)).toBeCloseTo(2.5);
    expect(equivalents(mc, 'tp', now)).toEqual(['2.5x', '$0.005']);
    expect(levelText(mc)).toBe('$5M MC');
    expect(parseLevel('0.0045', 'price', 'tp')).toEqual({ kind: 'price', value: 0.0045 });
    expect(parseLevel('$1,250', 'price', 'tp')).toEqual({ kind: 'price', value: 1250 });
    expect(parseLevel('3x', 'x', 'tp')).toEqual({ kind: 'x', value: 3 });
  });

  it('a stop loss "x" is a drop in %', () => {
    expect(parseLevel('30', 'x', 'sl')).toEqual({ kind: 'x', value: 0.7 });
    expect(parseLevel('-22.5%', 'x', 'sl')).toEqual({ kind: 'x', value: 0.775 });
    expect(parseLevel('100', 'x', 'sl')).toBeNull();
    const sl: Trigger = { kind: 'x', value: 0.7 };
    expect(toText(sl, 'x', 'sl', now)).toBe('30');
    expect(toText(sl, 'mc', 'sl', now)).toBe('1.4M');
    expect(toText({ kind: 'mc', value: 1_500_000 }, 'x', 'sl', now)).toBe('25');
    expect(levelText({ kind: 'x', value: 0.775 })).toBe('−22.5%');
    expect(rowHint({ kind: 'price', value: 0.0015 }, 'sl', now)).toBe('≈−25%');
  });

  it('rejects nonsense', () => {
    for (const [text, kind] of [
      ['', 'x'],
      ['abc', 'price'],
      ['0', 'mc'],
      ['-5', 'price'],
      ['2..5', 'x'],
      ['1e', 'mc'],
    ] as [string, TriggerKind][])
      expect(parseLevel(text, kind, 'tp')).toBeNull();
  });

  it('take-profits must be above the price now, stops below', () => {
    expect(levelProblem({ kind: 'price', value: 0.001 }, 'tp', now)).toMatch(/above/);
    expect(levelProblem({ kind: 'mc', value: 3_000_000 }, 'sl', now)).toMatch(/below/);
    expect(levelProblem({ kind: 'x', value: 1 }, 'tp', now)).toMatch(/above/);
    expect(levelProblem({ kind: 'mc', value: 3_000_000 }, 'tp', { priceUSD: 0.002, mc: null })).toMatch(/market cap/);
    expect(levelProblem({ kind: 'price', value: 0.003 }, 'tp', now)).toBeNull();
    expect(levelProblem({ kind: 'price', value: 0.0019 }, 'sl', now)).toBeNull();
  });

  it('prices never come out in e-notation', () => {
    expect(priceText(1.234e-7)).toBe('0.0000001234');
    expect(priceText(0.00512)).toBe('0.00512');
    expect(priceText(123.456)).toBe('123.5');
    expect(priceText(2)).toBe('2');
    expect(priceText(45_000)).toBe('45000');
  });

  it('sorts take-profits by where they sit, whatever the unit', () => {
    const tps = [{ trigger: { kind: 'mc', value: 10_000_000 } as Trigger }, { trigger: { kind: 'x', value: 2 } as Trigger }, { trigger: { kind: 'price', value: 0.006 } as Trigger }];
    expect(sortByLevel(tps, now).map((t) => levelX(t.trigger, now))).toEqual([2, expect.closeTo(3), expect.closeTo(5)]);
  });

  it('switching units and back keeps the level (within display rounding)', () => {
    fc.assert(
      fc.property(fc.double({ min: 1e-9, max: 100, noNaN: true }), fc.double({ min: 1e4, max: 1e10, noNaN: true }), fc.double({ min: 1.01, max: 50, noNaN: true }), (price, mc, x) => {
        const at = { priceUSD: price, mc };
        let t: Trigger = { kind: 'x', value: +x.toFixed(2) };
        for (const k of ['price', 'mc', 'x', 'mc', 'price'] as TriggerKind[]) {
          const next = parseLevel(toText(t, k, 'tp', at), k, 'tp');
          expect(next).not.toBeNull();
          expect(levelX(next!, at) / levelX(t, at)).toBeCloseTo(1, 1);
          t = next!;
        }
      }),
      { numRuns: 300 },
    );
  });
});

describe('review fixes (2026-10-12)', () => {
  it('a decimal comma is a decimal point; thousands commas are dropped', () => {
    expect(parseLevel('1,5', 'x', 'tp')).toEqual({ kind: 'x', value: 1.5 });
    expect(parseLevel('2,5', 'x', 'sl')).toEqual({ kind: 'x', value: 0.975 });
    expect(parseLevel('0,0045', 'price', 'tp')).toEqual({ kind: 'price', value: 0.0045 });
    expect(parseLevel('1,500', 'price', 'tp')).toEqual({ kind: 'price', value: 1500 });
    expect(parseLevel('2,500,000', 'mc', 'tp')).toEqual({ kind: 'mc', value: 2_500_000 });
  });

  it('a stop above the price has no "drop" — switching tabs never flips its side', () => {
    expect(toText({ kind: 'price', value: 0.003 }, 'x', 'sl', now)).toBe('');
    expect(parseLevel('+20', 'x', 'sl')).toBeNull();
    expect(parseLevel('-2', 'x', 'tp')).toBeNull();
  });

  it('limit-buy levels: a plain number is a dip, + is a breakout', () => {
    expect(parseLevel('20', 'x', 'buy')).toEqual({ kind: 'x', value: 0.8 });
    expect(parseLevel('−20', 'x', 'buy')).toEqual({ kind: 'x', value: 0.8 });
    expect(parseLevel('+15', 'x', 'buy')).toEqual({ kind: 'x', value: 1.15 });
    expect(toText({ kind: 'x', value: 1.15 }, 'x', 'buy', now)).toBe('+15');
    expect(toText({ kind: 'mc', value: 1_600_000 }, 'x', 'buy', now)).toBe('20');
    expect(levelText({ kind: 'x', value: 0.8 }, 'buy')).toBe('−20%');
    expect(levelText({ kind: 'x', value: 1.15 }, 'buy')).toBe('+15%');
    expect(levelProblem({ kind: 'price', value: 0.002 }, 'buy', now)).toMatch(/where it is now/);
    expect(levelProblem({ kind: 'price', value: 0.0024 }, 'buy', now)).toBeNull();
  });

  it('on a running plan, x is measured from the entry but checked against the price now', () => {
    const entry = { priceUSD: 0.001, mc: 1_000_000 };
    // 2x of a $0.001 entry = $0.002 = the price now → not above it
    expect(levelProblem({ kind: 'x', value: 2 }, 'tp', now, entry)).toMatch(/above/);
    expect(levelProblem({ kind: 'x', value: 3 }, 'tp', now, entry)).toBeNull();
    expect(rowHint({ kind: 'x', value: 3 }, 'tp', entry)).toBe('≈$3M');
  });

  it('multiples of 10x and up keep one decimal', () => {
    expect(levelText({ kind: 'x', value: 10.5 })).toBe('10.5x');
    expect(levelText({ kind: 'x', value: 20 })).toBe('20x');
  });
});

describe("the order form's level box", () => {
  const higgs = { priceUSD: 0.000719, mc: 719_000 };

  it('reads a market cap or a price, and shows it back the way traders write it', () => {
    expect(parseField('700k', 'mc')).toEqual({ kind: 'mc', value: 700_000 });
    expect(parseField('$1.2M', 'mc')).toEqual({ kind: 'mc', value: 1_200_000 });
    expect(parseField('$0.0007', 'price')).toEqual({ kind: 'price', value: 0.0007 });
    expect(parseField('lots', 'mc')).toBeNull();
    expect(fieldText({ kind: 'mc', value: 700_000 }, 'mc', higgs)).toBe('700K');
    expect(fieldText({ kind: 'mc', value: 700_000 }, 'price', higgs)).toBe('0.0007');
    expect(levelShort({ kind: 'mc', value: 700_000 }, 'mc', higgs)).toBe('$700K MC');
    expect(levelShort({ kind: 'price', value: 0.0007 }, 'price', higgs)).toBe('$0.0007');
  });

  it('the % box and the slider: a move from now, both ways', () => {
    expect(pctBoxText(-2.6426)).toBe('-2.6');
    expect(pctBoxText(400)).toBe('+400');
    expect(pctBoxText(NaN)).toBe('');
    expect(parsePct('−2.6%')).toBe(-2.6);
    expect(parsePct('+10')).toBe(10);
    expect(parsePct('-')).toBeNull();
    const t = levelFromPct(-10, 'mc', higgs)!;
    expect(t.kind).toBe('mc');
    expect(t.value).toBeCloseTo(647_100);
    expect(levelFromPct(-100, 'price', higgs)!.value).toBeCloseTo(0.00000719); // never zero: −99%
    expect(relToNow({ kind: 'mc', value: 700_000 }, higgs)).toBeCloseTo(0.97357, 4);
  });

  it('against your entry: a market cap, a price, or a multiple of it', () => {
    const entry = { priceUSD: 0.000716, mc: 716_000 };
    expect(vsEntry({ kind: 'mc', value: 700_000 }, entry, higgs)).toBeCloseTo(0.97765, 4);
    expect(vsEntry({ kind: 'price', value: 0.001432 }, entry, higgs)).toBeCloseTo(2);
    expect(vsEntry({ kind: 'x', value: 3 }, entry, higgs)).toBe(3);
    // Armed without a market cap: converted at today's price.
    expect(vsEntry({ kind: 'mc', value: 1_438_000 }, { priceUSD: 0.000719, mc: null }, higgs)).toBeCloseTo(2);
  });

  it('a P/L reads +1.0%, −20.0%, +340% — never −0.0%', () => {
    expect(pctFmt(1)).toBe('+1.0%');
    expect(pctFmt(-20)).toBe('−20.0%');
    expect(pctFmt(340.4)).toBe('+340%');
    expect(pctFmt(-0.01)).toBe('0.0%');
  });
});

describe('a partial stop and the stop loss in the wrong order', () => {
  // Entry $0.001 / $1M MC; the coin is at $2M MC now. Stop loss at 0.7x of entry = $700K MC.
  const entry = { priceUSD: 0.001, mc: 1_000_000 };
  const plan = (stops: { trigger: Trigger; sellPct: number }[] = []) =>
    buildPlan({
      id: 'p1',
      key: 'K:1',
      networkId: 1,
      address: 'K',
      symbol: 'TST',
      name: 'Test',
      entry: { ...entry, source: 'armed-at' },
      balance: 1000,
      tps: [],
      stops,
      sl: { trigger: { kind: 'x', value: 0.7 } },
      trailing: null,
      origin: 'manual',
      now: 1,
    });
  const mc = (value: number): Trigger => ({ kind: 'mc', value });
  const SL_FIRST = 'Heads up: your stop loss at $700K MC is higher, so it would sell everything first.';

  it('a partial stop at or under the stop loss: the stop loss sells everything first (whatever units each is in)', () => {
    expect(stopOrderNote(plan(), 'stop', mc(650_000), now, entry, 'mc')).toBe(SL_FIRST);
    expect(stopOrderNote(plan(), 'stop', mc(700_000), now, entry, 'mc')).toBe(SL_FIRST); // the same level
    expect(stopOrderNote(plan(), 'stop', { kind: 'price', value: 0.0007 }, now, entry, 'mc')).toBe(SL_FIRST);
    expect(stopOrderNote(plan(), 'stop', { kind: 'x', value: 0.6 }, now, entry, 'mc')).toBe(SL_FIRST);
    expect(stopOrderNote(plan(), 'stop', mc(650_000), now, entry, 'price')).toBe('Heads up: your stop loss at $0.0007 is higher, so it would sell everything first.');
    expect(stopOrderNote(plan(), 'stop', mc(710_000), now, entry, 'mc')).toBeNull();
    expect(stopOrderNote(plan(), 'stop', { kind: 'x', value: 0.71 }, now, entry, 'mc')).toBeNull();
  });

  it('only a waiting stop loss counts, and not the one being changed', () => {
    const p = plan();
    expect(stopOrderNote(p, 'stop', mc(650_000), now, entry, 'mc', { kind: 'sl' })).toBeNull(); // ✎ the stop loss into a partial stop
    p.sl!.status = 'held';
    expect(stopOrderNote(p, 'stop', mc(650_000), now, entry, 'mc')).toBeNull();
    expect(stopOrderNote({ sl: null, stops: [] }, 'stop', mc(650_000), now, entry, 'mc')).toBeNull();
  });

  it('the mirror: a stop loss at or over partial stops — those never fire', () => {
    const p = plan([
      { trigger: mc(900_000), sellPct: 10 },
      { trigger: mc(800_000), sellPct: 25 },
      { trigger: { kind: 'x', value: 0.75 }, sellPct: 12.5 },
    ]);
    expect(stopOrderNote(p, 'sl', mc(700_000), now, entry, 'mc')).toBeNull();
    expect(stopOrderNote(p, 'sl', mc(750_000), now, entry, 'mc')).toBe('Heads up: your 12.5% stop at $750K MC is lower, so it would never fire — the stop loss sells everything first.');
    expect(stopOrderNote(p, 'sl', mc(850_000), now, entry, 'mc')).toBe('Heads up: your stops at $800K MC and $750K MC are lower, so they would never fire — the stop loss sells everything first.');
    expect(stopOrderNote(p, 'sl', mc(1_000_000), now, entry, 'mc')).toBe(
      'Heads up: your stops at $900K MC, $800K MC and $750K MC are lower, so they would never fire — the stop loss sells everything first.',
    );
    // A stop that sold, or the one being turned into the stop loss, is left out.
    p.stops[0].status = 'filled';
    expect(stopOrderNote(p, 'sl', mc(1_000_000), now, entry, 'mc', { kind: 'stop', id: 'st2' })).toBe(
      'Heads up: your 12.5% stop at $750K MC is lower, so it would never fire — the stop loss sells everything first.',
    );
  });

  it('a plan saved before partial stops (no list), or a level it cannot place, says nothing', () => {
    const p = plan() as Partial<ReturnType<typeof plan>>;
    delete p.stops;
    expect(stopOrderNote(p as ReturnType<typeof plan>, 'sl', mc(1_000_000), now, entry, 'mc')).toBeNull();
    expect(stopOrderNote(plan(), 'stop', mc(650_000), { priceUSD: null, mc: null }, entry, 'mc')).toBeNull();
  });
});
