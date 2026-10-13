// Tippy's tick loop with limit buys, against a fake fomo: coins with a buy
// order are watched, a level that holds fires the buy through the queue, a
// buy left mid-way by a restart is never re-pressed, and auto-guard stays out
// of coins a buy is protecting itself.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('wxt/browser', async () => ({ browser: (await import('./background.fakes')).fakeBrowser }));
vi.mock('../src/shared/store', async () => (await import('./background.fakes')).fakeStore);
vi.mock('../src/shared/alerts', async () => (await import('./background.fakes')).fakeAlerts);
vi.mock('../src/background/relay', async () => (await import('./background.fakes')).fakeRelayModule);

import { applyBuyOutcome, buildBuy, markBuyExecuting, prepareBuy } from '../src/engine/buys';
import { buildPlan } from '../src/engine/orders';
import type { BuyInput, BuyOrder, Plan, PlanInput } from '../src/engine/types';
import { DEFAULT_STATUS } from '../src/shared/messages';
import type { Settings } from '../src/shared/settings';
import { buyInput, coins, execRequests, fillsOnPress, KEY, queuedBuy, quoteAt, resetWorld, setCash, setCoins, setPrice, settingsWith, SOL, T0, world } from './background.fakes';

const AT_LEVEL = 0.00155;
const ABOVE = 0.0019;

let runtime: typeof import('../src/background/runtime');

beforeEach(async () => {
  vi.useFakeTimers({ now: T0 });
  vi.stubGlobal('fetch', async () => ({ ok: false })); // kill-switch check: offline
  resetWorld();
  setCash(100);
  vi.resetModules(); // a fresh worker: no balances, no running trade
  runtime = await import('../src/background/runtime');
});

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function seed(buys: BuyOrder[], settings: Partial<Settings> = {}) {
  world.storage = {
    settings: settingsWith(settings),
    status: { ...DEFAULT_STATUS },
    plans: {},
    buys: Object.fromEntries(buys.map((o) => [o.id, o])),
    queue: [],
  };
}

const stored = (id = 'b1') => world.storage.buys![id];
const titles = () => world.alerts.map((a) => a.title);
const plansFor = (key: string) => Object.values(world.storage.plans!).filter((p) => p.key === key);

/** Start the loop and let `ms` of (fake) time pass. */
async function run(ms: number) {
  runtime.kick();
  await vi.advanceTimersByTimeAsync(ms);
}

function planBase(): Omit<PlanInput, 'tps'> {
  return {
    id: 'p1',
    key: KEY,
    networkId: SOL,
    address: 'COIN',
    symbol: 'TST',
    name: 'Test',
    entry: { priceUSD: AT_LEVEL, mc: AT_LEVEL * 1e9, source: 'manual' },
    balance: 1_000,
    sl: null,
    trailing: null,
    origin: 'manual',
    now: T0,
  };
}

/** 1,000 $TST: 50% at 2x, then 25% (or the rest) at 5x. */
function tpPlan(over: Partial<PlanInput> = {}): Plan {
  return buildPlan({
    ...planBase(),
    tps: [
      { trigger: { kind: 'x', value: 2 }, sellPct: 50 },
      { trigger: { kind: 'x', value: 5 }, sellPct: over.sl ? 25 : 50 },
    ],
    ...over,
  });
}

describe('the tick loop with limit buys', () => {
  it('watches the coin, buys once the dip holds, guards the coins — and auto-guard keeps out', async () => {
    seed([buildBuy(buyInput())], { autoGuard: { enabled: true, includeExisting: false } });
    setPrice(ABOVE);
    world.exec = fillsOnPress();

    await run(10);
    expect(world.requests.some((r) => r.req.type === 'QUOTES' && r.req.keys.includes(KEY))).toBe(true);
    expect(world.storage.status).toMatchObject({ health: 'watching', message: 'Watching 1 coin.' });
    expect(stored().state).toBe('armed');

    setPrice(AT_LEVEL);
    await vi.advanceTimersByTimeAsync(3_000);
    expect(stored()).toMatchObject({ state: 'armed', ticksAt: 1 }); // one tick at the level isn't enough
    expect(execRequests()).toHaveLength(0);

    await vi.advanceTimersByTimeAsync(60_000);
    const o = stored();
    expect(o.state).toBe('filled');
    expect(execRequests()).toHaveLength(1);
    // Exactly one guard on the coin: the preset the buy picked (not an auto-guard one).
    expect(plansFor(KEY)).toHaveLength(1);
    expect(plansFor(KEY)[0]).toMatchObject({ id: o.planId, origin: 'manual', state: 'armed' });
    expect(titles()).toContain('Tippy filled order');
    expect(world.alerts.find((a) => a.title === 'Tippy filled order')!.text).toMatch(/^Tippy bought \$10 at .* on \$TST\./);
    expect(titles()).not.toContain('🛡️ Tippy is guarding $TST');
  });

  it("a coin you're waiting to buy isn't 'missing' — so its new guard isn't mistaken for sold", async () => {
    seed([buildBuy(buyInput())]);
    setPrice(ABOVE);
    world.exec = fillsOnPress();
    const { presence } = await import('../src/background/presence'); // this worker's instance
    await run(45_000); // several clean balance reads without the coin
    expect(presence.gone(KEY, Date.now())).toBe(false);

    setPrice(AT_LEVEL);
    await vi.advanceTimersByTimeAsync(90_000);
    expect(stored().state).toBe('filled');
    expect(plansFor(KEY)).toMatchObject([{ state: 'armed' }]);
    expect(titles()).not.toContain('👀 Tippy stopped guarding $TST');
  });

  it('never buys while paused', async () => {
    seed([buildBuy(buyInput())], { paused: true });
    setPrice(AT_LEVEL);
    await run(30_000);
    expect(stored()).toMatchObject({ state: 'armed', ticksAt: 0 });
    expect(execRequests()).toHaveLength(0);
    expect(world.storage.status!.health).toBe('paused');
  });

  it('a buy left mid-way by a restart is never re-pressed; its coins showing up confirm it', async () => {
    const { order } = queuedBuy();
    const midway = prepareBuy(markBuyExecuting(order, T0 - 5_000), 0, 10 / AT_LEVEL, T0 - 4_000);
    seed([midway]);
    setPrice(AT_LEVEL);

    await run(10);
    expect(stored().state).toBe('unknown');
    expect(titles()).toEqual(['🤔 Checking your $TST buy']);

    setCoins((10 / AT_LEVEL) * 0.97); // fomo's balances catch up
    await vi.advanceTimersByTimeAsync(12_000);
    const o = stored();
    expect(o.state).toBe('filled');
    expect(o.got).toBeCloseTo((10 / AT_LEVEL) * 0.97);
    expect(plansFor(KEY)).toHaveLength(1);
    expect(titles()).toContain('Tippy filled order');
    expect(execRequests()).toHaveLength(0);
  });

  it("auto-guard leaves coins alone while a buy with a guard preset owns them", async () => {
    const { order } = queuedBuy();
    const unknown = applyBuyOutcome(prepareBuy(markBuyExecuting(order, T0 - 5_000), 0, 10 / AT_LEVEL, T0 - 4_000), { status: 'unknown' }, T0 - 3_000);
    seed([unknown], { autoGuard: { enabled: true, includeExisting: false } });
    world.storage.baseline = { [KEY]: 0 };
    setPrice(AT_LEVEL);
    setCoins((10 / AT_LEVEL) * 0.4); // something arrived, but not enough to call it this buy
    await run(20_000);
    expect(stored().state).toBe('unknown');
    expect(plansFor(KEY)).toHaveLength(0);
  });

  it('…and a buy with "None" means none: auto-guard leaves those coins alone too', async () => {
    const { order } = queuedBuy({ guardPresetId: null });
    const unknown = applyBuyOutcome(prepareBuy(markBuyExecuting(order, T0 - 5_000), 0, 10 / AT_LEVEL, T0 - 4_000), { status: 'unknown' }, T0 - 3_000);
    seed([unknown], { autoGuard: { enabled: true, includeExisting: false } });
    world.storage.baseline = { [KEY]: 0 };
    setPrice(AT_LEVEL);
    setCoins((10 / AT_LEVEL) * 0.4);
    await run(20_000);
    expect(plansFor(KEY)).toEqual([]);
  });

  it('a queued order that lost its place in the queue goes back to watching', async () => {
    const { order } = queuedBuy();
    seed([order]); // queue is empty
    setPrice(ABOVE);
    await run(10);
    expect(stored()).toMatchObject({ state: 'armed', queuedAt: null });
  });

  it('keeps the computer awake while any order is on — by default — and lets it sleep when none are', async () => {
    seed([buildBuy(buyInput({ expiresInMs: 5_000 } as Partial<BuyInput>))]);
    setPrice(ABOVE);
    await run(3_000);
    expect(world.power).toEqual(['system']);
    await run(7_000); // the order expires: nothing left to watch
    expect(stored().state).toBe('expired');
    expect(world.power).toEqual(['system', 'release']);
  });

  it("doesn't keep the computer awake when the user turned it off", async () => {
    seed([buildBuy(buyInput())], { stayAwake: false });
    setPrice(ABOVE);
    await run(5_000);
    expect(world.power).toEqual([]);
  });

  it('counts buys in the heartbeat and the health text', async () => {
    const other = `OTHER:${SOL}`;
    world.quotes[other] = quoteAt(0.01, 500_000, other);
    const plan = buildPlan({
      id: 'p1',
      key: other,
      networkId: SOL,
      address: 'OTHER',
      symbol: 'OTH',
      name: 'Other',
      entry: { priceUSD: 0.01, mc: 1e7, source: 'manual' },
      balance: 1_000,
      tps: [{ trigger: { kind: 'x', value: 2 }, sellPct: 100 }],
      sl: null,
      trailing: null,
      origin: 'manual',
      now: T0,
    });
    seed([buildBuy(buyInput())]);
    world.storage.plans = { p1: plan };
    setPrice(ABOVE);
    await run(10);
    expect(world.heartbeats).toEqual([2]);
    expect(world.storage.status!.message).toBe('Watching 2 coins.');
  });

  it('a sell that only shows up in your balance later still tells you it filled — once', async () => {
    const plan = tpPlan();
    // Tippy pressed Sell for TP1, but fomo's balance hadn't moved yet.
    Object.assign(plan.tps[0], { status: 'unknown', executingAt: T0 - 5_000, clickedAt: T0 - 5_000, attempts: 1 });
    seed([]);
    world.storage.plans = { p1: plan };
    world.storage.baseline = { [KEY]: 500 };
    setPrice(AT_LEVEL * 2.1);
    setCoins(500); // …now it has
    await run(10_000);
    expect(world.storage.plans!.p1.tps[0].status).toBe('filled');
    const fills = world.alerts.filter((a) => a.title === 'Tippy filled order');
    expect(fills).toHaveLength(1);
    expect(fills[0].text).toMatch(/^Tippy sold 50% of \$TST at \$[\d.]+[KM] MC \(take-profit 1\)\.$/);
  });

  it("a press more than 30 minutes ago that only now shows up isn't claimed as Tippy's fill", async () => {
    const plan = tpPlan();
    Object.assign(plan.tps[0], { status: 'blocked', executingAt: T0 - 31 * 60_000, clickedAt: T0 - 31 * 60_000, attempts: 1 });
    seed([]);
    world.storage.plans = { p1: plan };
    world.storage.baseline = { [KEY]: 500 };
    setPrice(AT_LEVEL * 2.1);
    setCoins(500);
    await run(10_000);
    expect(world.storage.plans!.p1.tps[0].status).toBe('filled');
    expect(world.notices).toEqual([{ key: KEY, title: 'Tippy order update', text: 'Your take-profit 1 on $TST looks sold — your balance dropped.', tone: 'info' }]);
  });

  it('a level that went along with a late sell counts toward its % — no notice of its own', async () => {
    const plan = tpPlan({ sl: { trigger: { kind: 'x', value: 0.5 } } });
    // TP1 gave up before anything was pressed; TP2 was pressed but not confirmed.
    Object.assign(plan.tps[0], { status: 'blocked', clickedAt: null, attempts: 3 });
    Object.assign(plan.tps[1], { status: 'unknown', executingAt: T0 - 5_000, clickedAt: T0 - 5_000, attempts: 1 });
    seed([]);
    world.storage.plans = { p1: plan };
    world.storage.baseline = { [KEY]: 0 };
    setPrice(AT_LEVEL * 5.1);
    setCoins(250); // TP2's target: 50% + 25% sold
    await run(10_000);
    const tps = world.storage.plans!.p1.tps;
    expect(tps.map((t) => t.status)).toEqual(['filled', 'filled']);
    const fills = world.alerts.filter((a) => a.title === 'Tippy filled order');
    expect(fills).toHaveLength(1);
    expect(fills[0].text).toMatch(/^Tippy sold 75% of \$TST at \$[\d.]+[KM] MC \(take-profit 2\)\.$/);
  });

  it("a partial stop below fomo's minimum is skipped — and the alert quotes this tick's note, not an old one", async () => {
    // $HIGGS-style: a $4.98 bag at $719K MC, "sell 10% at 700k".
    const price = 0.000719;
    const bag = 4.98 / price;
    const plan = buildPlan({
      ...planBase(),
      entry: { priceUSD: price, mc: price * 1e9, source: 'manual' },
      balance: bag,
      tps: [],
      stops: [{ trigger: { kind: 'mc', value: 700_000 }, sellPct: 10 }],
    });
    plan.history.push({ at: T0 - 60_000, kind: 'too-small', text: 'An old note.' });
    seed([]);
    world.storage.plans = { p1: plan };
    world.storage.baseline = { [KEY]: bag };
    setPrice(0.0007);
    setCoins(bag);
    await run(10_000);
    expect(execRequests()).toHaveLength(0);
    expect(world.storage.plans!.p1.stops[0].status).toBe('cancelled');
    // A pop-up on fomo's page (like a fill), not just a desktop / Telegram alert — once.
    const text = "Your stop at $700K mc on $TST would sell $0.48 — below fomo's $2 minimum, so Tippy skipped it.";
    expect(world.notices).toEqual([{ key: KEY, title: 'Tippy skipped a stop', text, tone: 'stop' }]);
    expect(world.alerts.find((a) => a.title === 'Tippy skipped a stop')?.dedupeKey).toBe(`small:p1:${text}`);
  });

  it('a partial stop goes all the way through: the drop holds, Tippy sells exactly its 10%, the plan keeps guarding the rest', async () => {
    // 100,000 $TST ($155) at $1.55M MC: TP 50% at 2x, a 10% stop at $1.4M MC, and a stop loss at −50%.
    const plan = tpPlan({ balance: 100_000, tps: [{ trigger: { kind: 'x', value: 2 }, sellPct: 50 }], stops: [{ trigger: { kind: 'mc', value: 1_400_000 }, sellPct: 10 }], sl: { trigger: { kind: 'x', value: 0.5 } } });
    seed([]);
    world.storage.plans = { p1: plan };
    world.storage.baseline = { [KEY]: 100_000 };
    world.exec = (req) => {
      if (req.type !== 'EXECUTE') throw new Error('expected a sell');
      setCoins(coins() - (req.action.sellPctOfCurrent >= 99.5 ? coins() : req.action.sellAmount!));
      return { stage: 'submitted', clicked: true, sold: true, detail: 'Sold' };
    };
    setPrice(AT_LEVEL);
    setCoins(100_000);
    await run(10);
    expect(execRequests()).toHaveLength(0);

    setPrice(0.00138); // $1.38M MC: under the stop, well above the stop loss
    setCoins(100_000);
    await vi.advanceTimersByTimeAsync(60_000);
    const sells = execRequests().filter((r) => r.type === 'EXECUTE');
    expect(sells).toHaveLength(1);
    expect(sells[0].action).toMatchObject({ level: { kind: 'stop', id: 'st1' }, targetRemaining: 90_000 });
    expect(sells[0].action.sellAmount).toBeCloseTo(10_000, 6);
    expect(sells[0].action.sellPctOfCurrent).toBeCloseTo(10, 6); // never fomo's 100%
    expect(coins()).toBeCloseTo(90_000, 6);
    const p = world.storage.plans!.p1;
    expect(p.state).toBe('armed');
    expect(p.stops[0].status).toBe('filled');
    expect(p.tps[0].targetRemaining).toBeCloseTo(40_000, 6); // the take-profit still sells 50% of the original bag
    expect(p.sl!.status).toBe('waiting');
    const fills = world.alerts.filter((a) => a.title === 'Tippy filled order');
    expect(fills).toHaveLength(1);
    expect(fills[0].text).toMatch(/^Stop hit — Tippy sold 10% of \$TST at \$[\d.]+[KM] MC \(stop 1\)\.$/);
  });

  it('a plan saved by the previous version (no `stops` list) keeps working: its stop loss still sells the rest', async () => {
    const plan: Partial<Plan> = tpPlan({ balance: 100_000, sl: { trigger: { kind: 'x', value: 0.8 } } });
    delete plan.stops;
    seed([]);
    world.storage.plans = { p1: plan as Plan };
    world.storage.baseline = { [KEY]: 100_000 };
    world.exec = (req) => {
      if (req.type !== 'EXECUTE') throw new Error('expected a sell');
      setCoins(0);
      return { stage: 'submitted', clicked: true, sold: true, detail: 'Sold' };
    };
    setPrice(AT_LEVEL);
    setCoins(100_000);
    await run(10);
    expect(world.storage.plans!.p1.state).toBe('armed');

    setPrice(AT_LEVEL * 0.7);
    setCoins(100_000);
    await vi.advanceTimersByTimeAsync(60_000);
    const sells = execRequests().filter((r) => r.type === 'EXECUTE');
    expect(sells).toHaveLength(1);
    expect(sells[0].action).toMatchObject({ level: { kind: 'sl' }, sellPctOfCurrent: 100 });
    const p = world.storage.plans!.p1;
    expect(p.state).toBe('done');
    expect(p.stops).toEqual([]);
    expect(world.alerts.find((a) => a.title === 'Tippy filled order')?.text).toMatch(/^Stop loss hit — Tippy sold the rest of \$TST/);
  });

  it('tells you when a buy expires', async () => {
    seed([buildBuy(buyInput({ expiresInMs: 5_000 } as Partial<BuyInput>))]);
    setPrice(ABOVE);
    await run(7_000);
    expect(stored().state).toBe('expired');
    expect(titles()).toEqual(['Tippy order expired']);
    expect(world.alerts[0].text).toMatch(/^Your \$10 limit buy on \$TST at .+ expired — the price never got there\.$/);
  });
});
