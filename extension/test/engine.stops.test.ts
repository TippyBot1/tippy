// Partial stops (2026-10-13): "sell 10% at 700k" while the coin is above $700K
// MC is a stop — sell that slice if it drops there. Sized like a take-profit (a
// slice of the ORIGINAL bag, declarative target), confirmed over 2 ticks like
// the stop loss, checked before take-profits. Below fomo's minimum it folds into
// the next stop down or is skipped — never sold bigger.
import { describe, expect, it } from 'vitest';
import {
  allLevels,
  applyOutcome,
  buildPlan,
  cancelPlan,
  editPlan,
  evaluate,
  getLevel,
  hasInFlight,
  isEditableStop,
  levelLabel,
  markExecuting,
  normalizePlan,
  planEditWith,
  reconcile,
  RECONCILE_AFTER_MS,
  pausePlan,
  rescale,
  resolveHeld,
  sortActions,
  undoDryRunFills,
  resumePlan,
  retryableLevels,
  retryLevel,
  summarizePlan,
  withdrawQueued,
} from '../src/engine/orders';
import { validatePlanInput } from '../src/engine/triggers';
import type { EvalContext, LevelRef, Plan, PlanInput, SellAction } from '../src/engine/types';

const T0 = 1_700_000_000_000;
const ENTRY = 0.001; // $ per token; supply 1e9 → $1M MC at entry
const BAG = 100_000; // tokens → $100 at entry
const mc = (n: number) => ({ kind: 'mc' as const, value: n });

const ctx = (over: Partial<EvalContext> = {}): EvalContext => ({ now: T0, gap: false, gapPolicy: 'sell', minSellUsd: 2, dustUsd: 1, ...over });
/** A quote at a market cap (price follows: supply 1e9). */
const atMc = (m: number, at = T0) => ({ priceUSD: m / 1e9, mc: m, at });

function input(over: Partial<PlanInput> = {}): PlanInput {
  return {
    id: 'p1',
    key: 'HiggsMint111:1399811149',
    networkId: 1399811149,
    address: 'HiggsMint111',
    symbol: 'HIGGS',
    name: 'Higgs',
    entry: { priceUSD: ENTRY, mc: 1_000_000, source: 'armed-at' },
    balance: BAG,
    tps: [],
    stops: [{ trigger: mc(700_000), sellPct: 10 }],
    sl: null,
    trailing: null,
    origin: 'manual',
    now: T0,
    ...over,
  };
}

const sell = (r: { actions: unknown[] }) => r.actions[0] as SellAction;
const st = (id: string): LevelRef => ({ kind: 'stop', id });
const tp = (id: string): LevelRef => ({ kind: 'tp', id });

/** Feed the same market cap for `n` ticks; returns the last result. */
function ticks(plan: Plan, m: number, balance: number | null, n: number, over: Partial<EvalContext> = {}) {
  let r = { plan, actions: [] as ReturnType<typeof evaluate>['actions'] };
  for (let i = 0; i < n; i++) r = evaluate(r.plan, atMc(m), balance, ctx(over));
  return r;
}

/** Execute and fill a level, landing the balance on `after`. */
function fill(plan: Plan, ref: LevelRef, after: number): Plan {
  const p = markExecuting(plan, ref, T0);
  return applyOutcome(p, ref, { status: 'filled', balanceAfter: after }, T0);
}

describe('partial stops: firing', () => {
  it('fires after 2 ticks at/below the level and sells exactly its share', () => {
    const p = buildPlan(input());
    expect(p.stops.map((s) => [s.id, s.targetRemaining, s.confirmTicks])).toEqual([['st1', 90_000, 2]]);
    let r = evaluate(p, atMc(719_000), BAG, ctx());
    expect(r.actions).toHaveLength(0);
    r = evaluate(r.plan, atMc(700_000), BAG, ctx()); // at the level counts
    expect(r.actions).toHaveLength(0);
    expect(r.plan.stops[0].ticksBelow).toBe(1);
    r = evaluate(r.plan, atMc(690_000), BAG, ctx());
    const a = sell(r);
    expect(a.level).toEqual(st('st1'));
    expect(a.targetRemaining).toBeCloseTo(90_000, 6);
    expect(a.sellAmount).toBeCloseTo(10_000, 6);
    expect(a.sellPctOfCurrent).toBe(10);
    expect(a.priority).toBe(0.5); // after the stop loss / trailing stop, before take-profits
    expect(a.reason).toBe('stop $700K mc');
    expect(r.plan.stops[0].status).toBe('queued');
    expect(r.plan.history.at(-1)!.text).toContain('selling 10% of your bag');
  });

  it('a 1-tick wick does nothing', () => {
    let r = evaluate(buildPlan(input()), atMc(650_000), BAG, ctx());
    r = evaluate(r.plan, atMc(720_000), BAG, ctx());
    expect(r.actions).toHaveLength(0);
    expect(r.plan.stops[0].ticksBelow).toBe(0);
    r = evaluate(r.plan, atMc(650_000), BAG, ctx());
    expect(r.actions).toHaveLength(0);
    expect(r.plan.stops[0].status).toBe('waiting');
  });

  it('counts its ticks while another sell is in flight, then fires once it lands', () => {
    let r = evaluate(buildPlan(input({ tps: [{ trigger: { kind: 'x', value: 2 }, sellPct: 50 }] })), atMc(2_000_000), BAG, ctx());
    expect(sell(r).level).toEqual(tp('tp1'));
    let p = markExecuting(r.plan, tp('tp1'), T0);
    r = ticks(p, 600_000, BAG, 3);
    expect(r.actions).toHaveLength(0); // one sell at a time
    expect(r.plan.stops[0].ticksBelow).toBe(3);
    p = applyOutcome(r.plan, tp('tp1'), { status: 'filled', balanceAfter: 50_000 }, T0);
    expect(p.stops[0].targetRemaining).toBeCloseTo(40_000, 6); // 50% sold + its 10%
    r = evaluate(p, atMc(600_000), 50_000, ctx());
    expect(sell(r).level).toEqual(st('st1'));
    expect(sell(r).sellAmount).toBeCloseTo(10_000, 6); // 10% of the original bag, not of what's left
  });

  it('a sleep gap resets the count; it re-confirms with fresh ticks', () => {
    let r = evaluate(buildPlan(input()), atMc(650_000), BAG, ctx());
    r = evaluate(r.plan, atMc(650_000), BAG, ctx({ gap: true, now: T0 + 600_000 }));
    expect(r.actions).toHaveLength(0);
    expect(r.plan.stops[0].ticksBelow).toBe(1);
    r = evaluate(r.plan, atMc(650_000), BAG, ctx({ now: T0 + 603_000 }));
    expect(sell(r).gapFill).toBe(true);
  });

  it('waits for a known balance to size the sell', () => {
    const r = ticks(buildPlan(input()), 650_000, null, 3);
    expect(r.actions).toHaveLength(0);
    expect(r.plan.stops[0].status).toBe('waiting');
    expect(sell(evaluate(r.plan, atMc(650_000), BAG, ctx()))).toBeDefined();
  });

  it('builds stops highest first, each a slice of the original bag', () => {
    const p = buildPlan(input({ stops: [{ trigger: mc(500_000), sellPct: 20 }, { trigger: mc(700_000), sellPct: 10 }] }));
    expect(p.stops.map((s) => [s.id, s.trigger.value, s.targetRemaining])).toEqual([
      ['st1', 700_000, 90_000],
      ['st2', 500_000, 70_000],
    ]);
  });

  it('a stop above entry (locking in profit) works the same way down', () => {
    let r = ticks(buildPlan(input({ stops: [{ trigger: mc(2_000_000), sellPct: 25 }] })), 3_000_000, BAG, 3);
    expect(r.actions).toHaveLength(0);
    r = ticks(r.plan, 1_900_000, BAG, 2);
    expect(sell(r).sellAmount).toBeCloseTo(25_000, 6);
  });
});

describe('partial stops with take-profits', () => {
  const both = () => buildPlan(input({ tps: [{ trigger: { kind: 'x', value: 2 }, sellPct: 50 }], stops: [{ trigger: mc(700_000), sellPct: 20 }] }));

  it('stop first, then the take-profit still sells its own % of the original bag', () => {
    let p = both();
    expect([p.tps[0].targetRemaining, p.stops[0].targetRemaining]).toEqual([50_000, 80_000]);
    const r = ticks(p, 650_000, BAG, 2);
    expect(sell(r).sellAmount).toBeCloseTo(20_000, 6);
    p = fill(r.plan, st('st1'), 80_000);
    expect(p.stops[0].status).toBe('filled');
    expect(p.state).toBe('armed');
    expect(p.tps[0].targetRemaining).toBeCloseTo(30_000, 6); // 20% + 50% of the original gone
    const r2 = evaluate(p, atMc(2_000_000), 80_000, ctx());
    expect(sell(r2).level).toEqual(tp('tp1'));
    expect(sell(r2).sellAmount).toBeCloseTo(50_000, 6);
  });

  it('take-profit first, then the stop sells its own % of the original bag', () => {
    let p = both();
    const r = evaluate(p, atMc(2_000_000), BAG, ctx());
    p = fill(r.plan, tp('tp1'), 50_000);
    expect(p.stops[0].targetRemaining).toBeCloseTo(30_000, 6);
    expect(p.stops[0].status).toBe('waiting'); // a take-profit never marks stops sold
    const r2 = ticks(p, 650_000, 50_000, 2);
    expect(sell(r2).level).toEqual(st('st1'));
    expect(sell(r2).sellAmount).toBeCloseTo(20_000, 6);
    p = fill(r2.plan, st('st1'), 30_000);
    expect(p.state).toBe('done'); // nothing left to watch
  });

  it('stops are checked before take-profits', () => {
    // A stop set above a take-profit (odd, but possible after edits): both due on the same tick.
    const p = buildPlan(input({ tps: [{ trigger: { kind: 'x', value: 1.5 }, sellPct: 50 }], stops: [{ trigger: mc(3_000_000), sellPct: 10 }] }));
    let r = evaluate(p, atMc(1_400_000), BAG, ctx());
    expect(r.actions).toHaveLength(0);
    r = evaluate(r.plan, atMc(2_000_000), BAG, ctx());
    expect(sell(r).level).toEqual(st('st1'));
  });

  it('while a stop may have sold (blocked after a click), take-profits and other stops wait', () => {
    let r = ticks(both(), 650_000, BAG, 2);
    let p = markExecuting(r.plan, st('st1'), T0);
    p = applyOutcome(p, st('st1'), { status: 'unknown' }, T0);
    p = reconcile(p, BAG, T0 + RECONCILE_AFTER_MS + 1, null);
    expect(p.stops[0].status).toBe('blocked');
    expect(p.stops[0].clickedAt).toBe(T0);
    expect(retryableLevels(p)).toEqual([st('st1')]);
    expect(evaluate(p, atMc(2_000_000), BAG, ctx({ now: T0 + 200_000 })).actions).toHaveLength(0);
    // late confirmation: sold after all
    const late = reconcile(p, 80_000, T0 + 300_000, null);
    expect(late.stops[0].status).toBe('filled');
    expect(late.tps[0].targetRemaining).toBeCloseTo(30_000, 6);
    // or the user checks fomo and retries: declarative, so no double sell
    p = retryLevel(p, st('st1'), T0 + 400_000);
    expect(p.stops[0].status).toBe('waiting');
    r = ticks(p, 650_000, 80_000, 2, { now: T0 + 400_000 });
    expect(r.actions).toHaveLength(0);
    expect(r.plan.stops[0].status).toBe('done-elsewhere');
  });
});

describe('partial stops: a fast drop and sells made elsewhere', () => {
  const two = () => buildPlan(input({ stops: [{ trigger: mc(700_000), sellPct: 10 }, { trigger: mc(500_000), sellPct: 20 }], sl: { trigger: { kind: 'x', value: 0.2 } } }));

  it('a gap through two stops sells down to the lower one in one go', () => {
    const r = ticks(two(), 400_000, BAG, 2);
    expect(r.actions).toHaveLength(1);
    expect(sell(r).level).toEqual(st('st2'));
    expect(sell(r).targetRemaining).toBeCloseTo(70_000, 6);
    expect(sell(r).sellAmount).toBeCloseTo(30_000, 6);
    expect(r.plan.stops.map((s) => [s.status, s.mergedInto])).toEqual([
      ['merged', 'st2'],
      ['queued', null],
    ]);
    const p = fill(r.plan, st('st2'), 70_000);
    expect(p.stops.map((s) => s.status)).toEqual(['filled', 'filled']);
  });

  it('withdrawing that sell restores the merged stop (re-confirming from scratch)', () => {
    const r = ticks(two(), 400_000, BAG, 2);
    const back = withdrawQueued(r.plan, st('st2'));
    expect(back.stops.map((s) => [s.status, s.ticksBelow])).toEqual([
      ['waiting', 0],
      ['waiting', 0],
    ]);
    const exec = markExecuting(r.plan, st('st2'), T0);
    const stale = applyOutcome(exec, st('st2'), { status: 'stale' }, T0);
    expect(stale.stops.map((s) => s.status)).toEqual(['waiting', 'waiting']);
  });

  it('already sold that much elsewhere: done-elsewhere, nothing sold', () => {
    const r = ticks(two(), 650_000, 89_800, 2);
    expect(r.actions).toHaveLength(0);
    expect(r.plan.stops[0].status).toBe('done-elsewhere');
    expect(r.plan.stops[1].targetRemaining).toBeCloseTo(70_000, 6);
    expect(r.plan.state).toBe('armed');
  });

  it('a manual partial sell is topped up only to the stop’s target', () => {
    const r = ticks(two(), 650_000, 95_000, 2);
    expect(sell(r).targetRemaining).toBeCloseTo(90_000, 6);
    expect(sell(r).sellAmount).toBeCloseTo(5_000, 6);
  });

  it("the bag-gone check waits while a stop is confirming", () => {
    let r = evaluate(two(), atMc(650_000), 0, ctx());
    expect(r.plan.state).toBe('armed');
    r = evaluate(r.plan, atMc(650_000), 0, ctx());
    expect(r.actions).toHaveLength(0);
    expect(r.plan.stops[0].status).toBe('done-elsewhere'); // nothing to sell
    r = evaluate(r.plan, atMc(800_000), 0, ctx());
    expect(r.plan.state).toBe('done');
  });
});

describe("partial stops and fomo's minimum", () => {
  it("the $HIGGS case: 10% of a $4.98 bag is below fomo's $2 minimum — skipped with a clear note, never sells the rest", () => {
    // $HIGGS at $719K MC, bag worth $4.98; "sell 10% at 700k"
    const price = 719_000 / 1e9;
    const bag = 4.98 / price;
    let p = buildPlan(input({ balance: bag, entry: { priceUSD: price, mc: 719_000, source: 'armed-at' }, sl: { trigger: { kind: 'x', value: 0.5 } } }));
    let r = ticks(p, 700_000, bag, 2);
    expect(r.actions).toHaveLength(0);
    expect(r.plan.stops[0].status).toBe('cancelled');
    expect(r.plan.state).toBe('armed'); // the stop loss keeps working
    expect(r.plan.sl!.status).toBe('waiting');
    const note = r.plan.history.find((h) => h.kind === 'too-small');
    expect(note?.text).toBe("Your stop at $700K mc on $HIGGS would sell $0.48 — below fomo's $2 minimum, so Tippy skipped it.");
    expect(note?.at).toBe(T0);
    // deeper drops never sell it bigger
    r = ticks(r.plan, 400_000, bag, 3);
    expect(r.actions).toHaveLength(0);
    // on its own, nothing is left to watch
    p = buildPlan(input({ balance: bag, entry: { priceUSD: price, mc: 719_000, source: 'armed-at' } }));
    r = ticks(p, 700_000, bag, 2);
    expect(r.plan.state).toBe('done');
    expect(r.plan.history.some((h) => h.kind === 'too-small')).toBe(true);
  });

  it('a slice below the minimum rolls into the next stop down', () => {
    const p = buildPlan(input({ stops: [{ trigger: mc(700_000), sellPct: 5 }, { trigger: mc(500_000), sellPct: 20 }] }));
    let r = ticks(p, 650_000, BAG, 2, { minSellUsd: 5 }); // 5,000 tokens ≈ $3.25 < $5
    expect(r.actions).toHaveLength(0);
    expect(r.plan.stops.map((s) => [s.status, s.mergedInto])).toEqual([
      ['merged', null],
      ['waiting', null],
    ]);
    r = ticks(r.plan, 500_000, BAG, 2, { minSellUsd: 5 });
    expect(sell(r).level).toEqual(st('st2'));
    expect(sell(r).sellAmount).toBeCloseTo(25_000, 6); // both slices, as planned
    const done = fill(r.plan, st('st2'), 75_000);
    expect(done.stops.map((s) => s.status)).toEqual(['filled', 'filled']);
  });

  it('several stops crossed at once that are still too small together are all skipped', () => {
    const p = buildPlan(input({ stops: [{ trigger: mc(700_000), sellPct: 1 }, { trigger: mc(600_000), sellPct: 1 }], sl: { trigger: { kind: 'x', value: 0.1 } } }));
    const r = ticks(p, 500_000, BAG, 2, { minSellUsd: 5 }); // 2,000 tokens = $1
    expect(r.actions).toHaveLength(0);
    expect(r.plan.stops.map((s) => s.status)).toEqual(['cancelled', 'cancelled']);
    expect(r.plan.state).toBe('armed');
  });

  it('crumb rule: if what would remain is unsellable, it sells everything', () => {
    // $10 bag; 85% at $900K leaves 1,500 tokens ≈ $1.35 < the $2 floor
    const p = buildPlan(input({ balance: 10_000, stops: [{ trigger: mc(900_000), sellPct: 85 }] }));
    const r = ticks(p, 900_000, 10_000, 2);
    expect(sell(r).targetRemaining).toBeCloseTo(0, 6);
    expect(sell(r).sellAmount).toBeCloseTo(10_000, 6);
    expect(sell(r).sellPctOfCurrent).toBe(100);
    expect(r.plan.stops[0].targetRemaining).toBeCloseTo(1_500, 6); // its own target is never rewritten
    expect(fill(r.plan, st('st1'), 0).state).toBe('done');
  });
});

describe('the stop loss and trailing stop still sell the rest', () => {
  it('the stop loss beats a partial stop and cancels it', () => {
    const p = buildPlan(input({ sl: { trigger: { kind: 'x', value: 0.5 } } }));
    const r = ticks(p, 400_000, BAG, 2);
    expect(sell(r).level).toEqual({ kind: 'sl' });
    expect(sell(r).targetRemaining).toBeCloseTo(0, 6);
    const done = fill(r.plan, { kind: 'sl' }, 0);
    expect(done.state).toBe('done');
    expect(done.stops[0].status).toBe('cancelled');
  });

  it('the stop loss still fires while a partial stop is in flight', () => {
    const p = buildPlan(input({ sl: { trigger: { kind: 'x', value: 0.5 } } }));
    let r = ticks(p, 650_000, BAG, 2);
    expect(sell(r).level).toEqual(st('st1'));
    const exec = markExecuting(r.plan, st('st1'), T0);
    r = ticks(exec, 400_000, BAG, 2);
    expect(sell(r).level).toEqual({ kind: 'sl' });
    const done = fill(applyOutcome(r.plan, st('st1'), { status: 'filled', balanceAfter: 90_000 }, T0), { kind: 'sl' }, 0);
    expect(done.state).toBe('done');
  });
});

describe('the queue order: stop loss, then partial stops, then take-profits', () => {
  it('a stop loss lined up after a partial stop (another coin) still runs first; take-profits wait behind both', () => {
    const stop = sell(ticks(buildPlan(input()), 650_000, BAG, 2));
    const sl = sell(ticks(buildPlan(input({ id: 'p2', stops: [], sl: { trigger: { kind: 'x', value: 0.5 } } })), 400_000, BAG, 2));
    const takeProfit = sell(evaluate(buildPlan(input({ id: 'p3', stops: [], tps: [{ trigger: { kind: 'x', value: 2 }, sellPct: 50 }] })), atMc(2_000_000), BAG, ctx()));
    expect([stop.priority, sl.priority, takeProfit.priority]).toEqual([0.5, 0, 1]);
    expect(sortActions([takeProfit, stop, sl]).map((a) => (a as SellAction).planId)).toEqual(['p2', 'p1', 'p3']);
  });
});

describe('partial stops in a dry run', () => {
  const dryFill = (plan: Plan, ref: LevelRef) => applyOutcome(markExecuting(plan, ref, T0), ref, { status: 'filled', balanceAfter: null, dryRun: true }, T0);
  const withTp = () => buildPlan(input({ tps: [{ trigger: { kind: 'x', value: 2 }, sellPct: 50 }], stops: [{ trigger: mc(700_000), sellPct: 10 }, { trigger: mc(500_000), sellPct: 20 }], sl: { trigger: { kind: 'x', value: 0.2 } } }));

  it('a dry-run fill is marked (with the stops folded into it); a real fill is not', () => {
    const r = ticks(withTp(), 400_000, BAG, 2); // through both stops: st1 merged into st2
    const p = dryFill(r.plan, st('st2'));
    expect(p.stops.map((s) => [s.status, s.dryRun])).toEqual([
      ['filled', true],
      ['filled', true],
    ]);
    expect(p.tps[0].targetRemaining).toBeCloseTo(20_000, 6); // the dry run "sold" 30%
    expect(fill(r.plan, st('st2'), 70_000).stops.map((s) => s.dryRun)).toEqual([undefined, undefined]);
  });

  it('dry run off: the levels it pretended to sell come back, sized on the real bag', () => {
    let p = ticks(withTp(), 650_000, BAG, 2).plan;
    p = dryFill(p, st('st1'));
    p = dryFill(evaluate(p, atMc(2_000_000), BAG, ctx()).plan, tp('tp1'));
    expect(p.stops[0].status).toBe('filled');
    expect(p.tps[0].status).toBe('filled');
    const live = undoDryRunFills(p, T0 + 1);
    expect(live.tps[0]).toMatchObject({ status: 'waiting', attempts: 0, targetRemaining: 50_000 });
    expect(live.stops.map((s) => [s.status, s.ticksBelow, s.targetRemaining])).toEqual([
      ['waiting', 0, 90_000],
      ['waiting', 0, 70_000],
    ]);
    expect(live.stops[0].dryRun).toBeUndefined();
    expect(live.tps[0].dryRun).toBeUndefined();
    expect(live.history.at(-1)!.text).toBe('Dry run is off — the levels Tippy only pretended to sell on $HIGGS are back on, sized on your real bag.');
    // From here a real drop sells exactly the stop's 10%.
    expect(sell(ticks(live, 650_000, BAG, 2)).sellAmount).toBeCloseTo(10_000, 6);
  });

  it('real fills stay sold; plans without dry-run fills (and finished plans) are left exactly as they are', () => {
    const r = ticks(withTp(), 650_000, BAG, 2);
    const real = fill(r.plan, st('st1'), 90_000);
    expect(undoDryRunFills(real, T0 + 1)).toBe(real);
    const mixed = dryFill(ticks(real, 450_000, 90_000, 2).plan, st('st2'));
    const live = undoDryRunFills(mixed, T0 + 1);
    expect(live.stops.map((s) => s.status)).toEqual(['filled', 'waiting']);
    expect(live.stops[1].targetRemaining).toBeCloseTo(70_000, 6);
    expect(live.tps[0].targetRemaining).toBeCloseTo(40_000, 6); // the real 10% still counts
    const finished = cancelPlan(dryFill(r.plan, st('st1')), T0);
    expect(undoDryRunFills(finished, T0 + 1)).toBe(finished);
  });
});

describe('partial stops: outcomes', () => {
  it('a failed sell re-arms with a cool-down and fires again once the drop still holds', () => {
    let r = ticks(buildPlan(input()), 650_000, BAG, 2);
    let p = markExecuting(r.plan, st('st1'), T0);
    p = applyOutcome(p, st('st1'), { status: 'failed', detail: 'quote timed out', retryable: true }, T0);
    expect(p.stops[0].status).toBe('waiting');
    expect(p.stops[0].ticksBelow).toBe(0);
    r = ticks(p, 650_000, BAG, 2, { now: T0 + 5_000 });
    expect(r.actions).toHaveLength(0); // cooling down (but counting)
    expect(r.plan.stops[0].ticksBelow).toBe(2);
    r = evaluate(r.plan, atMc(650_000), BAG, ctx({ now: T0 + 25_000 }));
    expect(sell(r).level).toEqual(st('st1'));
  });

  it('after 3 failed attempts it is blocked until Retry (the plan stays armed)', () => {
    let p = ticks(buildPlan(input({ sl: { trigger: { kind: 'x', value: 0.2 } } })), 650_000, BAG, 2).plan;
    for (let i = 0; i < 3; i++) {
      p = markExecuting(p, st('st1'), T0);
      p = applyOutcome(p, st('st1'), { status: 'failed', detail: 'impact too high', retryable: true }, T0);
    }
    expect(p.stops[0].status).toBe('blocked');
    expect(p.state).toBe('armed');
    expect(p.attention).toContain('stop $700K mc (10%)');
  });

  it('a plan whose only order was a partial stop finishes when it sells — without cheering', () => {
    const r = ticks(buildPlan(input()), 650_000, BAG, 2);
    const done = fill(r.plan, st('st1'), 90_000);
    expect(done.state).toBe('done');
    expect(done.history.at(-1)!.text).toBe("All of $HIGGS's levels are done.");
  });

  it('labels and summaries', () => {
    const p = buildPlan(input({ tps: [{ trigger: { kind: 'x', value: 2 }, sellPct: 50 }], sl: { trigger: { kind: 'x', value: 0.5 } } }));
    expect(summarizePlan(p)).toBe('2x 50% · stop $700K mc 10% · SL −50%');
    expect(levelLabel(p, st('st1'))).toBe('stop $700K mc (10%)');
    expect(allLevels(p).map((l) => l.ref)).toEqual([tp('tp1'), st('st1'), { kind: 'sl' }]);
  });

  it('a top-up counts stops that sold', () => {
    const r = ticks(buildPlan(input({ tps: [{ trigger: { kind: 'x', value: 2 }, sellPct: 50 }] })), 650_000, BAG, 2);
    const p = rescale(fill(r.plan, st('st1'), 90_000), 180_000, T0);
    expect(p.origBalance).toBe(200_000); // 10% sold: 180k is 90% of the bigger bag
    expect(p.tps[0].targetRemaining).toBeCloseTo(80_000, 6);
  });
});

describe('editing partial stops', () => {
  const plan = () => buildPlan(input({ tps: [{ trigger: { kind: 'x', value: 2 }, sellPct: 50 }], sl: { trigger: { kind: 'x', value: 0.5 } } }));

  it('planEditWith carries the stops and can move one', () => {
    const p = plan();
    expect(planEditWith(p, {}).stops).toEqual([{ id: 'st1', trigger: mc(700_000), sellPct: 10 }]);
    const edit = planEditWith(p, { stop: { id: 'st1', trigger: mc(650_000) } });
    const r = editPlan(p, edit, T0 + 1);
    expect(r.ok && r.plan.stops.map((s) => [s.id, s.trigger.value, s.targetRemaining])).toEqual([['st1', 650_000, 90_000]]);
  });

  it('an edit without a stops field keeps the stops exactly as they are', () => {
    const p = ticks(plan(), 690_000, BAG, 1).plan; // a tick of the drop already counted
    const r = editPlan(p, { tps: [{ id: 'tp1', trigger: { kind: 'x', value: 3 }, sellPct: 50 }], sl: { trigger: { kind: 'x', value: 0.5 } }, trailing: null }, T0 + 1);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.plan.stops).toEqual(p.stops);
  });

  it('an unchanged stop keeps counting when another line moves', () => {
    const p = ticks(plan(), 690_000, BAG, 1).plan;
    const r = editPlan(p, planEditWith(p, { tp: { id: 'tp1', trigger: { kind: 'x', value: 3 } } }), T0 + 1);
    expect(r.ok && r.plan.stops[0].ticksBelow).toBe(1);
  });

  it('adds stops with fresh ids, highest first, each a slice of the original bag', () => {
    const p = plan();
    const r = editPlan(p, { ...planEditWith(p, {}), stops: [{ id: 'st1', trigger: mc(700_000), sellPct: 10 }, { id: null, trigger: mc(800_000), sellPct: 15 }] }, T0 + 1);
    expect(r.ok && r.plan.stops.map((s) => [s.id, s.trigger.value, s.targetRemaining])).toEqual([
      ['st2', 800_000, 85_000],
      ['st1', 700_000, 75_000],
    ]);
    expect(r.ok && r.plan.history.at(-1)!.text).toContain('stop $800K mc 15%');
  });

  it("won't add up past 100% counting stops that already sold", () => {
    const r0 = ticks(plan(), 650_000, BAG, 2);
    const p = fill(r0.plan, st('st1'), 90_000);
    const r = editPlan(p, { ...planEditWith(p, {}), stops: [{ id: null, trigger: mc(500_000), sellPct: 95 }] }, T0 + 1);
    expect(r).toMatchObject({ ok: false });
    expect(!r.ok && r.error).toContain('105%');
    expect(editPlan(p, { ...planEditWith(p, {}), stops: [{ id: null, trigger: mc(500_000), sellPct: 90 }] }, T0 + 1).ok).toBe(true);
  });

  it('refuses an edit based on a stop that has since sold', () => {
    const r0 = ticks(plan(), 650_000, BAG, 2);
    const p = fill(r0.plan, st('st1'), 90_000);
    expect(isEditableStop(p.stops[0])).toBe(false);
    const r = editPlan(p, { ...planEditWith(p, {}), stops: [{ id: 'st1', trigger: mc(600_000), sellPct: 10 }] }, T0 + 1);
    expect(r).toMatchObject({ ok: false, stale: true });
  });

  it('refuses while a stop is mid-sell', () => {
    const r0 = ticks(plan(), 650_000, BAG, 2);
    expect(hasInFlight(r0.plan)).toBe(true);
    expect(editPlan(r0.plan, planEditWith(r0.plan, {}), T0 + 1)).toMatchObject({ ok: false, stale: true });
  });

  it('a plan with only partial stops is still a plan; removing everything is not', () => {
    const p = plan();
    expect(editPlan(p, { tps: [], stops: [{ id: 'st1', trigger: mc(700_000), sellPct: 10 }], sl: null, trailing: null }, T0 + 1).ok).toBe(true);
    const r = editPlan(p, { tps: [], stops: [], sl: null, trailing: null }, T0 + 1);
    expect(!r.ok && r.error).toContain('Add at least one');
  });

  it('rejects bad stop amounts', () => {
    const p = plan();
    expect(editPlan(p, { ...planEditWith(p, {}), stops: [{ id: null, trigger: mc(600_000), sellPct: 0 }] }, T0 + 1).ok).toBe(false);
    expect(editPlan(p, { ...planEditWith(p, {}), stops: [{ id: null, trigger: mc(0), sellPct: 10 }] }, T0 + 1).ok).toBe(false);
  });
});

describe('plans saved before partial stops existed', () => {
  const legacy = (): Plan => {
    const p: Partial<Plan> = buildPlan(input({ stops: undefined, tps: [{ trigger: { kind: 'x', value: 2 }, sellPct: 50 }], sl: { trigger: { kind: 'x', value: 0.7 } } }));
    delete p.stops;
    return p as Plan;
  };

  it('work everywhere, as if they had no stops', () => {
    const p = legacy();
    expect('stops' in p).toBe(false);
    expect(summarizePlan(p)).toBe('2x 50% · SL −30%');
    expect(allLevels(p)).toHaveLength(2);
    expect(hasInFlight(p)).toBe(false);
    expect(retryableLevels(p)).toEqual([]);
    expect(planEditWith(p, {}).stops).toEqual([]);
    expect(normalizePlan(p).stops).toEqual([]);
    const r = evaluate(p, atMc(2_000_000), BAG, ctx());
    expect(r.plan.stops).toEqual([]);
    expect(sell(r).sellAmount).toBeCloseTo(50_000, 6);
    expect(applyOutcome(markExecuting(p, tp('tp1'), T0), tp('tp1'), { status: 'filled', balanceAfter: 50_000 }, T0).tps[0].status).toBe('filled');
    expect(reconcile(p, BAG, T0, 0.002).stops).toEqual([]);
    expect(reconcile(p, BAG, T0, null)).toBe(p); // nothing to do: untouched
    const e = editPlan(p, { tps: [{ id: 'tp1', trigger: { kind: 'x', value: 3 }, sellPct: 50 }], sl: null, trailing: null }, T0);
    expect(e.ok && e.plan.stops).toEqual([]);
    expect(rescale(p, 200_000, T0).tps[0].targetRemaining).toBeCloseTo(100_000, 6);
    const sl = ticks(p, 600_000, BAG, 2);
    expect(sell(sl).level).toEqual({ kind: 'sl' });
  });

  it('pause, resume, cancel, withdraw, retry and a held stop loss never trip over the missing list', () => {
    const p = legacy();
    expect(getLevel(p, st('st1'))).toBeNull();
    expect(levelLabel(p, st('st1'))).toBe('stop');
    const paused = pausePlan(p, T0);
    expect(paused.state).toBe('paused');
    const resumed = resumePlan(paused, T0);
    expect(resumed.state).toBe('armed');
    expect(resumed.stops).toEqual([]);
    expect(cancelPlan(p, T0).state).toBe('cancelled');
    expect(withdrawQueued(p).stops).toEqual([]);
    expect(retryLevel(p, st('st1'), T0)).toBe(p); // no such stop: untouched
    const held = legacy();
    held.sl!.status = 'held';
    const sold = resolveHeld(held, { kind: 'sl' }, true, T0);
    expect(sold.sl!.status).toBe('queued');
    expect(sold.stops).toEqual([]);
  });
});

describe('validatePlanInput with partial stops', () => {
  const base = { ...input(), entry: { priceUSD: ENTRY, mc: 1_000_000, source: 'manual' as const } };

  it('takes a stop at any level (above entry too) and counts it as a plan', () => {
    expect(validatePlanInput(base)).toEqual([]);
    expect(validatePlanInput({ ...base, stops: [{ trigger: mc(2_000_000), sellPct: 25 }] })).toEqual([]);
  });

  it('catches bad amounts and totals over 100%, separately from take-profits', () => {
    const msgs = (stops: PlanInput['stops']) => validatePlanInput({ ...base, stops }).map((i) => i.message).join(' | ');
    expect(msgs([{ trigger: mc(700_000), sellPct: 0 }])).toContain('between 1% and 100%');
    expect(msgs([{ trigger: mc(0), sellPct: 10 }])).toContain('above zero');
    expect(msgs([{ trigger: mc(700_000), sellPct: 60 }, { trigger: mc(500_000), sellPct: 50 }])).toContain('stops add up to 110%');
    expect(
      validatePlanInput({ ...base, tps: [{ trigger: { kind: 'x', value: 2 }, sellPct: 100 }], stops: [{ trigger: mc(700_000), sellPct: 100 }] }),
    ).toEqual([]);
    expect(msgs([{ trigger: mc(700_000), sellPct: 10 }])).toBe('');
    const noMc = validatePlanInput({ ...base, entry: { priceUSD: ENTRY, mc: null, source: 'manual' }, stops: [{ trigger: mc(700_000), sellPct: 10 }] });
    expect(noMc.map((i) => i.message).join(' | ')).toContain("can't see this coin's market cap");
  });
});
