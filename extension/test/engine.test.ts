import { describe, expect, it } from 'vitest';
import {
  applyOutcome,
  buildPlan,
  cancelPlan,
  evaluate,
  markExecuting,
  pausePlan,
  reconcile,
  rescale,
  resolveHeld,
  resumePlan,
  retryLevel,
  retryableLevels,
  RECONCILE_AFTER_MS,
  withdrawQueued,
  sortActions,
  summarizePlan,
} from '../src/engine/orders';
import { describeTrigger, formatUsd, isHit, validatePlanInput } from '../src/engine/triggers';
import type { EvalContext, Plan, PlanInput, SellAction } from '../src/engine/types';

const T0 = 1_700_000_000_000;
const ENTRY = 0.001; // $ per token
const BAG = 100_000; // tokens → $100 at entry

const ctx = (over: Partial<EvalContext> = {}): EvalContext => ({
  now: T0,
  gap: false,
  gapPolicy: 'sell',
  minSellUsd: 2,
  dustUsd: 1,
  ...over,
});

const q = (price: number, at = T0) => ({ priceUSD: price, mc: price * 1e9, at });

function input(over: Partial<PlanInput> = {}): PlanInput {
  return {
    id: 'p1',
    key: 'So1anaMint111:1399811149',
    networkId: 1399811149,
    address: 'So1anaMint111',
    symbol: 'WIF',
    name: 'dogwifhat',
    entry: { priceUSD: ENTRY, mc: ENTRY * 1e9, source: 'armed-at' },
    balance: BAG,
    tps: [
      { trigger: { kind: 'x', value: 2 }, sellPct: 50 },
      { trigger: { kind: 'x', value: 5 }, sellPct: 25 },
    ],
    sl: { trigger: { kind: 'x', value: 0.7 } },
    trailing: null,
    origin: 'manual',
    now: T0,
    ...over,
  };
}

const sell = (r: { actions: unknown[] }) => r.actions[0] as SellAction;

describe('buildPlan', () => {
  it('turns percentages into declarative remaining-balance targets', () => {
    const p = buildPlan(input());
    expect(p.tps.map((t) => t.targetRemaining)).toEqual([50_000, 25_000]);
    expect(p.state).toBe('armed');
    expect(summarizePlan(p)).toBe('2x 50% · 5x 25% · SL −30%');
  });

  it('a ladder that adds up to 100% ends at zero', () => {
    const p = buildPlan(input({ tps: [{ trigger: { kind: 'x', value: 2 }, sellPct: 60 }, { trigger: { kind: 'x', value: 3 }, sellPct: 40 }] }));
    expect(p.tps[1].targetRemaining).toBe(0);
  });
});

describe('take-profits', () => {
  it('does nothing below the first level', () => {
    const r = evaluate(buildPlan(input()), q(ENTRY * 1.9), BAG, ctx());
    expect(r.actions).toHaveLength(0);
  });

  it('sells half at 2x', () => {
    const r = evaluate(buildPlan(input()), q(ENTRY * 2), BAG, ctx());
    const a = sell(r);
    expect(a.level).toEqual({ kind: 'tp', id: 'tp1' });
    expect(a.sellAmount).toBe(50_000);
    expect(a.sellPctOfCurrent).toBe(50);
    expect(r.plan.tps[0].status).toBe('queued');
  });

  it('a jump past two levels sells down to the deepest target once', () => {
    const r = evaluate(buildPlan(input()), q(ENTRY * 6), BAG, ctx());
    expect(r.actions).toHaveLength(1);
    expect(sell(r).targetRemaining).toBe(25_000);
    expect(sell(r).sellAmount).toBe(75_000);
    expect(r.plan.tps[0].status).toBe('merged');
  });

  it('skips a level already sold on the phone (declarative)', () => {
    const r = evaluate(buildPlan(input()), q(ENTRY * 2), 49_000, ctx());
    expect(r.actions).toHaveLength(0);
    expect(r.plan.tps[0].status).toBe('done-elsewhere');
  });

  it('closes the plan when the whole bag was sold elsewhere', () => {
    const r = evaluate(buildPlan(input()), q(ENTRY * 1.2), 0, ctx());
    expect(r.plan.state).toBe('done');
    expect(r.plan.sl!.status).toBe('cancelled');
  });

  it("sells everything instead of leaving a crumb below fomo's minimum", () => {
    // $4 bag at entry; 2x → $8; 75% sold leaves $2 → under the $2.5 floor → sell all
    const p = buildPlan(input({ balance: 4000, tps: [{ trigger: { kind: 'x', value: 2 }, sellPct: 75 }] }));
    const r = evaluate(p, q(ENTRY * 2), 4000, ctx({ minSellUsd: 2.5 }));
    expect(sell(r).targetRemaining).toBe(0);
    expect(sell(r).sellPctOfCurrent).toBe(100);
  });

  it('rolls a level that is too small into the next one', () => {
    // $10 bag; 10% at 2x = $2 < $5 minimum → merged into 5x
    const p = buildPlan(input({ balance: 10_000, tps: [{ trigger: { kind: 'x', value: 2 }, sellPct: 10 }, { trigger: { kind: 'x', value: 5 }, sellPct: 50 }] }));
    const r = evaluate(p, q(ENTRY * 2), 10_000, ctx({ minSellUsd: 5 }));
    expect(r.actions).toHaveLength(0);
    expect(r.plan.tps[0].status).toBe('merged');
    const r2 = evaluate(r.plan, q(ENTRY * 5), 10_000, ctx());
    // 5x level's target is 40% remaining (10% + 50% sold cumulatively)
    expect(sell(r2).sellAmount).toBe(6_000);
  });

  it('flags a bag too small to sell at all', () => {
    const p = buildPlan(input({ balance: 500, tps: [{ trigger: { kind: 'x', value: 2 }, sellPct: 50 }] }));
    const r = evaluate(p, q(ENTRY * 2), 500, ctx({ minSellUsd: 5 }));
    expect(r.actions).toHaveLength(0);
    expect(r.plan.state).toBe('armed'); // still guarded (the stop keeps working)
    expect(r.plan.tps[0].status).toBe('blocked');
    expect(r.plan.attention).toContain('minimum');
  });

  it('waits for a balance before sizing a take-profit', () => {
    const r = evaluate(buildPlan(input()), q(ENTRY * 2), null, ctx());
    expect(r.actions).toHaveLength(0);
    expect(r.plan.tps[0].status).toBe('waiting');
  });

  it('supports market-cap triggers', () => {
    const p = buildPlan(input({ tps: [{ trigger: { kind: 'mc', value: 3_000_000 }, sellPct: 50 }], sl: null }));
    expect(evaluate(p, { priceUSD: ENTRY * 2.9, mc: 2_900_000, at: T0 }, BAG, ctx()).actions).toHaveLength(0);
    expect(evaluate(p, { priceUSD: ENTRY * 3, mc: 3_000_000, at: T0 }, BAG, ctx()).actions).toHaveLength(1);
  });
});

describe('stop loss', () => {
  it('ignores a single wick', () => {
    let p = buildPlan(input());
    let r = evaluate(p, q(ENTRY * 0.6), BAG, ctx());
    expect(r.actions).toHaveLength(0);
    r = evaluate(r.plan, q(ENTRY * 0.9), BAG, ctx());
    expect(r.actions).toHaveLength(0);
    expect(r.plan.sl!.ticksBelow).toBe(0);
  });

  it('fires after two ticks below and sells the rest', () => {
    let r = evaluate(buildPlan(input()), q(ENTRY * 0.6), BAG, ctx());
    r = evaluate(r.plan, q(ENTRY * 0.55), BAG, ctx());
    const a = sell(r);
    expect(a.level).toEqual({ kind: 'sl' });
    expect(a.targetRemaining).toBe(0);
    expect(a.sellPctOfCurrent).toBe(100);
    expect(a.priority).toBe(0);
  });

  it('still fires while a take-profit is stuck in flight', () => {
    let r = evaluate(buildPlan(input()), q(ENTRY * 2), BAG, ctx());
    let p = markExecuting(r.plan, { kind: 'tp', id: 'tp1' }, T0);
    p = applyOutcome(p, { kind: 'tp', id: 'tp1' }, { status: 'unknown' }, T0);
    r = evaluate(p, q(ENTRY * 0.5), BAG, ctx());
    r = evaluate(r.plan, q(ENTRY * 0.5), BAG, ctx());
    expect(sell(r).level).toEqual({ kind: 'sl' });
  });

  it('OCO: a filled stop cancels the take-profits', () => {
    let r = evaluate(buildPlan(input()), q(ENTRY * 0.6), BAG, ctx());
    r = evaluate(r.plan, q(ENTRY * 0.6), BAG, ctx());
    let p = markExecuting(r.plan, { kind: 'sl' }, T0);
    p = applyOutcome(p, { kind: 'sl' }, { status: 'filled', balanceAfter: 0 }, T0);
    expect(p.state).toBe('done');
    expect(p.tps.every((t) => t.status === 'cancelled')).toBe(true);
    expect(evaluate(p, q(ENTRY * 10), BAG, ctx()).actions).toHaveLength(0);
  });

  it('after a sleep gap it re-confirms with fresh ticks and tags the fill', () => {
    let r = evaluate(buildPlan(input()), q(ENTRY * 0.6), BAG, ctx());
    r = evaluate(r.plan, q(ENTRY * 0.5), BAG, ctx({ gap: true, now: T0 + 600_000 }));
    expect(r.actions).toHaveLength(0); // counter reset by the gap
    r = evaluate(r.plan, q(ENTRY * 0.5), BAG, ctx({ now: T0 + 603_000 }));
    expect(sell(r).gapFill).toBe(true);
  });

  it("asks first after a gap when the user chose 'ask me'", () => {
    let r = evaluate(buildPlan(input()), q(ENTRY * 0.5), BAG, ctx({ gap: true, gapPolicy: 'ask' }));
    r = evaluate(r.plan, q(ENTRY * 0.5), BAG, ctx({ gapPolicy: 'ask', now: T0 + 3000 }));
    expect(r.actions[0].type).toBe('ask');
    expect(r.plan.sl!.status).toBe('held');
    const yes = resolveHeld(r.plan, { kind: 'sl' }, true, T0 + 5000);
    expect(yes.sl!.status).toBe('queued');
    const no = resolveHeld(r.plan, { kind: 'sl' }, false, T0 + 5000);
    expect(no.sl!.status).toBe('waiting');
  });
});

describe('trailing stop', () => {
  const trailInput = () => input({ tps: [], sl: null, trailing: { trailPct: 25, activateX: 1.5 } });

  it('only starts after the activation multiple and follows the peak', () => {
    let r = evaluate(buildPlan(trailInput()), q(ENTRY * 1.4), BAG, ctx());
    expect(r.plan.trailing!.active).toBe(false);
    r = evaluate(r.plan, q(ENTRY * 1.6), BAG, ctx());
    expect(r.plan.trailing!.active).toBe(true);
    r = evaluate(r.plan, q(ENTRY * 4), BAG, ctx());
    expect(r.plan.trailing!.peakPrice).toBeCloseTo(ENTRY * 4);
    r = evaluate(r.plan, q(ENTRY * 3.1), BAG, ctx()); // −22.5% from peak
    expect(r.actions).toHaveLength(0);
    r = evaluate(r.plan, q(ENTRY * 2.9), BAG, ctx()); // −27.5%
    r = evaluate(r.plan, q(ENTRY * 2.9), BAG, ctx());
    expect(sell(r).level).toEqual({ kind: 'trail' });
  });

  it('never invents a peak during a gap', () => {
    let r = evaluate(buildPlan(trailInput()), q(ENTRY * 2), BAG, ctx());
    r = evaluate(r.plan, q(ENTRY * 1.7), BAG, ctx({ gap: true }));
    expect(r.plan.trailing!.peakPrice).toBeCloseTo(ENTRY * 2);
  });
});

describe('executor outcomes and reconcile', () => {
  const tp1 = { kind: 'tp', id: 'tp1' } as const;
  const queuedAt2x = () => evaluate(buildPlan(input()), q(ENTRY * 2), BAG, ctx()).plan;

  it('a filled take-profit keeps the rest of the plan armed', () => {
    let p = markExecuting(queuedAt2x(), tp1, T0);
    p = applyOutcome(p, tp1, { status: 'filled', balanceAfter: 50_000 }, T0);
    expect(p.tps[0].status).toBe('filled');
    expect(p.state).toBe('armed');
  });

  it('reconcile confirms an unknown fill from the balance', () => {
    let p = markExecuting(queuedAt2x(), tp1, T0);
    p = applyOutcome(p, tp1, { status: 'unknown' }, T0);
    p = reconcile(p, 50_100, T0 + 10_000, null);
    expect(p.tps[0].status).toBe('filled');
  });

  it('reconcile never re-clicks a take-profit that may have sold — it blocks it until Retry', () => {
    let p = markExecuting(queuedAt2x(), tp1, T0);
    p = applyOutcome(p, tp1, { status: 'unknown' }, T0 + 25_000); // clicked ~25s after dequeue
    // window runs from the click, not from dequeue
    expect(reconcile(p, BAG, T0 + RECONCILE_AFTER_MS + 1, null).tps[0].status).toBe('unknown');
    p = reconcile(p, BAG, T0 + 25_000 + RECONCILE_AFTER_MS + 1, null);
    expect(p.tps[0].status).toBe('blocked');
    expect(p.state).toBe('armed');
    expect(p.attention).toContain('Retry');
    expect(evaluate(p, q(ENTRY * 3), BAG, ctx()).actions).toHaveLength(0);
    // Resume is NOT a retry
    expect(resumePlan(pausePlan(p, T0), T0).tps[0].status).toBe('blocked');
    // Retry is
    p = retryLevel(p, tp1, T0 + 400_000);
    expect(p.tps[0].status).toBe('waiting');
    expect(p.attention).toBeNull();
    expect(evaluate(p, q(ENTRY * 2), BAG, ctx({ now: T0 + 400_000 })).actions).toHaveLength(1);
  });

  it('a blocked take-profit never switches off the stop loss', () => {
    let p = markExecuting(queuedAt2x(), tp1, T0);
    p = applyOutcome(p, tp1, { status: 'unknown' }, T0);
    p = reconcile(p, BAG, T0 + RECONCILE_AFTER_MS + 1, null);
    expect(p.tps[0].status).toBe('blocked');
    let r = evaluate(p, q(ENTRY * 0.5), BAG, ctx({ now: T0 + 200_000 }));
    r = evaluate(r.plan, q(ENTRY * 0.5), BAG, ctx({ now: T0 + 203_000 }));
    expect(sell(r).level).toEqual({ kind: 'sl' });
  });

  it('a finished or cancelled plan is never brought back by a late result', () => {
    let p = markExecuting(queuedAt2x(), tp1, T0);
    p = cancelPlan(p, T0 + 1);
    for (const o of [{ status: 'unknown' as const }, { status: 'failed' as const, detail: 'x', retryable: false }, { status: 'aborted' as const, reason: 'x' }]) {
      const after = applyOutcome(p, tp1, o, T0 + 2);
      expect(after.state).toBe('cancelled');
      expect(after.attention).toBeNull();
      expect(resumePlan(after, T0 + 3).state).toBe('cancelled');
      expect(reconcile(after, BAG, T0 + RECONCILE_AFTER_MS * 2, null).state).toBe('cancelled');
    }
  });

  it('withdrawing a sell restores the take-profits that were merged into it', () => {
    const jumped = evaluate(buildPlan(input()), q(ENTRY * 6), BAG, ctx()).plan; // 2x merged into 5x
    expect(jumped.tps[0].status).toBe('merged');
    const back = withdrawQueued(jumped);
    expect(back.tps.map((t) => t.status)).toEqual(['waiting', 'waiting']);
    const exec = markExecuting(jumped, { kind: 'tp', id: 'tp2' }, T0);
    const stale = applyOutcome(exec, { kind: 'tp', id: 'tp2' }, { status: 'stale' }, T0);
    expect(stale.tps.map((t) => t.status)).toEqual(['waiting', 'waiting']);
  });

  it('a failing stop loss keeps retrying with backoff (and says so) instead of giving up', () => {
    let r = evaluate(buildPlan(input()), q(ENTRY * 0.5), BAG, ctx());
    r = evaluate(r.plan, q(ENTRY * 0.5), BAG, ctx());
    let p = r.plan;
    for (let i = 0; i < 5; i++) {
      p = markExecuting(p, { kind: 'sl' }, T0);
      p = applyOutcome(p, { kind: 'sl' }, { status: 'failed', detail: 'panel missing', retryable: false }, T0);
      expect(p.sl!.status).toBe('waiting');
    }
    expect(p.state).toBe('armed');
    expect(p.attention).toContain('keeps failing');
    expect(p.sl!.retryAfter! - T0).toBeLessThanOrEqual(5 * 60_000);
  });

  it('reconcile re-arms an unconfirmed "sell the rest" exit (re-sized at execution, cannot oversell)', () => {
    let r = evaluate(buildPlan(input()), q(ENTRY * 0.6), BAG, ctx());
    r = evaluate(r.plan, q(ENTRY * 0.6), BAG, ctx());
    let p = markExecuting(r.plan, { kind: 'sl' }, T0);
    p = applyOutcome(p, { kind: 'sl' }, { status: 'unknown' }, T0);
    p = reconcile(p, BAG, T0 + RECONCILE_AFTER_MS + 1, null);
    expect(p.sl!.status).toBe('waiting');
    expect(p.state).toBe('armed');
  });

  it('reconcile leaves alone the level the queue is executing right now', () => {
    let p = markExecuting(queuedAt2x(), tp1, T0);
    p = reconcile(p, 50_000, T0 + 1_000, null, 1, tp1);
    expect(p.tps[0].status).toBe('executing');
  });

  it('aborted sells (paused, logged out…) go back to watching without using an attempt', () => {
    let p = markExecuting(queuedAt2x(), tp1, T0);
    p = applyOutcome(p, tp1, { status: 'aborted', reason: 'Tippy is paused.' }, T0);
    expect(p.tps[0].status).toBe('waiting');
    expect(p.tps[0].attempts).toBe(0);
    expect(p.state).toBe('armed');
  });

  it('a failed sell cools down instead of re-firing every tick', () => {
    let p = markExecuting(queuedAt2x(), tp1, T0);
    p = applyOutcome(p, tp1, { status: 'failed', detail: 'impact too high', retryable: true }, T0);
    expect(evaluate(p, q(ENTRY * 2), BAG, ctx({ now: T0 + 5_000 })).actions).toHaveLength(0);
    expect(evaluate(p, q(ENTRY * 2), BAG, ctx({ now: T0 + 25_000 })).actions).toHaveLength(1);
  });

  it('done-elsewhere and stale outcomes', () => {
    let p = markExecuting(queuedAt2x(), tp1, T0);
    const elsewhere = applyOutcome(p, tp1, { status: 'done-elsewhere' }, T0);
    expect(elsewhere.tps[0].status).toBe('done-elsewhere');
    expect(elsewhere.state).toBe('armed');
    const stale = applyOutcome(p, tp1, { status: 'stale' }, T0);
    expect(stale.tps[0].status).toBe('waiting');
    expect(stale.tps[0].attempts).toBe(0);
    let r = evaluate(buildPlan(input()), q(ENTRY * 0.5), BAG, ctx());
    r = evaluate(r.plan, q(ENTRY * 0.5), BAG, ctx());
    p = markExecuting(r.plan, { kind: 'sl' }, T0);
    expect(applyOutcome(p, { kind: 'sl' }, { status: 'done-elsewhere' }, T0).state).toBe('done');
  });

  it('retryable take-profit failures re-arm; after 3 the level is blocked (plan stays armed)', () => {
    let p = queuedAt2x();
    for (let i = 0; i < 3; i++) {
      p = markExecuting(p, tp1, T0);
      p = applyOutcome(p, tp1, { status: 'failed', detail: 'quote timed out', retryable: true }, T0);
    }
    expect(p.state).toBe('armed');
    expect(p.tps[0].status).toBe('blocked');
    expect(p.attention).toContain('quote timed out');
    const n = p.history.length;
    expect(reconcile(p, BAG, T0 + 1, null).history.length).toBe(n); // no history spam
  });
});

describe('review round 3', () => {
  const tp1 = { kind: 'tp', id: 'tp1' } as const;
  const queuedAt2x = () => evaluate(buildPlan(input()), q(ENTRY * 2), BAG, ctx()).plan;

  it('while a take-profit may have sold (blocked after a click), deeper take-profits wait', () => {
    let p = markExecuting(queuedAt2x(), tp1, T0);
    p = applyOutcome(p, tp1, { status: 'unknown' }, T0);
    p = reconcile(p, BAG, T0 + RECONCILE_AFTER_MS + 1, null);
    expect(p.tps[0].status).toBe('blocked');
    expect(evaluate(p, q(ENTRY * 6), BAG, ctx({ now: T0 + 200_000 })).actions).toHaveLength(0);
  });

  it('a late balance confirmation un-blocks it (no Retry needed)', () => {
    let p = markExecuting(queuedAt2x(), tp1, T0);
    p = applyOutcome(p, tp1, { status: 'unknown' }, T0);
    p = reconcile(p, BAG, T0 + RECONCILE_AFTER_MS + 1, null);
    p = reconcile(p, BAG / 2, T0 + 300_000, null);
    expect(p.tps[0].status).toBe('filled');
    expect(p.attention).toBeNull();
  });

  it("a stop on a bag below fomo's minimum closes with a notice instead of retrying forever", () => {
    // 3,000 tokens at 0.5x = $1.50: above dust ($1), below fomo's $2 minimum
    let r = evaluate(buildPlan(input({ balance: 3_000 })), q(ENTRY * 0.5), 3_000, ctx({ minSellUsd: 2 }));
    r = evaluate(r.plan, q(ENTRY * 0.5), 3_000, ctx({ minSellUsd: 2 }));
    expect(r.actions).toHaveLength(0);
    expect(r.plan.state).toBe('done');
    expect(r.plan.history.some((h) => h.kind === 'too-small')).toBe(true);
  });

  it('a take-profit interrupted by a worker restart counts as "may have sold"', () => {
    const p0 = markExecuting(queuedAt2x(), tp1, T0); // executing, never reported back
    const p = reconcile(p0, BAG, T0 + RECONCILE_AFTER_MS + 1, null);
    expect(p.tps[0].status).toBe('blocked');
    expect(p.tps[0].clickedAt).toBe(T0);
    expect(evaluate(p, q(ENTRY * 6), BAG, ctx({ now: T0 + 200_000 })).actions).toHaveLength(0); // deeper TPs wait
    expect(reconcile(p, BAG / 2, T0 + 300_000, null).tps[0].status).toBe('filled'); // late confirmation
  });

  it('retry is only offered for blocked levels', () => {
    let p = markExecuting(queuedAt2x(), tp1, T0);
    p = applyOutcome(p, tp1, { status: 'unknown' }, T0);
    expect(retryableLevels(p)).toEqual([]);
    p = reconcile(p, BAG, T0 + RECONCILE_AFTER_MS + 1, null);
    expect(retryableLevels(p)).toEqual([tp1]);
  });
});

describe('plan lifecycle', () => {
  it('pausing withdraws queued sells; withdrawQueued targets one level', () => {
    const queued = evaluate(buildPlan(input()), q(ENTRY * 2), BAG, ctx()).plan;
    expect(queued.tps[0].status).toBe('queued');
    expect(pausePlan(queued, T0).tps[0].status).toBe('waiting');
    expect(withdrawQueued(queued, { kind: 'tp', id: 'tp1' }).tps[0].status).toBe('waiting');
    expect(withdrawQueued(queued, { kind: 'sl' }).tps[0].status).toBe('queued');
  });

  it('a triggered stop is never pre-empted by a zero balance guess', () => {
    let r = evaluate(buildPlan(input()), q(ENTRY * 0.6), 0, ctx());
    expect(r.plan.state).toBe('armed'); // first tick below: counting, not closing
    r = evaluate(r.plan, q(ENTRY * 0.6), 0, ctx());
    expect(sell(r).level).toEqual({ kind: 'sl' }); // stop still fires; execution confirms what's left
  });

  it('pause / resume / cancel', () => {
    let p = pausePlan(buildPlan(input()), T0);
    expect(evaluate(p, q(ENTRY * 2), BAG, ctx()).actions).toHaveLength(0);
    p = resumePlan(p, T0);
    expect(p.state).toBe('armed');
    p = cancelPlan(p, T0);
    expect(p.state).toBe('cancelled');
  });

  it('rescale keeps percentages meaning "of your bag" after buying more', () => {
    const p = rescale(buildPlan(input()), 200_000, T0, 0.0015);
    expect(p.tps.map((t) => t.targetRemaining)).toEqual([100_000, 50_000]);
    expect(p.entry.priceUSD).toBe(0.0015);
  });

  it('sortActions runs stops first, then biggest sells', () => {
    const mk = (priority: number, sellUsd: number) => ({ type: 'sell', priority, sellUsd, queuedAt: 0 }) as SellAction;
    const sorted = sortActions([mk(1, 10), mk(0, 5), mk(1, 50)]);
    expect(sorted.map((a) => [a.priority, a.sellUsd])).toEqual([[0, 5], [1, 50], [1, 10]]);
  });
});

describe('triggers & validation', () => {
  const entry = { priceUSD: 1, mc: 1_000_000, source: 'manual' as const };
  it('describes triggers in plain words', () => {
    expect(describeTrigger({ kind: 'x', value: 2 })).toBe('2x');
    expect(describeTrigger({ kind: 'x', value: 0.7 })).toBe('−30%');
    expect(describeTrigger({ kind: 'mc', value: 2_500_000 })).toBe('$2.5M mc');
    expect(formatUsd(0.00004123)).toBe('$0.0000412');
  });
  it('falls back to price for mc triggers without a quoted mc', () => {
    expect(isHit({ kind: 'mc', value: 2_000_000 }, { priceUSD: 2, mc: null, at: 0 }, entry, 'up')).toBe(true);
  });
  it('catches friendly mistakes', () => {
    const base = { ...input(), entry };
    expect(validatePlanInput(base)).toEqual([]);
    const bad = validatePlanInput({
      ...base,
      tps: [{ trigger: { kind: 'x', value: 3 }, sellPct: 80 }, { trigger: { kind: 'x', value: 2 }, sellPct: 40 }],
      sl: { trigger: { kind: 'x', value: 1.2 } },
    });
    const msgs = bad.map((i) => i.message).join(' | ');
    expect(msgs).toContain('lowest to highest');
    expect(msgs).toContain('add up to 120%');
    expect(msgs).toContain('below your entry');
  });
});

export type { Plan };
