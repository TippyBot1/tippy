// Limit buys: "buy $10 of $WIF when it dips to $1M MC" — or breaks out to a level.
// Pure functions, no chrome APIs (like orders.ts), so every rule is testable.
//
// Safety rules:
//  - One-shot. Once Tippy may have pressed Buy (state 'executing' → 'unknown'),
//    it never presses again for that order unless the user says "it didn't buy".
//  - A level must hold for BUY_CONFIRM_TICKS ticks (one wick doesn't buy).
//  - Never chase: if the price has run more than BUY_BAND past the level (a dip
//    that kept crashing, a breakout that already pumped), Tippy holds off.
//  - Paused / cancelled / expired orders never buy.

import { describeTrigger, formatUsd, isHit, triggerPrice } from './triggers';
import type { BuyAction, BuyEvent, BuyInput, BuyOrder, Entry, Quote, Trigger } from './types';

/** Ticks the price must sit at the level before buying. */
export const BUY_CONFIRM_TICKS = 2;
/** Don't buy if the price is more than this far past the level (25%). */
export const BUY_BAND = 0.25;
/** Retryable failures (nothing pressed) before giving up. */
export const BUY_MAX_ATTEMPTS = 4;
const BACKOFF_MS = [15_000, 30_000, 60_000, 120_000];
/** Wait before re-checking after "not enough cash". */
export const NO_CASH_RETRY_MS = 60_000;
/** After an aborted attempt (paused, logged out…), don't spin. */
const ABORT_RETRY_MS = 15_000;
/** Buys run after every sell (stops 0, take-profits 1). */
export const BUY_PRIORITY = 2;
/**
 * Ticks further apart than this aren't "consecutive" (a sleep or blind spell in
 * between). Generous: one tick can take ~20s when fomo's API is slow (two 8s
 * calls plus the 3s pause), yet still far below the 2-minute sleep check.
 */
export const BUY_TICK_GAP_MS = 30_000;
/** How long an earlier press can still land (fomo's balances lag minutes, not hours). */
export const PRIOR_PRESS_MS = 30 * 60_000;
/** More coins than this × what the buy should bring can't all be from the buy. */
const FILL_MAX_RATIO = 1.5;
/** At least this share of the expected coins means the buy landed. */
const FILL_MIN_RATIO = 0.5;
/** A level this close to the price now is neither a dip nor a breakout. */
const MIN_DISTANCE = 0.005;
const HISTORY_LIMIT = 30;

export type BuyOutcome =
  | {
      status: 'filled';
      got: number | null;
      price: number | null;
      dryRun?: boolean;
      note?: string;
      /** The whole balance read after the buy — what a new guard is sized on. */
      balanceAfter?: number | null;
    }
  /** Pressed (or may have) but the coins haven't shown up. */
  | { status: 'unknown'; detail?: string }
  /** Nothing was pressed. */
  | { status: 'failed'; detail: string; retryable: boolean }
  /** The price moved back out of range before buying. */
  | { status: 'stale' }
  /** Stopped before pressing (paused, logged out, order changed…). */
  | { status: 'aborted'; reason: string }
  | { status: 'no-cash'; cash: number | null };

const ACTIVE: BuyOrder['state'][] = ['armed', 'queued', 'executing', 'unknown'];
export const isLiveBuy = (o: BuyOrder) => ACTIVE.includes(o.state);
const isClosedBuy = (o: BuyOrder) => o.state === 'filled' || o.state === 'failed' || o.state === 'cancelled' || o.state === 'expired';

function log(o: BuyOrder, at: number, kind: BuyEvent['kind'], text: string): BuyOrder {
  return { ...o, updatedAt: at, history: [...o.history, { at, kind, text }].slice(-HISTORY_LIMIT) };
}

/** The level as a multiple of the reference price (0.8 = 20% below). NaN if unknown. */
export function buyX(trigger: Trigger, ref: Entry): number {
  if (!(ref.priceUSD > 0)) return NaN;
  return triggerPrice(trigger, ref) / ref.priceUSD;
}

/** "−20%", "+15%" from where it was when placed. */
export function buyMove(order: Pick<BuyOrder, 'trigger' | 'ref'>): string {
  const x = buyX(order.trigger, order.ref);
  if (!Number.isFinite(x)) return '';
  const pct = +(Math.abs(1 - x) * 100).toFixed(1);
  return `${x < 1 ? '−' : '+'}${pct}%`;
}

/** "$341K MC", "$0.0041", "−20%". */
export function buyLevelText(trigger: Trigger): string {
  if (trigger.kind === 'mc') return `${formatUsd(trigger.value)} MC`;
  return describeTrigger(trigger);
}

/** "Buy $10 at $341K MC (dip)". */
export function summarizeBuy(o: BuyOrder): string {
  return `Buy ${formatUsd(o.usd)} at ${buyLevelText(o.trigger)} (${o.direction === 'down' ? 'dip' : 'breakout'})`;
}

export interface BuyIssue {
  field: 'ref' | 'usd' | 'trigger' | 'expiry';
  message: string;
}

export function validateBuyInput(input: Omit<BuyInput, 'id' | 'now'>, minUsd = 1): BuyIssue[] {
  const issues: BuyIssue[] = [];
  if (!(input.ref.priceUSD > 0)) issues.push({ field: 'ref', message: "Tippy can't see this coin's price yet." });
  if (!(input.usd > 0) || !Number.isFinite(input.usd)) issues.push({ field: 'usd', message: 'Pick how much to buy.' });
  else if (input.usd < minUsd) issues.push({ field: 'usd', message: `fomo's minimum buy here is ${formatUsd(minUsd)}.` });
  if (!(input.trigger.value > 0) || !Number.isFinite(input.trigger.value)) issues.push({ field: 'trigger', message: 'Pick a price or market cap to buy at.' });
  else if (input.trigger.kind === 'mc' && !(input.ref.mc && input.ref.mc > 0)) issues.push({ field: 'trigger', message: "Tippy can't see this coin's market cap — use a price instead." });
  else {
    const x = buyX(input.trigger, input.ref);
    if (Number.isFinite(x) && Math.abs(x - 1) < MIN_DISTANCE) issues.push({ field: 'trigger', message: "That's where it is now — pick a dip below or a breakout above." });
  }
  if (input.expiresInMs != null && !(input.expiresInMs > 0)) issues.push({ field: 'expiry', message: 'Pick when this order should expire.' });
  return issues;
}

export function buildBuy(input: BuyInput): BuyOrder {
  const x = buyX(input.trigger, input.ref);
  const direction: BuyOrder['direction'] = x < 1 ? 'down' : 'up';
  const order: BuyOrder = {
    id: input.id,
    key: input.key,
    networkId: input.networkId,
    address: input.address,
    symbol: input.symbol,
    name: input.name,
    trigger: input.trigger,
    direction,
    ref: input.ref,
    usd: input.usd,
    state: 'armed',
    guardPresetId: input.guardPresetId,
    expiresAt: input.expiresInMs != null ? input.now + input.expiresInMs : null,
    createdAt: input.now,
    updatedAt: input.now,
    ticksAt: 0,
    attempts: 0,
    retryAfter: null,
    queuedAt: null,
    executingAt: null,
    balanceBefore: null,
    expectedAmount: null,
    filledAt: null,
    got: null,
    fillPrice: null,
    planId: null,
    dryRun: false,
    lastPrice: input.ref.priceUSD,
    lastMc: input.ref.mc,
    attention: null,
    history: [],
  };
  return log(order, input.now, 'armed', `${summarizeBuy(order)}.`);
}

/** Where the quote is relative to the level: 'at' (buy), 'before' (not there yet), 'past' (ran too far). */
export function buyZone(o: Pick<BuyOrder, 'trigger' | 'ref' | 'direction'>, quote: Pick<Quote, 'priceUSD' | 'mc'>): 'before' | 'at' | 'past' {
  const q: Quote = { priceUSD: quote.priceUSD, mc: quote.mc, at: 0 };
  if (!isHit(o.trigger, q, o.ref, o.direction)) return 'before';
  // Compare in the trigger's own units (market cap when fomo gives one).
  let current: number;
  let level: number;
  if (o.trigger.kind === 'mc' && quote.mc != null && quote.mc > 0) {
    current = quote.mc;
    level = o.trigger.value;
  } else {
    current = quote.priceUSD;
    level = triggerPrice(o.trigger, o.ref);
  }
  if (!Number.isFinite(level) || level <= 0) return 'before';
  const past = o.direction === 'down' ? current < level * (1 - BUY_BAND) : current > level * (1 + BUY_BAND);
  return past ? 'past' : 'at';
}

export interface BuyEval {
  order: BuyOrder;
  action: BuyAction | null;
}

/** One tick for one order. Only 'armed' orders can fire. */
export function evaluateBuy(order: BuyOrder, quote: Quote | null, now: number): BuyEval {
  let o = order;
  if (isClosedBuy(o)) return { order: o, action: null };
  if ((o.state === 'armed' || o.state === 'queued') && o.expiresAt != null && now >= o.expiresAt) {
    o = log({ ...o, state: 'expired', ticksAt: 0, queuedAt: null, attention: null }, now, 'expired', 'Expired before the price got there.');
    return { order: o, action: null };
  }
  if (o.state !== 'armed' || !quote) return { order: o, action: null };
  o = { ...o, lastPrice: quote.priceUSD, lastMc: quote.mc ?? o.lastMc };
  if (o.retryAfter != null && now < o.retryAfter) return { order: o, action: null };

  const zone = buyZone(o, quote);
  if (zone === 'before') {
    // Back in range: forget a "ran past" note.
    const cleared = o.attention && o.history[o.history.length - 1]?.kind === 'too-far' ? { attention: null } : {};
    return { order: { ...o, ticksAt: 0, lastAtTick: null, ...cleared }, action: null };
  }
  if (zone === 'past') {
    if (o.history[o.history.length - 1]?.kind !== 'too-far') {
      const text =
        o.direction === 'down'
          ? `$${o.symbol} fell more than ${BUY_BAND * 100}% past your level — Tippy is holding off (no catching falling knives). It'll buy if it comes back up to your level.`
          : `$${o.symbol} pumped more than ${BUY_BAND * 100}% past your level — Tippy won't chase it. It'll buy if it comes back down to your level.`;
      o = log({ ...o, attention: text }, now, 'too-far', text);
    }
    return { order: { ...o, ticksAt: 0, lastAtTick: null }, action: null };
  }

  // Only back-to-back ticks count: a wick before a sleep plus one tick after isn't "held".
  const consecutive = o.lastAtTick != null && now - o.lastAtTick <= BUY_TICK_GAP_MS;
  const ticksAt = (consecutive ? o.ticksAt : 0) + 1;
  if (ticksAt < BUY_CONFIRM_TICKS) return { order: { ...o, ticksAt, lastAtTick: now }, action: null };
  o = log({ ...o, ticksAt: 0, lastAtTick: null, state: 'queued', queuedAt: now, attention: null }, now, 'hit', `Hit ${buyLevelText(o.trigger)} at ${formatUsd(quote.priceUSD)}.`);
  const action: BuyAction = { type: 'buy', orderId: o.id, key: o.key, usd: o.usd, priority: BUY_PRIORITY, queuedAt: now, reason: summarizeBuy(o) };
  return { order: o, action };
}

/** Pause / kill switch: a queued buy goes back to watching (it re-fires only if the price still says so). */
export function withdrawBuy(order: BuyOrder, now: number): BuyOrder {
  if (order.state !== 'queued') return order;
  return { ...order, state: 'armed', queuedAt: null, ticksAt: 0, updatedAt: now };
}

export function markBuyExecuting(order: BuyOrder, now: number): BuyOrder {
  if (order.state !== 'queued') return order;
  return log({ ...order, state: 'executing', executingAt: now }, now, 'executing', 'Opening fomo to buy…');
}

/** Right before driving fomo: remember the balance and the coins expected, so the fill can be confirmed even after a restart. */
export function prepareBuy(order: BuyOrder, balanceBefore: number, expectedAmount: number | null, now: number): BuyOrder {
  if (order.state !== 'executing') return order;
  return { ...order, balanceBefore, expectedAmount, updatedAt: now };
}

const UNKNOWN_TEXT = (o: BuyOrder) =>
  `Tippy pressed Buy for ${formatUsd(o.usd)} of $${o.symbol}, but your balance hasn't changed yet. Check fomo — tap "It bought" or "It didn’t buy".`;

export function applyBuyOutcome(order: BuyOrder, outcome: BuyOutcome, now: number): BuyOrder {
  let o = { ...order, executingAt: null };
  // A fill is the truth even if the order was cancelled mid-buy.
  if (outcome.status === 'filled') {
    if (o.state === 'filled') return o;
    const text = outcome.dryRun
      ? `Dry run — would have bought ${formatUsd(o.usd)} of $${o.symbol}. Nothing was bought.`
      : `Bought ${formatUsd(o.usd)} of $${o.symbol}${outcome.price ? ` at ${formatUsd(outcome.price)}` : ''}.${outcome.note ? ` ${outcome.note}` : ''}`;
    return log({ ...o, state: 'filled', filledAt: now, got: outcome.got, fillPrice: outcome.price, dryRun: !!outcome.dryRun, attention: null, retryAfter: null, queuedAt: null }, now, 'filled', text);
  }
  if (outcome.status === 'unknown') {
    if (o.state === 'filled') return o;
    const text = UNKNOWN_TEXT(o);
    return log({ ...o, state: 'unknown', attention: text, queuedAt: null }, now, 'unknown', outcome.detail ?? text);
  }
  // Nothing was pressed. Only an order that's still executing goes back to watching.
  if (o.state !== 'executing') return o;
  switch (outcome.status) {
    case 'stale':
      return log({ ...o, state: 'armed', queuedAt: null, ticksAt: 0 }, now, 'stale', 'The price moved away before buying — watching again.');
    case 'aborted':
      return log({ ...o, state: 'armed', queuedAt: null, ticksAt: 0, retryAfter: now + ABORT_RETRY_MS }, now, 'retry', `Didn't buy: ${outcome.reason}`);
    case 'no-cash': {
      const text = `Not enough cash on fomo${outcome.cash != null ? ` (you have ${formatUsd(outcome.cash)})` : ''} for this ${formatUsd(o.usd)} buy. Top up and Tippy will buy if the price is still there.`;
      return log({ ...o, state: 'armed', queuedAt: null, ticksAt: 0, retryAfter: now + NO_CASH_RETRY_MS, attention: text }, now, 'no-cash', text);
    }
    case 'failed': {
      const attempts = o.attempts + 1;
      if (!outcome.retryable || attempts >= BUY_MAX_ATTEMPTS) {
        const text = `Tippy couldn't buy $${o.symbol}: ${outcome.detail}`;
        return log({ ...o, state: 'failed', attempts, queuedAt: null, attention: text }, now, 'failed', text);
      }
      const wait = BACKOFF_MS[Math.min(attempts - 1, BACKOFF_MS.length - 1)];
      return log({ ...o, state: 'armed', attempts, queuedAt: null, ticksAt: 0, retryAfter: now + wait }, now, 'retry', `Didn't buy yet: ${outcome.detail} Trying again soon.`);
    }
  }
}

/**
 * Every tick, with the coin's live balance (null = unknown):
 *  - an order left 'executing' by a worker restart may have bought → 'unknown' (never re-pressed);
 *  - an 'unknown' order whose coins showed up is confirmed 'filled'.
 */
export function reconcileBuy(order: BuyOrder, balance: number | null, now: number, running: boolean): BuyOrder {
  let o = order;
  if (o.state === 'executing' && !running) o = applyBuyOutcome(o, { status: 'unknown', detail: 'Tippy restarted mid-buy.' }, now);
  if (balance == null) return o;
  if (o.state === 'unknown' && o.balanceBefore != null && o.expectedAmount != null && o.expectedAmount > 0) {
    const fill = boundedFill(o, balance - o.balanceBefore, o.expectedAmount);
    if (fill) o = applyBuyOutcome(o, { status: 'filled', ...fill }, now);
  }
  // The press the user said "didn't buy" landed after all: done, never buy twice.
  const prior = livePriorPress(o, now);
  if (prior && (o.state === 'armed' || o.state === 'queued' || o.state === 'unknown')) {
    const fill = priorPressFill(o, balance, prior);
    if (fill) o = log({ ...o, state: 'filled', filledAt: now, got: fill.got, fillPrice: fill.price, attention: null, retryAfter: null, queuedAt: null, ticksAt: 0 }, now, 'filled', `Your earlier buy went through after all — ${formatUsd(o.usd)} of $${o.symbol}. Tippy won't buy again.`);
  }
  return o;
}

/** The earlier press, while it could still land (null once it's too old to be that press). */
export function livePriorPress(order: Pick<BuyOrder, 'priorPress'>, now: number): NonNullable<BuyOrder['priorPress']> | null {
  const p = order.priorPress;
  return p && now - p.at <= PRIOR_PRESS_MS ? p : null;
}

/**
 * Did the earlier press land? Only an increase about the size of that buy counts —
 * a much bigger one is something else (a manual buy, a transfer in), not that press.
 */
export function priorPressFill(order: Pick<BuyOrder, 'usd'>, balance: number, prior: NonNullable<BuyOrder['priorPress']>): { got: number; price: number } | null {
  const got = balance - prior.balanceBefore;
  if (!(prior.expectedAmount > 0) || got < prior.expectedAmount * FILL_MIN_RATIO || got > prior.expectedAmount * FILL_MAX_RATIO) return null;
  return { got, price: order.usd / got };
}

/**
 * Coins that arrived after a press → the fill, or null if too few to count.
 * More than ~1.5× what the buy should bring can't all be from it (a lagging
 * earlier buy, a coin missing from one balance read): then the buy is taken at
 * the price Tippy expected, never at a "too cheap" price from the extra coins.
 */
export function boundedFill(order: Pick<BuyOrder, 'usd'>, got: number, expected: number): { got: number; price: number; note?: string } | null {
  if (!(expected > 0) || !(got >= expected * FILL_MIN_RATIO)) return null;
  if (got > expected * FILL_MAX_RATIO) {
    return { got: expected, price: order.usd / expected, note: 'Your balance grew by more than this buy, so Tippy counted it at the price it expected.' };
  }
  return { got, price: order.usd / got };
}

/** The user checked fomo: it bought (→ filled) or it didn't (→ watching again, may buy again). */
export function resolveUnknownBuy(order: BuyOrder, bought: boolean, now: number): BuyOrder {
  if (order.state !== 'unknown' && order.state !== 'failed') return order;
  if (bought) return log({ ...order, state: 'filled', filledAt: now, attention: null }, now, 'filled', 'You confirmed it bought.');
  // Keep the earlier press: if its coins show up late, the order is filled, not bought twice.
  const priorPress =
    order.state === 'unknown' && order.balanceBefore != null && order.expectedAmount != null && order.expectedAmount > 0
      ? { balanceBefore: order.balanceBefore, expectedAmount: order.expectedAmount, at: now }
      : (order.priorPress ?? null);
  return log(
    { ...order, state: 'armed', attempts: 0, ticksAt: 0, lastAtTick: null, retryAfter: null, queuedAt: null, attention: null, balanceBefore: null, expectedAmount: null, priorPress },
    now,
    'retry',
    'You said it didn’t buy — watching again.',
  );
}

export function cancelBuy(order: BuyOrder, now: number): BuyOrder {
  // A pressed-but-unconfirmed buy can't just be dropped: if its coins land, they
  // must still get their guard. The user answers "It bought" / "It didn't buy".
  // Mid-buy ('executing') it can't be stopped from here either — the press may already be happening.
  if (isClosedBuy(order) || order.state === 'unknown' || order.state === 'executing') return order;
  return log({ ...order, state: 'cancelled', queuedAt: null, attention: null }, now, 'cancelled', 'Cancelled.');
}

/**
 * Move a watching order to a new level (dragged on the chart, or typed). Its
 * "placed at" reference becomes the price now, so dip / breakout and "%" levels
 * are measured from here. Returns null with a reason when it can't move.
 */
export function moveBuy(order: BuyOrder, trigger: Trigger, now: { priceUSD: number; mc: number | null }, at: number): { order: BuyOrder } | { error: string } {
  if (order.state !== 'armed' && order.state !== 'queued') return { error: 'That order is already buying or finished.' };
  const ref: Entry = { priceUSD: now.priceUSD, mc: now.mc, source: 'armed-at' };
  const issue = validateBuyInput({ ...order, trigger, ref, expiresInMs: null }, 0)[0];
  if (issue) return { error: issue.message };
  const x = buyX(trigger, ref);
  const moved: BuyOrder = { ...order, trigger, ref, direction: x < 1 ? 'down' : 'up', state: 'armed', queuedAt: null, ticksAt: 0, lastAtTick: null, retryAfter: null, attention: null };
  return { order: log(moved, at, 'armed', `Moved to ${buyLevelText(trigger)} (${moved.direction === 'down' ? 'dip' : 'breakout'}).`) };
}

/** Record the protection plan armed on the new coins. */
export function protectedBy(order: BuyOrder, planId: string | null, text: string, now: number): BuyOrder {
  return log({ ...order, planId }, now, 'protected', text);
}

/**
 * Auto-guard leaves a balance increase alone when a limit buy is (or just was)
 * responsible for it — the buy protects its own coins with the chosen preset.
 */
export function buyOwnsIncrease(orders: BuyOrder[], key: string, now: number, windowMs = 10 * 60_000): boolean {
  return orders.some(
    (o) =>
      o.key === key &&
      !o.dryRun &&
      (o.state === 'queued' || o.state === 'executing' || o.state === 'unknown' || (o.state === 'filled' && o.filledAt != null && now - o.filledAt < windowMs)),
  );
}

/** Keep finished orders a while so people can see what happened, then drop them. */
export function pruneBuys(orders: Record<string, BuyOrder>, now: number): Record<string, BuyOrder> {
  const week = 7 * 24 * 3600_000;
  const finished = Object.values(orders)
    .filter(isClosedBuy)
    .sort((a, b) => b.updatedAt - a.updatedAt);
  const keep = new Set(finished.filter((o, i) => i < 30 && now - o.updatedAt < week).map((o) => o.id));
  const out: Record<string, BuyOrder> = {};
  for (const [id, o] of Object.entries(orders)) if (!isClosedBuy(o) || keep.has(id)) out[id] = o;
  return out;
}
