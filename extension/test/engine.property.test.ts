// Randomised price paths, manual sells and flaky executions. Whatever happens,
// Tippy must never sell more than you hold, never double-sell a level, and never
// act on a closed plan. With partial stops in the mix: no level ever sells below
// its declared target (only to sweep an unsellable crumb), a partial stop never
// sells more than its share, and an exit always beats a take-profit / partial stop.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { applyOutcome, buildPlan, evaluate, getLevel, markExecuting, reconcile } from '../src/engine/orders';
import type { EvalContext, Plan, SellAction, StopLevel, StopLoss, TakeProfit, Trailing } from '../src/engine/types';

const T0 = 1_700_000_000_000;
const ENTRY = 0.001;

const stepWith = (minMove: number, maxMove: number, manualSells = 3) =>
  fc.record({
    move: fc.double({ min: minMove, max: maxMove, noNaN: true }), // log-ish price move per tick
    // 1 in (manualSells + 1) ticks you also sell some by hand
    manualSellPct: fc.oneof(...Array.from({ length: manualSells }, () => fc.constant(0)), fc.integer({ min: 1, max: 100 })),
    outcome: fc.constantFrom('filled', 'filled', 'filled', 'unknown', 'failed', 'partial'),
    gap: fc.integer({ min: 0, max: 9 }).map((n) => n === 0), // ~10% of ticks follow a sleep
  });
const step = stepWith(-0.6, 1.2);
/** A market that drifts down: partial stops get hit a lot. */
const fallingStep = stepWith(-0.5, 0.4, 12);

const stopShape = (minLength: number) => fc.array(fc.record({ x: fc.double({ min: 0.2, max: 1.5, noNaN: true }), pct: fc.integer({ min: 1, max: 60 }) }), { minLength, maxLength: 3 });
const shapeWith = (stops: fc.Arbitrary<{ x: number; pct: number }[]>) =>
  fc.record({
    tps: fc.array(fc.record({ x: fc.double({ min: 1.1, max: 20, noNaN: true }), pct: fc.integer({ min: 5, max: 70 }) }), { maxLength: 4 }),
    stops,
    sl: fc.option(fc.double({ min: 0.2, max: 0.95, noNaN: true }), { nil: null }),
    trail: fc.option(fc.record({ pct: fc.integer({ min: 5, max: 60 }), act: fc.option(fc.double({ min: 1.1, max: 4, noNaN: true }), { nil: null }) }), { nil: null }),
    bag: fc.integer({ min: 1_000, max: 10_000_000 }),
  });
/** Partial stops sometimes. */
const planShape = shapeWith(fc.oneof(fc.constant<{ x: number; pct: number }[]>([]), stopShape(0)));
/** Partial stops always. */
const stopPlanShape = shapeWith(stopShape(1));
type Shape = typeof planShape extends fc.Arbitrary<infer T> ? T : never;
type Step = typeof step extends fc.Arbitrary<infer T> ? T : never;

const exitDue = (l: StopLoss | Trailing | null, now: number) =>
  !!l && l.status === 'waiting' && l.ticksBelow >= l.confirmTicks && (l.retryAfter == null || l.retryAfter <= now) && (!('active' in l) || (l.active && !!l.peakPrice));

/** A take-profit / partial stop sell, checked against the level that asked for it. */
function checkSlice(plan: Plan, a: SellAction, balance: number, price: number, ctx: EvalContext) {
  const level = getLevel(plan, a.level) as TakeProfit | StopLevel;
  // an exit that's due always goes first
  expect(exitDue(plan.sl, ctx.now)).toBe(false);
  expect(exitDue(plan.trailing, ctx.now)).toBe(false);
  // never below the level's declared target — except to sweep an unsellable crumb
  // (and, for a take-profit, a last slice too small for fomo on its own)
  const crumb = level.targetRemaining * price < Math.max(ctx.minSellUsd, ctx.dustUsd);
  if (a.targetRemaining < level.targetRemaining - 1e-6) {
    expect(a.targetRemaining).toBe(0);
    if (a.level.kind === 'stop') expect(crumb).toBe(true);
    else expect(crumb || (balance - level.targetRemaining) * price < ctx.minSellUsd).toBe(true);
  }
  if (a.level.kind === 'stop') {
    // only once the price is at/below the stop, and never more than its share (crumbs aside)
    expect(price).toBeLessThanOrEqual(ENTRY * level.trigger.value * (1 + 1e-9));
    if (!crumb) expect(a.sellAmount!).toBeLessThanOrEqual(balance - level.targetRemaining + 1e-6);
    // never sold just to reach fomo's minimum
    expect(a.sellAmount! * price).toBeGreaterThanOrEqual(ctx.minSellUsd - 1e-9);
  }
}

describe('engine invariants', () => {
  it('holds under random markets, manual sells and flaky fills', () => {
    const seen = { stopSells: 0 };
    fc.assert(
      fc.property(planShape, fc.array(step, { minLength: 5, maxLength: 120 }), (shape, steps) => scenario(shape, steps, seen)),
      { numRuns: 400 },
    );
  });

  it('holds for partial stops in falling markets', () => {
    const seen = { stopSells: 0 };
    fc.assert(
      fc.property(stopPlanShape, fc.array(fallingStep, { minLength: 5, maxLength: 80 }), (shape, steps) => scenario(shape, steps, seen)),
      { numRuns: 800 },
    );
    expect(seen.stopSells).toBeGreaterThan(100); // partial stops really were exercised
  });
});

function scenario(shape: Shape, steps: Step[], seen: { stopSells: number }) {
  // normalise the ladder: ascending, total ≤ 100%
  const xs = [...new Set(shape.tps.map((t) => Math.round(t.x * 100) / 100))].sort((a, b) => a - b);
  let left = 100;
  const tps = xs.map((x, i) => {
    const pct = Math.min(left, shape.tps[i]?.pct ?? 10);
    left -= pct;
    return { trigger: { kind: 'x' as const, value: x }, sellPct: pct };
  }).filter((t) => t.sellPct > 0);
  // partial stops: any order (the engine sorts them), their own 100%
  let stopLeft = 100;
  const stops = [...new Map(shape.stops.map((t) => [Math.round(t.x * 100) / 100, t.pct])).entries()]
    .map(([x, pct]) => {
      const take = Math.min(stopLeft, pct);
      stopLeft -= take;
      return { trigger: { kind: 'x' as const, value: x }, sellPct: take };
    })
    .filter((t) => t.sellPct > 0);

  let plan: Plan = buildPlan({
    id: 'p',
    key: 'k:1',
    networkId: 1399811149,
    address: 'k',
    symbol: 'TST',
    name: 'Test',
    entry: { priceUSD: ENTRY, mc: null, source: 'armed-at' },
    balance: shape.bag,
    tps,
    stops,
    sl: shape.sl ? { trigger: { kind: 'x', value: shape.sl } } : null,
    trailing: shape.trail ? { trailPct: shape.trail.pct, activateX: shape.trail.act } : null,
    origin: 'manual',
    now: T0,
  });

  let balance = shape.bag;
  let price = ENTRY;
  let now = T0;
  let soldByTippy = 0;
  const filledLevels = new Set<string>();

  for (const s of steps) {
    now += s.gap ? 600_000 : 3_000;
    price = Math.max(1e-9, price * Math.exp(s.move * 0.5));
    if (s.manualSellPct) balance = balance * (1 - s.manualSellPct / 100);

    const ctx: EvalContext = { now, gap: s.gap, gapPolicy: 'sell', minSellUsd: 2, dustUsd: 1 };
    plan = reconcile(plan, balance, now, price);
    const closedBefore = plan.state === 'done' || plan.state === 'cancelled';
    const r = evaluate(plan, { priceUSD: price, mc: null, at: now }, balance, ctx);

    // at most one action per plan per tick; none on closed plans
    expect(r.actions.length).toBeLessThanOrEqual(1);
    if (closedBefore) expect(r.actions).toHaveLength(0);
    plan = r.plan;

    for (const a of r.actions as SellAction[]) {
      if (a.type !== 'sell') continue;
      const levelKey = a.level.kind === 'tp' || a.level.kind === 'stop' ? a.level.id : a.level.kind;
      // a level is never sold twice
      expect(filledLevels.has(levelKey)).toBe(false);
      if (a.level.kind === 'tp' || a.level.kind === 'stop') checkSlice(plan, a, balance, price, ctx);
      if (a.level.kind === 'stop') seen.stopSells++;
      // never sell more than we hold, never sell when already at target
      if (a.sellAmount != null) {
        expect(a.sellAmount).toBeLessThanOrEqual(balance + 1e-6);
        expect(a.sellAmount).toBeGreaterThan(0);
      }
      expect(a.targetRemaining).toBeGreaterThanOrEqual(0);

      plan = markExecuting(plan, a.level, now);
      const sellNow = Math.max(0, balance - a.targetRemaining);
      if (s.outcome === 'filled') {
        soldByTippy += sellNow;
        balance = a.targetRemaining;
        plan = applyOutcome(plan, a.level, { status: 'filled', balanceAfter: balance }, now);
        filledLevels.add(levelKey);
      } else if (s.outcome === 'partial') {
        // click landed but the balance shows up next tick
        soldByTippy += sellNow;
        balance = a.targetRemaining;
        plan = applyOutcome(plan, a.level, { status: 'unknown' }, now);
      } else if (s.outcome === 'unknown') {
        plan = applyOutcome(plan, a.level, { status: 'unknown' }, now);
      } else {
        plan = applyOutcome(plan, a.level, { status: 'failed', detail: 'test', retryable: true }, now);
      }
    }

    expect(balance).toBeGreaterThanOrEqual(-1e-6);
    expect(soldByTippy).toBeLessThanOrEqual(shape.bag + 1e-6);
    // OCO: once a stop/trailing exit fills, the plan is closed
    if (filledLevels.has('sl') || filledLevels.has('trail')) {
      expect(['done', 'cancelled']).toContain(plan.state);
    }
  }
}
