// Tippy's chat, the planning half: every intent becomes a precise reply or a
// confirm card, validated like the window validates — and NOTHING is sent until
// the card's run() is called. run() re-reads the price and your plans, and
// refuses when the change on the card is no longer the change it would make.
import { beforeEach, describe, expect, it } from 'vitest';
import type { ChatPlan, Intent } from '../src/chat/intent';
import { type ChatApi, type ChatCoin, type ChatCtx, type ChatState, DEFAULT_BUY_EXPIRY_MS, levelToTrigger, planIntent } from '../src/chat/run';
import { buildBuy } from '../src/engine/buys';
import { buildPlan, pausePlan } from '../src/engine/orders';
import type { BuyInput, BuyOrder, Plan, PlanInput } from '../src/engine/types';
import type { CommandResult } from '../src/shared/messages';
import { type Settings, withDefaults } from '../src/shared/settings';

const SOL = 1399811149;
// $CLAUDIA: price $0.001, 1B supply → $1M market cap; you hold 100,000 ($100).
const claudia: ChatCoin = { key: 'Claud111:1399811149', address: 'Claud111', networkId: SOL, symbol: 'CLAUDIA', name: 'Claudia', priceUSD: 0.001, mc: 1_000_000, balance: 100_000 };
// $HIGGS at $719K MC — the trader's coin. A $4.98 bag; `bigHiggs` holds $719.
const higgs: ChatCoin = { key: 'Higgs333:1399811149', address: 'Higgs333', networkId: SOL, symbol: 'HIGGS', name: 'Higgs', priceUSD: 0.000719, mc: 719_000, balance: 6926.3 };
const bigHiggs: ChatCoin = { ...higgs, balance: 1_000_000 };
const wif: ChatCoin = { key: 'Wif222:1399811149', address: 'Wif222', networkId: SOL, symbol: 'WIF', name: 'dogwifhat', priceUSD: 2, mc: 2_000_000_000, balance: 50 };
const HERE = { here: true } as const;

let calls: { fn: string; args: unknown[] }[];
let results: Partial<Record<keyof ChatApi, CommandResult>>;
let fresh: Record<string, ChatCoin | null>;
let state: ChatState;
let resolved: string[];

function api(): ChatApi {
  const rec =
    (fn: keyof ChatApi) =>
    async (...args: unknown[]): Promise<CommandResult> => {
      calls.push({ fn, args });
      return results[fn] ?? { ok: true };
    };
  return {
    arm: rec('arm'),
    update: rec('update'),
    pause: rec('pause'),
    resume: rec('resume'),
    cancel: rec('cancel'),
    armBuy: rec('armBuy'),
    cancelBuy: rec('cancelBuy'),
    moveBuy: rec('moveBuy'),
    practice: rec('practice'),
    setSettings: rec('setSettings'),
    pauseAll: rec('pauseAll'),
  };
}

function ctx(over: Partial<ChatCtx> = {}): ChatCtx {
  return {
    coin: claudia,
    ...state,
    latest: () => state,
    minBuyUsd: () => 2,
    minSellUsd: () => 2,
    cash: 100,
    resolveCoin: async (symbol) => {
      resolved.push(symbol);
      return symbol.toUpperCase() === 'WIF' ? wif : null;
    },
    fetchCoin: async (key) => (key in fresh ? fresh[key] : key === claudia.key ? claudia : key === wif.key ? wif : null),
    api: api(),
    ...over,
  };
}

function settings(over: Partial<Settings> = {}): Settings {
  return { ...withDefaults(undefined), ...over };
}

/** A running plan on $CLAUDIA bought at $1M MC: TP1 2x 50%, TP2 5x 25%, SL −30%. */
function guard(over: Partial<PlanInput> = {}): Plan {
  return buildPlan({
    id: 'p1',
    key: claudia.key,
    networkId: SOL,
    address: claudia.address,
    symbol: 'CLAUDIA',
    name: 'Claudia',
    entry: { priceUSD: 0.001, mc: 1_000_000, source: 'armed-at' },
    balance: 100_000,
    tps: [
      { trigger: { kind: 'x', value: 2 }, sellPct: 50 },
      { trigger: { kind: 'x', value: 5 }, sellPct: 25 },
    ],
    sl: { trigger: { kind: 'x', value: 0.7 } },
    trailing: null,
    origin: 'manual',
    now: 1,
    ...over,
  });
}

function buy(over: Partial<BuyInput> = {}): BuyOrder {
  return buildBuy({
    id: 'b1',
    key: claudia.key,
    networkId: SOL,
    address: claudia.address,
    symbol: 'CLAUDIA',
    name: 'Claudia',
    trigger: { kind: 'mc', value: 800_000 },
    ref: { priceUSD: 0.001, mc: 1_000_000, source: 'armed-at' },
    usd: 10,
    guardPresetId: 'classic',
    expiresInMs: DEFAULT_BUY_EXPIRY_MS,
    now: Date.now(),
    ...over,
  });
}

/** Plan a message's intent; asserts nothing was sent while planning. */
async function plan(intent: Intent, c: ChatCtx = ctx()): Promise<ChatPlan> {
  const p = await planIntent(intent, c);
  expect(calls).toEqual([]);
  return p;
}

/** Plan, expect a card, tap it. */
async function tap(intent: Intent, c: ChatCtx = ctx()) {
  const p = await plan(intent, c);
  expect(p.confirm, p.say).toBeTruthy();
  const res = await p.confirm!.run();
  return { card: p, res };
}

const sent = (fn: string) => calls.filter((c) => c.fn === fn).map((c) => c.args);

beforeEach(() => {
  calls = [];
  results = {};
  fresh = {};
  resolved = [];
  state = { plans: [], buys: [], settings: settings() };
});

describe('levelToTrigger', () => {
  it('keeps market caps and prices, multiples stay multiples, a move becomes one', () => {
    const ref = { priceUSD: 0.001, mc: 1_000_000 };
    expect(levelToTrigger({ kind: 'mc', value: 500_000 }, ref)).toEqual({ kind: 'mc', value: 500_000 });
    expect(levelToTrigger({ kind: 'price', value: 0.004 }, ref)).toEqual({ kind: 'price', value: 0.004 });
    expect(levelToTrigger({ kind: 'x', value: 2 }, ref)).toEqual({ kind: 'x', value: 2 });
    expect(levelToTrigger({ kind: 'pct', value: -30 }, ref)).toEqual({ kind: 'x', value: 0.7 });
    expect(levelToTrigger({ kind: 'pct', value: 15 }, ref)).toEqual({ kind: 'x', value: 1.15 });
    expect(levelToTrigger({ kind: 'pct', value: -100 }, ref)).toBeNull();
    expect(levelToTrigger({ kind: 'mc', value: 0 }, ref)).toBeNull();
  });
});

describe('add a take-profit', () => {
  it('no plan yet: arms one with that take-profit on your whole bag — and says so', async () => {
    const { card, res } = await tap({ type: 'add-tp', coin: HERE, level: { kind: 'mc', value: 2_000_000 }, sellPct: null });
    expect(card.say).toContain('Add a take-profit on $CLAUDIA: sell all of it at $2M MC (2x from now) — say "sell half at …" to keep some.');
    expect(card.say).toContain('your $CLAUDIA bag ($100)');
    expect(card.confirm!.label).toBe('Add it');
    expect(res).toMatchObject({ ok: true });
    expect(sent('arm')).toHaveLength(1);
    const input = sent('arm')[0][0] as Omit<PlanInput, 'id' | 'now'>;
    expect(input).toMatchObject({
      key: claudia.key,
      balance: 100_000,
      entry: { priceUSD: 0.001, mc: 1_000_000, source: 'armed-at' },
      tps: [{ trigger: { kind: 'mc', value: 2_000_000 }, sellPct: 100 }],
      sl: null,
      trailing: null,
      origin: 'manual',
    });
    expect(calls).toHaveLength(1);
  });

  it('"sell 50%": the size you said, with the level as a market cap and its move', async () => {
    const card = await plan({ type: 'add-tp', coin: HERE, level: { kind: 'pct', value: 50 }, sellPct: 50 });
    expect(card.say).toContain('sell 50% at $1.5M MC (+50% from now)');
    expect(card.say).not.toContain('all of it');
  });

  it('a take-profit has to be above the price now', async () => {
    const card = await plan({ type: 'add-tp', coin: HERE, level: { kind: 'mc', value: 500_000 }, sellPct: null });
    expect(card.warn).toBe(true);
    expect(card.confirm).toBeUndefined();
    expect(card.say).toMatch(/above where it is now.*\$1M MC/);
    expect(card.say).toContain('To sell it all if it drops there, say "sl at 500k".');
  });

  it("you don't hold the coin: offers a limit buy instead", async () => {
    const card = await plan({ type: 'add-tp', coin: HERE, level: { kind: 'x', value: 2 }, sellPct: null }, ctx({ coin: { ...claudia, balance: 0 } }));
    expect(card.confirm).toBeUndefined();
    expect(card.say).toMatch(/don't hold \$CLAUDIA — want a limit buy instead/);
  });

  it("can't see your bag: asks you to open the coin, never guesses", async () => {
    const card = await plan({ type: 'add-tp', coin: HERE, level: { kind: 'x', value: 2 }, sellPct: null }, ctx({ coin: { ...claudia, balance: null } }));
    expect(card.confirm).toBeUndefined();
    expect(card.say).toMatch(/can't see your \$CLAUDIA bag/);
  });

  it('running plan: adds the level to it (UPDATE_PLAN), sized to what is left', async () => {
    state.plans = [guard()];
    const { card, res } = await tap({ type: 'add-tp', coin: HERE, level: { kind: 'mc', value: 3_000_000 }, sellPct: null });
    // 50% + 25% already set → 25% left; measured against the price now, numbered by where it lands.
    expect(card.say).toContain('Add TP2 on $CLAUDIA: sell the rest (25% of your bag) at $3M MC (3x from now).');
    expect(res).toMatchObject({ ok: true, say: expect.stringContaining('TP2') });
    expect(sent('update')).toHaveLength(1);
    const [planId, edit] = sent('update')[0] as [string, { tps: { id: string | null; trigger: unknown; sellPct: number }[]; sl: unknown }];
    expect(planId).toBe('p1');
    expect(edit.tps).toEqual([
      { id: 'tp1', trigger: { kind: 'x', value: 2 }, sellPct: 50 },
      { id: 'tp2', trigger: { kind: 'x', value: 5 }, sellPct: 25 },
      { id: null, trigger: { kind: 'mc', value: 3_000_000 }, sellPct: 25 },
    ]);
    expect(edit.sl).toEqual({ trigger: { kind: 'x', value: 0.7 } });
  });

  it('running plan with room to spare: picks 50% and says so', async () => {
    state.plans = [guard({ tps: [{ trigger: { kind: 'x', value: 2 }, sellPct: 25 }] })];
    const { card } = await tap({ type: 'add-tp', coin: HERE, level: { kind: 'x', value: 4 }, sellPct: null });
    expect(card.say).toContain("sell 50% of your bag at $4M MC (4x entry · 4x from now) — you didn't say how much, so I picked 50%.");
    expect((sent('update')[0][1] as { tps: { sellPct: number }[] }).tps.map((t) => t.sellPct)).toEqual([25, 50]);
  });

  it('running plan: a multiple is measured from your entry, and the card shows both', async () => {
    state.plans = [guard({ tps: [{ trigger: { kind: 'x', value: 5 }, sellPct: 25 }] })];
    const card = await plan({ type: 'add-tp', coin: HERE, level: { kind: 'x', value: 3 }, sellPct: 25 }, ctx({ coin: { ...claudia, priceUSD: 0.0015, mc: 1_500_000 } }));
    expect(card.say).toContain('at $3M MC (3x entry · 2x from now)');
  });

  it('refuses past 100% of the bag, and a level you already have', async () => {
    state.plans = [guard({ tps: [{ trigger: { kind: 'x', value: 2 }, sellPct: 100 }] })];
    let card = await plan({ type: 'add-tp', coin: HERE, level: { kind: 'x', value: 3 }, sellPct: null });
    expect(card.say).toMatch(/already sell 100% of the bag/);
    expect(card.confirm).toBeUndefined();
    state.plans = [guard()];
    card = await plan({ type: 'add-tp', coin: HERE, level: { kind: 'x', value: 4 }, sellPct: 40 });
    expect(card.say).toMatch(/would sell 115%.*room for 25% more/);
    card = await plan({ type: 'add-tp', coin: HERE, level: { kind: 'mc', value: 2_000_000 }, sellPct: 10 });
    expect(card.say).toMatch(/already have TP1 at \$2M MC/);
  });

  it('counts take-profits that already sold toward the 100%', async () => {
    const p = guard();
    p.tps[0].status = 'filled';
    state.plans = [p];
    const card = await plan({ type: 'add-tp', coin: HERE, level: { kind: 'x', value: 8 }, sellPct: 30 });
    expect(card.say).toMatch(/would sell 105%.*counting what already sold/);
  });

  it('not while a sell is in flight on that coin', async () => {
    const p = guard();
    p.tps[0].status = 'queued';
    state.plans = [p];
    const card = await plan({ type: 'add-tp', coin: HERE, level: { kind: 'x', value: 8 }, sellPct: 10 });
    expect(card.say).toMatch(/middle of a sell/);
  });

  it('"on WIF": a coin you hold that is not on screen', async () => {
    const { card } = await tap({ type: 'add-tp', coin: { symbol: '$wif' }, level: { kind: 'mc', value: 3_000_000_000 }, sellPct: 50 });
    expect(resolved).toEqual(['wif']);
    expect(card.say).toContain('$WIF');
    expect((sent('arm')[0][0] as { key: string }).key).toBe(wif.key);
  });

  it('a coin Tippy can\'t find: says what it can find', async () => {
    const card = await plan({ type: 'add-tp', coin: { symbol: 'NOPE' }, level: { kind: 'x', value: 2 }, sellPct: null });
    expect(card.warn).toBe(true);
    expect(card.say).toBe('I can only find coins you hold, have orders on, or have open on fomo — open $NOPE on fomo first.');
  });

  it('no coin on screen and none named: asks which', async () => {
    const card = await plan({ type: 'add-tp', coin: HERE, level: { kind: 'x', value: 2 }, sellPct: null }, ctx({ coin: null }));
    expect(card.say).toMatch(/^Which coin\?/);
  });
});

describe('stop loss and trailing stop', () => {
  it('no plan: arms one with just the stop, measured from now', async () => {
    const { card } = await tap({ type: 'set-sl', coin: HERE, level: { kind: 'pct', value: -30 } });
    expect(card.say).toContain('Set a stop loss on $CLAUDIA at $700K MC (−30% from now)');
    expect(card.confirm!.label).toBe('Set it');
    expect(sent('arm')[0][0]).toMatchObject({ tps: [], sl: { trigger: { kind: 'x', value: 0.7 } }, trailing: null });
  });

  it('running plan: moves the stop, keeps every other level', async () => {
    state.plans = [guard()];
    const { card } = await tap({ type: 'set-sl', coin: HERE, level: { kind: 'mc', value: 800_000 } });
    expect(card.say).toContain('Move your stop on $CLAUDIA from $700K MC to $800K MC (−20% from now)');
    expect(card.confirm!.label).toBe('Move it');
    const edit = sent('update')[0][1] as { tps: unknown[]; sl: unknown };
    expect(edit.sl).toEqual({ trigger: { kind: 'mc', value: 800_000 } });
    expect(edit.tps).toHaveLength(2);
  });

  it('a stop has to be below the price now', async () => {
    const card = await plan({ type: 'set-sl', coin: HERE, level: { kind: 'mc', value: 1_200_000 } });
    expect(card.say).toMatch(/stop loss has to be below where it is now/);
    expect(card.confirm).toBeUndefined();
  });

  it('trailing stop on a running plan', async () => {
    state.plans = [guard()];
    const { card } = await tap({ type: 'set-trail', coin: HERE, trailPct: 20, afterX: 2 });
    expect(card.say).toContain('once it reaches 2x your entry ($2M MC)');
    expect(card.say).toContain('falls 20% from its highest price');
    expect((sent('update')[0][1] as { trailing: unknown }).trailing).toEqual({ trailPct: 20, activateX: 2 });
  });

  it('trailing stop with no plan arms one; silly distances are refused', async () => {
    await tap({ type: 'set-trail', coin: HERE, trailPct: 25, afterX: null });
    expect(sent('arm')[0][0]).toMatchObject({ tps: [], sl: null, trailing: { trailPct: 25, activateX: null } });
    calls = [];
    expect((await plan({ type: 'set-trail', coin: HERE, trailPct: 0, afterX: null })).say).toMatch(/between 1% and 99%/);
    expect((await plan({ type: 'set-trail', coin: HERE, trailPct: 20, afterX: 0.5 })).say).toMatch(/above 1x/);
  });
});

describe('partial stops: "sell 10% at 700k" below the price', () => {
  it("the trader's $HIGGS message: 10% of a $4.98 bag is under fomo's $2 minimum — says so up front, sends nothing", async () => {
    const card = await plan({ type: 'add-tp', coin: HERE, level: { kind: 'mc', value: 700_000 }, sellPct: 10, anySide: true }, ctx({ coin: higgs }));
    expect(card.warn).toBe(true);
    expect(card.confirm).toBeUndefined();
    // Valued at the stop's level ($4.85 there), with a little room as a stop can fill lower.
    expect(card.say).toBe("10% of your $HIGGS bag ($4.98) is $0.48 at $700K MC — fomo's minimum sell is $2. Try at least 44% (a stop can fill a bit lower).");
    const tiny = await plan({ type: 'add-stop', coin: HERE, level: { kind: 'mc', value: 700_000 }, sellPct: 50 }, ctx({ coin: { ...higgs, balance: 2000 } }));
    expect(tiny.say).toBe("Your whole $HIGGS bag would be worth $1.40 at $700K MC — under fomo's $2 minimum sell, so I couldn't sell it there.");
  });

  it('below the price now: a card for a partial stop, armed with PlanInput.stops', async () => {
    fresh[higgs.key] = bigHiggs;
    const { card, res } = await tap({ type: 'add-tp', coin: HERE, level: { kind: 'mc', value: 700_000 }, sellPct: 10, anySide: true }, ctx({ coin: bigHiggs }));
    expect(card.say).toContain('Add a stop on $HIGGS: sell 10% if it drops to $700K MC (−2.6% from now).');
    expect(card.say).toContain('your $HIGGS bag ($719)');
    expect(card.confirm!.label).toBe('Add it');
    expect(res).toEqual({ ok: true, say: "Done! I'll sell 10% of $HIGGS if it drops to $700K MC." });
    expect(sent('arm')[0][0]).toMatchObject({ key: higgs.key, tps: [], stops: [{ trigger: { kind: 'mc', value: 700_000 }, sellPct: 10 }], sl: null, trailing: null });
  });

  it('above the price it is a take-profit; no size below the price is the stop loss (sells the rest)', async () => {
    fresh[higgs.key] = bigHiggs;
    const up = await tap({ type: 'add-tp', coin: HERE, level: { kind: 'mc', value: 800_000 }, sellPct: 10, anySide: true }, ctx({ coin: bigHiggs }));
    expect(up.card.say).toContain('Add a take-profit on $HIGGS: sell 10% at $800K MC (+11% from now).');
    expect(sent('arm')[0][0]).toMatchObject({ tps: [{ trigger: { kind: 'mc', value: 800_000 }, sellPct: 10 }], sl: null });
    calls = [];
    const down = await tap({ type: 'add-tp', coin: HERE, level: { kind: 'mc', value: 700_000 }, sellPct: null, anySide: true }, ctx({ coin: bigHiggs }));
    expect(down.card.say).toContain('Set a stop loss on $HIGGS at $700K MC (−2.6% from now): if it falls there, I sell all of it.');
    expect(sent('arm')[0][0]).toMatchObject({ tps: [], sl: { trigger: { kind: 'mc', value: 700_000 } } });
  });

  it('"tp" below the price, or a stop above it, is refused with what to say instead', async () => {
    const tp = await plan({ type: 'add-tp', coin: HERE, level: { kind: 'mc', value: 700_000 }, sellPct: 10 }, ctx({ coin: bigHiggs }));
    expect(tp.say).toBe('A take-profit has to be above where it is now. $HIGGS is at $719K MC. To sell some if it drops there, say "sell 10% if it drops to 700k".');
    const st = await plan({ type: 'add-stop', coin: HERE, level: { kind: 'mc', value: 800_000 }, sellPct: 10 }, ctx({ coin: bigHiggs }));
    // (With what to say for either side, in the user's own size — never just "has to be below".)
    expect(st.say).toBe('A stop has to be below where it is now. $HIGGS is at $719K MC. To sell 10% on the way up, say "sell 10% at 800k" — for a stop, pick a level below, like "sell 10% if it drops 20%".');
    expect(st.confirm).toBeUndefined();
  });

  it('"stop 100% at 700k" is the stop loss that sells the rest, like in the window', async () => {
    const all = await plan({ type: 'add-stop', coin: HERE, level: { kind: 'mc', value: 700_000 }, sellPct: 100 }, ctx({ coin: bigHiggs }));
    expect(all.say).toContain('Set a stop loss on $HIGGS at $700K MC (−2.6% from now): if it falls there, I sell all of it.');
  });

  it("a take-profit too small for fomo's minimum is refused too", async () => {
    const card = await plan({ type: 'add-tp', coin: HERE, level: { kind: 'mc', value: 800_000 }, sellPct: 10, anySide: true }, ctx({ coin: higgs }));
    expect(card.say).toBe("10% of your $HIGGS bag ($4.98) is $0.55 at $800K MC — fomo's minimum sell is $2. Try at least 37%.");
  });

  it('running plan: adds the stop (UPDATE_PLAN), keeping every other level', async () => {
    state.plans = [guard()];
    const { card, res } = await tap({ type: 'add-stop', coin: HERE, level: { kind: 'mc', value: 800_000 }, sellPct: 25 });
    expect(card.say).toContain('Add a stop on $CLAUDIA: sell 25% if it drops to $800K MC (−20% from now).');
    expect(card.say).not.toContain('Heads up');
    expect(res).toEqual({ ok: true, say: 'Done! Stop 1 on $CLAUDIA: sell 25% if it drops to $800K MC.' });
    const edit = sent('update')[0][1] as { tps: unknown[]; stops: unknown[]; sl: unknown };
    expect(edit.stops).toEqual([{ id: null, trigger: { kind: 'mc', value: 800_000 }, sellPct: 25 }]);
    expect(edit.tps).toHaveLength(2);
    expect(edit.sl).toEqual({ trigger: { kind: 'x', value: 0.7 } });
    // Below the stop loss: it would never get its turn — the card says so.
    calls = [];
    const low = await plan({ type: 'add-stop', coin: HERE, level: { kind: 'mc', value: 600_000 }, sellPct: 25 });
    expect(low.say).toContain('Heads up: your stop loss at $700K MC is higher, so it would sell everything first.');
  });

  it('stops count to their own 100%, and a level you already have is refused', async () => {
    state.plans = [guard({ stops: [{ trigger: { kind: 'x', value: 0.9 }, sellPct: 60 }] })];
    expect((await plan({ type: 'add-stop', coin: HERE, level: { kind: 'mc', value: 800_000 }, sellPct: 50 })).say).toMatch(/stops on \$CLAUDIA would sell 110% of the bag — there's room for 40% more/);
    expect((await plan({ type: 'add-stop', coin: HERE, level: { kind: 'mc', value: 900_000 }, sellPct: 10 })).say).toMatch(/already have stop 1 at \$900K MC on \$CLAUDIA — say "move stop 1 to …"/);
  });

  it('moves and removes stop 2 / stop 1 by number (highest first), never the stop loss', async () => {
    state.plans = [guard({ stops: [{ trigger: { kind: 'mc', value: 800_000 }, sellPct: 20 }, { trigger: { kind: 'mc', value: 900_000 }, sellPct: 10 }] })];
    const { card } = await tap({ type: 'move', coin: HERE, target: { kind: 'stop', index: 2 }, level: { kind: 'mc', value: 750_000 } });
    expect(card.say).toContain('Move stop 2 on $CLAUDIA from $800K MC to $750K MC (−25% from now) — still selling 20% of your bag.');
    expect((sent('update')[0][1] as { stops: unknown[] }).stops).toEqual([
      { id: 'st1', trigger: { kind: 'mc', value: 900_000 }, sellPct: 10 },
      { id: 'st2', trigger: { kind: 'mc', value: 750_000 }, sellPct: 20 },
    ]);
    calls = [];
    const rm = await tap({ type: 'remove-level', coin: HERE, target: { kind: 'stop', index: 1 } });
    expect(rm.card.say).toMatch(/^Remove stop 1 on \$CLAUDIA \(sell 10% if it drops to \$900K MC\)\?/);
    const edit = sent('update')[0][1] as { stops: unknown[]; sl: unknown };
    expect(edit.stops).toEqual([{ id: 'st2', trigger: { kind: 'mc', value: 800_000 }, sellPct: 20 }]);
    expect(edit.sl).toEqual({ trigger: { kind: 'x', value: 0.7 } });
    calls = [];
    expect((await plan({ type: 'move', coin: HERE, target: { kind: 'stop', index: 3 }, level: { kind: 'mc', value: 750_000 } })).say).toMatch(/stops 1–2 — there's no stop 3/);
    expect((await plan({ type: 'move', coin: HERE, target: { kind: 'stop', index: 1 }, level: { kind: 'mc', value: 1_100_000 } })).say).toMatch(/^A stop has to be below where it is now/);
  });

  it('"my stop" with only partial stops points at their numbers; no partial stops says how to add one', async () => {
    state.plans = [guard({ sl: null, stops: [{ trigger: { kind: 'mc', value: 800_000 }, sellPct: 20 }] })];
    expect((await plan({ type: 'remove-level', coin: HERE, target: { kind: 'sl' } })).say).toMatch(/don't have a stop loss on \$CLAUDIA — to remove a partial stop, say "remove stop 1"/);
    expect((await plan({ type: 'move', coin: HERE, target: { kind: 'sl' }, level: { kind: 'mc', value: 600_000 } })).say).toMatch(/to move a partial stop, say "move stop 1 to …"/);
    state.plans = [guard()];
    expect((await plan({ type: 'remove-level', coin: HERE, target: { kind: 'stop', index: 1 } })).say).toMatch(/has no partial stops — say "sell 10% if it drops to …" to add one, or "my stop" for your stop loss/);
  });

  it('a sold stop stays as it is', async () => {
    const p = guard({ stops: [{ trigger: { kind: 'mc', value: 800_000 }, sellPct: 20 }] });
    p.stops[0].status = 'filled';
    state.plans = [p];
    expect((await plan({ type: 'remove-level', coin: HERE, target: { kind: 'stop', index: 1 } })).say).toMatch(/Stop 1 on \$CLAUDIA already sold — it stays as it is/);
  });

  it('show and "my orders" list partial stops', async () => {
    state.plans = [guard({ stops: [{ trigger: { kind: 'mc', value: 900_000 }, sellPct: 10 }] })];
    const one = await plan({ type: 'show', coin: HERE });
    expect(one.say.split('\n')).toContain('Stop 1 · sell 10% if it drops to $900K MC (−10%) — watching');
    const all = await plan({ type: 'show', coin: { all: true } });
    expect(all.say).toContain('$CLAUDIA — $2M MC 50% · $5M MC 25% · stop $900K MC 10% · SL $700K MC');
  });

  it('a plan saved before partial stops (no `stops` field) still works', async () => {
    const old = guard();
    delete (old as Partial<Plan>).stops;
    state.plans = [old];
    expect((await plan({ type: 'show', coin: HERE })).say).toContain('SL · $700K MC');
    const { res } = await tap({ type: 'add-stop', coin: HERE, level: { kind: 'mc', value: 800_000 }, sellPct: 25 });
    expect(res.ok).toBe(true);
    expect((sent('update')[0][1] as { stops: unknown[] }).stops).toEqual([{ id: null, trigger: { kind: 'mc', value: 800_000 }, sellPct: 25 }]);
  });

  it('run(): the price fell past the level while you read — refused, nothing sent', async () => {
    const card = await plan({ type: 'add-tp', coin: HERE, level: { kind: 'mc', value: 700_000 }, sellPct: 10, anySide: true }, ctx({ coin: bigHiggs }));
    fresh[higgs.key] = { ...bigHiggs, priceUSD: 0.00069, mc: 690_000 };
    const res = await card.confirm!.run();
    expect(res.ok).toBe(false);
    expect(calls).toEqual([]);
    const explicit = await plan({ type: 'add-stop', coin: HERE, level: { kind: 'mc', value: 700_000 }, sellPct: 10 }, ctx({ coin: bigHiggs }));
    expect(await explicit.confirm!.run()).toEqual({ ok: false, error: 'A stop has to be below where it is now. $HIGGS is at $690K MC. To sell 10% on the way up, say "sell 10% at 700k" — for a stop, pick a level below, like "sell 10% if it drops 20%". Nothing was sent.' });
    expect(calls).toEqual([]);
  });

  it("a partial stop needs 5% of room over fomo's minimum, like the window: $2.07 at its level is refused", async () => {
    // 50% of the $4.98 bag at $600K MC is $2.07 — over $2, but a stop can fill a little lower and get skipped.
    const close = await plan({ type: 'add-stop', coin: HERE, level: { kind: 'mc', value: 600_000 }, sellPct: 50 }, ctx({ coin: higgs }));
    expect(close.confirm).toBeUndefined();
    expect(close.say).toBe("50% of your $HIGGS bag ($4.98) is $2.07 at $600K MC — cutting it close to fomo's $2 minimum sell, and a stop can fill a bit lower. Try at least 51%.");
    // The suggestion itself passes.
    expect((await plan({ type: 'add-stop', coin: HERE, level: { kind: 'mc', value: 600_000 }, sellPct: 51 }, ctx({ coin: higgs }))).confirm).toBeTruthy();
    // A take-profit only needs the minimum itself: 37% at $800K MC is $2.05.
    expect((await plan({ type: 'add-tp', coin: HERE, level: { kind: 'mc', value: 800_000 }, sellPct: 37 }, ctx({ coin: higgs }))).confirm).toBeTruthy();
  });
});

describe('sizes said in dollars: "sell $20 at 1m"', () => {
  it('converts to a % of the bag at the level, and the card says both', async () => {
    fresh[higgs.key] = higgs;
    const { card, res } = await tap({ type: 'add-tp', coin: HERE, level: { kind: 'mc', value: 1_000_000 }, sellPct: null, sellUsd: 3, anySide: true }, ctx({ coin: higgs }));
    // The bag is worth $6.93 at $1M MC: $3 is 43.3% of it (rounded up, never less than you said).
    expect(card.say).toContain('Add a take-profit on $HIGGS: sell $3 ≈ 43% of your bag at $1M MC (+39% from now).');
    const tp = (sent('arm')[0][0] as PlanInput).tps[0];
    expect(tp.sellPct).toBeCloseTo(43.3132, 4);
    expect(tp.sellPct * 6926.3 * 0.001 / 100).toBeGreaterThanOrEqual(3);
    expect(res).toEqual({ ok: true, say: `Done! I'll sell 43.3% of $HIGGS (≈$3) at $1M MC. No stop loss yet — say "sl -30%" to add one.` });
  });

  it('more than the whole bag at the level is refused — never oversold, never quietly "all"', async () => {
    const card = await plan({ type: 'add-tp', coin: HERE, level: { kind: 'mc', value: 1_000_000 }, sellPct: null, sellUsd: 20, anySide: true }, ctx({ coin: higgs }));
    expect(card.confirm).toBeUndefined();
    expect(card.say).toBe('$20 is more than your whole $HIGGS bag would be worth at $1M MC (≈$6.93). To sell all of it there, say "sell all at 1m".');
  });

  it("below the price it's a partial stop sized at the stop's level; fomo's minimum is said in dollars", async () => {
    fresh[higgs.key] = bigHiggs;
    const { card } = await tap({ type: 'add-tp', coin: HERE, level: { kind: 'mc', value: 600_000 }, sellPct: null, sellUsd: 20, anySide: true }, ctx({ coin: bigHiggs }));
    expect(card.say).toContain('Add a stop on $HIGGS: sell $20 ≈ 3.3% of your bag if it drops to $600K MC (−17% from now).');
    expect((sent('arm')[0][0] as PlanInput).stops![0].sellPct).toBeCloseTo((20 / 600) * 100, 3);
    calls = [];
    const tiny = await plan({ type: 'add-stop', coin: HERE, level: { kind: 'mc', value: 600_000 }, sellPct: null, sellUsd: 2 }, ctx({ coin: higgs }));
    expect(tiny.say).toBe("$2 at $600K MC is cutting it close to fomo's $2 minimum sell, and a stop can fill a bit lower. Try at least $2.10.");
    const under = await plan({ type: 'add-tp', coin: HERE, level: { kind: 'x', value: 2 }, sellPct: null, sellUsd: 1 }, ctx({ coin: higgs }));
    expect(under.say).toBe("$1 is under fomo's $2 minimum sell. Try at least $2.");
  });

  it('run(): pinned to the % on the card, so a price tick before the tap sends that same order', async () => {
    // "sell $5 at 2x" with no plan: 2x of the price now, which moves.
    const card = await plan({ type: 'add-tp', coin: HERE, level: { kind: 'x', value: 2 }, sellPct: null, sellUsd: 5 }, ctx({ coin: higgs }));
    expect(card.say).toContain('sell $5 ≈ 50% of your bag');
    fresh[higgs.key] = { ...higgs, priceUSD: 0.000721, mc: 721_000 };
    expect(await card.confirm!.run()).toMatchObject({ ok: true });
    expect((sent('arm')[0][0] as PlanInput).tps[0].sellPct).toBeCloseTo((5 / (6926.3 * 0.001438)) * 100, 3);
  });

  it('a running plan: a share of the bag the plan sizes on', async () => {
    state.plans = [guard({ tps: [{ trigger: { kind: 'x', value: 2 }, sellPct: 50 }] })];
    const { card } = await tap({ type: 'add-tp', coin: HERE, level: { kind: 'x', value: 4 }, sellPct: null, sellUsd: 40 });
    // 100,000 tokens at 4x entry ($0.004) are worth $400: $40 is 10%.
    expect(card.say).toContain('Add TP2 on $CLAUDIA: sell $40 ≈ 10% of your bag at $4M MC');
    expect((sent('update')[0][1] as { tps: { sellPct: number }[] }).tps.map((t) => t.sellPct)).toEqual([50, 10]);
  });
});

describe('levels Tippy asks about instead of using', () => {
  it('a price ~1000x from the coin\'s is a market cap typed without its k — asked, never placed', async () => {
    const far = await plan({ type: 'add-tp', coin: HERE, level: { kind: 'price', value: 0.7 }, sellPct: 50, anySide: true }, ctx({ coin: higgs }));
    expect(far.confirm).toBeUndefined();
    expect(far.say).toBe('$0.70 as a price — that\'s $700M MC, 974x the price now ($HIGGS is at $719K MC, $0.000719). Did you mean 700k mcap? Then say "sell half at 700k".');
    const sl = await plan({ type: 'set-sl', coin: HERE, level: { kind: 'price', value: 700 } }, ctx({ coin: higgs }));
    expect(sl.confirm).toBeUndefined();
    expect(sl.say).toMatch(/^\$700 as a price — that's \$700B MC/);
    // Within 50x it's a price like any other.
    expect((await plan({ type: 'add-tp', coin: HERE, level: { kind: 'price', value: 0.001 }, sellPct: 50, anySide: true }, ctx({ coin: bigHiggs }))).confirm).toBeTruthy();
  });

  it('"sell 50% at 719k" is where it is now — not on the spot, so it asks which side', async () => {
    const card = await plan({ type: 'add-tp', coin: HERE, level: { kind: 'mc', value: 719_000 }, sellPct: 50, anySide: true }, ctx({ coin: bigHiggs }));
    expect(card.confirm).toBeUndefined();
    expect(card.say).toMatch(/^That's where \$HIGGS is now \(\$719K MC\) — I sell at a level, not on the spot/);
  });

  it('"buy 20% …": Tippy buys in dollars — it asks, showing what that share of your cash is, with an amount to copy', async () => {
    const ask = 'How much in dollars? I buy with a $ amount, not a share of your cash.';
    const twenty = { type: 'unknown', hint: `${ask} Try "buy $10 at 500k".`, buy: { ask, where: 'at 500k', pct: 20 } } as const;
    const card = await plan(twenty, ctx({ cash: 50 }));
    expect(card.confirm).toBeUndefined();
    expect(card.say).toBe(`${ask} You have $50 cash on fomo — 20% of it is $10. Try "buy $10 at 500k".`);
    // Under fomo's minimum buy: says so, and the example is the minimum.
    expect((await plan(twenty, ctx({ cash: 5.27 }))).say).toBe(`${ask} You have $5.27 cash on fomo — 20% of it is $1.05, under fomo's $2 minimum buy. Try "buy $2 at 500k".`);
    // Not even the minimum: top up first — never an example you can't afford.
    expect((await plan(twenty, ctx({ cash: 1.5 }))).say).toBe(`${ask} You have $1.50 cash on fomo — 20% of it is $0.30, under fomo's $2 minimum buy — top up first.`);
    // No amount at all: an example that fits your cash.
    const none = { type: 'unknown', hint: 'How much should I buy at $500K MC? Try "buy $10 at 500k".', buy: { ask: 'How much should I buy at $500K MC?', where: 'at 500k' } } as const;
    expect((await plan(none, ctx({ cash: 5.27 }))).say).toBe('How much should I buy at $500K MC? You have $5.27 cash on fomo. Try "buy $5 at 500k".');
    // Cash unknown: the parser's own words.
    expect((await plan(twenty, ctx({ cash: null }))).say).toBe(twenty.hint);
  });
});

describe('move and remove', () => {
  it('moves TP1 (UPDATE_PLAN with only that level changed)', async () => {
    state.plans = [guard()];
    const { card } = await tap({ type: 'move', coin: HERE, target: { kind: 'tp', index: 1 }, level: { kind: 'mc', value: 3_000_000 } });
    expect(card.say).toContain('Move TP1 on $CLAUDIA from $2M MC to $3M MC (3x from now) — still selling 50%');
    const edit = sent('update')[0][1] as { tps: { id: string; trigger: unknown }[] };
    expect(edit.tps).toEqual([
      { id: 'tp1', trigger: { kind: 'mc', value: 3_000_000 }, sellPct: 50 },
      { id: 'tp2', trigger: { kind: 'x', value: 5 }, sellPct: 25 },
    ]);
  });

  it("refuses a TP that doesn't exist, or already sold", async () => {
    const p = guard();
    state.plans = [p];
    expect((await plan({ type: 'move', coin: HERE, target: { kind: 'tp', index: 9 }, level: { kind: 'x', value: 3 } })).say).toMatch(/TP1–TP2 — there's no TP9/);
    p.tps[0].status = 'filled';
    expect((await plan({ type: 'move', coin: HERE, target: { kind: 'tp', index: 1 }, level: { kind: 'x', value: 3 } })).say).toMatch(/TP1 on \$CLAUDIA already sold/);
  });

  it('moves the stop', async () => {
    state.plans = [guard()];
    await tap({ type: 'move', coin: HERE, target: { kind: 'sl' }, level: { kind: 'mc', value: 600_000 } });
    expect((sent('update')[0][1] as { sl: unknown }).sl).toEqual({ trigger: { kind: 'mc', value: 600_000 } });
  });

  it('moves a limit buy with MOVE_BUY, measured from the fresh price', async () => {
    state.buys = [buy()];
    fresh[claudia.key] = { ...claudia, priceUSD: 0.0011, mc: 1_100_000 };
    const { card, res } = await tap({ type: 'move', coin: HERE, target: { kind: 'buy' }, level: { kind: 'mc', value: 700_000 } });
    expect(card.say).toContain('Move your $10 buy on $CLAUDIA from $800K MC to $700K MC (−30% from now)');
    expect(res.ok).toBe(true);
    expect(sent('moveBuy')).toEqual([['b1', { kind: 'mc', value: 700_000 }, { priceUSD: 0.0011, mc: 1_100_000 }]]);
  });

  it('no buy to move', async () => {
    expect((await plan({ type: 'move', coin: HERE, target: { kind: 'buy' }, level: { kind: 'mc', value: 700_000 } })).say).toMatch(/no limit buy waiting on \$CLAUDIA/);
  });

  it('removes TP2, the stop or the trailing stop', async () => {
    state.plans = [guard({ trailing: { trailPct: 20, activateX: 2 } })];
    await tap({ type: 'remove-level', coin: HERE, target: { kind: 'tp', index: 2 } });
    expect((sent('update')[0][1] as { tps: { id: string }[] }).tps.map((t) => t.id)).toEqual(['tp1']);
    calls = [];
    const { card } = await tap({ type: 'remove-level', coin: HERE, target: { kind: 'sl' } });
    expect(card.say).toMatch(/^Remove your stop loss on \$CLAUDIA \(\$700K MC\)\? Without it, nothing sells if it falls\./);
    expect(card.confirm!.label).toBe('Remove it');
    expect((sent('update')[0][1] as { sl: unknown }).sl).toBeNull();
    calls = [];
    await tap({ type: 'remove-level', coin: HERE, target: { kind: 'trail' } });
    expect((sent('update')[0][1] as { trailing: unknown }).trailing).toBeNull();
  });

  it("won't remove the last level — that's \"cancel my plan\"", async () => {
    state.plans = [guard({ tps: [], sl: { trigger: { kind: 'x', value: 0.7 } } })];
    const card = await plan({ type: 'remove-level', coin: HERE, target: { kind: 'sl' } });
    expect(card.say).toMatch(/last level on \$CLAUDIA — say "cancel my plan on CLAUDIA"/);
    expect((await plan({ type: 'remove-level', coin: HERE, target: { kind: 'trail' } })).say).toMatch(/don't have a trailing stop/);
  });
});

describe('limit buys', () => {
  it('places a buy (ARM_BUY) with the default preset and a 24h expiry', async () => {
    const { card, res } = await tap({ type: 'limit-buy', coin: HERE, usd: 10, level: { kind: 'mc', value: 800_000 }, preset: null, expiresInMs: 'default' });
    expect(card.say).toContain('Place a limit buy on $CLAUDIA: $10 if it dips to $800K MC (−20% from now), then guard the new coins with P2 ⭐ Classic (2x 50% · 5x 25% · SL −30%) — your current bag too.');
    expect(card.say).toContain('P2 ⭐ Classic');
    expect(card.say).toContain('Expires in 24h.');
    expect(card.confirm!.label).toBe('Place buy');
    expect(res.ok).toBe(true);
    expect(sent('armBuy')).toEqual([
      [
        {
          key: claudia.key,
          networkId: SOL,
          address: claudia.address,
          symbol: 'CLAUDIA',
          name: 'Claudia',
          trigger: { kind: 'mc', value: 800_000 },
          ref: { priceUSD: 0.001, mc: 1_000_000, source: 'armed-at' },
          usd: 10,
          guardPresetId: 'classic',
          expiresInMs: DEFAULT_BUY_EXPIRY_MS,
        },
      ],
    ]);
  });

  it('"if it dips 20%", no guard, never expires; a breakout says so', async () => {
    await tap({ type: 'limit-buy', coin: HERE, usd: 25, level: { kind: 'pct', value: -20 }, preset: 'none', expiresInMs: null });
    expect(sent('armBuy')[0][0]).toMatchObject({ trigger: { kind: 'x', value: 0.8 }, guardPresetId: null, expiresInMs: null, usd: 25 });
    const card = await planIntent({ type: 'limit-buy', coin: HERE, usd: 10, level: { kind: 'mc', value: 1_500_000 }, preset: 'P3', expiresInMs: 3_600_000 }, ctx());
    expect(card.say).toContain('breaks out to $1.5M MC (+50% from now)');
    expect(card.say).toContain('P3 🌙 Moon bag');
    expect(card.say).toContain('Expires in 1h.');
  });

  it("a running guard on the coin covers the new coins; you don't hold it — fine for a buy", async () => {
    state.plans = [guard()];
    const card = await plan({ type: 'limit-buy', coin: HERE, usd: 10, level: { kind: 'mc', value: 800_000 }, preset: null, expiresInMs: 'default' }, ctx({ coin: { ...claudia, balance: 0 } }));
    expect(card.say).toContain('your current guard on $CLAUDIA covers the new coins');
    expect(card.confirm).toBeTruthy();
  });

  it("refusals: unknown preset, below fomo's minimum, at the price now; low cash only warns", async () => {
    expect((await plan({ type: 'limit-buy', coin: HERE, usd: 10, level: { kind: 'mc', value: 800_000 }, preset: 'yolo', expiresInMs: 'default' })).say).toMatch(/don't know a preset called "yolo" — yours are P1 🛟 Play it safe, P2 ⭐ Classic, P3 🌙 Moon bag/);
    expect((await plan({ type: 'limit-buy', coin: HERE, usd: 10, level: { kind: 'mc', value: 800_000 }, preset: null, expiresInMs: 'default' }, ctx({ minBuyUsd: () => 25 }))).say).toMatch(/minimum buy here is \$25/);
    expect((await plan({ type: 'limit-buy', coin: HERE, usd: 10, level: { kind: 'mc', value: 1_000_000 }, preset: null, expiresInMs: 'default' })).say).toMatch(/where it is now/);
    const low = await plan({ type: 'limit-buy', coin: HERE, usd: 50, level: { kind: 'mc', value: 800_000 }, preset: null, expiresInMs: 'default' }, ctx({ cash: 5 }));
    expect(low.confirm).toBeTruthy();
    expect(low.say).toMatch(/you have \$5 cash on fomo/);
  });

  it('"if it dips to 1.2m" while it\'s at $1M is a breakout — refused, never a buy on the other side', async () => {
    const dip = await plan({ type: 'limit-buy', coin: HERE, usd: 20, level: { kind: 'mc', value: 1_200_000 }, preset: null, expiresInMs: 'default', said: 'dip' });
    expect(dip.confirm).toBeUndefined();
    expect(dip.say).toBe(`$1.2M MC is above where $CLAUDIA is now ($1M MC), so that's a breakout, not a dip. If that's what you want, say "buy $20 if it breaks out to 1.2m" — or pick a level below $1M MC.`);
    const up = await plan({ type: 'limit-buy', coin: HERE, usd: 20, level: { kind: 'mc', value: 800_000 }, preset: null, expiresInMs: 'default', said: 'breakout' });
    expect(up.confirm).toBeUndefined();
    expect(up.say).toMatch(/^\$800K MC is below where \$CLAUDIA is now \(\$1M MC\), so that's a dip, not a breakout/);
    // Said the way it is: a card.
    expect((await plan({ type: 'limit-buy', coin: HERE, usd: 20, level: { kind: 'mc', value: 800_000 }, preset: null, expiresInMs: 'default', said: 'dip' })).confirm).toBeTruthy();
  });

  it('cancels the buy on a coin, or every waiting buy', async () => {
    state.buys = [buy(), buy({ id: 'b2', key: wif.key, symbol: 'WIF', trigger: { kind: 'x', value: 0.8 }, ref: { priceUSD: 2, mc: 2e9, source: 'armed-at' } })];
    let r = await tap({ type: 'cancel-buy', coin: HERE });
    expect(r.card.say).toBe('Cancel your limit buy on $CLAUDIA: $10 at $800K MC?');
    expect(r.card.confirm!.label).toBe('Cancel it');
    expect(sent('cancelBuy')).toEqual([['b1']]);
    calls = [];
    r = await tap({ type: 'cancel-buy', coin: { all: true } });
    expect(r.card.say).toMatch(/Cancel your 2 limit buys: \$CLAUDIA \$10 at \$800K MC, \$WIF \$10 at \$1\.6B MC\?/);
    expect(sent('cancelBuy')).toEqual([['b1'], ['b2']]);
    calls = [];
    state.buys = [];
    const none = await plan({ type: 'cancel-buy', coin: { all: true } });
    expect(none.confirm).toBeUndefined();
    expect(none.say).toBe('You have no limit buys waiting.');
  });
});

describe('plans: stop, pause, presets', () => {
  it('stops guarding (CANCEL_PLAN) — nothing sold', async () => {
    state.plans = [guard()];
    const { card } = await tap({ type: 'stop-plan', coin: HERE });
    expect(card.say).toMatch(/^Stop guarding \$CLAUDIA\? .*nothing gets sold/);
    expect(card.confirm!.label).toBe('Stop it');
    expect(sent('cancel')).toEqual([['p1']]);
    state.plans = [];
    calls = [];
    expect((await plan({ type: 'stop-plan', coin: HERE })).say).toBe("I'm not guarding $CLAUDIA.");
  });

  it('pauses and resumes one coin', async () => {
    state.plans = [guard()];
    await tap({ type: 'pause', coin: HERE, paused: true });
    expect(sent('pause')).toEqual([['p1']]);
    calls = [];
    expect((await plan({ type: 'pause', coin: HERE, paused: false })).confirm).toBeUndefined();
    state.plans = [pausePlan(guard(), 2)];
    expect((await plan({ type: 'pause', coin: HERE, paused: true })).say).toMatch(/already paused/);
    await tap({ type: 'pause', coin: HERE, paused: false });
    expect(sent('resume')).toEqual([['p1']]);
  });

  it('pause everything / resume everything', async () => {
    const { card } = await tap({ type: 'pause', coin: { all: true }, paused: true });
    expect(card.say).toMatch(/^Pause Tippy\?/);
    expect(sent('pauseAll')).toEqual([[true]]);
    calls = [];
    state.settings = settings({ paused: true });
    state.plans = [pausePlan(guard(), 2)];
    const r = await tap({ type: 'pause', coin: { all: true }, paused: false });
    expect(r.card.say).toMatch(/Wake Tippy up and resume your 1 paused guard \(\$CLAUDIA\)/);
    expect(calls.map((c) => [c.fn, ...c.args])).toEqual([
      ['pauseAll', false],
      ['resume', 'p1'],
    ]);
  });

  it('"pause" with no coin on screen means everything', async () => {
    const card = await plan({ type: 'pause', coin: HERE, paused: true }, ctx({ coin: null }));
    expect(card.say).toMatch(/^Pause Tippy\?/);
  });

  it('guards a coin with a preset (ARM), by name or P-number', async () => {
    const { card } = await tap({ type: 'apply-preset', coin: HERE, preset: 'classic' });
    expect(card.say).toContain('Guard $CLAUDIA with P2 ⭐ Classic: sell 50% at $2M MC (2x), 25% at $5M MC (5x); stop at $700K MC (−30%)');
    expect(sent('arm')[0][0]).toMatchObject({
      tps: [
        { trigger: { kind: 'x', value: 2 }, sellPct: 50 },
        { trigger: { kind: 'x', value: 5 }, sellPct: 25 },
      ],
      sl: { trigger: { kind: 'x', value: 0.7 } },
      trailing: null,
    });
    calls = [];
    await tap({ type: 'apply-preset', coin: HERE, preset: 'P1' });
    expect(sent('arm')[0][0]).toMatchObject({ tps: [{ trigger: { kind: 'x', value: 2 }, sellPct: 100 }], sl: { trigger: { kind: 'x', value: 0.8 } } });
  });

  it('switches a running plan to a preset (UPDATE_PLAN), refusing levels already passed', async () => {
    state.plans = [guard()];
    const { card } = await tap({ type: 'apply-preset', coin: HERE, preset: 'moon bag' });
    expect(card.say).toMatch(/Switch \$CLAUDIA to P3 🌙 Moon bag, measured from your entry/);
    expect(card.say).toMatch(/replaces your open levels/);
    expect(sent('update')[0][1]).toEqual({
      tps: [
        { id: null, trigger: { kind: 'x', value: 3 }, sellPct: 33 },
        { id: null, trigger: { kind: 'x', value: 10 }, sellPct: 33 },
      ],
      stops: [],
      sl: { trigger: { kind: 'x', value: 0.6 } },
      trailing: { trailPct: 25, activateX: 2 },
    });
    calls = [];
    const up = await plan({ type: 'apply-preset', coin: HERE, preset: 'classic' }, ctx({ coin: { ...claudia, priceUSD: 0.003, mc: 3_000_000 } }));
    expect(up.say).toMatch(/2x take-profit \(\$2M MC\) is below where \$CLAUDIA is now/);
    expect((await plan({ type: 'apply-preset', coin: HERE, preset: 'turbo' })).say).toMatch(/don't know a preset called "turbo"/);
  });
});

describe('answers without a card', () => {
  it('show: one coin, with levels as market caps and their moves', async () => {
    state.plans = [guard()];
    state.buys = [buy()];
    const card = await plan({ type: 'show', coin: HERE });
    expect(card.confirm).toBeUndefined();
    expect(card.say.split('\n')).toEqual([
      '$CLAUDIA · $1M MC now · bag $100',
      'TP1 · sell 50% at $2M MC (2x) — watching',
      'TP2 · sell 25% at $5M MC (5x) — watching',
      'SL · $700K MC (−30%) — sells the rest',
      expect.stringMatching(/^Buy · \$10 at \$800K MC \(−20%\) — watching, 24h left$/),
    ]);
  });

  it('show: everything', async () => {
    state.plans = [guard()];
    state.buys = [buy({ id: 'b2', key: wif.key, symbol: 'WIF', trigger: { kind: 'x', value: 0.8 }, ref: { priceUSD: 2, mc: 2e9, source: 'armed-at' } })];
    const card = await plan({ type: 'show', coin: { all: true } });
    expect(card.say.split('\n')).toEqual(['Guarding 1 coin:', '$CLAUDIA — $2M MC 50% · $5M MC 25% · SL $700K MC', 'Limit buy:', '$WIF — $10 at $1.6B MC (dip)']);
    state.plans = [];
    state.buys = [];
    expect((await plan({ type: 'show', coin: { all: true } })).say).toMatch(/^I'm not watching anything yet/);
  });

  it('help lists examples; unknown passes the hint on', async () => {
    const help = await plan({ type: 'help' });
    expect(help.confirm).toBeUndefined();
    expect(help.say).toContain('"tp at 500k mcap"');
    const unk = await plan({ type: 'unknown', hint: "Which level? Try 'at 500k mcap'." });
    expect(unk.warn).toBe(true);
    expect(unk.say).toBe("Which level? Try 'at 500k mcap'.");
    expect((await plan({ type: 'unknown', hint: "Hmm, I didn't catch that." })).say).toBe(`Hmm, I didn't catch that. Say "help" for examples.`);
  });
});

describe('practice and settings', () => {
  it('practice a sell / a buy (PRACTICE) and reports how it went', async () => {
    results.practice = { ok: true, practice: { key: claudia.key, symbol: 'CLAUDIA', side: 'sell', at: 1, ok: true, stage: 'dry-run', detail: 'Got to the Sell button.' } };
    const { card, res } = await tap({ type: 'practice', coin: HERE, side: 'sell', usd: null });
    expect(card.confirm!.label).toBe('Practice');
    expect(card.say).toMatch(/nothing gets sold/);
    expect(res).toEqual({ ok: true, say: '✅ Practice worked — Got to the Sell button.' });
    expect(sent('practice')).toEqual([[claudia.key, 'sell', undefined]]);
    calls = [];
    await tap({ type: 'practice', coin: HERE, side: 'buy', usd: null }, ctx({ minBuyUsd: () => 25 }));
    expect(sent('practice')).toEqual([[claudia.key, 'buy', 25]]);
    calls = [];
    expect((await plan({ type: 'practice', coin: HERE, side: 'sell', usd: null }, ctx({ coin: { ...claudia, balance: 0 } }))).say).toMatch(/nothing to practise selling/);
  });

  it('settings (SET_SETTINGS), and says when nothing would change', async () => {
    await tap({ type: 'setting', name: 'dryRun', value: true });
    expect(sent('setSettings')).toEqual([[{ dryRun: true }]]);
    calls = [];
    const ag = await tap({ type: 'setting', name: 'autoGuard', value: true });
    expect(ag.card.say).toMatch(/P2 ⭐ Classic/);
    expect(sent('setSettings')).toEqual([[{ autoGuard: { enabled: true, includeExisting: false } }]]);
    calls = [];
    const unit = await tap({ type: 'setting', name: 'levelUnit', value: 'move' });
    expect(unit.card.say).toMatch(/^I'll read bare numbers in chat as moves \("tp 3" = 3x, "sl 30" = −30%\)/);
    expect(unit.card.say).not.toMatch(/window/);
    expect(sent('setSettings')).toEqual([[{ levelUnit: 'move' }]]);
    calls = [];
    await tap({ type: 'setting', name: 'chartLines', value: false });
    expect(sent('setSettings')).toEqual([[{ chartLines: false }]]);
    calls = [];
    const same = await plan({ type: 'setting', name: 'levelUnit', value: 'mc' });
    expect(same.confirm).toBeUndefined();
    // Only the chat reads this setting now — the reply doesn't promise a window change.
    expect(same.say).toMatch(/already ask what a bare number means/);
    expect(same.say).not.toMatch(/window/);
  });

  it('dry run / paused are mentioned on cards that trade', async () => {
    state.settings = settings({ dryRun: true, paused: true });
    const card = await plan({ type: 'add-tp', coin: HERE, level: { kind: 'x', value: 2 }, sellPct: 50 });
    expect(card.say).toMatch(/paused overall/);
    expect(card.say).toMatch(/Dry run is on, so I won't really sell/);
  });
});

describe('run(): fresh data, once, never blind', () => {
  it('the price ran past the take-profit while you read: refuses, nothing sent', async () => {
    const card = await plan({ type: 'add-tp', coin: HERE, level: { kind: 'mc', value: 2_000_000 }, sellPct: 50 });
    fresh[claudia.key] = { ...claudia, priceUSD: 0.0025, mc: 2_500_000 };
    const res = await card.confirm!.run();
    expect(res.ok).toBe(false);
    expect(!res.ok && res.error).toMatch(/above where it is now.*Nothing was sent/);
    expect(calls).toEqual([]);
  });

  it('the plan changed (a take-profit sold): refuses rather than send a stale edit', async () => {
    state.plans = [guard()];
    const card = await plan({ type: 'set-sl', coin: HERE, level: { kind: 'mc', value: 800_000 } });
    const sold = guard();
    sold.tps[0].status = 'filled';
    state = { ...state, plans: [sold] };
    const res = await card.confirm!.run();
    expect(!res.ok && res.error).toMatch(/Things changed on \$CLAUDIA since I asked — nothing was sent/);
    expect(calls).toEqual([]);
  });

  it('a plan appeared since the card said "no plan": refuses instead of replacing it', async () => {
    const card = await plan({ type: 'add-tp', coin: HERE, level: { kind: 'x', value: 2 }, sellPct: 50 });
    state = { ...state, plans: [guard()] };
    const res = await card.confirm!.run();
    expect(res.ok).toBe(false);
    expect(calls).toEqual([]);
  });

  it('a dip that became a breakout (price fell past the level) is refused', async () => {
    const card = await plan({ type: 'limit-buy', coin: HERE, usd: 10, level: { kind: 'mc', value: 800_000 }, preset: null, expiresInMs: 'default' });
    fresh[claudia.key] = { ...claudia, priceUSD: 0.0007, mc: 700_000 };
    const res = await card.confirm!.run();
    expect(res.ok).toBe(false);
    expect(calls).toEqual([]);
  });

  it("can't get a fresh price: refuses", async () => {
    const card = await plan({ type: 'add-tp', coin: HERE, level: { kind: 'x', value: 2 }, sellPct: 50 });
    fresh[claudia.key] = null;
    const res = await card.confirm!.run();
    expect(!res.ok && res.error).toMatch(/couldn't get a fresh price/);
    expect(calls).toEqual([]);
  });

  it('a new plan uses the fresh price and bag', async () => {
    const card = await plan({ type: 'add-tp', coin: HERE, level: { kind: 'mc', value: 2_000_000 }, sellPct: 50 });
    fresh[claudia.key] = { ...claudia, priceUSD: 0.0011, mc: 1_100_000, balance: 120_000 };
    await card.confirm!.run();
    expect(sent('arm')[0][0]).toMatchObject({ entry: { priceUSD: 0.0011, mc: 1_100_000 }, balance: 120_000 });
  });

  it('runs at most once, and passes Tippy\'s error through', async () => {
    const card = await plan({ type: 'stop-plan', coin: HERE }, ctx());
    expect(card.confirm).toBeUndefined();
    state.plans = [guard()];
    const c2 = await plan({ type: 'stop-plan', coin: HERE });
    results.cancel = { ok: false, error: 'That plan is gone.' };
    const [a, b] = await Promise.all([c2.confirm!.run(), c2.confirm!.run()]);
    expect(sent('cancel')).toHaveLength(1);
    expect([a, b]).toContainEqual({ ok: false, error: 'That plan is gone.' });
    expect([a, b]).toContainEqual({ ok: false, error: expect.stringMatching(/already did that one/) });
  });

  it('a symbol known only from a plan works without a quote (the popup)', async () => {
    const p = guard();
    p.lastPrice = 0.001;
    p.lastMc = 1_000_000;
    state.plans = [p];
    const c = ctx({ coin: null, resolveCoin: async () => null, fetchCoin: async () => null });
    const card = await plan({ type: 'pause', coin: { symbol: 'claudia' }, paused: true }, c);
    expect(card.confirm).toBeTruthy();
    await card.confirm!.run();
    expect(sent('pause')).toEqual([['p1']]);
  });
});
