// The one-at-a-time trade queue, driven against a fake fomo: limit buys (one
// press at most, fills confirmed by your balance, new coins guarded), practice
// runs (never press, never verify, never overlap a trade), and sells still
// going through the shared queue.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('wxt/browser', async () => ({ browser: (await import('./background.fakes')).fakeBrowser }));
vi.mock('../src/shared/store', async () => (await import('./background.fakes')).fakeStore);
vi.mock('../src/shared/alerts', async () => (await import('./background.fakes')).fakeAlerts);
vi.mock('../src/background/relay', async () => (await import('./background.fakes')).fakeRelayModule);

import { practice, processQueue } from '../src/background/queue';
import { cancelBuy } from '../src/engine/buys';
import { buildPlan, evaluate } from '../src/engine/orders';
import type { BuyOrder, Plan, PlanInput, SellAction } from '../src/engine/types';
import { DEFAULT_STATUS, type ExecResult, type PracticeResult } from '../src/shared/messages';
import type { Settings } from '../src/shared/settings';
import {
  cash,
  coins,
  DESK,
  execRequests,
  fakeBrowser,
  fillsOnPress,
  KEY,
  queuedBuy,
  resetWorld,
  setCash,
  setCoins,
  setPrice,
  settingsWith,
  SOL,
  SUPPLY,
  T0,
  world,
  type World,
} from './background.fakes';

const AT_LEVEL = 0.00155; // $1.55M MC — just under the $1.6M level

function seedBuy(opts: { settings?: Partial<Settings>; cash?: number; order?: Parameters<typeof queuedBuy>[0] } = {}): BuyOrder {
  const { order, action } = queuedBuy(opts.order);
  world.storage = {
    settings: settingsWith(opts.settings),
    status: { ...DEFAULT_STATUS, health: 'watching', deskTabId: DESK },
    plans: {},
    buys: { [order.id]: order },
    queue: [action],
    baseline: { [KEY]: 0 },
  };
  setCash(opts.cash ?? 100);
  return order;
}

const stored = (id = 'b1') => world.storage.buys![id];

/** Let the queue run to the end (fake clock: the 45s balance check takes no real time). */
async function drain() {
  const done = processQueue();
  await vi.runAllTimersAsync();
  await done;
}

async function runPractice(side: 'sell' | 'buy', usd?: number): Promise<PracticeResult> {
  const p = practice(KEY, side, usd);
  await vi.runAllTimersAsync();
  return p;
}

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

beforeEach(() => {
  vi.useFakeTimers({ now: T0 });
  resetWorld();
  setPrice(AT_LEVEL);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('limit buys', () => {
  it('buys once, confirms by your balance, and guards the new coins with your preset', async () => {
    seedBuy();
    world.exec = fillsOnPress();
    await drain();

    const buys = execRequests();
    expect(buys).toHaveLength(1);
    const req = buys[0];
    expect(req.type).toBe('EXECUTE_BUY');
    if (req.type !== 'EXECUTE_BUY') return;
    expect(req.action.usd).toBe(10);
    expect(req.options).toMatchObject({ dryRun: false, maxImpactPct: 10, failClosedOnUnknownImpact: true, symbol: 'TST', focused: false });
    expect(req.options.practice).toBeFalsy();
    expect(req.options.estimatedImpactPct).toBeCloseTo(0.01, 2);

    const o = stored();
    expect(o.state).toBe('filled');
    expect(o.balanceBefore).toBe(0);
    expect(o.expectedAmount).toBeCloseTo(10 / AT_LEVEL);
    expect(o.got).toBeCloseTo(coins());
    expect(o.fillPrice).toBeCloseTo(10 / coins());

    // Guarded with the order's preset, sized on the coins that arrived.
    const plan = world.storage.plans![o.planId!];
    expect(plan.origin).toBe('manual');
    expect(plan.origBalance).toBeCloseTo(coins());
    expect(plan.tps.map((t) => t.trigger.value)).toEqual([2, 5]);
    expect(world.storage.baseline![KEY]).toBeCloseTo(coins());

    expect(world.alerts.map((a) => a.title)).toEqual(['Tippy filled order']);
    expect(world.alerts[0].text).toBe('Tippy bought $10 at $1.6M MC on $TST. Guarding it with ⭐ Classic.');
    expect(world.notices).toMatchObject([{ key: KEY, title: 'Tippy filled order', tone: 'good' }]);
    // The trade tab was opened on the coin, marked, in the background — and closed.
    expect(world.tabsOpened).toEqual(['https://fomo.family/tokens/solana/COIN?tippy=sell']);
    expect(world.tabsClosed).toEqual([100]);
    expect(world.storage.status!.executing).toBeNull();
    expect(world.storage.queue).toEqual([]);
  });

  it('a dry run walks through but buys nothing, and arms no guard', async () => {
    seedBuy({ settings: { dryRun: true } });
    world.exec = (req) => {
      expect(req.options.dryRun).toBe(true);
      return { stage: 'dry-run', clicked: false, detail: 'Ready to buy. Dry run — not clicked.' };
    };
    await drain();
    const o = stored();
    expect(o.state).toBe('filled');
    expect(o.dryRun).toBe(true);
    expect(o.got).toBeNull();
    expect(o.planId).toBeNull();
    expect(world.storage.plans).toEqual({});
    expect(world.alerts.map((a) => a.title)).toEqual(['Tippy filled order (dry run)']);
    expect(world.alerts[0].text).toMatch(/^Dry run — Tippy would have bought \$10 at \$1\.6M MC on \$TST\. Nothing was really bought\.$/);
  });

  it('a balance read that skips a coin you hold is double-checked before it counts as "none"', async () => {
    seedBuy();
    setCoins(1_000_000); // you already hold a big bag
    const held = structuredClone(world.holdings);
    world.balancesSeq = [held.filter((h) => h.key !== KEY), held]; // the first read skips it
    world.exec = fillsOnPress();
    await drain();
    const o = stored();
    expect(o.balanceBefore).toBe(1_000_000);
    expect(o.state).toBe('filled');
    expect(o.fillPrice! / AT_LEVEL).toBeCloseTo(1, 1); // ~the market price (a little slippage), not "nearly free"
  });

  it("won't press when fomo's list keeps skipping a coin you held a moment ago", async () => {
    seedBuy();
    world.storage.baseline = { [KEY]: 1_000_000 };
    await drain();
    expect(world.tabsOpened).toEqual([]);
    expect(stored()).toMatchObject({ state: 'armed' });
    expect(stored().history.at(-1)!.text).toMatch(/skipped your \$TST/);
  });

  it("an earlier press you said didn't buy, landing late, completes the order — Tippy doesn't buy again", async () => {
    seedBuy();
    world.storage.buys = { b1: { ...stored(), priorPress: { balanceBefore: 0, expectedAmount: 10 / AT_LEVEL, at: T0 } } };
    setCoins(10 / AT_LEVEL); // the first buy's coins
    await drain();
    expect(world.tabsOpened).toEqual([]);
    expect(stored().state).toBe('filled');
  });

  it('an order that expires while waiting its turn never buys', async () => {
    seedBuy();
    world.storage.buys = { b1: { ...stored(), expiresAt: T0 - 1 } };
    await drain();
    expect(world.tabsOpened).toEqual([]);
    expect(execRequests()).toHaveLength(0);
  });

  it('pressed but the coins never show up: "unknown", and never pressed again', async () => {
    seedBuy();
    world.exec = () => ({ stage: 'submitted', clicked: true, bought: true, detail: 'Bought' }); // a "Bought" strip, no coins
    await drain();
    const o = stored();
    expect(o.state).toBe('unknown');
    expect(o.attention).toMatch(/balance hasn't changed/);
    expect(world.alerts.map((a) => a.title)).toEqual(['🤔 Checking your $TST buy']);
    // Before: a read without the coin is double-checked (2 reads). After: 15 checks over 45s, then it stopped looking.
    const balanceReads = world.requests.filter((r) => r.req.type === 'BALANCES').length;
    expect(balanceReads).toBe(2 + 15);

    await drain(); // nothing left to do — and the order isn't re-queued
    expect(execRequests()).toHaveLength(1);
  });

  it('a lost reply on a real buy is treated as "may have pressed"', async () => {
    seedBuy();
    world.exec = () => null;
    await drain();
    expect(stored().state).toBe('unknown');
  });

  it('…but in a dry run (which never presses) a lost reply just means "try again"', async () => {
    seedBuy({ settings: { dryRun: true } });
    world.exec = () => null;
    await drain();
    expect(stored()).toMatchObject({ state: 'armed', attempts: 1 });
    expect(stored().history.at(-1)?.text).toMatch(/lost touch with fomo's tab/);
  });

  it("re-checks the price first: if it moved away, it doesn't even open fomo", async () => {
    seedBuy();
    setPrice(0.0019); // back above the $1.6M level
    await drain();
    expect(world.tabsOpened).toEqual([]);
    expect(stored().state).toBe('armed');
    expect(stored().history.at(-1)?.kind).toBe('stale');
  });

  it("won't catch a falling knife that crashed through the level", async () => {
    seedBuy();
    setPrice(0.001); // $1M MC: more than 25% under the level
    await drain();
    expect(world.tabsOpened).toEqual([]);
    expect(stored().state).toBe('armed');
  });

  it('not enough cash: no tab, waits, and tells you', async () => {
    seedBuy({ cash: 4 });
    await drain();
    expect(world.tabsOpened).toEqual([]);
    const o = stored();
    expect(o.state).toBe('armed');
    expect(o.retryAfter).toBeGreaterThan(T0);
    expect(o.attention).toMatch(/Not enough cash on fomo \(you have \$4\.00\)/);
    expect(world.alerts).toMatchObject([{ title: '😟 Tippy needs you: $TST', dedupeKey: 'no-cash:b1' }]);
  });

  it("fomo's panel says insufficient and your cash agrees: no-cash", async () => {
    seedBuy();
    world.exec = () => {
      setCash(3); // spent on the phone meanwhile
      return { stage: 'insufficient-ui', clicked: false, detail: 'Insufficient balance' };
    };
    await drain();
    expect(stored().history.at(-1)?.kind).toBe('no-cash');
    expect(execRequests()).toHaveLength(1);
  });

  it('skips a buy that would move the price more than your limit', async () => {
    seedBuy();
    setPrice(AT_LEVEL, 100); // a $100 pool
    await drain();
    expect(world.tabsOpened).toEqual([]);
    const o = stored();
    expect(o.state).toBe('armed');
    expect(o.attempts).toBe(1);
    expect(o.history.at(-1)?.text).toMatch(/move the price about .*your limit is 10%/);
  });

  it("won't press when it can't read your balance cleanly (it could never confirm the buy)", async () => {
    seedBuy();
    world.unparsed = 1;
    await drain();
    expect(world.tabsOpened).toEqual([]);
    expect(stored().attempts).toBe(1);
  });

  it('remembers the balance before opening fomo, so a restart can still confirm the fill', async () => {
    seedBuy();
    setCoins(1_000);
    world.exec = (req, w) => {
      // Already saved when fomo opens: a worker restart from here on can still confirm the fill.
      expect(stored()).toMatchObject({ state: 'executing', balanceBefore: 1_000 });
      expect(stored().expectedAmount).toBeCloseTo(10 / AT_LEVEL);
      return fillsOnPress()(req, w);
    };
    await drain();
    expect(stored().state).toBe('filled');
    expect(stored().got).toBeCloseTo(coins() - 1_000);
  });

  it('paused while fomo loads: never presses (a buy in progress can be paused, not cancelled)', async () => {
    seedBuy();
    // The user hits Pause all while the trade tab is still opening.
    const realCreate = fakeBrowser.tabs.create;
    const spy = vi.spyOn(fakeBrowser.tabs, 'create').mockImplementation(async (opts) => {
      expect(cancelBuy(world.storage.buys!.b1, T0)).toBe(world.storage.buys!.b1); // ✕ is refused mid-buy
      world.storage.settings = { ...world.storage.settings!, paused: true };
      return realCreate(opts);
    });
    await drain();
    spy.mockRestore();
    expect(execRequests()).toHaveLength(0);
    expect(stored().state).toBe('armed');
    expect(world.tabsClosed).toHaveLength(1);
  });

  it('pause all: queued buys go back to watching, nothing opens', async () => {
    seedBuy({ settings: { paused: true } });
    await drain();
    expect(world.tabsOpened).toEqual([]);
    expect(stored().state).toBe('armed');
    expect(world.storage.queue).toEqual([]);
  });

  it('the kill switch stops buys too', async () => {
    seedBuy();
    world.storage.status = { ...world.storage.status!, health: 'killed' };
    await drain();
    expect(world.tabsOpened).toEqual([]);
    expect(stored().state).toBe('armed');
  });

  it("logged out (fomo's API says so): waits without using up an attempt", async () => {
    seedBuy();
    world.balancesError = { error: 'unauthorized', authFailed: true };
    await drain();
    expect(world.tabsOpened).toEqual([]);
    expect(stored()).toMatchObject({ state: 'armed', attempts: 0 });
    expect(stored().history.at(-1)?.text).toMatch(/logged out/);
  });

  it('only one trade at a time: a sell queued ahead runs first, then the buy', async () => {
    const order = seedBuy({ settings: { dryRun: true } });
    const plan = sellPlan();
    world.storage.plans = { [plan.plan.id]: plan.plan };
    world.storage.queue = [plan.action, ...world.storage.queue!];
    let inFlight = 0;
    world.exec = async () => {
      inFlight++;
      expect(inFlight).toBe(1);
      await new Promise((r) => setTimeout(r, 1_000));
      inFlight--;
      return { stage: 'dry-run', clicked: false, detail: 'dry' };
    };
    await drain();
    expect(execRequests().map((r) => r.type)).toEqual(['EXECUTE', 'EXECUTE_BUY']);
    expect(stored(order.id).state).toBe('filled');
  });
});

/** A plan whose stop loss just fired (a 'sell everything' action). */
function sellPlan(): { plan: Plan; action: SellAction } {
  setCoins(5_000);
  let plan = buildPlan({
    id: 'p1',
    key: KEY,
    networkId: SOL,
    address: 'COIN',
    symbol: 'TST',
    name: 'Test Coin',
    entry: { priceUSD: 0.003, mc: 3_000_000, source: 'manual' },
    balance: 5_000,
    tps: [{ trigger: { kind: 'x', value: 2 }, sellPct: 50 }],
    sl: { trigger: { kind: 'x', value: 0.7 }, confirmTicks: 1 },
    trailing: null,
    origin: 'manual',
    now: T0,
  });
  const r = evaluate(plan, { priceUSD: AT_LEVEL, mc: AT_LEVEL * 1e9, at: T0 }, 5_000, { now: T0, gap: false, gapPolicy: 'sell', minSellUsd: 2, dustUsd: 1 });
  plan = r.plan;
  return { plan, action: r.actions[0] as SellAction };
}

function seedSell(fired: { plan: Plan; action: SellAction }, settings: Partial<Settings> = {}) {
  world.storage = { settings: settingsWith(settings), status: { ...DEFAULT_STATUS, health: 'watching', deskTabId: DESK }, plans: { p1: fired.plan }, buys: {}, queue: [fired.action] };
}

const sellRequests = () => execRequests().filter((r): r is Extract<typeof r, { type: 'EXECUTE' }> => r.type === 'EXECUTE');
const storedPlan = () => world.storage.plans!.p1;

describe('sells still run through the shared queue', () => {
  it('a stop sells everything and closes the plan', async () => {
    seedSell(sellPlan());
    world.exec = (req) => {
      if (req.type !== 'EXECUTE') throw new Error('expected a sell');
      setCoins(0);
      return { stage: 'submitted', clicked: true, sold: true, detail: 'Sold' };
    };
    await drain();
    expect(sellRequests()[0].action).toMatchObject({ level: { kind: 'sl' }, targetRemaining: 0, sellPctOfCurrent: 100 });
    expect(sellRequests()[0].options).toMatchObject({ maxImpactPct: 40, failClosedOnUnknownImpact: false });
    expect(world.storage.plans!.p1.state).toBe('done');
    expect(world.alerts[0].title).toBe('Tippy filled order');
    expect(world.alerts[0].text).toMatch(/^Stop loss hit — Tippy sold the rest of \$TST at \$[\d.]+[KM]? MC\.$|^Stop loss hit — Tippy sold the rest of \$TST at \$0\.\d+\.$/);
  });

  it("a stop loss still sells the rest (fomo's 100%) when the balance can't be read", async () => {
    seedSell(sellPlan());
    world.balancesError = { error: 'timeout' };
    await drain();
    expect(sellRequests()).toHaveLength(1);
    expect(sellRequests()[0].action).toMatchObject({ level: { kind: 'sl' }, sellAmount: null, sellPctOfCurrent: 100 });
  });

  it("a lost reply in a dry run (which never presses) just means \"try again\" — no balance watching", async () => {
    seedSell(sellPlan(), { dryRun: true });
    world.exec = () => null;
    await drain();
    expect(storedPlan().sl).toMatchObject({ status: 'waiting', attempts: 1 });
    expect(storedPlan().history.at(-1)?.text).toMatch(/lost touch with fomo's tab/);
    expect(world.requests.filter((r) => r.req.type === 'BALANCES')).toHaveLength(1); // the read before selling, nothing after
    expect(world.alerts.filter((a) => a.title.startsWith('Tippy filled order'))).toEqual([]);
  });

  it('…but on a real sell a lost reply may have pressed, so Tippy watches the balance', async () => {
    seedSell(sellPlan());
    world.exec = () => null;
    await drain();
    expect(storedPlan().sl!.status).toBe('unknown'); // pressed, not confirmed — never treated as "nothing happened"
    expect(world.requests.filter((r) => r.req.type === 'BALANCES').length).toBeGreaterThan(1);
  });
});

const BAG = 100_000; // tokens
const ENTRY = 0.001; // $1M MC (supply 1e9) — the bag is worth $100
const evalCtx = { now: T0, gap: false, gapPolicy: 'sell' as const, minSellUsd: 2, dustUsd: 1 };

/** A $TST plan whose level fired at `price` (ticked until it did): the queued plan and its sell. */
function firedAt(price: number, over: Partial<PlanInput> = {}, bag = BAG): { plan: Plan; action: SellAction } {
  setPrice(price);
  setCoins(bag);
  let plan = buildPlan({
    id: 'p1',
    key: KEY,
    networkId: SOL,
    address: 'COIN',
    symbol: 'TST',
    name: 'Test Coin',
    entry: { priceUSD: ENTRY, mc: ENTRY * SUPPLY, source: 'manual' },
    balance: bag,
    tps: [],
    stops: [],
    sl: null,
    trailing: null,
    origin: 'manual',
    now: T0,
    ...over,
  });
  for (let i = 0; i < 3; i++) {
    const r = evaluate(plan, { priceUSD: price, mc: price * SUPPLY, at: T0 }, bag, evalCtx);
    plan = r.plan;
    if (r.actions[0]?.type === 'sell') return { plan, action: r.actions[0] };
  }
  throw new Error('nothing fired');
}

/** fomo sells what Tippy asked for (× `fill`, as the price moves while it sells), or everything on 100%. */
function sellsOnPress(fill = 1): World['exec'] {
  return (req) => {
    if (req.type !== 'EXECUTE') throw new Error('expected a sell');
    const amount = req.action.sellPctOfCurrent >= 99.5 ? coins() : req.action.sellAmount! * fill;
    setCoins(coins() - amount);
    return { stage: 'submitted', clicked: true, sold: true, detail: 'Sold' };
  };
}

const STOP_10 = { stops: [{ trigger: { kind: 'mc' as const, value: 700_000 }, sellPct: 10 }], tps: [{ trigger: { kind: 'x' as const, value: 2 }, sellPct: 50 }] };
const BELOW = 0.00069; // $690K MC — under the $700K stop

describe('partial stops sell only their share', () => {
  it('"sell 10% at $700K": sells exactly 10% of the bag — never Max — like a stop (protective)', async () => {
    seedSell(firedAt(BELOW, STOP_10));
    world.exec = sellsOnPress();
    await drain();

    const [req] = sellRequests();
    expect(req.action).toMatchObject({ level: { kind: 'stop', id: 'st1' }, targetRemaining: 90_000, sellAmount: 10_000 });
    expect(req.action.sellPctOfCurrent).toBeCloseTo(10);
    expect(req.action.sellUsd).toBeCloseTo(10_000 * BELOW);
    // The stop policy: its impact cap, and it may OK an unreadable impact warning.
    expect(req.options).toMatchObject({ maxImpactPct: 40, failClosedOnUnknownImpact: false });

    expect(coins()).toBe(90_000);
    const p = storedPlan();
    expect(p.stops[0].status).toBe('filled');
    expect(p.tps[0].status).toBe('waiting');
    expect(p.state).toBe('armed');
    expect(world.notices).toEqual([{ key: KEY, title: 'Tippy filled order', text: 'Stop hit — Tippy sold 10% of $TST at $690K MC (stop 1).', tone: 'stop' }]);
  });

  it("can't read the balance: waits — it never sells a slice blind (that would be 100%)", async () => {
    seedSell(firedAt(BELOW, STOP_10));
    world.balancesError = { error: 'timeout' };
    await drain();
    expect(world.tabsOpened).toEqual([]);
    expect(sellRequests()).toHaveLength(0);
    // Nothing was pressed: a hiccup reading fomo doesn't use up an attempt.
    expect(storedPlan().stops[0]).toMatchObject({ status: 'waiting', attempts: 0 });
    expect(storedPlan().history.at(-1)?.text).toMatch(/couldn't check your balance on fomo — it'll look again shortly/);
    expect(coins()).toBe(BAG);
  });

  it('the coin missing from one balance read: waits for a clean one', async () => {
    seedSell(firedAt(BELOW, STOP_10));
    world.balancesSeq = [world.holdings.filter((h) => h.key !== KEY)];
    await drain();
    expect(world.tabsOpened).toEqual([]);
    expect(storedPlan().stops[0]).toMatchObject({ status: 'waiting', attempts: 0 });
  });

  it("balance hiccups never use up a partial stop: after many of them it still sells (no Retry needed)", async () => {
    const fired = firedAt(BELOW, STOP_10);
    seedSell(fired);
    const requeue = () => {
      world.storage.plans!.p1.stops[0].status = 'queued';
      world.storage.queue = [fired.action];
    };
    // Balances down, then the coin's row missing, then no fomo tab at all — four times over.
    for (let i = 0; i < 4; i++) {
      world.balancesError = { error: 'timeout' };
      await drain();
      world.balancesError = null;
      world.balancesSeq = [world.holdings.filter((h) => h.key !== KEY)];
      requeue();
      await drain();
      world.storage.status = { ...world.storage.status!, deskTabId: null };
      requeue();
      await drain();
      expect(storedPlan().history.at(-1)?.text).toMatch(/no fomo tab is open/);
      world.storage.status = { ...world.storage.status!, deskTabId: DESK };
      requeue();
    }
    expect(storedPlan().stops[0]).toMatchObject({ status: 'queued', attempts: 0 });
    expect(storedPlan().attention).toBeNull();
    world.exec = sellsOnPress();
    await drain();
    expect(storedPlan().stops[0].status).toBe('filled');
    expect(coins()).toBe(90_000);
  });

  it('…but a real failure on fomo still counts as an attempt', async () => {
    seedSell(firedAt(BELOW, STOP_10));
    world.exec = () => ({ stage: 'error', clicked: false, detail: 'Something broke.' });
    await drain();
    expect(storedPlan().stops[0]).toMatchObject({ status: 'waiting', attempts: 1 });
  });

  it('a stop loss with no fomo tab still fails loudly (it keeps trying, and tells you if it keeps failing)', async () => {
    seedSell(sellPlan());
    world.storage.status = { ...world.storage.status!, deskTabId: null };
    await drain();
    expect(storedPlan().sl).toMatchObject({ status: 'waiting', attempts: 1 });
  });

  it('re-checks the level going down once it has waited a while: bounced back above → no sell', async () => {
    const fired = firedAt(BELOW, STOP_10);
    seedSell({ ...fired, action: { ...fired.action, queuedAt: T0 - 120_000 } });
    setPrice(0.00072); // back above $700K
    await drain();
    expect(world.tabsOpened).toEqual([]);
    expect(storedPlan().stops[0].status).toBe('waiting');
    expect(storedPlan().history.at(-1)?.text).toMatch(/moved back past your stop \$700K mc/);
  });

  it('a dump while fomo loads: the dollars are sized at the live price, so it never sells more coins than its slice', async () => {
    seedSell(firedAt(BELOW, STOP_10));
    const DUMPED = BELOW * 0.7; // −30% while the trade tab was loading
    const realCreate = fakeBrowser.tabs.create;
    const spy = vi.spyOn(fakeBrowser.tabs, 'create').mockImplementation(async (opts) => {
      setPrice(DUMPED);
      return realCreate(opts);
    });
    let sold = 0;
    world.exec = (req) => {
      if (req.type !== 'EXECUTE') throw new Error('expected a sell');
      // fomo turns the typed dollars back into coins at its live price.
      sold = req.action.sellUsd! / world.quotes[KEY].priceUSD;
      setCoins(coins() - sold);
      return { stage: 'submitted', clicked: true, sold: true, detail: 'Sold' };
    };
    await drain();
    spy.mockRestore();

    const [req] = sellRequests();
    expect(req.action.sellAmount).toBeCloseTo(10_000, 6);
    expect(req.action.sellUsd).toBeCloseTo(10_000 * DUMPED, 6); // not 10,000 × the price before the dump
    expect(sold).toBeLessThanOrEqual(10_000 * (1 + 1e-9)); // sized at the old price it would have been ~14,286
    expect(coins()).toBeCloseTo(90_000, 3);
    expect(storedPlan().stops[0].status).toBe('filled');
  });

  it("price unreadable at the press: keeps the old figure, but never above the lowest price Tippy has seen since", async () => {
    seedSell(firedAt(BELOW, STOP_10));
    const realCreate = fakeBrowser.tabs.create;
    const spy = vi.spyOn(fakeBrowser.tabs, 'create').mockImplementation(async (opts) => {
      delete world.quotes[KEY]; // fomo's prices stop answering…
      world.storage.plans!.p1.lastPrice = BELOW * 0.8; // …after the tick loop saw it lower
      return realCreate(opts);
    });
    world.exec = sellsOnPress();
    await drain();
    spy.mockRestore();
    expect(sellRequests()[0].action.sellUsd).toBeCloseTo(10_000 * BELOW * 0.8, 6);

    // Nothing newer seen: the old figure stands.
    resetWorld();
    seedSell(firedAt(BELOW, STOP_10));
    const spy2 = vi.spyOn(fakeBrowser.tabs, 'create').mockImplementation(async (opts) => {
      delete world.quotes[KEY];
      return realCreate(opts);
    });
    world.exec = sellsOnPress();
    await drain();
    spy2.mockRestore();
    expect(sellRequests()[0].action.sellUsd).toBeCloseTo(10_000 * BELOW, 6);
  });

  it("fomo sells most (not all) of the slice at its own price: still counted as sold, with what really went", async () => {
    seedSell(firedAt(BELOW, STOP_10));
    world.exec = sellsOnPress(0.8); // 8,000 of the 10,000 — the price ticked up as it sold
    await drain();
    expect(coins()).toBe(92_000);
    expect(storedPlan().stops[0].status).toBe('filled');
    expect(world.notices[0].text).toBe('Stop hit — Tippy sold 8% of $TST at $690K MC (stop 1).');
  });

  it('…but a balance that barely moved is not a fill', async () => {
    seedSell(firedAt(BELOW, STOP_10));
    world.exec = sellsOnPress(0.5);
    await drain();
    expect(storedPlan().stops[0].status).toBe('unknown');
  });

  it("a stop whose target is nothing sells the rest (fomo's 100%)", async () => {
    seedSell(firedAt(BELOW, { stops: [{ trigger: { kind: 'mc', value: 700_000 }, sellPct: 100 }] }));
    world.exec = sellsOnPress();
    await drain();
    expect(sellRequests()[0].action).toMatchObject({ targetRemaining: 0, sellPctOfCurrent: 100 });
    expect(coins()).toBe(0);
    expect(world.notices[0].text).toBe('Stop hit — Tippy sold the rest of $TST at $690K MC (stop 1).');
  });
});

describe('the stop loss beats everything in a dump', () => {
  const STOPS_AND_SL = { ...STOP_10, sl: { trigger: { kind: 'x' as const, value: 0.5 }, confirmTicks: 1 } };

  /** The partial stop is pressed; meanwhile the price crashes and the tick loop lines up the stop loss. */
  function crashWhileSelling(sliceSells: number) {
    const fired = firedAt(BELOW, STOPS_AND_SL);
    seedSell(fired);
    const pressedAt: Record<string, number> = {};
    world.exec = (req) => {
      if (req.type !== 'EXECUTE') throw new Error('expected a sell');
      pressedAt[req.action.level.kind] = Date.now();
      if (req.action.level.kind === 'stop') {
        setCoins(coins() - sliceSells); // fomo's balance only shows this much of it so far
        world.storage.plans!.p1.sl!.status = 'queued';
        world.storage.queue = [{ ...fired.action, level: { kind: 'sl' }, targetRemaining: 0, sellPctOfCurrent: 100, priority: 0 }];
      } else {
        setCoins(0);
      }
      return { stage: 'submitted', clicked: true, sold: true, detail: 'Sold' };
    };
    return pressedAt;
  }

  it("stops waiting on the partial stop once the stop loss is lined up: 'unknown' when the balance hasn't moved", async () => {
    const pressedAt = crashWhileSelling(0);
    await drain();
    expect(sellRequests().map((r) => r.action.level.kind)).toEqual(['stop', 'sl']);
    // One balance check (3s), not the full 45s.
    expect(pressedAt.sl - pressedAt.stop).toBeLessThan(10_000);
    const p = storedPlan();
    expect(p.state).toBe('done');
    expect(p.sl!.status).toBe('filled');
    expect(p.stops[0].status).toBe('cancelled'); // never confirmed — the stop loss sold the rest
    expect(coins()).toBe(0);
  });

  it('…and counts the partial stop as sold when the balance clearly dropped', async () => {
    const pressedAt = crashWhileSelling(3_000);
    await drain();
    expect(pressedAt.sl - pressedAt.stop).toBeLessThan(10_000);
    const p = storedPlan();
    expect(p.stops[0].status).toBe('filled');
    expect(p.sl!.status).toBe('filled');
    expect(world.notices.map((n) => n.text)).toEqual(['Stop hit — Tippy sold 3% of $TST at $690K MC (stop 1).', 'Stop loss hit — Tippy sold the rest of $TST at $690K MC.']);
  });
});

describe('dry runs never count as really sold', () => {
  it('a dry-run partial stop is marked as a dry run', async () => {
    seedSell(firedAt(BELOW, STOP_10), { dryRun: true });
    await drain();
    expect(storedPlan().stops[0]).toMatchObject({ status: 'filled', dryRun: true });
    expect(coins()).toBe(BAG);
  });

  it("dry run switched off while it ran: the 'fill' doesn't count — the stop goes back to watching", async () => {
    seedSell(firedAt(BELOW, STOP_10), { dryRun: true });
    world.exec = (req) => {
      expect(req.options.dryRun).toBe(true);
      world.storage.settings = { ...world.storage.settings!, dryRun: false };
      return { stage: 'dry-run', clicked: false, detail: 'Dry run — not clicked.' };
    };
    await drain();
    const p = storedPlan();
    expect(p.stops[0]).toMatchObject({ status: 'waiting', attempts: 0 });
    expect(p.stops[0].dryRun).toBeUndefined();
    expect(p.tps[0].targetRemaining).toBe(50_000); // the take-profit still sizes on the whole bag
    expect(world.notices).toEqual([]);
  });
});

describe('fill notices say what this sell did', () => {
  it('a take-profit: the % of the bag that really went, from your balance', async () => {
    seedSell(firedAt(0.002, { tps: [{ trigger: { kind: 'x', value: 2 }, sellPct: 50 }], sl: { trigger: { kind: 'x', value: 0.5 } } }));
    world.exec = sellsOnPress(1.006); // the price slipped a little while it sold
    await drain();
    expect(world.notices[0].text).toBe('Tippy sold 50.3% of $TST at $2M MC (take-profit 1).');
    expect(storedPlan().state).toBe('armed');
  });

  it("the last take-profit with coins left: Tippy says it's stopped guarding them", async () => {
    seedSell(firedAt(0.002, { tps: [{ trigger: { kind: 'x', value: 2 }, sellPct: 60 }] }));
    world.exec = sellsOnPress();
    await drain();
    expect(storedPlan().state).toBe('done');
    expect(world.notices[0].text).toBe('Tippy sold 60% of $TST at $2M MC (take-profit 1). Tippy has stopped guarding the rest.');
  });

  it('a dry run says what it would have sold — two take-profits passed in one jump', async () => {
    const tps = [
      { trigger: { kind: 'x' as const, value: 2 }, sellPct: 50 },
      { trigger: { kind: 'x' as const, value: 3 }, sellPct: 25 },
    ];
    seedSell(firedAt(0.003, { tps, sl: { trigger: { kind: 'x', value: 0.5 } } }), { dryRun: true });
    world.exec = () => ({ stage: 'dry-run', clicked: false, detail: 'Dry run — not clicked.' });
    await drain();
    expect(world.notices[0]).toMatchObject({ title: 'Tippy filled order (dry run)', text: 'Dry run — Tippy would have sold 75% of $TST at $3M MC (take-profit 2). Nothing was really sold.' });
    expect(coins()).toBe(BAG);
  });
});

describe('practice runs', () => {
  function seedPractice(settings: Partial<Settings> = {}) {
    world.storage = { settings: settingsWith(settings), status: { ...DEFAULT_STATUS, health: 'watching', deskTabId: DESK }, plans: {}, buys: {}, queue: [] };
    setCash(50);
  }

  it('practice sell: half the bag, always a dry run, stops before Sell, never checks for a fill', async () => {
    seedPractice({ dryRun: false });
    setCoins(10_000); // $15.50
    let executing: unknown = null;
    world.exec = () => {
      executing = world.storage.status!.executing;
      return { stage: 'dry-run', clicked: false, detail: 'Ready to sell (50%). Dry run — not clicked.', impactPct: 0.4 };
    };
    const r = await runPractice('sell');

    expect(r).toMatchObject({ ok: true, stage: 'dry-run', side: 'sell', symbol: 'TST', key: KEY, impactPct: 0.4 });
    expect(r.detail).toMatch(/All good! .*"Sell TST" button for \$7\.75.*Nothing was sold/);
    const [req] = execRequests();
    expect(req.type).toBe('EXECUTE');
    if (req.type !== 'EXECUTE') return;
    expect(req.options).toMatchObject({ dryRun: true, practice: true, failClosedOnUnknownImpact: true, maxImpactPct: 15, symbol: 'TST' });
    expect(req.action).toMatchObject({ planId: 'practice', level: { kind: 'tp', id: 'practice' }, sellPctOfCurrent: 50, targetRemaining: 5_000, sellAmount: 5_000 });
    expect(executing).toMatchObject({ kind: 'practice', side: 'sell', symbol: 'TST' });
    expect(world.storage.status!.executing).toBeNull();
    // One read to size it — no balance polling afterwards.
    expect(world.requests.filter((x) => x.req.type === 'BALANCES')).toHaveLength(1);
    expect(world.tabsClosed).toHaveLength(1);
  });

  it('practice uses the fomo tab you pressed it in when the remembered desk tab is gone (Tippy was reloaded)', async () => {
    seedPractice();
    world.deadTabs.add(DESK);
    const p = practice(KEY, 'buy', 5, 42);
    await vi.runAllTimersAsync();
    const r = await p;
    expect(r).toMatchObject({ ok: true, stage: 'dry-run' });
    expect(world.requests.filter((x) => x.req.type === 'BALANCES').map((x) => x.tabId)).toEqual([42]);
  });

  it('practice explains how to fix it when no fomo tab answers', async () => {
    seedPractice();
    world.deadTabs.add(DESK);
    const p = practice(KEY, 'buy', 5);
    await vi.runAllTimersAsync();
    expect((await p).detail).toMatch(/refresh this fomo tab/);
    expect(execRequests()).toHaveLength(0);
  });

  it('practice sell: the whole bag when half would be under the minimum', async () => {
    seedPractice();
    setCoins(2_000); // $3.10 — half is $1.55, under the $2 minimum
    await runPractice('sell');
    const [req] = execRequests();
    expect(req.type === 'EXECUTE' && req.action).toMatchObject({ sellPctOfCurrent: 100, targetRemaining: 0 });
  });

  it("practice sell with nothing to sell is skipped — no tab", async () => {
    seedPractice();
    const r = await runPractice('sell');
    expect(r).toMatchObject({ ok: false, stage: 'skipped' });
    expect(r.detail).toMatch(/don't hold any \$TST — try a practice buy/);
    expect(world.tabsOpened).toEqual([]);
  });

  it("practice buy: $5 by default, never under fomo's minimum", async () => {
    seedPractice();
    await runPractice('buy');
    await runPractice('buy', 1);
    world.storage.status = { ...world.storage.status!, minBuyUsd: { [String(SOL)]: 7 } };
    await runPractice('buy', 3);
    const usds = execRequests().map((r) => (r.type === 'EXECUTE_BUY' ? r.action.usd : null));
    expect(usds).toEqual([5, 2, 7]);
    for (const r of execRequests()) expect(r.options).toMatchObject({ dryRun: true, practice: true, maxImpactPct: 10 });
    expect(cash()).toBe(50); // nothing bought
  });

  it('reports where it stopped when fomo says no', async () => {
    seedPractice();
    world.exec = () => ({ stage: 'insufficient-ui', clicked: false, detail: 'Insufficient balance' });
    const r = await runPractice('buy', 100);
    expect(r).toMatchObject({ ok: false, stage: 'insufficient-ui' });
    expect(r.detail).toMatch(/don't have enough cash for \$100\.00/);
  });

  it('a press during practice is never shrugged off', async () => {
    seedPractice();
    world.exec = () => ({ stage: 'dry-run', clicked: true, detail: '??' });
    const r = await runPractice('buy');
    expect(r.ok).toBe(false);
    expect(r.detail).toMatch(/should never happen/);
    expect(world.alerts.map((a) => a.title)).toEqual(['⚠️ Tippy pressed Buy during a practice run']);
    // …and Tippy doesn't go looking for a fill either.
    expect(world.requests.filter((x) => x.req.type === 'BALANCES')).toHaveLength(1);
  });

  it('is refused while a real trade is running', async () => {
    seedBuy({ settings: { dryRun: true } });
    const gate = deferred<ExecResult>();
    world.exec = () => gate.promise;
    const trade = processQueue();
    await vi.advanceTimersByTimeAsync(2_000); // incl. the double-checked "you hold none" read
    expect(execRequests()).toHaveLength(1);

    const r = await practice(KEY, 'buy');
    expect(r).toMatchObject({ ok: false, stage: 'skipped', symbol: 'TST' });
    expect(r.detail).toMatch(/in the middle of a trade/);

    gate.resolve({ stage: 'dry-run', clicked: false, detail: 'dry' });
    await vi.runAllTimersAsync();
    await trade;
    expect(execRequests()).toHaveLength(1);
  });

  it('is refused while a real trade is lined up (a practice must never hold up a stop or a buy)', async () => {
    seedBuy({ settings: { dryRun: true } });
    const r = await practice(KEY, 'buy');
    expect(r).toMatchObject({ ok: false, stage: 'skipped' });
    expect(r.detail).toMatch(/real trade lined up/);
    expect(execRequests()).toHaveLength(0);
  });

  it('holds the queue while it runs, then lets it go', async () => {
    seedBuy({ settings: { dryRun: true } });
    // The buy only gets in line once the practice has started.
    const lined = { queue: world.storage.queue!, order: stored() };
    world.storage.queue = [];
    world.storage.buys = { b1: { ...lined.order, state: 'armed', queuedAt: null } };
    const gate = deferred<ExecResult>();
    world.exec = () => gate.promise;
    const run = practice(KEY, 'buy');
    await vi.advanceTimersByTimeAsync(10);
    expect(execRequests().map((r) => r.options.practice)).toEqual([true]);

    world.storage.queue = lined.queue;
    world.storage.buys = { b1: lined.order };
    void processQueue(); // the tick loop nudging the queue meanwhile
    await vi.advanceTimersByTimeAsync(10);
    expect(execRequests()).toHaveLength(1); // the real buy waits its turn

    world.exec = () => ({ stage: 'dry-run', clicked: false, detail: 'dry' });
    gate.resolve({ stage: 'dry-run', clicked: false, detail: 'dry' });
    await vi.runAllTimersAsync();
    expect((await run).ok).toBe(true);
    await vi.runAllTimersAsync();
    expect(execRequests().map((r) => !!r.options.practice)).toEqual([true, false]);
    expect(stored().state).toBe('filled');
  });
});
