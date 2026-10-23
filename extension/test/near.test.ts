// "Getting close" alerts (engine/near.ts): milestones on the way from your entry
// to the next take-profit, a warning just above a stop, each once per level,
// and a daily cap per coin.
import { describe, expect, it } from 'vitest';
import { nearAlerts, type NearSettings } from '../src/engine/near';
import { buildPlan, editPlan, pausePlan } from '../src/engine/orders';
import type { Plan, PlanInput } from '../src/engine/types';

const T0 = Date.UTC(2026, 9, 23, 12);
const DAY = 24 * 3600_000;
const mc = (n: number) => ({ kind: 'mc' as const, value: n });
/** A quote at a market cap (price follows: supply 1e9). */
const atMc = (m: number, at = T0) => ({ priceUSD: m / 1e9, mc: m, at });
const CFG: NearSettings = { tp: [50, 90], sl: 20, maxPerDay: 5 };

function plan(over: Partial<PlanInput> = {}): Plan {
  return buildPlan({
    id: 'p1',
    key: 'TippyMint111:1399811149',
    networkId: 1399811149,
    address: 'TippyMint111',
    symbol: 'TIPPY',
    name: 'Tippy',
    entry: { priceUSD: 0.0003, mc: 300_000, source: 'armed-at' },
    balance: 100_000,
    tps: [
      { trigger: mc(1_000_000), sellPct: 50 },
      { trigger: mc(2_000_000), sellPct: 25 },
    ],
    stops: [],
    sl: { trigger: mc(200_000) },
    trailing: null,
    origin: 'manual',
    now: T0,
    ...over,
  });
}

/** Walk a plan through market caps, keeping what was sent; returns every alert title. */
function walk(p: Plan, mcs: number[], cfg = CFG, start = T0): { titles: string[]; texts: string[]; plan: Plan } {
  const titles: string[] = [];
  const texts: string[] = [];
  mcs.forEach((m, i) => {
    const at = start + i * 3000;
    const r = nearAlerts(p, atMc(m, at), cfg, at);
    p = { ...p, near: r.near };
    for (const a of r.alerts) {
      titles.push(a.title);
      texts.push(a.text);
    }
  });
  return { titles, texts, plan: p };
}

describe('getting close to a take-profit', () => {
  it('says halfway, then 90%, on the way from your entry to the next take-profit', () => {
    // entry $300K → TP1 $1M: halfway is $650K, 90% is $930K
    const { titles, texts } = walk(plan(), [400_000, 640_000, 660_000, 700_000, 940_000, 950_000]);
    expect(titles).toEqual(['📈 $TIPPY is halfway to your take-profit', '📈 $TIPPY is 90% of the way to your take-profit']);
    expect(texts[0]).toBe('$660K MC now. Take-profit 1 sells 50% of your bag at $1M MC.');
  });

  it('a jump straight past both milestones sends one alert, not two', () => {
    const { titles } = walk(plan(), [400_000, 960_000, 970_000]);
    expect(titles).toEqual(['📈 $TIPPY is 90% of the way to your take-profit']);
  });

  it('a dip and a second run at the same milestone stays quiet', () => {
    const { titles } = walk(plan(), [660_000, 500_000, 400_000, 680_000]);
    expect(titles).toHaveLength(1);
  });

  it('moves on to the next take-profit once one has filled', () => {
    let p = plan();
    p = { ...p, tps: p.tps.map((t, i) => (i === 0 ? { ...t, status: 'filled' as const } : t)) };
    // entry $300K → TP2 $2M: halfway is $1.15M
    const { titles, texts } = walk(p, [1_200_000]);
    expect(titles).toEqual(['📈 $TIPPY is halfway to your take-profit']);
    expect(texts[0]).toContain('Take-profit 2 sells 25% of your bag at $2M MC');
  });

  it('a single take-profit is "your take-profit"', () => {
    const { texts } = walk(plan({ tps: [{ trigger: mc(1_000_000), sellPct: 100 }] }), [700_000]);
    expect(texts[0]).toContain('Your take-profit sells 100% of your bag');
  });

  it('editing the level starts its milestones afresh', () => {
    const first = walk(plan(), [700_000]);
    const [tp1, tp2] = first.plan.tps;
    const edited = editPlan(
      first.plan,
      { tps: [{ id: tp1.id, trigger: mc(1_100_000), sellPct: 50 }, { id: tp2.id, trigger: tp2.trigger, sellPct: 25 }], sl: { trigger: mc(200_000) }, trailing: null },
      T0 + 10_000,
    );
    if (!edited.ok) throw new Error(edited.error);
    const p = edited.plan;
    const again = walk(p, [710_000], CFG, T0 + 20_000);
    expect(again.titles).toEqual(['📈 $TIPPY is halfway to your take-profit']);
  });

  it('can be switched off', () => {
    expect(walk(plan(), [700_000, 960_000], { ...CFG, tp: [] }).titles).toEqual([]);
  });

  it('honours any mix of milestones', () => {
    const { titles } = walk(plan(), [480_000, 660_000, 830_000, 940_000], { ...CFG, tp: [25, 50, 75, 90] });
    expect(titles.map((t) => t.replace('📈 $TIPPY is ', ''))).toEqual([
      '25% of the way to your take-profit',
      'halfway to your take-profit',
      '75% of the way to your take-profit',
      '90% of the way to your take-profit',
    ]);
  });
});

describe('getting close to a stop', () => {
  it('warns once when the price is within 20% above the stop loss', () => {
    // stop loss $200K: within 20% above means at or under $250K
    const { titles, texts } = walk(plan(), [280_000, 250_000, 240_000, 245_000]);
    expect(titles).toEqual(['⚠️ $TIPPY is getting close to a stop']);
    expect(texts[0]).toBe('$250K MC now, 20% above your stop loss at $200K MC, which sells the rest.');
  });

  it('warns about the nearest stop first: a partial stop above the stop loss', () => {
    const { texts } = walk(plan({ stops: [{ trigger: mc(260_000), sellPct: 10 }] }), [300_000, 310_000, 320_000]);
    expect(texts[0]).toContain('above your stop at $260K MC, which sells 10% of your bag');
  });

  it('can be switched off', () => {
    expect(walk(plan(), [240_000], { ...CFG, sl: null }).titles).toEqual([]);
  });
});

describe('limits', () => {
  it('caps each coin per day, and the cap resets the next day', () => {
    const cfg = { ...CFG, maxPerDay: 1 };
    const day1 = walk(plan(), [700_000, 960_000], cfg);
    expect(day1.titles).toHaveLength(1);
    // the 90% milestone was passed while capped: it isn't brought up stale the next day
    const day2 = walk(day1.plan, [960_000, 240_000], cfg, T0 + DAY);
    expect(day2.titles).toEqual(['⚠️ $TIPPY is getting close to a stop']);
  });

  it('says nothing for a paused plan', () => {
    expect(walk(pausePlan(plan(), T0), [700_000, 240_000]).titles).toEqual([]);
  });

  it('works with take-profits set as a multiple of entry', () => {
    const p = plan({ tps: [{ trigger: { kind: 'x', value: 3 }, sellPct: 50 }] });
    // entry $0.0003 → 3x is $0.0009: halfway is $0.0006
    const { titles, texts } = walk(p, [610_000]);
    expect(titles).toEqual(['📈 $TIPPY is halfway to your take-profit']);
    expect(texts[0]).toContain('at 3x');
  });

  it('remembers only a bounded number of marks', () => {
    let p = plan();
    for (let i = 0; i < 100; i++) {
      p = { ...p, tps: [{ ...p.tps[0], trigger: mc(1_000_000 + i * 1000) }] };
      p = walk(p, [700_000], { ...CFG, maxPerDay: 1000 }, T0 + i).plan;
    }
    expect(p.near!.sent.length).toBeLessThanOrEqual(60);
  });
});
