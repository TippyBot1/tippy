// Limit buys: when they fire, when they hold off, and the one-shot rule —
// once Tippy may have pressed Buy it never presses again unless you say so.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  applyBuyOutcome,
  BUY_CONFIRM_TICKS,
  BUY_MAX_ATTEMPTS,
  buildBuy,
  buyOwnsIncrease,
  buyZone,
  cancelBuy,
  evaluateBuy,
  markBuyExecuting,
  prepareBuy,
  reconcileBuy,
  resolveUnknownBuy,
  summarizeBuy,
  validateBuyInput,
  withdrawBuy,
  type BuyOutcome,
} from '../src/engine/buys';
import type { BuyInput, BuyOrder, Trigger } from '../src/engine/types';

const T0 = 1_700_000_000_000;
const ref = { priceUSD: 0.002, mc: 2_000_000, source: 'armed-at' as const };

function order(over: Partial<BuyInput> = {}): BuyOrder {
  return buildBuy({ id: 'b1', key: 'k:1', networkId: 1399811149, address: 'k', symbol: 'TST', name: 'Test', trigger: { kind: 'mc', value: 1_600_000 }, ref, usd: 10, guardPresetId: 'classic', expiresInMs: 24 * 3600_000, now: T0, ...over });
}
const q = (priceUSD: number, at = T0) => ({ priceUSD, mc: priceUSD * 1e9, at });

/** Tick until the order fires (or give up). */
function fire(o: BuyOrder, price: number, t = T0 + 1000) {
  let r = evaluateBuy(o, q(price, t), t);
  for (let i = 1; i < BUY_CONFIRM_TICKS && !r.action; i++) r = evaluateBuy(r.order, q(price, t + i * 3000), t + i * 3000);
  return r;
}

describe('placing a limit buy', () => {
  it('works out dip vs breakout from where the price is now', () => {
    expect(order().direction).toBe('down');
    expect(order({ trigger: { kind: 'price', value: 0.003 } }).direction).toBe('up');
    expect(summarizeBuy(order())).toBe('Buy $10.00 at $1.6M MC (dip)');
  });

  it('validates the amount, the level and fomo’s minimum', () => {
    const base = { key: 'k:1', networkId: 1, address: 'k', symbol: 'T', name: 'T', ref, guardPresetId: null, expiresInMs: null };
    expect(validateBuyInput({ ...base, trigger: { kind: 'mc', value: 1.6e6 }, usd: 0 })[0].field).toBe('usd');
    expect(validateBuyInput({ ...base, trigger: { kind: 'mc', value: 1.6e6 }, usd: 1 }, 2)[0].message).toMatch(/minimum/);
    expect(validateBuyInput({ ...base, trigger: { kind: 'price', value: 0.002 }, usd: 10 })[0].field).toBe('trigger');
    expect(validateBuyInput({ ...base, trigger: { kind: 'mc', value: 1.6e6 }, usd: 10, ref: { ...ref, mc: null } })[0].message).toMatch(/market cap/);
    expect(validateBuyInput({ ...base, trigger: { kind: 'mc', value: 1.6e6 }, usd: 10 })).toEqual([]);
  });
});

describe('when a limit buy fires', () => {
  it('needs the level to hold for a couple of ticks (one wick doesn’t buy)', () => {
    const o = order();
    const one = evaluateBuy(o, q(0.0016), T0 + 1);
    expect(one.action).toBeNull();
    const back = evaluateBuy(one.order, q(0.0019), T0 + 2);
    expect(back.order.ticksAt).toBe(0);
    const r = fire(o, 0.0016);
    expect(r.action).toMatchObject({ type: 'buy', orderId: 'b1', usd: 10, priority: 2 });
    expect(r.order.state).toBe('queued');
  });

  it('won’t catch a falling knife or chase a pump past the band', () => {
    const o = order();
    expect(buyZone(o, { priceUSD: 0.0011, mc: 1.1e6 })).toBe('past'); // > 25% below $1.6M
    const r = fire(o, 0.0011);
    expect(r.action).toBeNull();
    expect(r.order.attention).toMatch(/falling knives/);
    // comes back into range → buys
    expect(fire(r.order, 0.0015, T0 + 60_000).action).not.toBeNull();
    const up = order({ trigger: { kind: 'price', value: 0.003 } });
    expect(fire(up, 0.0045).action).toBeNull();
    expect(fire(up, 0.0031).action).not.toBeNull();
  });

  it('expires', () => {
    const r = evaluateBuy(order({ expiresInMs: 1000 }), q(0.0016, T0 + 2000), T0 + 2000);
    expect(r.order.state).toBe('expired');
    expect(r.action).toBeNull();
  });

  it('pausing puts a queued buy back to watching', () => {
    const r = fire(order(), 0.0016);
    expect(withdrawBuy(r.order, T0 + 9).state).toBe('armed');
  });
});

describe('after Tippy drives fomo', () => {
  const executing = () => markBuyExecuting(fire(order(), 0.0016).order, T0 + 10_000);

  it('filled → done; unknown → waits for you, never pressed again', () => {
    expect(applyBuyOutcome(executing(), { status: 'filled', got: 6000, price: 0.00166 }, T0 + 20_000)).toMatchObject({ state: 'filled', got: 6000 });
    const u = applyBuyOutcome(executing(), { status: 'unknown' }, T0 + 20_000);
    expect(u.state).toBe('unknown');
    expect(u.attention).toMatch(/Check fomo/);
    expect(evaluateBuy(u, q(0.0016), T0 + 30_000).action).toBeNull();
  });

  it('retries failures that pressed nothing, with backoff, then gives up', () => {
    let o = executing();
    for (let i = 1; i < BUY_MAX_ATTEMPTS; i++) {
      o = applyBuyOutcome(o, { status: 'failed', detail: 'no panel', retryable: true }, T0 + i);
      expect(o.state).toBe('armed');
      expect(o.retryAfter).toBeGreaterThan(T0 + i);
      o = markBuyExecuting({ ...o, state: 'queued' }, T0 + i);
    }
    o = applyBuyOutcome(o, { status: 'failed', detail: 'no panel', retryable: true }, T0 + 99);
    expect(o.state).toBe('failed');
  });

  it('not enough cash: keeps watching, tells you, checks again later', () => {
    const o = applyBuyOutcome(executing(), { status: 'no-cash', cash: 3.2 }, T0 + 20_000);
    expect(o.state).toBe('armed');
    expect(o.attention).toMatch(/you have \$3\.20/);
    expect(evaluateBuy(o, q(0.0016), T0 + 21_000).action).toBeNull(); // waits out the cool-down
  });

  it('a restart mid-buy → unknown; coins showing up later confirm it', () => {
    const o = prepareBuy(executing(), 0, 6000, T0 + 11_000);
    const u = reconcileBuy(o, null, T0 + 12_000, false);
    expect(u.state).toBe('unknown');
    expect(reconcileBuy(u, 0, T0 + 13_000, false).state).toBe('unknown');
    expect(reconcileBuy(u, 5800, T0 + 14_000, false)).toMatchObject({ state: 'filled', got: 5800 });
    // the one actually running is left alone
    expect(reconcileBuy(o, null, T0 + 12_000, true).state).toBe('executing');
  });

  it('"It didn’t buy" re-arms; "It bought" closes', () => {
    const u = applyBuyOutcome(executing(), { status: 'unknown' }, T0 + 20_000);
    expect(resolveUnknownBuy(u, false, T0 + 30_000)).toMatchObject({ state: 'armed', attention: null });
    expect(resolveUnknownBuy(u, true, T0 + 30_000).state).toBe('filled');
  });

  it("can't be cancelled mid-buy (the press may be happening) — its outcome always lands", () => {
    const e = executing();
    expect(cancelBuy(e, T0 + 15_000)).toBe(e);
    expect(applyBuyOutcome(e, { status: 'filled', got: 1, price: 1 }, T0 + 16_000).state).toBe('filled');
  });

  it('auto-guard leaves coins from a limit buy to the buy’s own protection', () => {
    const f = applyBuyOutcome(executing(), { status: 'filled', got: 6000, price: 0.00166 }, T0 + 20_000);
    expect(buyOwnsIncrease([f], 'k:1', T0 + 60_000)).toBe(true);
    expect(buyOwnsIncrease([f], 'k:1', T0 + 20 * 60_000)).toBe(false);
    expect(buyOwnsIncrease([{ ...f, dryRun: true }], 'k:1', T0 + 60_000)).toBe(false);
  });
});

describe('limit-buy invariants under chaos', () => {
  const op = fc.oneof(
    { weight: 8, arbitrary: fc.record({ kind: fc.constant('tick' as const), move: fc.integer({ min: -30, max: 30 }).map((n) => n / 100) }) }, // integers: fc.double clusters near 0
    { weight: 1, arbitrary: fc.record({ kind: fc.constant('cancel' as const) }) },
    { weight: 1, arbitrary: fc.record({ kind: fc.constant('pause' as const) }) },
    { weight: 1, arbitrary: fc.record({ kind: fc.constant('resolve' as const), bought: fc.boolean() }) },
    { weight: 3, arbitrary: fc.record({ kind: fc.constant('restart' as const) }) },
    { weight: 1, arbitrary: fc.record({ kind: fc.constant('sleep' as const) }) },
  );
  // 'hang' = the buy is still running when the next thing happens (often a worker restart).
  const outcome = fc.constantFrom<BuyOutcome['status'] | 'hang'>('filled', 'unknown', 'failed', 'stale', 'aborted', 'no-cash', 'hang', 'hang', 'hang');
  const triggers: Trigger[] = [
    { kind: 'mc', value: 1_800_000 },
    { kind: 'price', value: 0.0022 },
    { kind: 'x', value: 0.9 },
  ];

  it('presses at most once per "go", never after cancel / expiry / fill, one action per tick', () => {
    fc.assert(
      fc.property(fc.constantFrom(...triggers), fc.array(op, { minLength: 10, maxLength: 120 }), fc.array(outcome, { minLength: 120, maxLength: 120 }), (trigger, ops, outcomes) => {
        let o = order({ trigger, expiresInMs: 6 * 3600_000 });
        let price = 0.002;
        let now = T0;
        let oi = 0;
        let presses = 0; // outcomes that may have bought (filled / unknown)
        let gos = 1; // "go" permissions: placing the order, and each "it didn't buy"
        let running = false;
        for (const s of ops) {
          if (s.kind === 'tick') {
            now += 3000;
            price = Math.max(1e-6, price * Math.exp(s.move * 0.3));
            if (running && o.state === 'executing') {
              // a hung buy finishes on some later tick (it may have pressed) — or keeps hanging
              if (outcomes[oi++ % outcomes.length] === 'hang') continue;
              presses++;
              expect(presses).toBeLessThanOrEqual(gos);
              o = applyBuyOutcome(o, { status: 'unknown' }, now);
              running = false;
            }
            o = reconcileBuy(o, null, now, running);
            const before = o.state;
            const r = evaluateBuy(o, { priceUSD: price, mc: price * 1e9, at: now }, now);
            o = r.order;
            if (r.action) {
              expect(before).toBe('armed');
              expect(['cancelled', 'expired', 'filled', 'unknown', 'failed']).not.toContain(before);
              o = markBuyExecuting(o, now);
              running = true;
              const kind = outcomes[oi++ % outcomes.length];
              if (kind === 'hang') continue; // still executing — resolved next tick, or by a restart
              const res: BuyOutcome =
                kind === 'filled' ? { status: 'filled', got: 1, price } : kind === 'unknown' ? { status: 'unknown' } : kind === 'failed' ? { status: 'failed', detail: 'x', retryable: true } : kind === 'no-cash' ? { status: 'no-cash', cash: 1 } : kind === 'aborted' ? { status: 'aborted', reason: 'x' } : { status: 'stale' };
              if (kind === 'filled' || kind === 'unknown') presses++;
              expect(presses).toBeLessThanOrEqual(gos);
              o = applyBuyOutcome(o, res, now);
              running = false;
            }
          } else if (s.kind === 'cancel') o = cancelBuy(o, now);
          else if (s.kind === 'pause') o = withdrawBuy(o, now);
          else if (s.kind === 'resolve') {
            const was = o.state;
            o = resolveUnknownBuy(o, s.bought, now);
            if ((was === 'unknown' || was === 'failed') && !s.bought) gos++;
          } else if (s.kind === 'restart') {
            // the worker died mid-buy: Tippy may have pressed
            if (running && o.state === 'executing') presses++;
            running = false;
            o = reconcileBuy(o, null, now, false);
            expect(o.state).not.toBe('executing');
          } else now += 2 * 60_000;
          expect(['armed', 'queued', 'executing', 'unknown', 'filled', 'failed', 'cancelled', 'expired']).toContain(o.state);
        }
      }),
      { numRuns: 1500 },
    );
  });
});

describe('review fixes (2026-10-13)', () => {
  const executing = () => markBuyExecuting(fire(order(), 0.0016).order, T0 + 10_000);

  it('extra coins never make a buy look "cheap": the fill is capped at what the buy should bring', async () => {
    const { boundedFill } = await import('../src/engine/buys');
    // a held bag missing from the "before" read: 1,006,323 coins "arrived" for a $10 buy expecting 6,250
    expect(boundedFill({ usd: 10 }, 1_006_323, 6_250)).toMatchObject({ got: 6_250, price: 0.0016 });
    expect(boundedFill({ usd: 10 }, 6_000, 6_250)).toEqual({ got: 6_000, price: 10 / 6_000 });
    expect(boundedFill({ usd: 10 }, 2_000, 6_250)).toBeNull();
    const o = reconcileBuy(prepareBuy(executing(), 0, 6_250, T0), 1_006_323, T0 + 20_000, false);
    expect(o).toMatchObject({ state: 'filled', got: 6_250, fillPrice: 0.0016 });
  });

  it('"It didn’t buy" remembers the first press: if its coins land late, the order is filled, not bought twice', () => {
    const u = applyBuyOutcome(prepareBuy(executing(), 100, 6_250, T0), { status: 'unknown' }, T0 + 60_000);
    const again = resolveUnknownBuy(u, false, T0 + 120_000);
    expect(again.state).toBe('armed');
    expect(again.priorPress).toEqual({ balanceBefore: 100, expectedAmount: 6_250, at: T0 + 120_000 });
    const late = reconcileBuy(again, 6_300, T0 + 180_000, false);
    expect(late.state).toBe('filled');
    expect(evaluateBuy(late, q(0.0016), T0 + 181_000).action).toBeNull();
  });

  it('a pressed-but-unconfirmed buy can’t be cancelled (its coins would lose their guard)', () => {
    const u = applyBuyOutcome(executing(), { status: 'unknown' }, T0 + 60_000);
    expect(cancelBuy(u, T0 + 61_000)).toBe(u);
  });

  it('wick protection: one tick before a sleep plus one after is not "two ticks at the level"', () => {
    const one = evaluateBuy(order(), q(0.0016), T0 + 3_000);
    expect(one.order.ticksAt).toBe(1);
    const afterSleep = evaluateBuy(one.order, q(0.0016), T0 + 3_000 + 3_600_000);
    expect(afterSleep.action).toBeNull();
    expect(afterSleep.order.ticksAt).toBe(1);
    expect(evaluateBuy(afterSleep.order, q(0.0016), T0 + 3_603_000 + 3_000).action).not.toBeNull();
  });
});

describe('verification fixes (2026-10-13)', () => {
  const executing = () => markBuyExecuting(fire(order(), 0.0016).order, T0 + 10_000);

  it('an earlier press only counts for 30 minutes, and only for an increase its own size', async () => {
    const { PRIOR_PRESS_MS } = await import('../src/engine/buys');
    const u = applyBuyOutcome(prepareBuy(executing(), 0, 6_250, T0), { status: 'unknown' }, T0 + 60_000);
    const again = resolveUnknownBuy(u, false, T0 + 120_000);
    // a $50 manual buy later (5x the press): not that press — keep watching for the dip
    expect(reconcileBuy(again, 31_000, T0 + 180_000, false).state).toBe('armed');
    // the right size, but hours later: not that press either
    expect(reconcileBuy(again, 6_300, T0 + 120_000 + PRIOR_PRESS_MS + 1, false).state).toBe('armed');
    expect(reconcileBuy(again, 6_300, T0 + 180_000, false).state).toBe('filled');
  });

  it('a slow fomo (ticks ~20s apart) still counts as consecutive ticks', () => {
    const one = evaluateBuy(order(), q(0.0016), T0 + 3_000);
    expect(evaluateBuy(one.order, q(0.0016), T0 + 23_000).action).not.toBeNull();
  });
});
