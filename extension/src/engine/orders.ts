// Tippy's order engine: a pure state machine. No chrome APIs, no clocks, no I/O —
// the runtime feeds it quotes and balances and executes the actions it returns.
//
// Key ideas:
//  - Sells are *declarative*. Every level stores the balance that should remain
//    once it has sold. Before selling we compare against the live balance, so
//    sells made elsewhere (phone, another computer, a crash mid-trade) are never
//    repeated.
//  - A plan is armed, paused, done or cancelled. "Needs attention" is a notice
//    (plan.attention), never a state, so a stuck take-profit can never switch
//    off the stop loss.
//  - A take-profit that may have been pressed but never confirmed is never
//    re-pressed on its own — it becomes 'blocked' until the user taps Retry.
//    Exits ("sell the rest") are re-sized at execution and can't oversell, so
//    they keep retrying (with backoff) for as long as the plan is armed.
//  - Once a plan is done or cancelled it stays that way; late results only
//    update the level's record.
//  - Partial stops ("sell 10% if it drops to $700K") are take-profits in the
//    other direction: a slice of the original bag, a declarative target, the
//    same "never re-press on its own" rule. They only fire after a few ticks at
//    or below their level (wick protection), and before take-profits.

import { describeTrigger, formatUsd, formatX, isHit, triggerPrice } from './triggers';
import type {
  Action,
  BuyAction,
  Entry,
  EvalContext,
  LevelRef,
  Plan,
  PlanEvent,
  PlanInput,
  Quote,
  SellAction,
  StopLevel,
  StopLoss,
  TakeProfit,
  Trailing,
  Trigger,
} from './types';

const HISTORY_LIMIT = 40;
/** After a (possible) click, wait this long for the balance to move before giving up on it. */
export const RECONCILE_AFTER_MS = 120_000;
/** Take-profits give up (become 'blocked') after this many failed attempts; exits keep trying. */
export const MAX_ATTEMPTS = 3;
const GAP_FILL_WINDOW_MS = 120_000;
const RETRY_BASE_MS = 20_000;
const RETRY_MAX_MS = 5 * 60_000;

const OPEN: ReadonlySet<string> = new Set(['waiting', 'queued', 'held', 'executing', 'unknown', 'blocked']);
const IN_FLIGHT: ReadonlySet<string> = new Set(['queued', 'held', 'executing', 'unknown']);

type AnyLevel = TakeProfit | StopLevel | StopLoss | Trailing;
/** Levels that sell a slice of the bag down to a declarative target. */
type SliceLevel = TakeProfit | StopLevel;

function clone<T>(v: T): T {
  return structuredClone(v);
}

/** Plans saved before partial stops existed have no `stops` list: treat it as empty. */
function stopsOf(plan: Pick<Plan, 'stops'>): StopLevel[] {
  return plan.stops ?? [];
}

/** A working copy of a plan, with a `stops` list even if it was saved without one. */
function clonePlan(input: Plan): Plan {
  const plan = clone(input);
  if (!Array.isArray(plan.stops)) plan.stops = [];
  return plan;
}

/** A plan with a `stops` list (older saved plans get an empty one). The same object when nothing is missing. */
export function normalizePlan(plan: Plan): Plan {
  return Array.isArray(plan.stops) ? plan : { ...plan, stops: [] };
}

function log(plan: Plan, at: number, kind: PlanEvent['kind'], text: string) {
  plan.history.push({ at, kind, text });
  if (plan.history.length > HISTORY_LIMIT) plan.history.splice(0, plan.history.length - HISTORY_LIMIT);
  plan.updatedAt = at;
}

function cumulativeTargets(orig: number, pcts: number[]): number[] {
  let cum = 0;
  return pcts.map((p) => {
    cum = Math.min(100, cum + p);
    return cum >= 100 ? 0 : orig * (1 - cum / 100);
  });
}

function newLevelBase() {
  return { status: 'waiting' as const, executingAt: null, clickedAt: null, attempts: 0, retryAfter: null };
}

/** Where a trigger sits on the price line, for ordering stops (no market cap yet: at the bottom). */
function stopPrice(trigger: Trigger, entry: Entry): number {
  const p = triggerPrice(trigger, entry);
  return Number.isFinite(p) ? p : -Infinity;
}

/** Highest stop first — the first one hit on the way down. Stable for equal prices. */
function sortStops<T extends { trigger: Trigger }>(stops: T[], entry: Entry): T[] {
  return stops.sort((a, b) => {
    const pa = stopPrice(a.trigger, entry);
    const pb = stopPrice(b.trigger, entry);
    return pa === pb ? 0 : pa > pb ? -1 : 1;
  });
}

function newStop(id: string, trigger: Trigger, sellPct: number): StopLevel {
  return { id, trigger, sellPct, targetRemaining: 0, mergedInto: null, confirmTicks: 2, ticksBelow: 0, ...newLevelBase() };
}

export function buildPlan(input: PlanInput): Plan {
  const targets = cumulativeTargets(
    input.balance,
    input.tps.map((t) => t.sellPct),
  );
  const tps: TakeProfit[] = input.tps.map((t, i) => ({
    id: `tp${i + 1}`,
    trigger: t.trigger,
    sellPct: t.sellPct,
    targetRemaining: targets[i],
    mergedInto: null,
    ...newLevelBase(),
  }));
  // Partial stops count down from the highest: each sells its % of the bag on the way down.
  const stops = sortStops([...(input.stops ?? [])], input.entry).map((s, i) => newStop(`st${i + 1}`, s.trigger, s.sellPct));
  const stopTargets = cumulativeTargets(input.balance, stops.map((s) => s.sellPct));
  stops.forEach((s, i) => (s.targetRemaining = stopTargets[i]));
  const sl: StopLoss | null = input.sl ? { trigger: input.sl.trigger, confirmTicks: Math.max(1, input.sl.confirmTicks ?? 2), ticksBelow: 0, ...newLevelBase() } : null;
  const trailing: Trailing | null = input.trailing
    ? {
        trailPct: input.trailing.trailPct,
        activateX: input.trailing.activateX ?? null,
        peakPrice: null,
        active: false,
        confirmTicks: Math.max(1, input.trailing.confirmTicks ?? 2),
        ticksBelow: 0,
        ...newLevelBase(),
      }
    : null;

  const plan: Plan = {
    id: input.id,
    key: input.key,
    networkId: input.networkId,
    address: input.address,
    symbol: input.symbol,
    name: input.name,
    entry: input.entry,
    origBalance: input.balance,
    tps,
    stops,
    sl,
    trailing,
    state: 'armed',
    attention: null,
    origin: input.origin,
    createdAt: input.now,
    updatedAt: input.now,
    gapAt: null,
    lastPrice: null,
    lastMc: null,
    history: [],
  };
  log(plan, input.now, 'armed', `Tippy is guarding $${input.symbol}: ${summarizePlan(plan)}`);
  return plan;
}

/** "2x 50% · 5x 25% · stop $700K mc 10% · SL −30% · trail 25%" */
export function summarizePlan(plan: Pick<Plan, 'tps' | 'sl' | 'trailing'> & { stops?: StopLevel[] }): string {
  const parts = plan.tps.map((t) => `${describeTrigger(t.trigger)} ${trimPct(t.sellPct)}%`);
  for (const s of plan.stops ?? []) parts.push(`stop ${describeTrigger(s.trigger)} ${trimPct(s.sellPct)}%`);
  if (plan.sl) parts.push(`SL ${describeTrigger(plan.sl.trigger)}`);
  if (plan.trailing) {
    parts.push(
      `trail ${trimPct(plan.trailing.trailPct)}%` +
        (plan.trailing.activateX ? ` after ${formatX(plan.trailing.activateX)}` : ''),
    );
  }
  return parts.join(' · ') || 'no levels';
}

function trimPct(n: number) {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

export function getLevel(plan: Plan, ref: LevelRef): AnyLevel | null {
  if (ref.kind === 'sl') return plan.sl;
  if (ref.kind === 'trail') return plan.trailing;
  if (ref.kind === 'stop') return stopsOf(plan).find((s) => s.id === ref.id) ?? null;
  return plan.tps.find((t) => t.id === ref.id) ?? null;
}

export function levelLabel(plan: Plan, ref: LevelRef): string {
  if (ref.kind === 'sl') return `stop loss (${plan.sl ? describeTrigger(plan.sl.trigger) : ''})`;
  if (ref.kind === 'trail') return `trailing stop (${plan.trailing?.trailPct ?? ''}% from top)`;
  if (ref.kind === 'stop') {
    const s = stopsOf(plan).find((x) => x.id === ref.id);
    return s ? `stop ${describeTrigger(s.trigger)} (${trimPct(s.sellPct)}%)` : 'stop';
  }
  const tp = plan.tps.find((t) => t.id === ref.id);
  return tp ? `take-profit ${describeTrigger(tp.trigger)}` : 'take-profit';
}

export function sameRef(a: LevelRef, b: LevelRef): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === 'tp' || a.kind === 'stop') return 'id' in b && a.id === b.id;
  return true;
}

function levelTarget(plan: Plan, ref: LevelRef): number {
  if (ref.kind === 'tp') return plan.tps.find((t) => t.id === ref.id)?.targetRemaining ?? 0;
  if (ref.kind === 'stop') return stopsOf(plan).find((s) => s.id === ref.id)?.targetRemaining ?? 0;
  return 0;
}

/** Exits sell everything that's left; so does a take-profit or partial stop whose target is 0. */
function isExitRef(plan: Plan, ref: LevelRef): boolean {
  return ref.kind === 'sl' || ref.kind === 'trail' || levelTarget(plan, ref) === 0;
}

export function allLevels(plan: Plan): { ref: LevelRef; level: AnyLevel }[] {
  const out: { ref: LevelRef; level: AnyLevel }[] = plan.tps.map((t) => ({ ref: { kind: 'tp', id: t.id } as LevelRef, level: t }));
  for (const s of stopsOf(plan)) out.push({ ref: { kind: 'stop', id: s.id }, level: s });
  if (plan.sl) out.push({ ref: { kind: 'sl' }, level: plan.sl });
  if (plan.trailing) out.push({ ref: { kind: 'trail' }, level: plan.trailing });
  return out;
}

export function hasInFlight(plan: Plan): boolean {
  return allLevels(plan).some(({ level }) => IN_FLIGHT.has(level.status));
}

export const isClosed = (plan: Plan) => plan.state === 'done' || plan.state === 'cancelled';

function closePlan(plan: Plan, now: number, kind: 'done' | 'cancelled', text: string) {
  for (const { level } of allLevels(plan)) {
    if (OPEN.has(level.status)) level.status = 'cancelled';
  }
  plan.state = kind;
  plan.attention = null;
  log(plan, now, kind, text);
}

function toleranceTokens(plan: Plan, price: number | null, dustUsd: number): number {
  const byBag = plan.origBalance * 0.005;
  const byDust = price && price > 0 ? dustUsd / price : 0;
  return Math.max(byBag, byDust);
}

/** Put a level back to watching (and un-merge the levels that were folded into it). */
function backToWaiting(plan: Plan, ref: LevelRef, level: AnyLevel) {
  level.status = 'waiting';
  level.executingAt = null;
  if ('ticksBelow' in level) level.ticksBelow = 0;
  if (ref.kind === 'tp') {
    for (const t of plan.tps) {
      if (t.status === 'merged' && t.mergedInto === ref.id) {
        t.status = 'waiting';
        t.mergedInto = null;
      }
    }
  }
  if (ref.kind === 'stop') {
    for (const s of stopsOf(plan)) {
      if (s.status === 'merged' && s.mergedInto === ref.id) {
        s.status = 'waiting';
        s.mergedInto = null;
        s.ticksBelow = 0; // re-confirm from scratch
      }
    }
  }
}

/**
 * A take-profit (or partial stop) sold, or was already sold, down to its target:
 * every level before it in the same list had its share go with it — levels folded
 * into it, and any still open (blocked, merged…) whose target sits at or above it.
 * Marking them keeps "what's sold" honest for top-ups and edits. Never crosses
 * lists: a take-profit's fill says nothing about the stops, and vice versa.
 */
function coveredBy(levels: SliceLevel[], sold: SliceLevel, status: 'filled' | 'done-elsewhere', dryRun = false) {
  for (const t of levels) {
    if (t === sold) continue;
    const open = t.status === 'waiting' || t.status === 'blocked' || t.status === 'merged';
    if (t.mergedInto === sold.id || (open && t.targetRemaining >= sold.targetRemaining)) {
      t.status = status;
      t.mergedInto = null;
      markDryRun(t, dryRun);
    }
  }
}

/** Mark what a take-profit / partial stop sold along with it (exits close the plan instead). */
function coverSold(plan: Plan, ref: LevelRef, level: AnyLevel, status: 'filled' | 'done-elsewhere', dryRun = false) {
  if (ref.kind === 'tp') coveredBy(plan.tps, level as TakeProfit, status, dryRun);
  if (ref.kind === 'stop') coveredBy(plan.stops, level as StopLevel, status, dryRun);
}

/** A level 'filled' in a dry run never really sold: remember that, so going live can undo it. */
function markDryRun(level: AnyLevel, dryRun: boolean) {
  if (dryRun) level.dryRun = true;
  else delete level.dryRun;
}

/** A sell in one direction changes what the other should leave: re-size both lists (plans with stops only). */
function retargetIfStops(plan: Plan) {
  if (plan.stops.length > 0) retarget(plan);
}

/** A take-profit or partial stop that may already have sold (blocked after a press). */
const maySoldLevel = (l: SliceLevel) => l.status === 'blocked' && l.clickedAt != null;

function setAttention(plan: Plan, now: number, text: string) {
  if (plan.attention === text) return; // no history spam on repeats
  plan.attention = text;
  log(plan, now, 'attention', text);
}

function clearAttentionIfResolved(plan: Plan) {
  if (!allLevels(plan).some(({ level }) => level.status === 'blocked' || level.status === 'unknown')) plan.attention = null;
}

/**
 * Feed one fresh quote (and the latest known balance, if any) into a plan.
 * Returns the updated plan and at most one action — Tippy sells one thing per
 * plan per tick, stops before take-profits.
 */
export function evaluate(
  input: Plan,
  quote: Quote,
  balance: number | null,
  ctx: EvalContext,
): { plan: Plan; actions: Action[] } {
  if (input.state !== 'armed') return { plan: input, actions: [] };
  if (!(quote.priceUSD > 0)) return { plan: input, actions: [] };

  const plan = clonePlan(input);
  const price = quote.priceUSD;
  plan.lastPrice = price;
  plan.lastMc = quote.mc;
  plan.updatedAt = ctx.now;

  if (ctx.gap) {
    plan.gapAt = ctx.now;
    if (plan.sl) plan.sl.ticksBelow = 0;
    if (plan.trailing) plan.trailing.ticksBelow = 0;
    for (const s of plan.stops) s.ticksBelow = 0;
    log(plan, ctx.now, 'gap', 'Tippy was asleep for a bit — double-checking prices before acting.');
  }
  const gapFill = plan.gapAt != null && ctx.now - plan.gapAt < GAP_FILL_WINDOW_MS;

  const inFlight = hasInFlight(plan);

  // Partial stops count their ticks at/below the level on every tick while they
  // wait — even while another sell is in flight — so a drop that holds is never missed.
  for (const s of plan.stops) {
    if (s.status === 'waiting') s.ticksBelow = isHit(s.trigger, quote, plan.entry, 'down') ? s.ticksBelow + 1 : 0;
  }

  // Trailing stop bookkeeping. The peak only ever comes from prices we actually saw.
  const tr = plan.trailing;
  if (tr && tr.status === 'waiting') {
    if (!tr.active && (tr.activateX == null || price >= plan.entry.priceUSD * tr.activateX)) {
      tr.active = true;
      tr.peakPrice = price;
      log(plan, ctx.now, 'trailing-on', `Trailing stop is on — following $${plan.symbol} up from ${formatUsd(price)}.`);
    }
    if (tr.active && price > (tr.peakPrice ?? 0)) tr.peakPrice = price;
  }

  // 1. Exits (stop loss / trailing stop) sell the rest and beat take-profits. They
  //    still fire while a take-profit is in flight: "sell the rest" is re-sized at
  //    execution time, so it can't double-sell.
  let exit: LevelRef | null = null;
  const ready = (l: { retryAfter: number | null }) => l.retryAfter == null || l.retryAfter <= ctx.now;
  const sl = plan.sl;
  if (sl && sl.status === 'waiting') {
    sl.ticksBelow = isHit(sl.trigger, quote, plan.entry, 'down') ? sl.ticksBelow + 1 : 0;
    if (sl.ticksBelow >= sl.confirmTicks && ready(sl)) exit = { kind: 'sl' };
  }
  if (tr && tr.status === 'waiting' && tr.active && tr.peakPrice) {
    const below = price <= tr.peakPrice * (1 - tr.trailPct / 100);
    tr.ticksBelow = below ? tr.ticksBelow + 1 : 0;
    if (!exit && tr.ticksBelow >= tr.confirmTicks && ready(tr)) exit = { kind: 'trail' };
  }

  if (exit) {
    const level = getLevel(plan, exit)!;
    const label = levelLabel(plan, exit);
    if (gapFill && ctx.gapPolicy === 'ask') {
      level.status = 'held';
      log(plan, ctx.now, 'held', `Your ${label} on $${plan.symbol} hit while Tippy was asleep. Waiting for your OK.`);
      return {
        plan,
        actions: [{ type: 'ask', planId: plan.id, key: plan.key, level: exit, text: `$${plan.symbol} hit your ${label} while your computer was asleep. Sell the rest now?` }],
      };
    }
    // A bag worth less than fomo's minimum can't be sold at all — say so and stop, instead of retrying forever.
    if (balance != null && balance * price >= ctx.dustUsd && balance * price < ctx.minSellUsd) {
      log(plan, ctx.now, 'too-small', `Your ${label} on $${plan.symbol} hit, but the bag (${formatUsd(balance * price)}) is below fomo's ${formatUsd(ctx.minSellUsd)} minimum sell — Tippy can't sell it.`);
      closePlan(plan, ctx.now, 'done', `Tippy stopped guarding $${plan.symbol} (too small to sell on fomo).`);
      return { plan, actions: [] };
    }
    level.status = 'queued';
    log(plan, ctx.now, 'queued', `$${plan.symbol} hit your ${label} at ${formatUsd(price)} — selling the rest.`);
    const known = balance != null && balance > 0 ? balance : null; // re-sized at execution anyway
    const action: SellAction = {
      type: 'sell',
      planId: plan.id,
      key: plan.key,
      level: exit,
      targetRemaining: 0,
      sellAmount: known,
      sellUsd: known != null ? known * price : null,
      sellPctOfCurrent: 100,
      reason: label,
      gapFill,
      priority: 0,
      queuedAt: ctx.now,
    };
    return { plan, actions: [action] };
  }

  // The whole bag is gone (sold in the fomo app, sent away…): nothing left to guard.
  // Checked only after exits, and not while a stop is confirming — the runtime only
  // passes 0 after repeated confirmations, but a stop always gets the last word.
  const stopPending =
    (plan.sl?.ticksBelow ?? 0) > 0 || (plan.trailing?.ticksBelow ?? 0) > 0 || plan.stops.some((s) => s.status === 'waiting' && s.ticksBelow > 0);
  if (!inFlight && !stopPending && balance != null && balance * price < ctx.dustUsd) {
    log(plan, ctx.now, 'sold-elsewhere', `Your $${plan.symbol} bag is gone from fomo.`);
    closePlan(plan, ctx.now, 'done', `Your $${plan.symbol} bag was sold elsewhere — Tippy stopped guarding it.`);
    return { plan, actions: [] };
  }

  // 2. Partial stops and take-profits: one sell at a time per coin, and we need a
  //    balance to size it. While a take-profit or partial stop may already have
  //    sold (blocked after a click), the others wait too: a lagging balance would
  //    make them re-sell its share.
  const maySold = plan.tps.some(maySoldLevel) || plan.stops.some(maySoldLevel);
  if (inFlight || maySold || balance == null) return { plan, actions: [] };

  // Partial stops go first: the price has held at/below them for confirmTicks ticks.
  const stopHits = plan.stops.filter((s) => s.status === 'waiting' && ready(s) && s.ticksBelow >= s.confirmTicks);
  if (stopHits.length > 0) return sellStop(plan, stopHits, price, balance, ctx, gapFill);

  // 3. Take-profits.
  const waiting = plan.tps.filter((t) => t.status === 'waiting' && ready(t));
  const crossed = waiting.filter((t) => isHit(t.trigger, quote, plan.entry, 'up'));
  if (crossed.length === 0) return { plan, actions: [] };

  // If price gapped through several levels, sell down to the deepest target in one go.
  const top = crossed.reduce((a, b) => (b.targetRemaining < a.targetRemaining ? b : a));
  for (const t of crossed) {
    if (t !== top) {
      t.status = 'merged';
      t.mergedInto = top.id; // restored if this sell is withdrawn
      log(plan, ctx.now, 'merged', `Take-profit ${describeTrigger(t.trigger)} was passed in one jump — combined with ${describeTrigger(top.trigger)}.`);
    }
  }

  // Already at/below this level's target (within 0.5% of the bag): it was sold elsewhere.
  if (balance - top.targetRemaining <= plan.origBalance * 0.005) {
    top.status = 'done-elsewhere';
    coveredBy(plan.tps, top, 'done-elsewhere');
    log(plan, ctx.now, 'done-elsewhere', `Take-profit ${describeTrigger(top.trigger)}: you'd already sold that much — nothing to do.`);
    retargetIfStops(plan);
    maybeFinish(plan, ctx.now);
    return { plan, actions: [] };
  }

  // Sizing for this sell only — the level's own target is never rewritten.
  let target = top.targetRemaining;
  const floorUsd = Math.max(ctx.minSellUsd, ctx.dustUsd);
  if (target > 0 && target * price < floorUsd) target = 0; // don't leave an unsellable crumb

  let sellAmount = balance - target;
  if (sellAmount * price < ctx.minSellUsd) {
    const next = plan.tps.find((t) => t.status === 'waiting' && t !== top && t.targetRemaining < top.targetRemaining);
    if (next) {
      top.status = 'merged';
      top.mergedInto = null; // permanently rolled into a later level
      for (const t of plan.tps) if (t.mergedInto === top.id) t.mergedInto = null;
      log(plan, ctx.now, 'merged', `Take-profit ${describeTrigger(top.trigger)} is below fomo's ${formatUsd(ctx.minSellUsd)} minimum — rolled into ${describeTrigger(next.trigger)}.`);
      return { plan, actions: [] };
    }
    if (balance * price >= ctx.minSellUsd) {
      target = 0;
      sellAmount = balance;
    } else {
      top.status = 'blocked';
      setAttention(plan, ctx.now, `Your $${plan.symbol} bag is worth less than fomo's ${formatUsd(ctx.minSellUsd)} minimum sell, so Tippy can't take profit on it.`);
      return { plan, actions: [] };
    }
  }

  top.status = 'queued';
  const pctOfCurrent = target === 0 ? 100 : Math.min(100, (sellAmount / balance) * 100);
  log(plan, ctx.now, 'queued', `$${plan.symbol} hit ${describeTrigger(top.trigger)} at ${formatUsd(price)} — taking profit.`);
  return {
    plan,
    actions: [
      {
        type: 'sell',
        planId: plan.id,
        key: plan.key,
        level: { kind: 'tp', id: top.id },
        targetRemaining: target,
        sellAmount,
        sellUsd: sellAmount * price,
        sellPctOfCurrent: pctOfCurrent,
        reason: `take-profit ${describeTrigger(top.trigger)}`,
        gapFill,
        priority: 1,
        queuedAt: ctx.now,
      },
    ],
  };
}

/** fomo's minimum for messages: "$2", "$0.50". */
function minText(usd: number): string {
  return formatUsd(usd).replace(/\.00$/, '');
}

/** A cash amount for messages: cents below $1 ("$0.48"), like formatUsd above. */
function cashText(usd: number): string {
  return usd >= 0.01 && usd < 1 ? `$${usd.toFixed(2)}` : formatUsd(usd);
}

/**
 * Partial stops whose drop has held: sell their slice of the bag. Sized exactly
 * like a take-profit (down to a declarative target). A slice below fomo's
 * minimum is folded into the next stop down, or skipped — never sold bigger.
 */
function sellStop(plan: Plan, hits: StopLevel[], price: number, balance: number, ctx: EvalContext, gapFill: boolean): { plan: Plan; actions: Action[] } {
  // Dropped through several stops at once: sell down to the deepest target in one go.
  const top = hits.reduce((a, b) => (b.targetRemaining < a.targetRemaining ? b : a));
  for (const s of hits) {
    if (s !== top) {
      s.status = 'merged';
      s.mergedInto = top.id; // restored if this sell is withdrawn
      log(plan, ctx.now, 'merged', `Stop ${describeTrigger(s.trigger)} was passed in one drop — combined with ${describeTrigger(top.trigger)}.`);
    }
  }

  // Already at/below this stop's target (within 0.5% of the bag): it was sold elsewhere.
  if (balance - top.targetRemaining <= plan.origBalance * 0.005) {
    top.status = 'done-elsewhere';
    coveredBy(plan.stops, top, 'done-elsewhere');
    log(plan, ctx.now, 'done-elsewhere', `Stop ${describeTrigger(top.trigger)}: you'd already sold that much — nothing to do.`);
    retarget(plan);
    maybeFinish(plan, ctx.now);
    return { plan, actions: [] };
  }

  // Sizing for this sell only — the stop's own target is never rewritten.
  let target = top.targetRemaining;
  const floorUsd = Math.max(ctx.minSellUsd, ctx.dustUsd);
  if (target > 0 && target * price < floorUsd) target = 0; // don't leave an unsellable crumb
  const sellAmount = balance - target;

  if (sellAmount * price < ctx.minSellUsd) {
    // Too small for fomo: fold it into the next stop down, if there is one.
    const next = plan.stops.find((s) => s.status === 'waiting' && s !== top && s.targetRemaining < top.targetRemaining);
    if (next) {
      top.status = 'merged';
      top.mergedInto = null; // permanently rolled into a lower stop
      for (const s of plan.stops) if (s.mergedInto === top.id) s.mergedInto = null;
      log(plan, ctx.now, 'merged', `Stop ${describeTrigger(top.trigger)} is below fomo's ${minText(ctx.minSellUsd)} minimum — rolled into ${describeTrigger(next.trigger)}.`);
      return { plan, actions: [] };
    }
    // Nothing lower to fold into: skip it (with the stops above whose share rode along).
    // Never sell more than it asked for just to reach the minimum.
    for (const s of plan.stops) {
      const rodeAlong = s.status === 'merged' && (s.mergedInto === top.id || (s.mergedInto == null && s.targetRemaining >= top.targetRemaining));
      if (s === top || rodeAlong) {
        s.status = 'cancelled';
        s.mergedInto = null;
      }
    }
    log(
      plan,
      ctx.now,
      'too-small',
      `Your stop at ${describeTrigger(top.trigger)} on $${plan.symbol} would sell ${cashText(sellAmount * price)} — below fomo's ${minText(ctx.minSellUsd)} minimum, so Tippy skipped it.`,
    );
    retarget(plan);
    if (!allLevels(plan).some(({ level }) => OPEN.has(level.status))) closePlan(plan, ctx.now, 'done', `Nothing left for Tippy to watch on $${plan.symbol}.`);
    return { plan, actions: [] };
  }

  top.status = 'queued';
  const pctOfCurrent = target === 0 ? 100 : Math.min(100, (sellAmount / balance) * 100);
  const what = target === 0 ? 'the rest' : `${trimPct(Math.round((sellAmount / plan.origBalance) * 1000) / 10)}% of your bag`;
  log(plan, ctx.now, 'queued', `$${plan.symbol} dropped to your stop ${describeTrigger(top.trigger)} at ${formatUsd(price)} — selling ${what}.`);
  return {
    plan,
    actions: [
      {
        type: 'sell',
        planId: plan.id,
        key: plan.key,
        level: { kind: 'stop', id: top.id },
        targetRemaining: target,
        sellAmount,
        sellUsd: sellAmount * price,
        sellPctOfCurrent: pctOfCurrent,
        reason: `stop ${describeTrigger(top.trigger)}`,
        gapFill,
        // After the stop loss / trailing stop (they sell the rest), before take-profits.
        priority: 0.5,
        queuedAt: ctx.now,
      },
    ],
  };
}

/** Close the plan once nothing is left to watch. */
function maybeFinish(plan: Plan, now: number) {
  const anyOpen = allLevels(plan).some(({ level }) => OPEN.has(level.status));
  if (!anyOpen && plan.state === 'armed') {
    plan.state = 'done';
    // No cheering when a stop did some of the selling.
    const cheer = plan.stops.some(isSold) ? '' : ' Nice one!';
    log(plan, now, 'done', `All of $${plan.symbol}'s levels are done.${cheer}`);
  }
}

export function markExecuting(input: Plan, ref: LevelRef, now: number): Plan {
  const plan = clonePlan(input);
  const level = getLevel(plan, ref);
  if (level) {
    level.status = 'executing';
    level.executingAt = now;
    level.clickedAt = null;
    level.attempts += 1;
  }
  plan.updatedAt = now;
  return plan;
}

/** The user said "yes, sell" (or "no") to a held stop after a gap. */
export function resolveHeld(input: Plan, ref: LevelRef, sell: boolean, now: number): Plan {
  if (input.state !== 'armed') return input;
  const plan = clonePlan(input);
  const level = getLevel(plan, ref);
  if (!level || level.status !== 'held') return input;
  if (sell) {
    level.status = 'queued';
    log(plan, now, 'queued', `OK — selling the rest of $${plan.symbol}.`);
  } else {
    backToWaiting(plan, ref, level);
    plan.gapAt = null;
    log(plan, now, 'resumed', `Got it — Tippy keeps watching $${plan.symbol}.`);
  }
  return plan;
}

export type ExecOutcome =
  /** `soldAmount`: tokens actually sold, when the executor knows. */
  | { status: 'filled'; balanceAfter: number | null; detail?: string; dryRun?: boolean; soldAmount?: number }
  | { status: 'unknown'; detail?: string }
  /** The fresh balance was already at/below target — sold elsewhere. */
  | { status: 'done-elsewhere' }
  /** The price slipped back past the level before selling. */
  | { status: 'stale' }
  /** Not sold and nothing pressed — paused, kill switch, session lost… Doesn't count as an attempt. */
  | { status: 'aborted'; reason: string }
  | { status: 'failed'; detail: string; retryable: boolean };

/** Apply what the executor reported for a level. */
export function applyOutcome(input: Plan, ref: LevelRef, outcome: ExecOutcome, now: number): Plan {
  const plan = clonePlan(input);
  const level = getLevel(plan, ref);
  if (!level) return input;
  const label = levelLabel(plan, ref);
  const closed = isClosed(plan);
  const exit = isExitRef(plan, ref);

  if (outcome.status === 'filled') {
    level.status = 'filled';
    level.executingAt = null;
    level.clickedAt = null;
    markDryRun(level, !!outcome.dryRun);
    // Levels folded into this sell (or before it in the same list) were sold with it.
    coverSold(plan, ref, level, 'filled', !!outcome.dryRun);
    log(plan, now, 'filled', `Sold $${plan.symbol} at your ${label}.${outcome.detail ? ' ' + outcome.detail : ''}`);
    if (closed) return plan;
    retargetIfStops(plan);
    const price = plan.lastPrice ?? 0;
    const bagGone = outcome.balanceAfter != null && price > 0 && outcome.balanceAfter * price < 1;
    if (exit || bagGone) closePlan(plan, now, 'done', ref.kind === 'tp' ? `That was the last of $${plan.symbol}. Nice one!` : `Tippy closed out $${plan.symbol}.`);
    else {
      clearAttentionIfResolved(plan);
      maybeFinish(plan, now);
    }
    return plan;
  }

  if (outcome.status === 'unknown') {
    level.status = closed ? 'cancelled' : 'unknown';
    // The reconcile window runs from the (possible) click, not from dequeue.
    level.executingAt = now;
    level.clickedAt = now;
    log(plan, now, 'unknown', `Tippy pressed sell for your ${label} but the balance hasn't moved yet — checking again shortly.`);
    return plan;
  }

  if (outcome.status === 'done-elsewhere') {
    level.status = 'done-elsewhere';
    level.executingAt = null;
    coverSold(plan, ref, level, 'done-elsewhere');
    log(plan, now, 'done-elsewhere', `Your ${label}: you'd already sold that much — nothing to do.`);
    if (closed) return plan;
    retargetIfStops(plan);
    if (exit) closePlan(plan, now, 'done', `Your $${plan.symbol} bag was sold elsewhere — Tippy stopped guarding it.`);
    else maybeFinish(plan, now);
    return plan;
  }

  if (closed) {
    // A late "didn't sell" for a plan that's already finished: just record it.
    level.status = 'cancelled';
    level.executingAt = null;
    return plan;
  }

  if (outcome.status === 'aborted' || outcome.status === 'stale') {
    backToWaiting(plan, ref, level);
    level.attempts = Math.max(0, level.attempts - 1);
    level.retryAfter = now + 10_000;
    log(plan, now, 'retry', outcome.status === 'aborted' ? `Didn't sell $${plan.symbol} for your ${label}: ${outcome.reason}` : `$${plan.symbol} moved back past your ${label} — Tippy is still watching.`);
    return plan;
  }

  // failed before (or without) clicking confirm
  level.retryAfter = now + Math.min(RETRY_MAX_MS, RETRY_BASE_MS * 2 ** Math.max(0, level.attempts - 1));
  if (exit) {
    // A stop must keep trying while the plan is armed; tell the user if it keeps failing.
    backToWaiting(plan, ref, level);
    log(plan, now, 'retry', `Couldn't sell for your ${label} (${outcome.detail}). Tippy will keep trying.`);
    if (level.attempts >= MAX_ATTEMPTS) setAttention(plan, now, `Tippy keeps failing to sell $${plan.symbol} for your ${label} — it's still trying. Check fomo.`);
  } else if (outcome.retryable && level.attempts < MAX_ATTEMPTS) {
    backToWaiting(plan, ref, level);
    log(plan, now, 'retry', `Couldn't sell for your ${label} (${outcome.detail}). Tippy will try again if it's still there.`);
  } else {
    level.status = 'blocked';
    level.executingAt = null;
    setAttention(plan, now, `Tippy couldn't sell $${plan.symbol} for your ${label}: ${outcome.detail}. Tap Retry when you're ready.`);
  }
  return plan;
}

/**
 * Settle levels stuck in executing/unknown (after a restart or an unconfirmed
 * click) by looking at the live balance. Never re-clicks a take-profit on its
 * own: after the window it becomes 'blocked' and asks for a Retry. Exits are
 * re-armed (they can't oversell). `price` is the current price (for the dust
 * tolerance); `skip` is the level the queue is executing right now.
 */
export function reconcile(input: Plan, balance: number | null, now: number, price: number | null, dustUsd = 1, skip?: LevelRef | null): Plan {
  let plan = input;
  if (price != null && price > 0 && price !== input.lastPrice) {
    plan = clonePlan(input);
    plan.lastPrice = price;
  }
  for (const { ref, level } of allLevels(input)) {
    const lateConfirm = level.status === 'blocked' && level.clickedAt != null;
    if (level.status !== 'executing' && level.status !== 'unknown' && !lateConfirm) continue;
    if (skip && sameRef(skip, ref)) continue;
    const target = levelTarget(input, ref);
    const tol = toleranceTokens(input, price ?? input.lastPrice, dustUsd);
    if (balance != null && balance <= target + tol) {
      plan = applyOutcome(plan, ref, { status: 'filled', balanceAfter: balance, detail: '(confirmed by your balance)' }, now);
      continue;
    }
    if (lateConfirm) continue; // still waiting for the user's Retry
    const since = level.clickedAt ?? level.executingAt;
    if (since == null || now - since <= RECONCILE_AFTER_MS) continue;
    plan = clonePlan(plan);
    const l = getLevel(plan, ref)!;
    l.executingAt = null;
    if (isClosed(plan)) {
      l.status = 'cancelled';
    } else if (isExitRef(plan, ref)) {
      backToWaiting(plan, ref, l);
      l.clickedAt = null;
      l.retryAfter = now + Math.min(RETRY_MAX_MS, RETRY_BASE_MS * 2 ** Math.max(0, l.attempts - 1));
      log(plan, now, 'retry', `The sell didn't go through — Tippy is watching $${plan.symbol} again.`);
      if (l.attempts >= MAX_ATTEMPTS) setAttention(plan, now, `Tippy's sells of $${plan.symbol} for your ${levelLabel(plan, ref)} aren't showing up in your balance. Please check fomo.`);
    } else {
      // A take-profit / partial stop that was executing when the worker died may have been pressed.
      l.clickedAt ??= since;
      l.status = 'blocked';
      setAttention(plan, now, `Tippy pressed sell for your ${levelLabel(plan, ref)} on $${plan.symbol}, but your balance hasn't changed. Check fomo, then tap Retry if it didn't sell.`);
    }
  }
  return plan;
}

/** The user tapped Retry on a blocked / unconfirmed level. */
export function retryLevel(input: Plan, ref: LevelRef, now: number): Plan {
  if (isClosed(input)) return input;
  const plan = clonePlan(input);
  const level = getLevel(plan, ref);
  if (!level || (level.status !== 'blocked' && level.status !== 'unknown')) return input;
  backToWaiting(plan, ref, level);
  level.attempts = 0;
  level.clickedAt = null;
  level.retryAfter = null;
  clearAttentionIfResolved(plan);
  log(plan, now, 'retry', `OK — Tippy will try your ${levelLabel(plan, ref)} on $${plan.symbol} again.`);
  return plan;
}

/**
 * Dry run was switched off. Take-profits and partial stops 'filled' in the dry
 * run never really sold: put them back to watching (stops count their ticks
 * again from scratch) and re-size every open level from the real bag. Real fills
 * stay as they are. Finished plans, and plans without dry-run fills, come back
 * unchanged (the same object).
 */
export function undoDryRunFills(input: Plan, now: number): Plan {
  if (isClosed(input)) return input;
  const dryFilled = (l: SliceLevel) => l.status === 'filled' && l.dryRun === true;
  if (!input.tps.some(dryFilled) && !stopsOf(input).some(dryFilled)) return input;
  const plan = clonePlan(input);
  for (const l of [...plan.tps, ...plan.stops]) {
    if (!dryFilled(l)) continue;
    Object.assign(l, newLevelBase(), { mergedInto: null });
    delete l.dryRun;
    if ('ticksBelow' in l) l.ticksBelow = 0;
  }
  retarget(plan);
  log(plan, now, 'rescaled', `Dry run is off — the levels Tippy only pretended to sell on $${plan.symbol} are back on, sized on your real bag.`);
  return plan;
}

/**
 * The user bought more of a coin Tippy is guarding: scale the bag (and
 * optionally the entry, e.g. a weighted average) so the percentages still mean
 * "of your bag".
 */
export function rescale(input: Plan, newBalance: number, now: number, newEntryPrice?: number): Plan {
  const plan = clonePlan(input);
  const soldPct = Math.min(99, consumedPct(plan));
  plan.origBalance = newBalance / (1 - soldPct / 100);
  if (newEntryPrice && newEntryPrice > 0) {
    // Market cap moves with price (same supply), so mc levels keep meaning the same thing.
    const old = plan.entry;
    plan.entry = { ...old, priceUSD: newEntryPrice, mc: old.mc != null && old.priceUSD > 0 ? (old.mc * newEntryPrice) / old.priceUSD : null };
  }
  // A new entry moves "x" levels but not price / market-cap ones: re-sort before re-targeting.
  retarget(plan);
  log(plan, now, 'rescaled', `You added to $${plan.symbol} — Tippy updated your levels.`);
  return plan;
}

const isSold = (t: SliceLevel) => t.status === 'filled' || t.status === 'done-elsewhere';

/** % of the original bag already sold (here or elsewhere) — by take-profits and partial stops. */
function consumedPct(plan: Plan): number {
  return [...plan.tps, ...stopsOf(plan)].reduce((sum, t) => (isSold(t) ? sum + t.sellPct : sum), 0);
}

/**
 * Sort take-profits (lowest price first) and partial stops (highest first — the
 * order they're hit in) and recompute the open levels' targets: what's already
 * sold, in either direction, comes off the top, then each remaining level sells
 * its % of the original bag in the order it would be hit.
 */
function retarget(plan: Plan) {
  const at = (t: TakeProfit) => {
    const p = triggerPrice(t.trigger, plan.entry);
    return Number.isFinite(p) ? p : Infinity;
  };
  plan.tps.sort((a, b) => at(a) - at(b));
  const consumed = Math.min(100, consumedPct(plan));
  targetLadder(plan, plan.tps, consumed);
  if (plan.stops.length > 0) targetLadder(plan, sortStops(plan.stops, plan.entry), consumed);
}

/** Cumulative targets down one list, starting from what's already sold. */
function targetLadder(plan: Plan, levels: SliceLevel[], consumed: number) {
  // What's sold comes off the top; every other level counts in order (a merged
  // level's share is sold by the level it was folded into, after it).
  let cum = consumed;
  for (const t of levels) {
    if (isSold(t) || t.status === 'cancelled') continue;
    cum = Math.min(100, cum + t.sellPct);
    // Re-size everything that hasn't sold and isn't mid-sell — including blocked levels
    // (a Retry sells this size) and merged ones (restored if their sell is withdrawn).
    if (t.status === 'waiting' || t.status === 'blocked' || t.status === 'merged') t.targetRemaining = cum >= 100 ? 0 : plan.origBalance * (1 - cum / 100);
  }
}

export interface PlanEdit {
  /** Take-profits to keep or add. `id` = an existing level being changed; null = a new one. */
  tps: { id: string | null; trigger: Trigger; sellPct: number }[];
  /** Partial stops to keep or add, like `tps`. Left out = the plan's stops stay exactly as they are. */
  stops?: { id: string | null; trigger: Trigger; sellPct: number }[];
  sl: { trigger: Trigger } | null;
  trailing: { trailPct: number; activateX: number | null } | null;
}

/**
 * The running plan as an edit, with one level moved (a dragged chart line). Every
 * other level stays exactly as it is.
 */
export function planEditWith(plan: Plan, move: { tp?: { id: string; trigger: Trigger }; sl?: Trigger; stop?: { id: string; trigger: Trigger } }): PlanEdit {
  return {
    tps: plan.tps.filter(isEditableTp).map((t) => ({ id: t.id, trigger: move.tp && move.tp.id === t.id ? move.tp.trigger : t.trigger, sellPct: t.sellPct })),
    stops: stopsOf(plan)
      .filter(isEditableStop)
      .map((s) => ({ id: s.id, trigger: move.stop && move.stop.id === s.id ? move.stop.trigger : s.trigger, sellPct: s.sellPct })),
    sl: plan.sl ? { trigger: move.sl ?? plan.sl.trigger } : null,
    trailing: plan.trailing ? { trailPct: plan.trailing.trailPct, activateX: plan.trailing.activateX } : null,
  };
}

/** Take-profits the user may still change: watching, or given up on before anything was pressed. */
export function isEditableTp(t: TakeProfit): boolean {
  return t.status === 'waiting' || (t.status === 'blocked' && t.clickedAt == null);
}

/** Partial stops the user may still change — the same rule as take-profits. */
export function isEditableStop(s: StopLevel): boolean {
  return s.status === 'waiting' || (s.status === 'blocked' && s.clickedAt == null);
}

const sameTrigger = (a: Trigger, b: Trigger) => a.kind === b.kind && a.value === b.value;

/**
 * Replace a plan's editable partial stops with the edit (take-profit rules,
 * counted separately toward their own 100%). Returns an error, or null when done.
 */
function editStops(plan: Plan, edits: NonNullable<PlanEdit['stops']>): { error: string; stale?: boolean } | null {
  const byId = new Map(plan.stops.map((s) => [s.id, s]));
  for (const e of edits) {
    const s = e.id != null ? byId.get(e.id) : null;
    if (e.id != null && (!s || !isEditableStop(s))) return { error: 'Your plan just changed (a stop may have sold) — check it again.', stale: true };
  }
  for (const e of edits) {
    const p = triggerPrice(e.trigger, plan.entry);
    if (!(e.trigger.value > 0) || !Number.isFinite(p) || p <= 0) return { error: "Tippy can't place one of your stops (no market cap yet?)." };
    if (!(e.sellPct > 0 && e.sellPct <= 100)) return { error: 'Sell amount must be between 1% and 100%.' };
  }
  // Every stop counts toward the 100% — sold, merged or open (merged ones whose sell you remove go with it).
  const keptIds = new Set([...plan.stops.filter((s) => !isEditableStop(s)).map((s) => s.id), ...edits.flatMap((e) => (e.id != null ? [e.id] : []))]);
  const orphan = (s: StopLevel) => s.status === 'merged' && s.mergedInto != null && !keptIds.has(s.mergedInto);
  const total = plan.stops.filter((s) => !isEditableStop(s) && s.status !== 'cancelled' && !orphan(s)).reduce((sum, s) => sum + s.sellPct, 0) + edits.reduce((sum, e) => sum + e.sellPct, 0);
  if (total > 100.0001) return { error: `Your stops add up to ${Math.round(total)}% of the bag (including what already sold) — keep it at 100% or less.` };

  // Keep locked stops as they are; replace every editable one with the edit.
  const used = new Set(plan.stops.map((s) => s.id));
  let n = plan.stops.length;
  const nextId = () => {
    while (used.has(`st${++n}`));
    used.add(`st${n}`);
    return `st${n}`;
  };
  // Stops folded into one you're changing come back: the edit withdraws that sell.
  const editedIds = new Set(edits.flatMap((e) => (e.id != null ? [e.id] : [])));
  const kept = plan.stops
    .filter((s) => !isEditableStop(s) && !orphan(s))
    .map((s) => (s.status === 'merged' && s.mergedInto != null && editedIds.has(s.mergedInto) ? { ...s, status: 'waiting' as const, mergedInto: null, ticksBelow: 0 } : s));
  const edited: StopLevel[] = edits.map((e) => {
    const old = e.id != null ? byId.get(e.id)! : null;
    const s = newStop(old?.id ?? nextId(), e.trigger, e.sellPct);
    s.confirmTicks = old?.confirmTicks ?? s.confirmTicks;
    // An unchanged stop keeps counting its ticks (dragging another line doesn't restart it).
    if (old && old.status === 'waiting' && sameTrigger(old.trigger, e.trigger)) s.ticksBelow = old.ticksBelow;
    return s;
  });
  plan.stops = [...kept, ...edited];
  return null;
}

/**
 * Change a running plan in place. The entry and the original bag stay as they
 * were, levels that already sold stay sold (and count toward the 100%), and
 * nothing is touched while a sell is in flight.
 */
export function editPlan(input: Plan, edit: PlanEdit, now: number): { ok: true; plan: Plan } | { ok: false; error: string; stale?: boolean } {
  if (isClosed(input)) return { ok: false, error: 'This plan has already finished.', stale: true };
  if (hasInFlight(input)) return { ok: false, error: 'Tippy is in the middle of a sell on this coin — try again in a moment.', stale: true };
  const plan = clonePlan(input);
  const byId = new Map(plan.tps.map((t) => [t.id, t]));
  for (const e of edit.tps) {
    const t = e.id != null ? byId.get(e.id) : null;
    if (e.id != null && (!t || !isEditableTp(t))) return { ok: false, error: 'Your plan just changed (a take-profit may have sold) — check it again.', stale: true };
  }
  for (const e of edit.tps) {
    const p = triggerPrice(e.trigger, plan.entry);
    if (!Number.isFinite(p) || p <= 0) return { ok: false, error: "Tippy can't place one of your take-profits (no market cap yet?)." };
    if (!(e.sellPct > 0 && e.sellPct <= 100)) return { ok: false, error: 'Sell amount must be between 1% and 100%.' };
  }
  // Every level counts toward the 100% — sold, merged or open (merged ones whose sell you remove go with it).
  const keptIds = new Set([...plan.tps.filter((t) => !isEditableTp(t)).map((t) => t.id), ...edit.tps.flatMap((e) => (e.id != null ? [e.id] : []))]);
  const orphan = (t: TakeProfit) => t.status === 'merged' && t.mergedInto != null && !keptIds.has(t.mergedInto);
  const total = plan.tps.filter((t) => !isEditableTp(t) && t.status !== 'cancelled' && !orphan(t)).reduce((s, t) => s + t.sellPct, 0) + edit.tps.reduce((s, e) => s + e.sellPct, 0);
  if (total > 100.0001) return { ok: false, error: `Your take-profits add up to ${Math.round(total)}% of the bag (including what already sold) — keep it at 100% or less.` };

  // Keep locked levels as they are; replace every editable one with the edit.
  const used = new Set(plan.tps.map((t) => t.id));
  let n = plan.tps.length;
  const nextId = () => {
    while (used.has(`tp${++n}`));
    used.add(`tp${n}`);
    return `tp${n}`;
  };
  // Levels folded into a take-profit you're changing come back: the edit withdraws that sell.
  const editedIds = new Set(edit.tps.flatMap((e) => (e.id != null ? [e.id] : [])));
  const kept = plan.tps
    .filter((t) => !isEditableTp(t) && !orphan(t))
    .map((t) => (t.status === 'merged' && t.mergedInto != null && editedIds.has(t.mergedInto) ? { ...t, status: 'waiting' as const, mergedInto: null } : t));
  const edited: TakeProfit[] = edit.tps.map((e) => {
    const old = e.id != null ? byId.get(e.id)! : null;
    return { ...newLevelBase(), id: old?.id ?? nextId(), trigger: e.trigger, sellPct: e.sellPct, targetRemaining: 0, mergedInto: null };
  });
  plan.tps = [...kept, ...edited];

  if (edit.stops) {
    const bad = editStops(plan, edit.stops);
    if (bad) return { ok: false, ...bad };
  }

  if (edit.sl) {
    const same = plan.sl && plan.sl.trigger.kind === edit.sl.trigger.kind && plan.sl.trigger.value === edit.sl.trigger.value;
    if (!same) plan.sl = { trigger: edit.sl.trigger, confirmTicks: plan.sl?.confirmTicks ?? 2, ticksBelow: 0, ...newLevelBase() };
  } else {
    plan.sl = null;
  }
  if (edit.trailing) {
    const t = plan.trailing;
    if (!t || t.trailPct !== edit.trailing.trailPct || t.activateX !== edit.trailing.activateX) {
      plan.trailing = {
        trailPct: edit.trailing.trailPct,
        activateX: edit.trailing.activateX,
        // keep the highest price seen so far — re-arming must not forget the top
        peakPrice: t?.peakPrice ?? null,
        active: (t?.active ?? false) && (edit.trailing.activateX == null || (t?.peakPrice ?? 0) >= plan.entry.priceUSD * edit.trailing.activateX),
        confirmTicks: t?.confirmTicks ?? 2,
        ticksBelow: 0,
        ...newLevelBase(),
      };
    }
  } else {
    plan.trailing = null;
  }

  retarget(plan);
  clearAttentionIfResolved(plan);
  const nothingLeft = plan.tps.every((t) => !isEditableTp(t) && t.status !== 'blocked') && plan.stops.every((s) => !isEditableStop(s) && s.status !== 'blocked');
  if (nothingLeft && !plan.sl && !plan.trailing) return { ok: false, error: 'Add at least one take-profit or a stop loss (or tap Stop to stop guarding).' };
  log(plan, now, 'edited', `You changed the plan: ${summarizePlan(plan)}`);
  return { ok: true, plan };
}

/** Withdraw queued (not yet started) sells — one level, or all — back to watching. */
export function withdrawQueued(input: Plan, ref?: LevelRef): Plan {
  const plan = clonePlan(input);
  for (const { ref: r, level } of allLevels(plan)) {
    if (level.status !== 'queued' || (ref && !sameRef(ref, r))) continue;
    if (isClosed(plan)) level.status = 'cancelled';
    else backToWaiting(plan, r, level);
  }
  return plan;
}

export function pausePlan(input: Plan, now: number): Plan {
  if (input.state !== 'armed') return input;
  const plan = withdrawQueued(input);
  plan.state = 'paused';
  log(plan, now, 'paused', `Paused $${plan.symbol}.`);
  return plan;
}

/**
 * Resume a paused plan. Deliberately does NOT touch levels that may have sold
 * (unknown / executing / blocked) — those need an explicit Retry.
 */
export function resumePlan(input: Plan, now: number): Plan {
  if (input.state !== 'paused') return input;
  const plan = clonePlan(input);
  plan.state = 'armed';
  if (plan.sl) plan.sl.ticksBelow = 0;
  if (plan.trailing) plan.trailing.ticksBelow = 0;
  for (const s of plan.stops) s.ticksBelow = 0;
  for (const { ref, level } of allLevels(plan)) if (level.status === 'held') backToWaiting(plan, ref, level);
  log(plan, now, 'resumed', `Tippy is watching $${plan.symbol} again.`);
  return plan;
}

export function cancelPlan(input: Plan, now: number): Plan {
  if (isClosed(input)) return input; // finished plans stay as they are
  const plan = clonePlan(input);
  closePlan(plan, now, 'cancelled', `Stopped guarding $${plan.symbol}.`);
  return plan;
}

/** Levels the user can Retry. */
export function retryableLevels(plan: Plan): LevelRef[] {
  return allLevels(plan)
    .filter(({ level }) => level.status === 'blocked')
    .map(({ ref }) => ref);
}

/** Current multiple vs entry, for the UI. */
export function currentX(plan: Plan): number | null {
  return plan.lastPrice && plan.entry.priceUSD > 0 ? plan.lastPrice / plan.entry.priceUSD : null;
}

/** Sort sells: stops first, then the biggest positions. */
export function sortActions<T extends Action | BuyAction>(actions: T[]): T[] {
  return [...actions].sort((a, b) => {
    const pa = a.type === 'ask' ? -1 : a.priority;
    const pb = b.type === 'ask' ? -1 : b.priority;
    if (pa !== pb) return pa - pb;
    const ua = a.type === 'sell' ? (a.sellUsd ?? Infinity) : 0;
    const ub = b.type === 'sell' ? (b.sellUsd ?? Infinity) : 0;
    return ub - ua;
  });
}
