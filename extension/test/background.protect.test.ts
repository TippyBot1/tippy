// Guarding the coins a limit buy just bought: arm the picked preset, keep a
// guard you already have, swap out a minutes-old auto-guard — and never twice.
import { describe, expect, it } from 'vitest';
import { REPLACE_AUTO_GUARD_MS, protectBuy, protection, type ProtectInput } from '../src/background/protect';
import { presetToInput } from '../src/engine/autoguard';
import { applyBuyOutcome, buildBuy, markBuyExecuting, prepareBuy } from '../src/engine/buys';
import { buildPlan, markExecuting, pausePlan } from '../src/engine/orders';
import type { BuyOrder, Plan } from '../src/engine/types';
import { DEFAULT_PRESETS } from '../src/shared/settings';
import { buyInput, KEY, queuedBuy, SOL, T0 } from './background.fakes';

const NOW = T0 + 60_000;
const PRICE = 0.0016;

/** A real (not dry-run) fill: 0 coins before, `got` after, at usd / got. */
function filled(over: Parameters<typeof buyInput>[0] = {}, got = 6_000, dryRun = false): BuyOrder {
  const { order } = queuedBuy(over);
  let o = markBuyExecuting(order, T0 + 10);
  o = prepareBuy(o, 0, o.usd / PRICE, T0 + 20);
  return applyBuyOutcome(o, dryRun ? { status: 'filled', got: null, price: PRICE, dryRun: true } : { status: 'filled', got, price: o.usd / got }, T0 + 30);
}

function plan(origin: 'manual' | 'auto-guard', createdAt: number, id = 'p1', balance = 4_000): Plan {
  const input = presetToInput(DEFAULT_PRESETS[0], { key: KEY, address: 'COIN', networkId: SOL, symbol: 'TST', name: 'Test Coin', priceUSD: 0.002, mc: 2_000_000, balance }, origin);
  return buildPlan({ ...input, id, now: createdAt });
}

function input(order: BuyOrder, plans: Plan[] = [], over: Partial<ProtectInput> = {}): ProtectInput {
  let n = 0;
  return {
    order,
    plans: Object.fromEntries(plans.map((p) => [p.id, p])),
    presets: DEFAULT_PRESETS,
    balance: 6_000,
    quote: { priceUSD: PRICE, mc: PRICE * 1e9 },
    baseline: { [KEY]: 0, other: 5 },
    now: NOW,
    newId: () => `new${++n}`,
    ...over,
  };
}

describe('when to guard a buy', () => {
  it('does nothing for dry runs, orders without a preset, or orders that never bought', () => {
    expect(protection(filled({}, 6_000, true), [], NOW).kind).toBe('none');
    expect(protection(filled({ guardPresetId: null }), [], NOW).kind).toBe('none');
    expect(protection(buildBuy(buyInput()), [], NOW).kind).toBe('none');
    const unknown = applyBuyOutcome(markBuyExecuting(queuedBuy().order, T0), { status: 'unknown' }, T0);
    expect(protection(unknown, [], NOW).kind).toBe('none');
  });

  it('arms the preset when the coin has no guard', () => {
    expect(protection(filled(), [], NOW).kind).toBe('new');
  });

  it("keeps a guard you set up yourself — even a brand-new one", () => {
    const mine = plan('manual', NOW - 1_000);
    expect(protection(filled(), [mine], NOW)).toEqual({ kind: 'keep', plan: mine });
  });

  it('swaps a minutes-old auto-guard plan for the preset you picked', () => {
    const auto = plan('auto-guard', NOW - 2 * 60_000);
    expect(protection(filled(), [auto], NOW)).toEqual({ kind: 'replace', plan: auto });
  });

  it('keeps an older, paused, or mid-sell auto-guard plan', () => {
    const old = plan('auto-guard', NOW - REPLACE_AUTO_GUARD_MS - 1);
    expect(protection(filled(), [old], NOW).kind).toBe('keep');
    const paused = pausePlan(plan('auto-guard', NOW - 60_000), NOW - 30_000);
    expect(protection(filled(), [paused], NOW).kind).toBe('keep');
    const selling = markExecuting(plan('auto-guard', NOW - 60_000), { kind: 'sl' }, NOW - 1_000);
    expect(protection(filled(), [selling], NOW).kind).toBe('keep');
  });

  it('ignores finished plans and other coins', () => {
    const otherCoin = { ...plan('manual', NOW), key: 'OTHER:1' };
    const done = { ...plan('manual', NOW, 'p2'), state: 'done' as const };
    expect(protection(filled(), [otherCoin, done], NOW).kind).toBe('new');
  });
});

describe('guarding the new coins', () => {
  it('arms the picked preset on the whole bag, at the price actually paid', () => {
    const order = filled({ guardPresetId: 'classic' }, 6_000);
    const res = protectBuy(input(order));
    expect(res.armed).not.toBeNull();
    const p = res.plans[res.armed!.id];
    expect(p.origin).toBe('manual');
    expect(p.origBalance).toBe(6_000);
    expect(p.entry.priceUSD).toBeCloseTo(10 / 6_000);
    // Market cap scales with the entry, so "mc" levels mean the same thing.
    expect(p.entry.mc).toBeCloseTo(PRICE * 1e9 * (10 / 6_000 / PRICE));
    expect(p.tps.map((t) => [t.trigger.value, t.sellPct])).toEqual([
      [2, 50],
      [5, 25],
    ]);
    expect(p.sl?.trigger).toEqual({ kind: 'x', value: 0.7 });
    expect(res.order.planId).toBe(p.id);
    expect(res.order.history.at(-1)?.kind).toBe('protected');
    expect(res.text).toMatch(/^Guarding with .*Classic: 2x 50% · 5x 25% · SL −30%\.$/);
    // The tick loop must not treat the new coins as a fresh top-up or a bag to auto-guard.
    expect(res.baseline).toEqual({ [KEY]: 6_000, other: 5 });
  });

  it('leaves a missing auto-guard baseline missing (it would make every bag look new)', () => {
    const res = protectBuy(input(filled(), [], { baseline: null }));
    expect(res.armed).not.toBeNull();
    expect(res.baseline).toBeNull();
  });

  it('keeps your existing guard and sizes it to the bigger bag right away', () => {
    const mine = plan('manual', T0 - 3600_000); // 4,000 coins at $0.002
    const res = protectBuy(input(filled({}, 6_000), [mine], { balance: 10_000 }));
    expect(res.armed).toBeNull();
    const kept = res.plans[mine.id];
    expect(kept.origBalance).toBe(10_000);
    expect(kept.entry.priceUSD).toBeCloseTo((4_000 * 0.002 + 10) / 10_000);
    expect(res.baseline).toEqual({ [KEY]: 10_000, other: 5 }); // not seen again as a top-up
    expect(res.order.planId).toBe(mine.id);
    expect(res.text).toBe('Your existing guard on $TST covers the new coins.');
  });

  it("doesn't resize the existing guard twice when the tick loop already did", () => {
    const mine = plan('manual', T0 - 3600_000);
    const res = protectBuy(input(filled({}, 6_000), [mine], { balance: 10_000, baseline: { [KEY]: 10_000 } }));
    expect(res.plans[mine.id]).toBe(mine);
  });

  it('measures from the live price when the cost is more than 10% off (a stop must never start above the market)', () => {
    const res = protectBuy(input({ ...filled({}, 6_000), fillPrice: PRICE * 1.15 }));
    expect(res.plans[res.armed!.id].entry.priceUSD).toBeCloseTo(PRICE);
    const ok = protectBuy(input({ ...filled({}, 6_000), fillPrice: PRICE * 1.05 }));
    expect(ok.plans[ok.armed!.id].entry.priceUSD).toBeCloseTo(PRICE * 1.05);
  });

  it('says so when the guard that covers the new coins is paused or has no stop', () => {
    const paused = pausePlan(plan('manual', T0 - 3600_000), T0);
    const res = protectBuy(input(filled({}, 6_000), [paused], { balance: 10_000 }));
    expect(res.order.attention).toMatch(/paused, so the new coins aren.t protected/);
    const noStop = { ...plan('manual', T0 - 3600_000), sl: null };
    expect(protectBuy(input(filled({}, 6_000), [noStop], { balance: 10_000 })).order.attention).toBe('Your guard on $TST has no stop loss.');
    // Partial stops sell some on the way down, but not the rest.
    const someStops = buildPlan({ ...presetToInput(DEFAULT_PRESETS[0], { key: KEY, address: 'COIN', networkId: SOL, symbol: 'TST', name: 'Test Coin', priceUSD: 0.002, mc: 2_000_000, balance: 4_000 }, 'manual'), stops: [{ trigger: { kind: 'mc', value: 1_500_000 }, sellPct: 10 }], sl: null, id: 'p1', now: T0 - 3600_000 });
    expect(protectBuy(input(filled({}, 6_000), [someStops], { balance: 10_000 })).order.attention).toBe('Your guard on $TST has no stop loss for the rest.');
    // A plan saved before partial stops existed (no `stops` list).
    const legacy: Partial<Plan> = { ...plan('manual', T0 - 3600_000), sl: null };
    delete legacy.stops;
    expect(protectBuy(input(filled({}, 6_000), [legacy as Plan], { balance: 10_000 })).order.attention).toBe('Your guard on $TST has no stop loss.');
  });

  it('never arms a guard priced far from the market (a lagging balance can make a fill look nearly free)', () => {
    const cheap = filled({}, 6_000);
    const res = protectBuy(input({ ...cheap, fillPrice: PRICE / 100 }));
    expect(res.plans[res.armed!.id].entry.priceUSD).toBeCloseTo(PRICE);
    expect(res.text).toMatch(/Measured from today.s price/);
  });

  it('replaces a fresh auto-guard plan, averaging the coins it guarded into the entry', () => {
    const auto = plan('auto-guard', NOW - 60_000, 'auto', 4_000); // 4,000 coins at $0.002
    const res = protectBuy(input(filled({}, 6_000), [auto], { balance: 10_000 }));
    expect(res.plans.auto.state).toBe('cancelled');
    const p = res.plans[res.armed!.id];
    expect(p.state).toBe('armed');
    expect(p.origBalance).toBe(10_000);
    expect(p.entry.priceUSD).toBeCloseTo((4_000 * 0.002 + 10) / 10_000);
  });

  it('happens once per order', () => {
    const first = protectBuy(input(filled()));
    const again = protectBuy(input(first.order, Object.values(first.plans)));
    expect(again.armed).toBeNull();
    expect(again.text).toBeNull();
    expect(again.order).toBe(first.order);
  });

  it("won't guess the bag size when the balance read is missing — it says so instead", () => {
    const res = protectBuy(input(filled({}, 6_000), [], { balance: null }));
    expect(res.armed).toBeNull();
    expect(res.order.attention).toMatch(/couldn't see your new/);
  });

  it('uses the price Tippy expected when you confirmed the buy yourself', () => {
    // "It bought" after an unknown: no fill price, but Tippy knows what it expected to get.
    let o = prepareBuy(markBuyExecuting(queuedBuy().order, T0), 0, 10 / PRICE, T0);
    o = applyBuyOutcome(o, { status: 'unknown' }, T0);
    o = { ...o, state: 'filled', filledAt: NOW };
    const res = protectBuy(input(o, [], { balance: 6_200 }));
    expect(res.plans[res.armed!.id].entry.priceUSD).toBeCloseTo(PRICE);
  });

  it("says so (and doesn't guess) when it can't guard", () => {
    const noPreset = protectBuy(input(filled({ guardPresetId: 'deleted' })));
    expect(noPreset.armed).toBeNull();
    expect(noPreset.order.planId).toBeNull();
    expect(noPreset.order.attention).toMatch(/preset is gone/);
    // …and only once.
    expect(protectBuy(input(noPreset.order)).text).toBeNull();

    const { order } = queuedBuy();
    const unseen = applyBuyOutcome(markBuyExecuting(order, T0), { status: 'filled', got: null, price: null }, T0);
    const blind = protectBuy(input(unseen, [], { balance: null }));
    expect(blind.armed).toBeNull();
    expect(blind.order.attention).toMatch(/couldn't see your new \$TST coins/);
  });
});

