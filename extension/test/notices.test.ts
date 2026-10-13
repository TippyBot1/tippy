// "Tippy filled order — Tippy bought $5 at $716K MC on $HIGGS": the words Tippy
// uses when an order fills or runs out (fomo's page, desktop, Telegram).
import { describe, expect, it } from 'vitest';
import { buildPlan } from '../src/engine/orders';
import type { BuyEvent, BuyOrder, Plan, PlanInput } from '../src/engine/types';
import { buyExpiredNotice, buyFilledNotice, EXPIRED_TITLE, FILLED_TITLE, filledShare, lateSells, pctText, sellFilledNotice, SKIPPED_TITLE, stopSkippedNotice, UPDATE_TITLE } from '../src/shared/notices';

const KEY = 'HiGGsAddr:1399811149';

function order(over: Partial<BuyOrder> = {}): BuyOrder {
  return {
    key: KEY,
    symbol: 'HIGGS',
    usd: 5,
    trigger: { kind: 'mc', value: 716_000 },
    lastMc: 715_200,
    lastPrice: 0.000715,
    dryRun: false,
    ...over,
  } as BuyOrder;
}

function plan(over: Partial<Plan> = {}): Plan {
  return {
    key: KEY,
    symbol: 'HIGGS',
    state: 'armed',
    lastMc: 790_000,
    lastPrice: 0.00079,
    tps: [
      { id: 'a', sellPct: 50 },
      { id: 'b', sellPct: 25 },
    ],
    ...over,
  } as Plan;
}

describe('a limit buy fills', () => {
  it('says what it bought, where and on which coin', () => {
    expect(buyFilledNotice(order())).toEqual({ key: KEY, title: FILLED_TITLE, text: 'Tippy bought $5 at $716K MC on $HIGGS.', tone: 'good' });
    expect(FILLED_TITLE).toBe('Tippy filled order');
  });

  it('keeps cents when there are any, and names the guard briefly', () => {
    const n = buyFilledNotice(order({ usd: 12.5 }), 'Guarding with ⭐ Classic: 2x 50% · 5x 25% · SL −30%.');
    expect(n.text).toBe('Tippy bought $12.50 at $716K MC on $HIGGS. Guarding it with ⭐ Classic.');
  });

  it('says where it really filled when a jump took it well past the level', () => {
    expect(buyFilledNotice(order({ lastMc: 660_000 })).text).toBe('Tippy bought $5 at $716K MC on $HIGGS (filled at $660K MC).');
    // A few % past the level is just how dips fill — not worth a mention.
    expect(buyFilledNotice(order({ lastMc: 690_000 })).text).toBe('Tippy bought $5 at $716K MC on $HIGGS.');
  });

  it('a % dip order says the market cap it bought at', () => {
    expect(buyFilledNotice(order({ trigger: { kind: 'x', value: 0.8 }, lastMc: 572_800 })).text).toBe('Tippy bought $5 at $573K MC on $HIGGS.');
  });

  it('a dry run says nothing was bought', () => {
    const n = buyFilledNotice(order({ dryRun: true }));
    expect(n.title).toBe('Tippy filled order (dry run)');
    expect(n.text).toBe('Dry run — Tippy would have bought $5 at $716K MC on $HIGGS. Nothing was really bought.');
    expect(n.tone).toBe('info');
  });
});

describe('a sell fills', () => {
  it('a take-profit: how much, where, and which one', () => {
    expect(sellFilledNotice(plan(), { kind: 'tp', id: 'a' }, { soldPct: 50 })).toEqual({
      key: KEY,
      title: FILLED_TITLE,
      text: 'Tippy sold 50% of $HIGGS at $790K MC (take-profit 1).',
      tone: 'good',
    });
    expect(sellFilledNotice(plan(), { kind: 'tp', id: 'b' }, { soldPct: 25 }).text).toBe('Tippy sold 25% of $HIGGS at $790K MC (take-profit 2).');
  });

  it('says what THIS sell did, rounded sensibly', () => {
    const say = (soldPct: number) => sellFilledNotice(plan(), { kind: 'tp', id: 'a' }, { soldPct }).text;
    expect(say(49.99999)).toBe('Tippy sold 50% of $HIGGS at $790K MC (take-profit 1).');
    expect(say(12.5)).toBe('Tippy sold 12.5% of $HIGGS at $790K MC (take-profit 1).');
    expect(say(12.3456)).toBe('Tippy sold 12.3% of $HIGGS at $790K MC (take-profit 1).');
    expect(say(75)).toBe('Tippy sold 75% of $HIGGS at $790K MC (take-profit 1).'); // two levels in one go
    expect(pctText(0.01)).toBe('<0.1');
    expect(pctText(140)).toBe('100');
  });

  it('"the rest" only when the sell emptied the bag', () => {
    expect(sellFilledNotice(plan({ state: 'done' }), { kind: 'tp', id: 'b' }, { soldPct: 50, emptied: true }).text).toBe('Tippy sold the rest of $HIGGS at $790K MC (take-profit 2).');
  });

  it("a plan that closed with coins still held says Tippy isn't watching them any more", () => {
    // Take-profits added up to 60% and the last one just sold: 40% is left, unguarded.
    expect(sellFilledNotice(plan({ state: 'done' }), { kind: 'tp', id: 'b' }, { soldPct: 25 }).text).toBe(
      'Tippy sold 25% of $HIGGS at $790K MC (take-profit 2). Tippy has stopped guarding the rest.',
    );
  });

  it('a partial stop: how much, where, which one — in red', () => {
    const p = plan({ lastMc: 700_000, stops: [{ id: 'st1', sellPct: 10 }, { id: 'st2', sellPct: 20 }] as Plan['stops'] });
    expect(sellFilledNotice(p, { kind: 'stop', id: 'st1' }, { soldPct: 10 })).toEqual({
      key: KEY,
      title: FILLED_TITLE,
      text: 'Stop hit — Tippy sold 10% of $HIGGS at $700K MC (stop 1).',
      tone: 'stop',
    });
    expect(sellFilledNotice(p, { kind: 'stop', id: 'st2' }, { soldPct: 30 }).text).toBe('Stop hit — Tippy sold 30% of $HIGGS at $700K MC (stop 2).');
    expect(sellFilledNotice(p, { kind: 'stop', id: 'st2' }, { emptied: true }).text).toBe('Stop hit — Tippy sold the rest of $HIGGS at $700K MC (stop 2).');
  });

  it('a stop loss and a trailing stop say so, in red', () => {
    const sl = sellFilledNotice(plan({ lastMc: 644_000 }), { kind: 'sl' }, { emptied: true });
    expect(sl).toMatchObject({ title: FILLED_TITLE, text: 'Stop loss hit — Tippy sold the rest of $HIGGS at $644K MC.', tone: 'stop' });
    expect(sellFilledNotice(plan(), { kind: 'trail' }).text).toBe('Trailing stop hit — Tippy sold the rest of $HIGGS at $790K MC.');
  });

  it('falls back to the price when the market cap is unknown', () => {
    expect(sellFilledNotice(plan({ lastMc: null }), { kind: 'sl' }).text).toBe('Stop loss hit — Tippy sold the rest of $HIGGS at $0.00079.');
  });

  it('a dry run says nothing was sold', () => {
    const n = sellFilledNotice(plan(), { kind: 'sl' }, { dryRun: true, emptied: true });
    expect(n.title).toBe('Tippy filled order (dry run)');
    expect(n.text).toBe('Dry run — Tippy would have sold the rest of $HIGGS at $790K MC (stop loss). Nothing was really sold.');
    expect(sellFilledNotice(plan(), { kind: 'tp', id: 'a' }, { dryRun: true, soldPct: 50 }).text).toBe('Dry run — Tippy would have sold 50% of $HIGGS at $790K MC (take-profit 1). Nothing was really sold.');
  });

  it("long after the press, it doesn't claim Tippy filled it", () => {
    const n = sellFilledNotice(plan(), { kind: 'tp', id: 'a' }, { soldPct: 50, late: true });
    expect(n).toEqual({ key: KEY, title: UPDATE_TITLE, text: 'Your take-profit 1 on $HIGGS looks sold — your balance dropped.', tone: 'info' });
    expect(UPDATE_TITLE).toBe('Tippy order update');
  });
});

describe('what a sell took', () => {
  const T0 = 1_700_000_000_000;
  function real(over: Partial<PlanInput> = {}): Plan {
    return buildPlan({
      id: 'p1',
      key: KEY,
      networkId: 1399811149,
      address: 'HiGGsAddr',
      symbol: 'HIGGS',
      name: 'Higgs',
      entry: { priceUSD: 0.001, mc: 1_000_000, source: 'manual' },
      balance: 1_000_000, // $1,000 at entry
      tps: [
        { trigger: { kind: 'x', value: 2 }, sellPct: 50 },
        { trigger: { kind: 'x', value: 3 }, sellPct: 25 },
      ],
      stops: [{ trigger: { kind: 'mc', value: 700_000 }, sellPct: 10 }],
      sl: null,
      trailing: null,
      origin: 'manual',
      now: T0,
      ...over,
    });
  }
  const set = (p: Plan, list: 'tps' | 'stops', i: number, over: object) => Object.assign(p[list][i], over);

  it('filledShare: the levels that turned filled with this sell (merged / covered ones included)', () => {
    const before = real();
    const after = structuredClone(before);
    set(after, 'tps', 0, { status: 'filled' });
    set(after, 'tps', 1, { status: 'filled' });
    expect(filledShare(before, after)).toBe(75);
    const stop = structuredClone(before);
    set(stop, 'stops', 0, { status: 'filled' });
    expect(filledShare(before, stop)).toBe(10);
    expect(filledShare(before, before)).toBeNull();
    // A plan saved before partial stops existed.
    const legacy = { ...before, stops: undefined } as unknown as Plan;
    expect(filledShare(legacy, after)).toBe(75);
  });

  it('lateSells: one notice per press — a level that went along counts toward its %', () => {
    const before = real();
    set(before, 'tps', 0, { status: 'blocked', clickedAt: null }); // gave up before pressing
    set(before, 'tps', 1, { status: 'unknown', clickedAt: T0 - 60_000, executingAt: T0 - 60_000 });
    const after = structuredClone(before);
    set(after, 'tps', 0, { status: 'filled' });
    set(after, 'tps', 1, { status: 'filled' });
    expect(lateSells(before, after, 250_000, T0)).toEqual([{ ref: { kind: 'tp', id: 'tp2' }, soldPct: 75, emptied: false, late: false }]);
  });

  it('lateSells: a press more than 30 minutes ago is "late", an emptied bag is "the rest"', () => {
    const before = real();
    set(before, 'stops', 0, { status: 'blocked', clickedAt: T0 - 31 * 60_000 });
    const after = structuredClone(before);
    after.lastPrice = 0.0007;
    set(after, 'stops', 0, { status: 'filled' });
    expect(lateSells(before, after, 900_000, T0)).toEqual([{ ref: { kind: 'stop', id: 'st1' }, soldPct: 10, emptied: false, late: true }]);
    expect(lateSells(before, after, 0, T0)[0]).toMatchObject({ emptied: true });
  });

  it('lateSells: exits sell the rest; levels that were never pressed get nothing', () => {
    const before = real({ sl: { trigger: { kind: 'x', value: 0.5 } } });
    before.sl!.status = 'executing';
    before.sl!.executingAt = T0 - 5_000;
    const after = structuredClone(before);
    after.sl!.status = 'filled';
    set(after, 'tps', 0, { status: 'cancelled' });
    expect(lateSells(before, after, 0, T0)).toEqual([{ ref: { kind: 'sl' }, soldPct: null, emptied: true, late: false }]);
    const waiting = structuredClone(real());
    const sold = structuredClone(waiting);
    set(sold, 'tps', 0, { status: 'filled' });
    expect(lateSells(waiting, sold, 500_000, T0)).toEqual([]);
  });
});

describe('a limit buy expires', () => {
  const ev = (kind: BuyEvent['kind']): BuyEvent => ({ at: 0, kind, text: '' });
  const expired = (kinds: BuyEvent['kind'][], over: Partial<BuyOrder> = {}) => buyExpiredNotice(order({ direction: 'down', history: [ev('armed'), ...kinds.map(ev), ev('expired')], ...over })).text;

  it('says which order and why', () => {
    expect(buyExpiredNotice(order({ direction: 'down', history: [ev('armed'), ev('expired')] }))).toEqual({
      key: KEY,
      title: EXPIRED_TITLE,
      text: 'Your $5 limit buy on $HIGGS at $716K MC expired — the price never got there.',
      tone: 'info',
    });
    expect(EXPIRED_TITLE).toBe('Tippy order expired');
  });

  it("there wasn't enough cash when the price got there", () => {
    expect(expired(['hit', 'executing', 'no-cash'])).toBe("Your $5 limit buy on $HIGGS at $716K MC expired — there wasn't enough cash on fomo when the price got there.");
  });

  it('it ran past the level, so Tippy held off (a dip) or didn\'t chase it (a breakout)', () => {
    expect(expired(['too-far'])).toBe('Your $5 limit buy on $HIGGS at $716K MC expired — it ran more than 25% past your level, so Tippy held off.');
    expect(expired(['too-far'], { direction: 'up' })).toBe("Your $5 limit buy on $HIGGS at $716K MC expired — it pumped more than 25% past your level, so Tippy didn't chase it.");
  });

  it('the price got there, but the order ran out first', () => {
    expect(expired(['hit', 'executing', 'stale'])).toBe('Your $5 limit buy on $HIGGS at $716K MC expired — it expired before Tippy could buy.');
    expect(expired(['no-cash', 'hit', 'executing', 'failed'])).toMatch(/— it expired before Tippy could buy\.$/);
  });

  it('only counts what happened since the order was placed or last moved', () => {
    expect(expired(['hit', 'no-cash', 'armed'])).toMatch(/— the price never got there\.$/);
  });
});

describe('a stop too small to sell', () => {
  it("quotes the plan's latest note, as a stop notice on the coin", () => {
    const p = plan({
      history: [
        { at: 1, kind: 'too-small', text: 'An old note.' },
        { at: 2, kind: 'queued', text: 'Something else.' },
        { at: 3, kind: 'too-small', text: "Your stop at $700K mc on $HIGGS would sell $0.48 — below fomo's $2 minimum, so Tippy skipped it." },
      ],
    });
    expect(stopSkippedNotice(p)).toEqual({
      key: KEY,
      title: SKIPPED_TITLE,
      text: "Your stop at $700K mc on $HIGGS would sell $0.48 — below fomo's $2 minimum, so Tippy skipped it.",
      tone: 'stop',
    });
    expect(SKIPPED_TITLE).toBe('Tippy skipped a stop');
  });

  it('nothing to say without a note', () => {
    expect(stopSkippedNotice(plan({ history: [] }))).toBeNull();
  });
});
