// What the window's buttons do in the background: place / cancel / settle a
// limit buy, pause everything, and run a practice — against a fake fomo.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('wxt/browser', async () => ({ browser: (await import('./background.fakes')).fakeBrowser }));
vi.mock('../src/shared/store', async () => (await import('./background.fakes')).fakeStore);
vi.mock('../src/shared/alerts', async () => (await import('./background.fakes')).fakeAlerts);
vi.mock('../src/background/relay', async () => (await import('./background.fakes')).fakeRelayModule);
vi.mock('../src/background/runtime', () => ({ kick: () => {} }));

import { handleCommand } from '../src/background/commands';
import { applyBuyOutcome, markBuyExecuting, prepareBuy } from '../src/engine/buys';
import { applyOutcome, buildPlan, markExecuting } from '../src/engine/orders';
import type { BuyInput, LevelRef, Plan, SellAction } from '../src/engine/types';
import { DEFAULT_STATUS } from '../src/shared/messages';
import { buyInput, DESK, KEY, queuedBuy, resetWorld, setCash, setCoins, setPrice, settingsWith, SOL, T0, world } from './background.fakes';

const PRICE = 0.0016;

function seed() {
  world.storage = { settings: settingsWith(), status: { ...DEFAULT_STATUS, health: 'watching', deskTabId: DESK }, plans: {}, buys: {}, queue: [], baseline: { [KEY]: 0 } };
}

function armInput(over: Partial<BuyInput> = {}): Omit<BuyInput, 'id' | 'now'> {
  const { id: _id, now: _now, ...rest } = buyInput(over);
  return rest;
}

beforeEach(() => {
  vi.useFakeTimers({ now: T0 });
  resetWorld();
  setPrice(PRICE);
  setCash(100);
  seed();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('ARM_BUY', () => {
  it('places an armed order', async () => {
    const res = await handleCommand({ type: 'ARM_BUY', input: armInput() });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.buy).toMatchObject({ state: 'armed', direction: 'down', usd: 10, guardPresetId: 'classic' });
    expect(world.storage.buys![res.buy!.id]).toEqual(res.buy);
  });

  it("refuses less than fomo's minimum on that chain", async () => {
    world.storage.status = { ...world.storage.status!, minBuyUsd: { [String(SOL)]: 5 } };
    const res = await handleCommand({ type: 'ARM_BUY', input: armInput({ usd: 3 }) });
    expect(res).toEqual({ ok: false, error: "fomo's minimum buy here is $5.00." });
    expect(world.storage.buys).toEqual({});
  });

  it('refuses a guard preset that no longer exists', async () => {
    const res = await handleCommand({ type: 'ARM_BUY', input: armInput({ guardPresetId: 'gone' }) });
    expect(res.ok).toBe(false);
    expect(world.storage.buys).toEqual({});
  });
});

describe('CANCEL_BUY', () => {
  it('cancels the order and takes it out of the queue (sells stay)', async () => {
    const { order, action } = queuedBuy();
    const sell = { type: 'sell', planId: 'p1', key: 'X:1', level: { kind: 'sl' } } as SellAction;
    world.storage.buys = { [order.id]: order };
    world.storage.queue = [sell, action];
    const res = await handleCommand({ type: 'CANCEL_BUY', orderId: order.id });
    expect(res.ok && res.buy?.state).toBe('cancelled');
    expect(world.storage.queue).toEqual([sell]);
  });

  it('says so when the order is gone', async () => {
    expect(await handleCommand({ type: 'CANCEL_BUY', orderId: 'nope' })).toEqual({ ok: false, error: 'That order is gone.' });
  });
});

describe('RESOLVE_BUY', () => {
  function unknownBuy() {
    let o = prepareBuy(markBuyExecuting(queuedBuy().order, T0), 0, 10 / PRICE, T0);
    o = applyBuyOutcome(o, { status: 'unknown' }, T0);
    world.storage.buys = { [o.id]: o };
    return o;
  }

  it('"It bought": marks it bought and guards what is really in your wallet', async () => {
    const o = unknownBuy();
    setCoins(6_100);
    const res = await handleCommand({ type: 'RESOLVE_BUY', orderId: o.id, bought: true });
    expect(res.ok).toBe(true);
    const settled = world.storage.buys![o.id];
    expect(settled.state).toBe('filled');
    const plan = world.storage.plans![settled.planId!];
    expect(plan.origBalance).toBe(6_100);
    expect(plan.entry.priceUSD).toBeCloseTo(PRICE);
    expect(world.storage.baseline![KEY]).toBe(6_100);
  });

  it('"It didn\'t": back to watching (it may buy again), no guard', async () => {
    const o = unknownBuy();
    await handleCommand({ type: 'RESOLVE_BUY', orderId: o.id, bought: false });
    expect(world.storage.buys![o.id]).toMatchObject({ state: 'armed', attempts: 0, balanceBefore: null });
    expect(world.storage.plans).toEqual({});
  });
});

describe('PAUSE_ALL', () => {
  it('withdraws queued buys too', async () => {
    const { order, action } = queuedBuy();
    world.storage.buys = { [order.id]: order };
    world.storage.queue = [action];
    await handleCommand({ type: 'PAUSE_ALL', paused: true });
    expect(world.storage.settings!.paused).toBe(true);
    expect(world.storage.queue).toEqual([]);
    expect(world.storage.buys![order.id].state).toBe('armed');
  });
});

describe('PRACTICE', () => {
  it('runs a practice buy, saves how it went, and returns it', async () => {
    const res = handleCommand({ type: 'PRACTICE', key: KEY, side: 'buy' });
    await vi.runAllTimersAsync();
    const out = await res;
    expect(out.ok).toBe(true);
    expect(out.ok && out.practice).toMatchObject({ ok: true, stage: 'dry-run', side: 'buy', symbol: 'TST' });
    expect(world.storage.practice).toMatchObject({ ok: true, stage: 'dry-run' });
  });

  it('returns the reason when it could not practise (and still saves it)', async () => {
    const res = handleCommand({ type: 'PRACTICE', key: KEY, side: 'sell' });
    await vi.runAllTimersAsync();
    const out = await res;
    expect(out.ok).toBe(false);
    expect(!out.ok && out.error).toMatch(/don't hold any \$TST/);
    expect(world.storage.practice).toMatchObject({ ok: false, stage: 'skipped' });
  });
});

/** A guarded $TST bag with a take-profit, a partial stop and a stop loss. */
function guarded(): Plan {
  return buildPlan({
    id: 'p1',
    key: KEY,
    networkId: SOL,
    address: 'COIN',
    symbol: 'TST',
    name: 'Test Coin',
    entry: { priceUSD: PRICE, mc: PRICE * 1e9, source: 'manual' },
    balance: 100_000,
    tps: [{ trigger: { kind: 'x', value: 2 }, sellPct: 50 }],
    stops: [{ trigger: { kind: 'mc', value: 1_200_000 }, sellPct: 10 }],
    sl: { trigger: { kind: 'x', value: 0.5 } },
    trailing: null,
    origin: 'manual',
    now: T0,
  });
}

describe('partial stops through the commands', () => {
  it('RESOLVE_HELD: "sell the rest" only ever for a stop loss / trailing stop', async () => {
    const plan = guarded();
    plan.stops[0].status = 'held'; // never happens — but if it did, "yes" must not sell everything
    world.storage.plans = { p1: plan };
    const res = await handleCommand({ type: 'RESOLVE_HELD', planId: 'p1', level: { kind: 'stop', id: 'st1' }, sell: true });
    expect(res.ok).toBe(false);
    expect(world.storage.queue).toEqual([]);
    expect(world.storage.plans!.p1.stops[0].status).toBe('held');
  });

  it('RESOLVE_HELD: a held stop loss is queued to sell the rest; one that isn\'t held queues nothing', async () => {
    const plan = guarded();
    plan.sl!.status = 'held';
    world.storage.plans = { p1: plan };
    await handleCommand({ type: 'RESOLVE_HELD', planId: 'p1', level: { kind: 'sl' }, sell: true });
    expect(world.storage.queue).toMatchObject([{ type: 'sell', level: { kind: 'sl' }, targetRemaining: 0, consented: true }]);
    expect(world.storage.plans!.p1.sl!.status).toBe('queued');

    world.storage.queue = [];
    await handleCommand({ type: 'RESOLVE_HELD', planId: 'p1', level: { kind: 'sl' }, sell: true }); // already queued: a second tap
    expect(world.storage.queue).toEqual([]);
  });

  it('RETRY_LEVEL works on a partial stop', async () => {
    const plan = guarded();
    Object.assign(plan.stops[0], { status: 'blocked', clickedAt: T0 - 60_000, attempts: 3 });
    plan.attention = 'check fomo';
    world.storage.plans = { p1: plan };
    const res = await handleCommand({ type: 'RETRY_LEVEL', planId: 'p1', level: { kind: 'stop', id: 'st1' } });
    expect(res.ok).toBe(true);
    expect(world.storage.plans!.p1.stops[0]).toMatchObject({ status: 'waiting', attempts: 0, clickedAt: null });
  });

  it('UPDATE_PLAN moves a partial stop, and an edit without stops leaves them alone', async () => {
    world.storage.plans = { p1: guarded() };
    const moved = await handleCommand({
      type: 'UPDATE_PLAN',
      planId: 'p1',
      edit: { tps: [{ id: 'tp1', trigger: { kind: 'x', value: 2 }, sellPct: 50 }], stops: [{ id: 'st1', trigger: { kind: 'mc', value: 1_100_000 }, sellPct: 10 }], sl: { trigger: { kind: 'x', value: 0.5 } }, trailing: null },
    });
    expect(moved.ok).toBe(true);
    expect(world.storage.plans!.p1.stops).toMatchObject([{ id: 'st1', trigger: { kind: 'mc', value: 1_100_000 }, sellPct: 10 }]);

    const old = await handleCommand({ type: 'UPDATE_PLAN', planId: 'p1', edit: { tps: [{ id: 'tp1', trigger: { kind: 'x', value: 3 }, sellPct: 50 }], sl: { trigger: { kind: 'x', value: 0.5 } }, trailing: null } });
    expect(old.ok).toBe(true);
    expect(world.storage.plans!.p1.stops).toMatchObject([{ id: 'st1', trigger: { kind: 'mc', value: 1_100_000 } }]);
  });
});

describe('SET_SETTINGS: going live after a dry run', () => {
  const st1: LevelRef = { kind: 'stop', id: 'st1' };
  /** The partial stop "sold" in a dry run: the take-profit was re-sized as if 10% had really gone. */
  function dryFilled(): Plan {
    const plan = guarded();
    plan.stops[0].ticksBelow = 2;
    return applyOutcome(markExecuting(plan, st1, T0), st1, { status: 'filled', balanceAfter: null, dryRun: true }, T0);
  }

  it('puts the levels a dry run "sold" back to watching, sized on the real bag', async () => {
    const plan = dryFilled();
    expect(plan.tps[0].targetRemaining).toBe(40_000);
    world.storage.settings = settingsWith({ dryRun: true });
    world.storage.plans = { p1: plan };
    expect(await handleCommand({ type: 'SET_SETTINGS', patch: { dryRun: false } })).toEqual({ ok: true });
    expect(world.storage.settings!.dryRun).toBe(false);
    const p = world.storage.plans!.p1;
    expect(p.stops[0]).toMatchObject({ status: 'waiting', ticksBelow: 0, attempts: 0, targetRemaining: 90_000 });
    expect(p.stops[0].dryRun).toBeUndefined();
    expect(p.tps[0].targetRemaining).toBe(50_000);
    expect(p.history.at(-1)?.kind).toBe('rescaled');
  });

  it('leaves plans without dry-run fills — and every plan when dry run stays on or was already off — untouched', async () => {
    const clean = guarded();
    world.storage.settings = settingsWith({ dryRun: true });
    world.storage.plans = { p1: clean };
    await handleCommand({ type: 'SET_SETTINGS', patch: { dryRun: false } });
    expect(world.storage.plans!.p1).toEqual(clean);

    const dry = dryFilled();
    world.storage.plans = { p1: dry };
    world.storage.settings = settingsWith({ dryRun: false });
    await handleCommand({ type: 'SET_SETTINGS', patch: { dryRun: false } });
    expect(world.storage.plans!.p1).toEqual(dry);
    world.storage.settings = settingsWith({ dryRun: true });
    await handleCommand({ type: 'SET_SETTINGS', patch: { dryRun: true, notifications: true } });
    expect(world.storage.plans!.p1).toEqual(dry);
  });
});
