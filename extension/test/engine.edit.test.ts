// ✎ Edit on a running plan changes it in place (review 2026-10-12): sold levels
// stay sold, percentages keep meaning "of the original bag", the entry doesn't
// move, and nothing changes while a sell is in flight. Plus: top-ups keep
// take-profits in price order.
import { describe, expect, it } from 'vitest';
import { applyOutcome, buildPlan, editPlan, evaluate, markExecuting, rescale } from '../src/engine/orders';
import type { Plan, PlanInput } from '../src/engine/types';

const T0 = 1_700_000_000_000;
const ctx = { now: T0, gap: false, gapPolicy: 'sell' as const, minSellUsd: 0.5, dustUsd: 0.01 };

function plan(over: Partial<PlanInput> = {}): Plan {
  return buildPlan({
    id: 'p',
    key: 'k:1',
    networkId: 1399811149,
    address: 'k',
    symbol: 'TST',
    name: 'Test',
    entry: { priceUSD: 0.002, mc: 2_000_000, source: 'armed-at' },
    balance: 1000,
    tps: [
      { trigger: { kind: 'x', value: 2 }, sellPct: 50 },
      { trigger: { kind: 'x', value: 5 }, sellPct: 50 },
    ],
    sl: { trigger: { kind: 'x', value: 0.7 } },
    trailing: null,
    origin: 'manual',
    now: T0,
    ...over,
  });
}

/** TP1 sells for real: queued → executing → filled. */
function fillTp1(p: Plan): Plan {
  const r = evaluate(p, { priceUSD: 0.0041, mc: null, at: T0 + 1 }, 1000, ctx);
  expect(r.actions).toHaveLength(1);
  let q = markExecuting(r.plan, { kind: 'tp', id: 'tp1' }, T0 + 2);
  q = applyOutcome(q, { kind: 'tp', id: 'tp1' }, { status: 'filled', balanceAfter: 500 }, T0 + 3);
  expect(q.tps[0].status).toBe('filled');
  return q;
}

describe('editPlan', () => {
  it('keeps a sold take-profit sold and the last level still sells the rest', () => {
    const p = fillTp1(plan());
    const r = editPlan(p, { tps: [{ id: 'tp2', trigger: { kind: 'x', value: 4 }, sellPct: 50 }], sl: { trigger: { kind: 'x', value: 0.7 } }, trailing: null }, T0 + 10);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.plan.tps.map((t) => [t.id, t.status, t.targetRemaining])).toEqual([
      ['tp1', 'filled', 500],
      ['tp2', 'waiting', 0], // 50% sold + 50% = everything left
    ]);
    expect(r.plan.entry.priceUSD).toBe(0.002); // "4x" still means 4x your entry
    expect(r.plan.origBalance).toBe(1000);
  });

  it("won't add up past 100% counting what already sold", () => {
    const p = fillTp1(plan());
    const r = editPlan(p, { tps: [{ id: 'tp2', trigger: { kind: 'x', value: 5 }, sellPct: 60 }], sl: null, trailing: null }, T0 + 10);
    expect(r.ok).toBe(false);
  });

  it('refuses while a sell is in flight (the stop is never dropped mid-sell)', () => {
    const p = plan();
    const r1 = evaluate(p, { priceUSD: 0.0013, mc: null, at: T0 + 1 }, 1000, ctx);
    const r2 = evaluate(r1.plan, { priceUSD: 0.0013, mc: null, at: T0 + 2 }, 1000, ctx);
    expect(r2.actions[0]?.type).toBe('sell');
    const executing = markExecuting(r2.plan, { kind: 'sl' }, T0 + 3);
    const r = editPlan(executing, { tps: [], sl: null, trailing: null }, T0 + 4);
    expect(r).toMatchObject({ ok: false, stale: true });
  });

  it('refuses an edit based on a take-profit that has since sold', () => {
    const p = fillTp1(plan());
    const r = editPlan(p, { tps: [{ id: 'tp1', trigger: { kind: 'x', value: 2 }, sellPct: 50 }], sl: null, trailing: null }, T0 + 10);
    expect(r).toMatchObject({ ok: false, stale: true });
  });

  it('adds new levels with fresh ids and sorts by price', () => {
    const r = editPlan(plan(), {
      tps: [
        { id: 'tp2', trigger: { kind: 'x', value: 5 }, sellPct: 25 },
        { id: null, trigger: { kind: 'price', value: 0.003 }, sellPct: 25 },
        { id: 'tp1', trigger: { kind: 'mc', value: 4_000_000 }, sellPct: 25 },
      ],
      sl: { trigger: { kind: 'price', value: 0.0015 } },
      trailing: null,
    }, T0 + 5);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.plan.tps.map((t) => t.id)).toEqual(['tp3', 'tp1', 'tp2']); // $0.003, $4M MC (=$0.004), 5x (=$0.01)
    expect(r.plan.tps.map((t) => t.targetRemaining)).toEqual([750, 500, 250]);
    expect(r.plan.sl!.trigger).toEqual({ kind: 'price', value: 0.0015 });
  });

  it('keeps the trailing stop’s highest price when you change its distance', () => {
    let p = plan({ trailing: { trailPct: 30, activateX: null } });
    p = evaluate(p, { priceUSD: 0.003, mc: null, at: T0 + 1 }, 1000, ctx).plan;
    const peak = p.trailing!.peakPrice;
    expect(peak).toBe(0.003);
    const r = editPlan(p, { tps: [], sl: null, trailing: { trailPct: 20, activateX: null } }, T0 + 2);
    expect(r.ok && r.plan.trailing!.peakPrice).toBe(peak);
  });
});

describe('rescale on a top-up', () => {
  it('re-sorts mixed price / x levels so a lower level never sells the higher one’s share', () => {
    const p = plan({
      tps: [
        { trigger: { kind: 'price', value: 0.005 }, sellPct: 50 },
        { trigger: { kind: 'x', value: 3 }, sellPct: 25 },
      ],
    });
    // bought 2000 more at $0.0012 → blended entry ≈ $0.001467; 3x ≈ $0.0044 is now below $0.005
    const r = rescale(p, 3000, T0 + 1, 0.0044 / 3);
    expect(r.tps.map((t) => t.trigger.kind)).toEqual(['x', 'price']);
    expect(r.tps.map((t) => Math.round(t.targetRemaining))).toEqual([2250, 750]);
    expect(r.entry.mc).toBeCloseTo((2_000_000 * 0.0044) / 3 / 0.002);
  });
});

describe('review fixes (2026-10-13)', () => {
  it('a top-up re-sizes a blocked take-profit too, so a Retry sells its share of the bigger bag', async () => {
    const { retryLevel } = await import('../src/engine/orders');
    let p = plan({ tps: [{ trigger: { kind: 'x', value: 2 }, sellPct: 50 }, { trigger: { kind: 'x', value: 4 }, sellPct: 50 }] });
    p = { ...p, tps: p.tps.map((t, i) => (i === 0 ? { ...t, status: 'blocked' as const, clickedAt: null } : t)) };
    const r = rescale(p, 2000, T0 + 1);
    expect(r.tps[0].targetRemaining).toBe(1000);
    const retried = retryLevel(r, { kind: 'tp', id: 'tp1' }, T0 + 2);
    const e = evaluate(retried, { priceUSD: 0.0065, mc: null, at: T0 + 3 }, 2000, ctx);
    const sell = e.actions.find((a) => a.type === 'sell');
    expect(sell && sell.type === 'sell' && sell.targetRemaining).toBe(1000); // sells 1000 (50%), not 1500
  });

  it('take-profits folded into a sell are marked sold with it', () => {
    let p = plan({ tps: [{ trigger: { kind: 'x', value: 2 }, sellPct: 25 }, { trigger: { kind: 'x', value: 3 }, sellPct: 25 }, { trigger: { kind: 'x', value: 5 }, sellPct: 50 }] });
    const r = evaluate(p, { priceUSD: 0.0065, mc: null, at: T0 + 1 }, 1000, ctx); // jumps past 2x and 3x
    expect(r.plan.tps[0].status).toBe('merged');
    p = markExecuting(r.plan, { kind: 'tp', id: 'tp2' }, T0 + 2);
    p = applyOutcome(p, { kind: 'tp', id: 'tp2' }, { status: 'filled', balanceAfter: 500 }, T0 + 3);
    expect(p.tps.map((t) => t.status)).toEqual(['filled', 'filled', 'waiting']);
    const top = rescale(p, 1000, T0 + 4); // bought back to 1000
    expect(top.origBalance).toBe(2000);
    expect(top.tps[2].targetRemaining).toBe(0);
  });
});

describe('editPlan with merged levels', () => {
  it('removing the take-profit others were folded into removes them too (they never count as sold)', () => {
    let p = plan({ tps: [{ trigger: { kind: 'x', value: 2 }, sellPct: 25 }, { trigger: { kind: 'x', value: 3 }, sellPct: 25 }, { trigger: { kind: 'x', value: 5 }, sellPct: 50 }] });
    p = evaluate(p, { priceUSD: 0.0065, mc: null, at: T0 + 1 }, 1000, ctx).plan; // tp1 folded into tp2
    p = markExecuting(p, { kind: 'tp', id: 'tp2' }, T0 + 2);
    p = applyOutcome(p, { kind: 'tp', id: 'tp2' }, { status: 'failed', detail: 'below minimum', retryable: false }, T0 + 3);
    expect(p.tps[1].status).toBe('blocked');
    const r = editPlan(p, { tps: [{ id: 'tp3', trigger: { kind: 'x', value: 5 }, sellPct: 50 }], sl: null, trailing: null }, T0 + 4);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.plan.tps.map((t) => t.id)).toEqual(['tp3']);
    expect(r.plan.tps[0].targetRemaining).toBe(500); // sells its 50%, not "the rest"
  });
});

describe('what counts as sold (verification fixes)', () => {
  it("a blocked lower take-profit whose share a higher one just sold is marked sold, so a top-up doesn't oversize the rest", () => {
    let p = plan({ tps: [{ trigger: { kind: 'x', value: 2 }, sellPct: 25 }, { trigger: { kind: 'x', value: 3 }, sellPct: 25 }, { trigger: { kind: 'x', value: 5 }, sellPct: 50 }] });
    p = { ...p, tps: p.tps.map((t, i) => (i === 0 ? { ...t, status: 'blocked' as const, clickedAt: null } : t)) };
    p = markExecuting(p, { kind: 'tp', id: 'tp2' }, T0 + 1);
    p = applyOutcome(p, { kind: 'tp', id: 'tp2' }, { status: 'filled', balanceAfter: 500 }, T0 + 2); // sold down to 500: tp1's share too
    expect(p.tps.map((t) => t.status)).toEqual(['filled', 'filled', 'waiting']);
    expect(rescale(p, 1000, T0 + 3).origBalance).toBe(2000);
  });

  it('changing a take-profit others were folded into brings them back', () => {
    let p = plan({ tps: [{ trigger: { kind: 'x', value: 2 }, sellPct: 25 }, { trigger: { kind: 'x', value: 3 }, sellPct: 25 }, { trigger: { kind: 'x', value: 5 }, sellPct: 50 }] });
    p = evaluate(p, { priceUSD: 0.0065, mc: null, at: T0 + 1 }, 1000, ctx).plan; // tp1 folded into tp2
    p = markExecuting(p, { kind: 'tp', id: 'tp2' }, T0 + 2);
    p = applyOutcome(p, { kind: 'tp', id: 'tp2' }, { status: 'failed', detail: 'below minimum', retryable: false }, T0 + 3);
    const r = editPlan(p, { tps: [{ id: 'tp2', trigger: { kind: 'x', value: 4 }, sellPct: 25 }, { id: 'tp3', trigger: { kind: 'x', value: 5 }, sellPct: 50 }], sl: null, trailing: null }, T0 + 4);
    expect(r.ok && r.plan.tps.map((t) => [t.id, t.status, t.targetRemaining])).toEqual([
      ['tp1', 'waiting', 750],
      ['tp2', 'waiting', 500],
      ['tp3', 'waiting', 0],
    ]);
  });
});
