// Tippy's levels on fomo's chart, and dragging them: which lines a coin gets,
// and how a drop becomes a (confirmed) change.
import { describe, expect, it } from 'vitest';
import { buildBuy, moveBuy } from '../src/engine/buys';
import { buildPlan, editPlan, planEditWith } from '../src/engine/orders';
import type { PlanInput } from '../src/engine/types';
import { chartLinesFor, describeMove, stopTooSmall, triggerFromMove, type ChartMove } from '../src/shared/chartLines';
import { stopOrderNote } from '../src/ui/levels';

const T0 = 1_700_000_000_000;
const KEY = 'COIN:1399811149';
const entry = { priceUSD: 0.002, mc: 2_000_000, source: 'armed-at' as const };

const planInput = (): PlanInput => ({
  id: 'p1',
  key: KEY,
  networkId: 1399811149,
  address: 'COIN',
  symbol: 'TST',
  name: 'Test',
  entry,
  balance: 1000,
  tps: [
    { trigger: { kind: 'x', value: 2 }, sellPct: 50 },
    { trigger: { kind: 'mc', value: 10_000_000 }, sellPct: 25 },
  ],
  sl: { trigger: { kind: 'x', value: 0.7 } },
  trailing: null,
  origin: 'manual',
  now: T0,
});
const plan = () =>
  buildPlan({
    id: 'p1',
    key: KEY,
    networkId: 1399811149,
    address: 'COIN',
    symbol: 'TST',
    name: 'Test',
    entry,
    balance: 1000,
    tps: [
      { trigger: { kind: 'x', value: 2 }, sellPct: 50 },
      { trigger: { kind: 'mc', value: 10_000_000 }, sellPct: 25 },
    ],
    sl: { trigger: { kind: 'x', value: 0.7 } },
    trailing: null,
    origin: 'manual',
    now: T0,
  });
const buy = () => buildBuy({ id: 'b1', key: KEY, networkId: 1399811149, address: 'COIN', symbol: 'TST', name: 'Test', trigger: { kind: 'mc', value: 1_600_000 }, ref: entry, usd: 10, guardPresetId: null, expiresInMs: null, now: T0 });

describe('chart lines', () => {
  it('draws each open level once, in price and market cap, with the right colour kind', () => {
    const lines = chartLinesFor(KEY, [plan()], [buy()]);
    expect(lines.map((l) => [l.id, l.kind, Math.round(l.mc!), l.label])).toEqual([
      ['tp:p1:tp1', 'tp', 4_000_000, 'Tippy · TP1 · 50%'],
      ['tp:p1:tp2', 'tp', 10_000_000, 'Tippy · TP2 · 25%'],
      ['sl:p1', 'sl', 1_400_000, 'Tippy · SL · sell rest'],
      ['buy:b1', 'buy', 1_600_000, 'Tippy · BUY $10.00'],
    ]);
    expect(lines[0].price).toBeCloseTo(0.004);
    expect(lines.every((l) => l.draggable)).toBe(true);
  });

  it('only for this coin, and not for sold or finished levels', () => {
    const p = plan();
    p.tps[0].status = 'filled';
    expect(chartLinesFor('OTHER:1', [p], [buy()])).toEqual([]);
    expect(chartLinesFor(KEY, [p], []).map((l) => l.id)).toEqual(['tp:p1:tp2', 'sl:p1']);
  });

  it('a drop on the market-cap axis becomes a market-cap level, and Tippy asks in words', () => {
    const [tp1] = chartLinesFor(KEY, [plan()], []);
    const move = { id: tp1.id, value: 5_000_000, axis: 'mc' as const };
    expect(describeMove(tp1, move)).toBe('Move your TP1 to $5M MC?');
    const edit = planEditWith(plan(), { tp: { id: 'tp1', trigger: triggerFromMove(move) } });
    const r = editPlan(plan(), edit, T0 + 1);
    expect(r.ok && r.plan.tps.map((t) => t.trigger)).toEqual([{ kind: 'mc', value: 5_000_000 }, { kind: 'mc', value: 10_000_000 }]);
  });

  it('partial stops draw red like the stop loss, labelled with their size, and drag like one', () => {
    const p = buildPlan({
      ...planInput(),
      stops: [
        { trigger: { kind: 'mc', value: 1_800_000 }, sellPct: 10 },
        { trigger: { kind: 'mc', value: 1_600_000 }, sellPct: 25 },
      ],
    });
    p.stops[1].status = 'queued'; // selling now: drawn, but can't be dragged
    const lines = chartLinesFor(KEY, [p], []);
    expect(lines.map((l) => [l.id, l.kind, Math.round(l.mc!), l.label, l.draggable])).toEqual([
      ['tp:p1:tp1', 'tp', 4_000_000, 'Tippy · TP1 · 50%', true],
      ['tp:p1:tp2', 'tp', 10_000_000, 'Tippy · TP2 · 25%', true],
      ['stop:p1:st1', 'sl', 1_800_000, 'Tippy · SL · 10%', true],
      ['stop:p1:st2', 'sl', 1_600_000, 'Tippy · SL · 25%', false],
      ['sl:p1', 'sl', 1_400_000, 'Tippy · SL · sell rest', true],
    ]);
    const move = { id: 'stop:p1:st1', value: 1_700_000, axis: 'mc' as const };
    expect(describeMove(lines[2], move)).toBe('Move your 10% stop to $1.7M MC?');
    expect(describeMove(lines[4], move)).toBe('Move your stop loss to $1.7M MC?');
    const q = buildPlan({ ...planInput(), stops: [{ trigger: { kind: 'mc', value: 1_800_000 }, sellPct: 10 }] });
    const r = editPlan(q, planEditWith(q, { stop: { id: 'st1', trigger: triggerFromMove(move) } }), T0 + 1);
    expect(r.ok && r.plan.stops.map((st) => [st.id, st.trigger, st.sellPct])).toEqual([['st1', { kind: 'mc', value: 1_700_000 }, 10]]);
    expect(r.ok && r.plan.sl!.trigger).toEqual({ kind: 'x', value: 0.7 });
  });

  it("a partial stop dragged so low its slice is under fomo's minimum: Tippy says so before moving it", () => {
    // 10,000 tokens; the 10% stop sells 1,000 of them — $1.80 at $1.8M MC, $2.20 at $2.2M.
    const p = buildPlan({ ...planInput(), balance: 10_000, stops: [{ trigger: { kind: 'mc', value: 2_200_000 }, sellPct: 10 }] });
    expect(stopTooSmall(p, 'st1', { kind: 'mc', value: 2_200_000 }, 2)).toBeNull();
    expect(stopTooSmall(p, 'st1', { kind: 'mc', value: 1_800_000 }, 2)).toBe(
      "At $1.8M MC your 10% stop would sell $1.80 — under fomo's $2 minimum sell, so Tippy would skip it. Keep it higher, or make it bigger.",
    );
    expect(stopTooSmall(p, 'st1', { kind: 'price', value: 0.0004 }, 2)).toMatch(/^At \$0\.0004 your 10% stop would sell \$0\.40 —/);
    expect(stopTooSmall(p, 'nope', { kind: 'mc', value: 1_800_000 }, 2)).toBeNull();
  });

  it('a partial stop dropped at or under the stop loss (or the stop loss over partial stops): a heads-up, but it still moves', () => {
    // The stop loss is 0.7x of entry = $1.4M MC; the 10% stop is at $1.8M; the coin is at $2.5M now.
    const p = buildPlan({ ...planInput(), stops: [{ trigger: { kind: 'mc', value: 1_800_000 }, sellPct: 10 }] });
    const lines = chartLinesFor(KEY, [p], []);
    const stop = lines.find((l) => l.id === 'stop:p1:st1')!;
    const sl = lines.find((l) => l.id === 'sl:p1')!;
    const now = { priceUSD: 0.0025, mc: 2_500_000 };
    // What the window's drag notice says (App.tsx): the question, then the heads-up.
    const ask = (kind: 'stop' | 'sl', move: ChartMove) => {
      const note = stopOrderNote(p, kind, triggerFromMove(move), now, entry, move.axis);
      return note ? `${describeMove(kind === 'stop' ? stop : sl, move)} ${note}` : describeMove(kind === 'stop' ? stop : sl, move);
    };
    const down: ChartMove = { id: stop.id, value: 1_300_000, axis: 'mc' };
    expect(ask('stop', down)).toBe('Move your 10% stop to $1.3M MC? Heads up: your stop loss at $1.4M MC is higher, so it would sell everything first.');
    expect(ask('stop', { ...down, value: 1_400_000 })).toBe('Move your 10% stop to $1.4M MC? Heads up: your stop loss at $1.4M MC is higher, so it would sell everything first.');
    expect(ask('stop', { ...down, value: 1_500_000 })).toBe('Move your 10% stop to $1.5M MC?');
    expect(ask('stop', { id: stop.id, value: 0.0013, axis: 'price' })).toBe('Move your 10% stop to $0.0013? Heads up: your stop loss at $0.0014 is higher, so it would sell everything first.');
    const up: ChartMove = { id: sl.id, value: 1_900_000, axis: 'mc' };
    expect(ask('sl', up)).toBe('Move your stop loss to $1.9M MC? Heads up: your 10% stop at $1.8M MC is lower, so it would never fire — the stop loss sells everything first.');
    expect(ask('sl', { ...up, value: 1_700_000 })).toBe('Move your stop loss to $1.7M MC?');
    // Not a block: the move itself still goes through.
    const r = editPlan(p, planEditWith(p, { stop: { id: 'st1', trigger: triggerFromMove(down) } }), T0 + 1);
    expect(r.ok && r.plan.stops[0].trigger).toEqual({ kind: 'mc', value: 1_300_000 });
  });

  it('a plan saved before partial stops still draws', () => {
    const p = plan();
    delete (p as Partial<typeof p>).stops;
    expect(chartLinesFor(KEY, [p], []).map((l) => l.id)).toEqual(['tp:p1:tp1', 'tp:p1:tp2', 'sl:p1']);
  });

  it('a dragged limit buy moves, measured from the price now', () => {
    const r = moveBuy(buy(), { kind: 'mc', value: 1_200_000 }, { priceUSD: 0.0015, mc: 1_500_000 }, T0 + 1);
    expect('order' in r && [r.order.trigger.value, r.order.direction, r.order.ref.priceUSD]).toEqual([1_200_000, 'down', 0.0015]);
    expect(moveBuy(buy(), { kind: 'mc', value: 1_500_000 }, { priceUSD: 0.0015, mc: 1_500_000 }, T0 + 1)).toMatchObject({ error: expect.stringMatching(/where it is now/) });
  });
});
