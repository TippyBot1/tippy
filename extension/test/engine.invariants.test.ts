// Randomised "anything can happen" runs. Encodes the guarantees the reviews
// asked for: a take-profit that may have sold is never re-sold without an
// explicit Retry; nothing acts on paused/closed plans; closed plans stay closed;
// pausing leaves nothing queued; the stop loss is never silently cancelled while
// the plan is armed; Tippy never sells more than is held. Half the plans also
// carry partial stops, which follow the take-profit rules (and never sell more
// than their share, crumbs aside).
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { applyOutcome, buildPlan, cancelPlan, evaluate, getLevel, markExecuting, pausePlan, reconcile, RECONCILE_AFTER_MS, resumePlan, retryLevel, type ExecOutcome } from '../src/engine/orders';
import type { LevelRef, Plan, SellAction, StopLevel } from '../src/engine/types';

const T0 = 1_700_000_000_000;
const ENTRY = 0.001;

const op = fc.oneof(
  { weight: 6, arbitrary: fc.record({ kind: fc.constant('tick' as const), move: fc.integer({ min: -70, max: 110 }).map((n) => n / 100), knownBalance: fc.boolean() }) }, // integers: fc.double clusters near 0
  { weight: 1, arbitrary: fc.record({ kind: fc.constant('pause' as const) }) },
  { weight: 1, arbitrary: fc.record({ kind: fc.constant('resume' as const) }) },
  { weight: 1, arbitrary: fc.record({ kind: fc.constant('retry' as const) }) },
  { weight: 1, arbitrary: fc.record({ kind: fc.constant('manualSell' as const), pct: fc.integer({ min: 1, max: 100 }) }) },
  { weight: 2, arbitrary: fc.record({ kind: fc.constant('sleep' as const) }) },
  { weight: 1, arbitrary: fc.record({ kind: fc.constant('cancel' as const) }) },
);
const outcomeKind = fc.constantFrom('filled', 'filled', 'unknown-sold', 'unknown-not', 'failed', 'failed-final', 'aborted', 'stale', 'done-elsewhere');

const refKey = (r: LevelRef) => (r.kind === 'tp' || r.kind === 'stop' ? r.id : r.kind);
/** Take-profits and partial stops: the levels that may never be re-pressed without a Retry. */
const slices = (plan: Plan) => [...plan.tps.map((t) => ({ ref: { kind: 'tp', id: t.id } as LevelRef, level: t })), ...plan.stops.map((s) => ({ ref: { kind: 'stop', id: s.id } as LevelRef, level: s }))];

describe('engine invariants under chaos', () => {
  it('holds for random markets, user actions and executor outcomes', () => {
    let stopSells = 0;
    fc.assert(
      fc.property(fc.double({ min: 0.5, max: 5, noNaN: true }), fc.array(op, { minLength: 10, maxLength: 150 }), fc.array(outcomeKind, { minLength: 150, maxLength: 150 }), fc.boolean(), fc.constantFrom(0, -0.3), (startX, ops, outcomes, withStops, fall) => {
        let plan: Plan = buildPlan({
          id: 'p',
          key: 'k:1',
          networkId: 1399811149,
          address: 'k',
          symbol: 'TST',
          name: 'Test',
          entry: { priceUSD: ENTRY, mc: null, source: 'armed-at' },
          balance: 1_000_000,
          tps: [
            { trigger: { kind: 'x', value: 2 }, sellPct: 40 },
            { trigger: { kind: 'x', value: 4 }, sellPct: 30 },
          ],
          stops: withStops
            ? [
                { trigger: { kind: 'x', value: 0.7 }, sellPct: 25 },
                { trigger: { kind: 'x', value: 0.85 }, sellPct: 15 },
              ]
            : [],
          sl: { trigger: { kind: 'x', value: 0.6 } },
          trailing: { trailPct: 30, activateX: 1.5 },
          origin: 'manual',
          now: T0,
        });
        let held = 1_000_000;
        let price = ENTRY * startX; // start anywhere around the levels
        let now = T0;
        let sold = 0;
        let oi = 0;
        let closedAt: string | null = null;
        // TP levels whose sell may have gone through and hasn't been retried
        const mayHaveSold = new Set<string>();

        const runAction = (a: SellAction) => {
          const k = refKey(a.level);
          const slice = a.level.kind === 'tp' || a.level.kind === 'stop';
          if (slice) expect(mayHaveSold.has(k)).toBe(false); // never re-sold without Retry
          expect(plan.state).toBe('armed');
          if (a.level.kind === 'stop') {
            stopSells++;
            // a partial stop sells down to its own target — or everything, to sweep an unsellable crumb
            const level = getLevel(plan, a.level) as StopLevel;
            if (a.targetRemaining !== level.targetRemaining) {
              expect(a.targetRemaining).toBe(0);
              expect(level.targetRemaining * price).toBeLessThan(0.5);
            }
            expect(price).toBeLessThanOrEqual(ENTRY * level.trigger.value * (1 + 1e-9));
          }
          plan = markExecuting(plan, a.level, now);
          const kind = outcomes[oi++ % outcomes.length];
          const sellNow = Math.max(0, held - a.targetRemaining);
          let o: ExecOutcome;
          if (kind === 'filled') {
            sold += sellNow;
            held = a.targetRemaining;
            o = { status: 'filled', balanceAfter: held };
          } else if (kind === 'unknown-sold') {
            sold += sellNow;
            held = a.targetRemaining;
            o = { status: 'unknown' };
            if (slice) mayHaveSold.add(k);
          } else if (kind === 'unknown-not') {
            o = { status: 'unknown' };
            if (slice) mayHaveSold.add(k);
          } else if (kind === 'failed') o = { status: 'failed', detail: 'x', retryable: true };
          else if (kind === 'failed-final') o = { status: 'failed', detail: 'x', retryable: false };
          else if (kind === 'aborted') o = { status: 'aborted', reason: 'x' };
          else if (kind === 'stale') o = { status: 'stale' };
          else o = held - a.targetRemaining <= 1 ? { status: 'done-elsewhere' } : { status: 'failed', detail: 'x', retryable: true };
          plan = applyOutcome(plan, a.level, o, now);
          // filled/unknown-sold resolve the "may have sold" state once the balance confirms
        };

        for (const s of ops) {
          const wasClosed = plan.state === 'done' || plan.state === 'cancelled';
          if (s.kind === 'tick') {
            now += 3_000;
            const drift = withStops ? fall : 0; // with partial stops, half the markets drift down
            price = Math.max(1e-9, price * Math.exp((s.move + drift) * 0.4));
            const bal = s.knownBalance ? held : null;
            plan = reconcile(plan, bal, now, price);
            // reconcile may confirm a fill: levels it marks filled are no longer "may have sold"
            for (const { level: t } of slices(plan)) if (t.status === 'filled' || t.status === 'cancelled' || t.status === 'done-elsewhere') mayHaveSold.delete(t.id);
            const r = evaluate(plan, { priceUSD: price, mc: null, at: now }, bal, { now, gap: false, gapPolicy: 'sell', minSellUsd: 0.5, dustUsd: 0.01 });
            expect(r.actions.length).toBeLessThanOrEqual(1);
            if (plan.state !== 'armed') expect(r.actions).toHaveLength(0);
            plan = r.plan;
            for (const a of r.actions) if (a.type === 'sell') runAction(a);
          } else if (s.kind === 'pause') {
            plan = pausePlan(plan, now);
            for (const { level: t } of slices(plan)) expect(t.status).not.toBe('queued');
          } else if (s.kind === 'resume') {
            plan = resumePlan(plan, now);
          } else if (s.kind === 'retry') {
            for (const { ref, level: t } of slices(plan)) {
              if (t.status === 'blocked' || t.status === 'unknown') {
                plan = retryLevel(plan, ref, now);
                if (getLevel(plan, ref)!.status === 'waiting') {
                  // the user checked fomo and retried: if it had actually sold, the
                  // declarative target makes the retry a no-op ("done elsewhere").
                  mayHaveSold.delete(t.id);
                }
              }
            }
          } else if (s.kind === 'manualSell') {
            held = held * (1 - s.pct / 100);
          } else if (s.kind === 'sleep') {
            now += RECONCILE_AFTER_MS + 1;
          } else if (s.kind === 'cancel') {
            plan = cancelPlan(plan, now);
          }

          // closed plans stay closed
          if (wasClosed) expect(plan.state).toBe(closedAt);
          if (plan.state === 'done' || plan.state === 'cancelled') closedAt ??= plan.state;
          // the stop is never silently cancelled while the plan is armed
          if (plan.state === 'armed') expect(plan.sl!.status).not.toBe('cancelled');
          // 'attention' is never a state
          expect(['armed', 'paused', 'done', 'cancelled']).toContain(plan.state);
          expect(held).toBeGreaterThanOrEqual(-1e-6);
          expect(sold).toBeLessThanOrEqual(1_000_000 + 1e-6);
        }
      }),
      { numRuns: 1500 },
    );
    expect(stopSells).toBeGreaterThan(20); // partial stops really were exercised (most chaos runs end in a cancel)
  });
});
