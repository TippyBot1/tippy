// The trade queue: one trade at a time — stops first, then take-profits, then
// limit buys. Each trade re-checks that it's still allowed (not paused, no kill
// switch, plan / order unchanged), re-reads the live balance and price, opens a
// fresh fomo tab on the coin, drives fomo's panel, then confirms the result by
// watching the balance — never by trusting a toast.
//
// "Did it sell?" is never guessed from one signal. A coin missing from one
// balance read, or fomo's panel saying "Insufficient balance", only counts as
// "sold elsewhere" when the other source agrees.
//
// Buys are one-shot: once Tippy may have pressed Buy for an order, it never
// presses again for that order without the user (the order goes 'unknown').
//
// Practice runs borrow the same one-trade slot (so they never overlap a real
// trade) and are always dry runs: Tippy stops right before the final press.

import { browser } from 'wxt/browser';
import { applyBuyOutcome, boundedFill, BUY_PRIORITY, buyZone, livePriorPress, markBuyExecuting, prepareBuy, priorPressFill, withdrawBuy, type BuyOutcome } from '../engine/buys';
import { applyOutcome, getLevel, hasInFlight, levelLabel, markExecuting, withdrawQueued, type ExecOutcome } from '../engine/orders';
import { formatUsd, isHit } from '../engine/triggers';
import type { BuyAction, BuyOrder, LevelRef, Plan, QueuedAction, SellAction } from '../engine/types';
import { alert, notify } from '../shared/alerts';
import { cashUsd, parseKey, tokenUrl } from '../shared/chains';
import { minTradeUsdFor } from '../shared/config';
import type { BalancesRead } from '../fomo/api';
import type { ExecOptions, ExecResult, PracticeResult, RelayRequest, Status, StorageShape, TokenQuote } from '../shared/messages';
import { buyFilledNotice, filledShare, sellFilledNotice } from '../shared/notices';
import type { Settings } from '../shared/settings';
import { load, save } from '../shared/store';
import { withLock } from './lock';
import { presence } from './presence';
import { protectBuy } from './protect';
import { EXEC_MARKER, execTabs, focusTab, relay, waitForContent } from './relay';

const VERIFY_MS = 45_000; // cross-chain sells can wait for a relay confirmation
const VERIFY_EVERY_MS = 3_000;
/** Without fomo's "Sold" strip, a vanished coin must stay gone this long to count as sold. */
const VERIFY_ABSENT_MS = 15_000;
/**
 * A take-profit / partial stop counts as sold once your balance dropped by at
 * least this share of it: fomo turns the dollars back into coins at its own
 * price, which can be a little off Tippy's.
 */
const SLICE_SOLD_SHARE = 0.75;
/** A stop queued longer ago than this is re-checked against the live price before selling. */
const STALE_STOP_MS = 90_000;
/** "Not enough cash" for one order is mentioned at most this often. */
const NO_CASH_ALERT_MS = 30 * 60_000;
/** Practice buys default to this much cash (USD). */
const PRACTICE_BUY_USD = 5;
/** planId / orderId of a practice run — never a real plan or order. */
export const PRACTICE_ID = 'practice';
const LOGGED_OUT = "you're logged out of fomo — Tippy will carry on once you log back in.";

/** The trade in progress right now (in memory only — gone after a worker restart). */
export type Running =
  | { kind: 'sell'; planId: string; level: LevelRef }
  | { kind: 'buy'; orderId: string }
  | { kind: 'practice'; key: string; side: 'sell' | 'buy' };

let running: Promise<void> | null = null;
let current: Running | null = null;

export function processQueue(): Promise<void> {
  running ??= drain().finally(() => {
    running = null;
    current = null;
  });
  return running;
}

export function isExecuting() {
  return running != null;
}

export function currentExecution(): Running | null {
  return current;
}

/** fomo's minimum trade (USD) on a chain: what its /config said, else what Tippy knows. */
export function minTradeUsd(status: Status, networkId: number, side: 'buy' | 'sell' = 'sell'): number {
  return minTradeUsdFor(side === 'buy' ? status.minBuyUsd : status.minSellUsd, networkId, side);
}

/**
 * Pause all / kill switch: put every queued trade back to watching. Stops and
 * buys re-fire later only if the price still says so (never at a stale level).
 * Mutates `plans` and `buys`; the caller saves them with an empty queue.
 */
export function withdrawQueue(queue: QueuedAction[], plans: StorageShape['plans'], buys: StorageShape['buys'], now: number) {
  for (const a of queue) {
    if (a.type === 'sell') {
      if (plans[a.planId]) plans[a.planId] = withdrawQueued(plans[a.planId], a.level);
    } else if (buys[a.orderId]) {
      buys[a.orderId] = withdrawBuy(buys[a.orderId], now);
    }
  }
}

type Head =
  | { kind: 'sell'; action: SellAction; plan: Plan; settings: Settings; status: Status }
  | { kind: 'buy'; action: BuyAction; order: BuyOrder; settings: Settings; status: Status };

async function drain() {
  for (;;) {
    const head = await withLock(nextTrade);
    if (!head) return;
    if (head.kind === 'sell') await runSell(head.action, head.plan, head.settings, head.status);
    else await runBuy(head.action, head.order, head.settings, head.status);
  }
}

/** Take the next trade off the queue and mark it executing. Runs under the lock. */
async function nextTrade(): Promise<Head | null> {
  const { queue, plans, buys, settings, status } = await load('queue', 'plans', 'buys', 'settings', 'status');
  if (settings.paused || status.health === 'killed') {
    if (queue.length) {
      withdrawQueue(queue, plans, buys, Date.now());
      await save({ queue: [], plans, buys });
    }
    return null;
  }
  while (queue.length) {
    const action = queue.shift()!;
    const now = Date.now();
    if (action.type === 'buy') {
      const order = buys[action.orderId];
      // Cancelled, withdrawn or already handled: drop it. An expired one is left for the tick to close.
      if (!order || order.state !== 'queued' || (order.expiresAt != null && now >= order.expiresAt)) continue;
      buys[order.id] = markBuyExecuting(order, now);
      status.executing = { kind: 'buy', orderId: order.id, symbol: order.symbol, startedAt: now };
      current = { kind: 'buy', orderId: order.id };
      await save({ queue, buys, status });
      return { kind: 'buy', action, order: buys[order.id], settings, status };
    }
    const plan = plans[action.planId];
    const level = plan ? getLevel(plan, action.level) : null;
    if (!plan || !level || level.status !== 'queued') continue;
    if (plan.state !== 'armed') {
      plans[plan.id] = withdrawQueued(plan, action.level);
      continue;
    }
    plans[plan.id] = markExecuting(plan, action.level, now);
    status.executing = { kind: 'sell', planId: plan.id, level: action.level, symbol: plan.symbol, startedAt: now };
    current = { kind: 'sell', planId: plan.id, level: action.level };
    await save({ queue, plans, status });
    return { kind: 'sell', action, plan: plans[plan.id], settings, status };
  }
  await save({ queue, plans });
  return null;
}

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));
const CANT_READ_BALANCE = "Tippy couldn't check your balance on fomo — it'll look again shortly.";
const CANT_SEE_BAG = "Tippy couldn't see your bag in fomo's balances — it'll look again shortly.";

async function runSell(action: SellAction, plan: Plan, settings: Settings, status: Status) {
  let outcome: ExecOutcome;
  try {
    outcome = await sell(action, plan, settings, status);
  } catch (e) {
    outcome = { status: 'failed', detail: errText(e), retryable: true };
  }

  const result = await withLock(async () => {
    const { plans, status, settings: live } = await load('plans', 'status', 'settings');
    // A dry run that finished after dry run was switched off doesn't count as sold:
    // the level goes back to watching and sells for real if the price is still there.
    if (outcome.status === 'filled' && outcome.dryRun && !live.dryRun) {
      outcome = { status: 'aborted', reason: 'dry run was switched off — Tippy will sell for real if the price is still there.' };
    }
    const p = plans[plan.id];
    status.executing = null;
    const before = p?.attention ?? null;
    if (p) plans[p.id] = applyOutcome(p, action.level, outcome, Date.now());
    await save({ plans, status });
    // Cleared only now, under the lock: the tick must never see "executing" without the running marker.
    current = null;
    return p ? { before: p, plan: plans[p.id], newAttention: plans[p.id].attention !== before ? plans[p.id].attention : null } : null;
  });
  if (result) await announce(settings, result.before, result.plan, action, outcome, result.newAttention);
}

async function runBuy(action: BuyAction, order: BuyOrder, settings: Settings, status: Status) {
  const run: BuyRun = { sent: false, quote: null };
  const outcome = await buy(action, order, settings, status, run);

  const result = await withLock(async () => {
    const { buys, plans, baseline, settings: s, status } = await load('buys', 'plans', 'baseline', 'settings', 'status');
    status.executing = null;
    const o = buys[order.id];
    let res: { order: BuyOrder; newAttention: string | null; guard: string | null } | null = null;
    if (o) {
      const now = Date.now();
      let next = applyBuyOutcome(o, outcome, now);
      let guard: string | null = null;
      const patch: Partial<StorageShape> = {};
      if (next.state === 'filled' && o.state !== 'filled') {
        // Bought: guard the new coins with the preset picked on the order.
        // Size a new guard on the whole balance read after the buy, never on "before + bought" guesses.
        const balance = outcome.status === 'filled' ? (outcome.balanceAfter ?? null) : null;
        const p = protectBuy({ order: next, plans, presets: s.presets, balance, quote: run.quote, baseline, now, newId: () => crypto.randomUUID() });
        next = p.order;
        guard = p.text;
        if (p.armed) presence.forget(p.armed.key); // a fresh plan starts with a clean "is it gone?" record
        if (p.plans !== plans) patch.plans = p.plans;
        if (p.baseline !== baseline) patch.baseline = p.baseline;
      }
      buys[o.id] = next;
      await save({ ...patch, buys, status });
      res = { order: next, newAttention: next.attention && next.attention !== o.attention ? next.attention : null, guard };
    } else {
      await save({ status });
    }
    current = null;
    return res;
  });
  if (result) await announceBuy(settings, result.order, outcome, result.newAttention, result.guard);
}

/** "Sell everything": a stop loss / trailing stop, or a take-profit / partial stop sized down to nothing. */
const sellsAll = (action: SellAction) => action.level.kind === 'sl' || action.level.kind === 'trail' || action.targetRemaining === 0;

/**
 * `before` / `plan`: the plan just before and just after the outcome was
 * recorded. The fill notice says what THIS sell did, not what the plan is.
 */
async function announce(settings: Settings, before: Plan, plan: Plan, action: SellAction, outcome: ExecOutcome, newAttention: string | null) {
  const label = levelLabel(plan, action.level);
  if (outcome.status === 'filled') {
    const price = plan.lastPrice ?? 0;
    const emptied = sellsAll(action) || (outcome.balanceAfter != null && price > 0 && outcome.balanceAfter * price < 1);
    // Tokens actually sold when the balance showed it; else the levels that turned 'filled' with this sell.
    const soldPct = outcome.soldAmount != null && plan.origBalance > 0 ? (outcome.soldAmount / plan.origBalance) * 100 : filledShare(before, plan);
    await notify(settings, 'filled', sellFilledNotice(plan, action.level, { dryRun: !!outcome.dryRun, soldPct, emptied }));
  } else if (outcome.status === 'done-elsewhere' && plan.state === 'done') {
    // Never close a stop silently.
    const why = sellsAll(action) ? 'fomo showed nothing left to sell — it looks like you sold it elsewhere' : "you'd already sold that much elsewhere, and nothing else was left to watch";
    await alert(settings, 'attention', `👀 Tippy stopped guarding $${plan.symbol}`, `When your ${label} hit, ${why}. Re-arm Tippy if that's wrong.`);
  } else if (newAttention) {
    await alert(settings, 'attention', `😟 Tippy needs you: $${plan.symbol}`, newAttention);
  } else if (outcome.status === 'unknown') {
    await alert(settings, 'failed', `🤔 Checking your $${plan.symbol} sell`, `Tippy pressed sell for your ${label}, but fomo hasn't updated your balance yet.`);
  }
}

async function announceBuy(settings: Settings, order: BuyOrder, outcome: BuyOutcome, newAttention: string | null, guard: string | null) {
  if (outcome.status === 'filled' && order.state === 'filled') {
    await notify(settings, 'filled', buyFilledNotice(order, guard));
  } else if (outcome.status === 'unknown') {
    await alert(settings, 'failed', `🤔 Checking your $${order.symbol} buy`, `Tippy pressed Buy for ${formatUsd(order.usd)} of $${order.symbol}, but your balance hasn't changed yet. Check fomo, then tell Tippy whether it bought.`);
  } else if (newAttention) {
    // "Not enough cash" can repeat every minute while the price sits at the level — mention it once in a while.
    const dedupe = outcome.status === 'no-cash' ? `no-cash:${order.id}` : undefined;
    await alert(settings, 'attention', `😟 Tippy needs you: $${order.symbol}`, newAttention, dedupe, NO_CASH_ALERT_MS);
  }
}

type Fresh =
  | {
      ok: true;
      /** null = the coin wasn't in fomo's balance list on this read (for buys: 0 when the read is trusted). */
      balance: number | null;
      /** false when some rows couldn't be read — then a missing coin proves nothing. */
      trusted: boolean;
      quote: TokenQuote | null;
      /** fomo "cash" (USDC) in USD on this read — only meaningful when trusted. */
      cash: number;
      /** fomo's symbol for the coin, when it's in the balances. */
      symbol: string | null;
      /** The coin had its own row on this read (a missing row is not proof you hold none). */
      listed: boolean;
    }
  | { ok: false; authFailed: boolean };

/**
 * One balance + price read through the desk. `forBuy`: a coin you don't hold
 * yet is simply 0 — but only when the read was fully understood.
 */
async function freshState(deskTabId: number, key: string, forBuy = false): Promise<Fresh> {
  const [bal, q] = await Promise.all([relay<BalancesRead>(deskTabId, { type: 'BALANCES' }, 8_000), relay<TokenQuote[]>(deskTabId, { type: 'QUOTES', keys: [key] }, 8_000)]);
  if (!bal.ok) return { ok: false, authFailed: !!bal.authFailed };
  if (!bal.data || !Array.isArray(bal.data.holdings)) return { ok: false, authFailed: false };
  const holding = bal.data.holdings.find((h) => h.key === key);
  const trusted = bal.data.unparsed === 0;
  return {
    ok: true,
    balance: holding ? holding.amount : forBuy && trusted ? 0 : null,
    trusted,
    quote: q.ok && Array.isArray(q.data) ? (q.data.find((x) => x.key === key) ?? null) : null,
    cash: cashUsd(bal.data.holdings),
    symbol: holding?.symbol ?? null,
    listed: !!holding,
  };
}

/** The coin's live balance (0 if a clean read doesn't list it) and price, read through the desk — null if fomo can't be read. */
export async function readCoin(key: string): Promise<{ balance: number | null; quote: TokenQuote | null } | null> {
  const { status } = await load('status');
  if (status.deskTabId == null) return null;
  const s = await freshState(status.deskTabId, key, true);
  return s.ok ? { balance: s.balance, quote: s.quote } : null;
}

/** Why this sell must not go ahead right now (paused, kill switch, plan changed), or null. */
async function blocked(action: SellAction): Promise<string | null> {
  const { settings, status, plans } = await load('settings', 'status', 'plans');
  if (settings.paused) return 'Tippy is paused.';
  if (status.health === 'killed') return 'Tippy is paused for safety.';
  const plan = plans[action.planId];
  if (!plan || plan.state !== 'armed') return 'the plan was paused or stopped.';
  if (getLevel(plan, action.level)?.status !== 'executing') return 'the plan changed.';
  return null;
}

/** Is this level still hit at this price? Take-profits look up; stops of every kind look down. */
function stillHit(plan: Plan, ref: LevelRef, quote: TokenQuote): boolean {
  const q = { priceUSD: quote.priceUSD, mc: quote.mc, at: Date.now() };
  switch (ref.kind) {
    case 'tp': {
      const tp = plan.tps.find((t) => t.id === ref.id);
      return !!tp && isHit(tp.trigger, q, plan.entry, 'up');
    }
    case 'stop': {
      const st = (plan.stops ?? []).find((s) => s.id === ref.id);
      return !!st && isHit(st.trigger, q, plan.entry, 'down');
    }
    case 'sl':
      return !!plan.sl && isHit(plan.sl.trigger, q, plan.entry, 'down');
    case 'trail': {
      const tr = plan.trailing;
      return !!tr?.peakPrice && quote.priceUSD <= tr.peakPrice * (1 - tr.trailPct / 100);
    }
  }
}

async function sell(action: SellAction, plan: Plan, settings: Settings, status: Status): Promise<ExecOutcome> {
  // Only "sell everything" may go ahead without knowing the balance (fomo's 100%
  // button sizes it). A take-profit or partial stop sells a slice, which needs it.
  const isExit = sellsAll(action);
  const desk = status.deskTabId;
  if (desk == null) {
    // Nothing was pressed: a slice just waits for fomo (without using up an attempt).
    return isExit ? { status: 'failed', detail: 'No fomo tab is open.', retryable: true } : { status: 'aborted', reason: 'no fomo tab is open — Tippy will try again once there is one.' };
  }
  const stop = await blocked(action);
  if (stop) return { status: 'aborted', reason: stop };

  // 1. Re-check: still holding enough? still at the level?
  const read = await freshState(desk, plan.key);
  // Stops of every kind (partial ones too) protect the bag: the stop impact cap,
  // focus and urgency. Take-profits are the patient ones.
  const protective = action.level.kind !== 'tp';
  if (!read.ok) {
    if (read.authFailed) return { status: 'aborted', reason: LOGGED_OUT };
    // Balances down: a slice waits (a hiccup reading fomo isn't a failed sell, so it
    // doesn't use up an attempt), but a stop that sells the rest still goes ahead
    // with "sell everything" — fomo's own panel shows what's really there.
    if (!isExit) return { status: 'aborted', reason: CANT_READ_BALANCE };
  }
  const state = read.ok ? read : { ok: true as const, balance: null, trusted: false, quote: null };
  const price = state.quote?.priceUSD ?? plan.lastPrice ?? 0;
  const tol = Math.max(plan.origBalance * 0.005, price > 0 ? 1 / price : 0);

  if (state.balance == null) {
    // Missing from this read. If the tick loop has also confirmed it gone (several
    // trusted reads over 30s+), it was sold elsewhere. Otherwise a slice (take-profit
    // or partial stop) waits for a clean read and an exit goes ahead with "sell everything".
    if (state.trusted && presence.gone(plan.key, Date.now())) return { status: 'done-elsewhere' };
    if (!isExit) return { status: 'aborted', reason: CANT_SEE_BAG };
  } else if (state.balance - action.targetRemaining <= tol) {
    return { status: 'done-elsewhere' };
  }

  if (state.quote) {
    // A take-profit always re-checks its level; a stop only once it has waited a
    // while (its drop was already confirmed over several ticks).
    const recheck = action.level.kind === 'tp' || (!action.consented && Date.now() - action.queuedAt > STALE_STOP_MS);
    if (recheck && !stillHit(plan, action.level, state.quote)) return { status: 'stale' };
  }

  const known = state.balance;
  // Belt and braces: never press a slice without knowing the balance (it would be a 100% sell).
  if (known == null && !isExit) return { status: 'aborted', reason: CANT_SEE_BAG };
  const sellAmount = known == null ? null : known - action.targetRemaining;
  const sized: SellAction = {
    ...action,
    sellAmount,
    sellUsd: sellAmount == null ? null : sellAmount * price,
    sellPctOfCurrent: action.targetRemaining === 0 || known == null ? 100 : Math.min(100, ((sellAmount ?? 0) / known) * 100),
  };

  // Estimated impact from pool liquidity (constant-product), checked before any tab opens.
  const estimatedImpactPct = estimateImpact(sized.sellUsd, state.quote);
  const cap = protective ? settings.maxImpactStop : settings.maxImpactTp;
  if (estimatedImpactPct != null && estimatedImpactPct > cap) {
    return { status: 'failed', detail: `Selling now would move the price about ${estimatedImpactPct.toFixed(1)}% (your limit is ${cap}%).`, retryable: true };
  }

  // 2. Fresh tab on the coin (recently-opened tabs aren't heavily throttled).
  //    The marker keeps it from ever being mistaken for the desk tab.
  const tab = await browser.tabs.create({ url: `${tokenUrl(plan.address, plan.networkId)}?${EXEC_MARKER}`, active: false });
  if (tab.id == null) return { status: 'failed', detail: "Couldn't open fomo.", retryable: true };
  execTabs.add(tab.id);
  try {
    if (!(await waitForContent(tab.id, 30_000))) return { status: 'failed', detail: "fomo's page didn't load.", retryable: true };

    const options: ExecOptions = {
      dryRun: settings.dryRun,
      acceptRiskWarnings: settings.acceptRiskWarnings,
      maxImpactPct: cap,
      failClosedOnUnknownImpact: !protective,
      estimatedImpactPct,
      symbol: plan.symbol,
      focused: false,
    };

    // A slice is typed in dollars: size them at the price right now, not the one
    // read before fomo's page loaded. (An exit presses fomo's 100%.)
    const pressing = () => (isExit ? Promise.resolve(sized) : repriced(desk, sized, price));
    let toSell = await pressing();
    const late = await blocked(action);
    if (late) return { status: 'aborted', reason: late };
    let res = await exec(tab.id, toSell, plan.symbol, options);

    // 3. Background tab stalled or didn't render? Bring it forward and retry once.
    if (wantsFocus(res) && (protective ? settings.focus.stopLoss : settings.focus.takeProfit)) {
      toSell = await pressing();
      const again = await blocked(action);
      if (again) return { status: 'aborted', reason: again };
      await focusTab(tab.id);
      res = await exec(tab.id, toSell, plan.symbol, { ...options, focused: true });
    }

    // 4. Interpret. Anything that may have pressed confirm goes through verify().
    //    (A dry run never presses, so a lost reply there means nothing happened.)
    if (res.clicked || (res.relayLost && !options.dryRun)) {
      return await verify({ desk, planId: plan.id, key: plan.key, target: action.targetRemaining, tol, isExit, soldStrip: !!res.sold, before: known });
    }
    if (res.relayLost) return { status: 'failed', detail: "Tippy lost touch with fomo's tab.", retryable: true };
    switch (res.stage) {
      case 'dry-run':
        return { status: 'filled', balanceAfter: null, detail: '(Dry run — nothing was actually sold.)', dryRun: true };
      case 'insufficient-ui': {
        // fomo's panel says there's nothing to sell — believe it only if the balance
        // shows the bag (nearly) gone. A coin merely missing from a read is not enough.
        const recheck = await freshState(desk, plan.key);
        const agrees =
          recheck.ok && (recheck.balance != null ? recheck.balance - action.targetRemaining <= tol : isExit && recheck.trusted && presence.gone(plan.key, Date.now()));
        return agrees ? { status: 'done-elsewhere' } : { status: 'failed', detail: 'fomo showed "Insufficient balance" — Tippy will try again.', retryable: true };
      }
      case 'logged-out': {
        // The selling tab looked logged out; ask fomo's API (the desk) whether that's true.
        const session = await relay<BalancesRead>(desk, { type: 'BALANCES' }, 8_000);
        if (!session.ok && session.authFailed) return { status: 'aborted', reason: LOGGED_OUT };
        return { status: 'failed', detail: "fomo's sell panel didn't load.", retryable: true };
      }
      case 'impact-too-high':
        return { status: 'failed', detail: res.detail, retryable: true };
      case 'aborted':
        return { status: 'aborted', reason: res.detail };
      case 'below-minimum':
        return { status: 'failed', detail: res.detail, retryable: false };
      case 'no-panel':
        await alert(settings, 'ui-changed', "😵 Tippy can't see fomo's sell button", 'fomo may have updated. Tippy will keep trying; an update is on the way if it keeps happening.', 'ui-changed');
        return { status: 'failed', detail: res.detail, retryable: true };
      default:
        return { status: 'failed', detail: res.detail, retryable: true };
    }
  } finally {
    closeCoinTab(tab.id);
  }
}

type ExecReply = ExecResult & { relayLost?: boolean };
type ExecRequest = Extract<RelayRequest, { type: 'EXECUTE' | 'EXECUTE_BUY' }>;

async function send(tabId: number, req: ExecRequest, timeoutMs = 90_000): Promise<ExecReply> {
  const res = await relay<ExecResult>(tabId, req, timeoutMs);
  // If the message was delivered but no answer came back, the tab may have pressed confirm.
  if (!res.ok) return { stage: 'error', clicked: false, detail: res.error, relayLost: true };
  return res.data;
}

function exec(tabId: number, action: SellAction, symbol: string, options: ExecOptions): Promise<ExecReply> {
  return send(tabId, { type: 'EXECUTE', action, symbol, options });
}

/**
 * Background tab stalled or didn't render: bringing it forward may help — but
 * only if nothing was (or may have been) pressed. Disabled % buttons mean fomo
 * sees no position, which bringing the tab forward won't fix.
 */
function wantsFocus(res: ExecReply): boolean {
  const retryable = (res.stage === 'stalled' && res.step !== 'preset') || res.stage === 'no-panel' || res.stage === 'logged-out';
  return retryable && !res.clicked && !res.relayLost;
}

/**
 * A slice is typed into fomo in dollars, and fomo turns them back into coins at
 * its live price. fomo's page can take a while to load, so the dollars are sized
 * again right before pressing: in a dump, dollars sized at the older (higher)
 * price would sell more coins than the slice. If the price can't be read now,
 * the old figure stands — but never above the lowest price Tippy has seen since
 * (the tick loop keeps the plan's latest), so it never sells more coins than asked.
 */
async function repriced(desk: number, action: SellAction, readPrice: number): Promise<SellAction> {
  const amount = action.sellAmount;
  if (amount == null || !(amount > 0)) return action;
  const q = await relay<TokenQuote[]>(desk, { type: 'QUOTES', keys: [action.key] }, 8_000);
  const live = q.ok && Array.isArray(q.data) ? q.data.find((x) => x.key === action.key)?.priceUSD : undefined;
  if (live != null && Number.isFinite(live) && live > 0) return { ...action, sellUsd: amount * live };
  const { plans } = await load('plans');
  const seen = [readPrice, plans[action.planId]?.lastPrice ?? 0].filter((p) => Number.isFinite(p) && p > 0);
  if (seen.length === 0 || action.sellUsd == null) return action;
  return { ...action, sellUsd: Math.min(action.sellUsd, amount * Math.min(...seen)) };
}

/** The plan's stop loss or trailing stop is lined up to sell the rest. */
async function exitQueued(planId: string): Promise<boolean> {
  const { plans } = await load('plans');
  const p = plans[planId];
  return p?.sl?.status === 'queued' || p?.trailing?.status === 'queued';
}

/** Price impact (%) of a trade this size, from pool liquidity (constant-product), or null if unknown. */
function estimateImpact(tradeUsd: number | null, quote: TokenQuote | null): number | null {
  const liquidity = quote?.liquidity ?? null;
  return tradeUsd != null && liquidity && liquidity > 0 ? (100 * tradeUsd) / (liquidity / 2 + tradeUsd) : null;
}

/** A fresh, inactive tab on the coin (recently-opened tabs aren't heavily throttled). The marker keeps it from ever being mistaken for the desk. */
async function openCoinTab(address: string, networkId: number): Promise<number | null> {
  const tab = await browser.tabs.create({ url: `${tokenUrl(address, networkId)}?${EXEC_MARKER}`, active: false });
  if (tab.id == null) return null;
  execTabs.add(tab.id);
  return tab.id;
}

function closeCoinTab(tabId: number) {
  execTabs.delete(tabId);
  setTimeout(() => browser.tabs.remove(tabId).catch(() => {}), 1_500);
}

interface SellCheck {
  desk: number;
  planId: string;
  key: string;
  /** Balance that should remain. */
  target: number;
  tol: number;
  /** "Sell everything" (vs. a take-profit / partial stop's slice). */
  isExit: boolean;
  /** fomo showed its "Sold …" strip. */
  soldStrip: boolean;
  /** The balance read right before selling (null = unknown), so the fill can say how much really went. */
  before: number | null;
}

/**
 * Confirm by balance, not by toast. A fully sold coin disappears from fomo's
 * balance list (recon 2026-10-11), so for "sell everything" a missing row counts
 * — but only from trusted reads, and only with corroboration: fomo's "Sold …"
 * strip, or the coin missing on several reads spanning VERIFY_ABSENT_MS.
 *
 * A slice counts as sold once the balance dropped by most of it (fomo prices the
 * dollars itself). It never holds up the stop loss / trailing stop on the same
 * coin: once one is lined up, Tippy stops waiting — sold if the balance clearly
 * dropped, else 'unknown' (the tick settles it; the exit sells whatever is left).
 */
async function verify(c: SellCheck): Promise<ExecOutcome> {
  const end = Date.now() + VERIFY_MS;
  let absentSince: number | null = null;
  let absentReads = 0;
  /** The latest balance a trusted read showed. */
  let last: number | null = null;
  const before = c.before;
  const filled = (balanceAfter: number): ExecOutcome => {
    const sold = before != null ? before - balanceAfter : null;
    return sold != null && sold > 0 ? { status: 'filled', balanceAfter, soldAmount: sold } : { status: 'filled', balanceAfter };
  };
  /** Coins this slice was selling (0 for exits, or when the balance before is unknown). */
  const slice = !c.isExit && before != null ? before - c.target : 0;
  while (Date.now() < end) {
    await new Promise((r) => setTimeout(r, VERIFY_EVERY_MS));
    const s = await freshState(c.desk, c.key);
    if (s.ok && s.trusted) {
      if (s.balance == null) {
        absentSince ??= Date.now();
        absentReads++;
        if (c.isExit && (c.soldStrip ? absentReads >= 2 : absentReads >= 3 && Date.now() - absentSince >= VERIFY_ABSENT_MS)) return filled(0);
      } else {
        absentSince = null;
        absentReads = 0;
        last = s.balance;
        if (s.balance <= c.target + c.tol) return filled(s.balance);
        if (slice > 0 && before != null && before - s.balance >= slice * SLICE_SOLD_SHARE) return filled(s.balance);
      }
    }
    if (!c.isExit && (await exitQueued(c.planId))) {
      return before != null && last != null && before - last > c.tol ? filled(last) : { status: 'unknown', detail: 'Your stop is selling the rest first.' };
    }
  }
  return { status: 'unknown', detail: 'Balance has not updated yet.' };
}

// ---------------------------------------------------------------------------
// Limit buys

interface BuyRun {
  /** EXECUTE_BUY went out: from here on Tippy may have pressed Buy. */
  sent: boolean;
  /** The price read right before buying (sizes the guard on the new coins). */
  quote: TokenQuote | null;
}

/** Why this buy must not go ahead right now (paused, kill switch, order cancelled), or null. */
async function buyBlocked(orderId: string): Promise<string | null> {
  const { settings, status, buys } = await load('settings', 'status', 'buys');
  if (settings.paused) return 'Tippy is paused.';
  if (status.health === 'killed') return 'Tippy is paused for safety.';
  const order = buys[orderId];
  if (order?.state !== 'executing') return 'the order was cancelled.';
  if (order.expiresAt != null && Date.now() >= order.expiresAt) return 'the order expired.';
  return null;
}

async function buy(action: BuyAction, order: BuyOrder, settings: Settings, status: Status, run: BuyRun): Promise<BuyOutcome> {
  try {
    return await buyOnce(action, order, settings, status, run);
  } catch (e) {
    // A crash after the Buy message went out is never "nothing happened".
    if (run.sent) return { status: 'unknown', detail: `Something went wrong after Tippy opened fomo's Buy panel (${errText(e)}).` };
    return { status: 'failed', detail: errText(e), retryable: true };
  }
}

async function buyOnce(action: BuyAction, order: BuyOrder, settings: Settings, status: Status, run: BuyRun): Promise<BuyOutcome> {
  // Not being able to look (no tab, a hiccup reading fomo) isn't the order's fault: wait and
  // look again without using up an attempt.
  const desk = status.deskTabId;
  if (desk == null) return { status: 'aborted', reason: 'no fomo tab is open.' };
  const stop = await buyBlocked(order.id);
  if (stop) return { status: 'aborted', reason: stop };

  // 1. Re-check right before acting: still at the level? enough cash?
  const read = await freshState(desk, order.key, true);
  if (!read.ok) return { status: 'aborted', reason: read.authFailed ? LOGGED_OUT : "Tippy couldn't check your fomo balances — it'll look again shortly." };
  const quote = read.quote;
  run.quote = quote;
  if (!quote || !(quote.priceUSD > 0)) return { status: 'aborted', reason: `Tippy couldn't get $${order.symbol}'s price — it'll look again shortly.` };
  if (buyZone(order, quote) !== 'at') return { status: 'stale' };
  const usd = order.usd;
  if (read.trusted && read.cash < usd) return { status: 'no-cash', cash: read.cash };
  // Without the balance before, a fill could never be confirmed — so don't press.
  if (read.balance == null) return { status: 'failed', detail: "Tippy couldn't read your fomo balances cleanly, so it can't check a buy went through.", retryable: true };
  // "You hold none" from one read isn't proof (fomo's lists can lag or skip a row):
  // a coin missing here but held a moment ago would make the fill look enormous.
  let balanceBefore = read.balance;
  if (!read.listed) {
    await new Promise((r) => setTimeout(r, 1_500));
    const again = await freshState(desk, order.key, true);
    if (!again.ok || again.balance == null) return { status: 'aborted', reason: "Tippy couldn't double-check your balance — it'll look again shortly." };
    const { baseline } = await load('baseline');
    if (!again.listed && (baseline?.[order.key] ?? 0) > 0) return { status: 'aborted', reason: `fomo's balance list skipped your $${order.symbol} — Tippy will look again before buying.` };
    balanceBefore = again.balance;
  }
  // An earlier press the user said "didn't buy" may have landed late: never buy twice.
  const prior = livePriorPress(order, Date.now());
  const late = prior ? priorPressFill(order, balanceBefore, prior) : null;
  if (late) return { status: 'filled', ...late, balanceAfter: balanceBefore, note: "Your earlier buy went through after all — Tippy didn't buy again." };

  const estimatedImpactPct = estimateImpact(usd, quote);
  if (estimatedImpactPct != null && estimatedImpactPct > settings.maxImpactBuy) {
    return { status: 'failed', detail: `Buying now would move the price about ${estimatedImpactPct.toFixed(1)}% (your limit is ${settings.maxImpactBuy}%).`, retryable: true };
  }

  // 2. Remember the balance and the coins expected *before* opening fomo, so the
  //    fill can still be confirmed if the worker restarts mid-buy.
  const expected = usd / quote.priceUSD;
  const ready = await withLock(async () => {
    const { buys } = await load('buys');
    const o = buys[order.id];
    if (o?.state !== 'executing') return false;
    buys[o.id] = prepareBuy(o, balanceBefore, expected, Date.now());
    await save({ buys });
    return true;
  });
  if (!ready) return { status: 'aborted', reason: 'the order was cancelled.' };

  // 3. Fresh tab on the coin.
  const tabId = await openCoinTab(order.address, order.networkId);
  if (tabId == null) return { status: 'failed', detail: "Couldn't open fomo.", retryable: true };
  try {
    if (!(await waitForContent(tabId, 30_000))) return { status: 'failed', detail: "fomo's page didn't load.", retryable: true };

    const options: ExecOptions = {
      dryRun: settings.dryRun,
      acceptRiskWarnings: settings.acceptRiskWarnings,
      maxImpactPct: settings.maxImpactBuy,
      failClosedOnUnknownImpact: true,
      estimatedImpactPct,
      symbol: order.symbol,
      focused: false,
    };
    const req: ExecRequest = { type: 'EXECUTE_BUY', action: { ...action, usd }, symbol: order.symbol, options };

    const late = await buyBlocked(order.id);
    if (late) return { status: 'aborted', reason: late };
    run.sent = true;
    let res = await send(tabId, req);

    // Background tab stalled or didn't render? Bring it forward and retry once (nothing was pressed).
    if (wantsFocus(res) && settings.focus.takeProfit) {
      const again = await buyBlocked(order.id);
      if (again) return { status: 'aborted', reason: again };
      await focusTab(tabId);
      res = await send(tabId, { ...req, options: { ...options, focused: true } });
    }

    // 4. Interpret. Anything that may have pressed Buy is confirmed by your balance.
    //    (A dry run never presses, so a lost reply there means nothing happened.)
    if (res.clicked || (res.relayLost && !options.dryRun)) return await verifyBuy(desk, order, balanceBefore, expected, !!res.bought);
    if (res.relayLost) return { status: 'failed', detail: "Tippy lost touch with fomo's tab.", retryable: true };
    switch (res.stage) {
      case 'dry-run':
        return { status: 'filled', got: null, price: quote.priceUSD, dryRun: true };
      case 'insufficient-ui': {
        // fomo's panel says there isn't enough cash: check your balance before saying so.
        const recheck = await freshState(desk, order.key, true);
        if (recheck.ok && recheck.trusted && recheck.cash < usd) return { status: 'no-cash', cash: recheck.cash };
        return { status: 'failed', detail: 'fomo showed "Insufficient balance" — Tippy will try again.', retryable: true };
      }
      case 'logged-out': {
        // The buying tab looked logged out; ask fomo's API (the desk) whether that's true.
        const session = await relay<BalancesRead>(desk, { type: 'BALANCES' }, 8_000);
        if (!session.ok && session.authFailed) return { status: 'aborted', reason: LOGGED_OUT };
        return { status: 'failed', detail: "fomo's buy panel didn't load.", retryable: true };
      }
      case 'impact-too-high':
        return { status: 'failed', detail: res.detail, retryable: true };
      case 'aborted':
        return { status: 'aborted', reason: res.detail };
      case 'below-minimum':
        return { status: 'failed', detail: res.detail, retryable: false };
      case 'no-panel':
        await alert(settings, 'ui-changed', "😵 Tippy can't see fomo's buy button", 'fomo may have updated. Tippy will keep trying; an update is on the way if it keeps happening.', 'ui-changed');
        return { status: 'failed', detail: res.detail, retryable: true };
      default:
        return { status: 'failed', detail: res.detail, retryable: true };
    }
  } finally {
    closeCoinTab(tabId);
  }
}

/**
 * Confirm a buy by your balance: the coins must show up (at least half of what
 * Tippy expected — fees and slippage eat some). fomo's "Bought …" strip alone is
 * not proof; without the coins the order goes 'unknown' and is never re-pressed.
 */
async function verifyBuy(desk: number, order: BuyOrder, before: number, expected: number, boughtStrip: boolean): Promise<BuyOutcome> {
  const end = Date.now() + VERIFY_MS;
  while (Date.now() < end) {
    await new Promise((r) => setTimeout(r, VERIFY_EVERY_MS));
    const s = await freshState(desk, order.key, true);
    if (!s.ok || !s.trusted || s.balance == null) continue;
    // Bounded: extra coins (a lagging earlier buy) never make this buy look "cheap".
    const fill = boundedFill(order, s.balance - before, expected);
    if (fill) return { status: 'filled', ...fill, balanceAfter: s.balance };
  }
  return { status: 'unknown', detail: boughtStrip ? 'fomo showed "Bought", but your balance hasn\'t caught up yet.' : 'Your balance has not updated yet.' };
}

// ---------------------------------------------------------------------------
// Practice runs

/**
 * Walk through a real sell or buy on fomo and stop right before the final press,
 * so you can see everything works. Always a dry run, never tied to a plan or
 * order, never verified. Refused while a trade is running; while it runs, the
 * queue waits (same slot).
 */
/**
 * `viaTab` is the fomo tab the user pressed Practice in — it's always connected,
 * unlike a desk tab left over from before Tippy was reloaded or updated.
 */
export async function practice(key: string, side: 'sell' | 'buy', usd?: number, viaTab?: number): Promise<PracticeResult> {
  const at = Date.now();
  if (running) {
    const { plans, buys } = await load('plans', 'buys');
    return { key, symbol: knownSymbol(key, plans, buys), side, at, ok: false, stage: 'skipped', detail: 'Tippy is in the middle of a trade — try your practice run again in a moment.' };
  }
  // A practice can't be interrupted once it starts, so never let one hold up a real trade.
  {
    const { plans, buys, queue } = await load('plans', 'buys', 'queue');
    const waiting = queue.length > 0 || Object.values(plans).some((p) => p.state === 'armed' && hasInFlight(p)) || Object.values(buys).some((o) => o.state === 'queued');
    if (waiting || running) return { key, symbol: knownSymbol(key, plans, buys), side, at, ok: false, stage: 'skipped', detail: 'Tippy has a real trade lined up — try your practice run again in a moment.' };
  }
  // Take the slot synchronously (no await above this line on this path), so drain() can't start meanwhile.
  current = { kind: 'practice', key, side };
  const job = runPractice(key, side, usd, at, viaTab).catch((e): PracticeResult => ({ key, symbol: '', side, at, ok: false, stage: 'error', detail: `The practice run hit a snag: ${errText(e)}` }));
  running = job
    .then(() => undefined)
    .finally(() => {
      running = null;
      current = null;
    });
  await running;
  const result = await job;
  void processQueue(); // anything that queued up meanwhile
  return result;
}

function knownSymbol(key: string, plans: StorageShape['plans'], buys: StorageShape['buys']): string {
  return Object.values(plans).find((p) => p.key === key)?.symbol ?? Object.values(buys).find((o) => o.key === key)?.symbol ?? '';
}

/** The first of these fomo tabs that answers. Tabs opened before Tippy was reloaded or updated never do. */
async function liveFomoTab(tabs: (number | null | undefined)[]): Promise<number | null> {
  for (const id of tabs) if (id != null && (await relay(id, { type: 'PING' }, 1_500)).ok) return id;
  return null;
}

async function runPractice(key: string, side: 'sell' | 'buy', usd: number | undefined, at: number, viaTab?: number): Promise<PracticeResult> {
  const { settings, status, plans, buys } = await load('settings', 'status', 'plans', 'buys');
  let symbol = knownSymbol(key, plans, buys);
  const result = (stage: PracticeResult['stage'], detail: string, impactPct?: number | null): PracticeResult => ({
    key,
    symbol,
    side,
    at,
    ok: stage === 'dry-run',
    stage,
    detail,
    ...(impactPct !== undefined ? { impactPct } : {}),
  });

  if (status.health === 'killed') return result('skipped', "Tippy is paused for safety right now, so there's no practice run.");
  const coin = parseKey(key);
  if (!coin) return result('skipped', "Tippy doesn't recognise this coin.");
  const desk = await liveFomoTab([status.deskTabId, viaTab]);
  if (desk == null) return result('skipped', "Tippy can't talk to fomo yet — refresh this fomo tab and try again.");

  const read = await freshState(desk, key, side === 'buy');
  if (!read.ok) return result('skipped', read.authFailed ? "You're logged out of fomo — log back in, then try again." : "Tippy couldn't reach fomo just now — try again in a moment.");
  symbol = read.quote?.symbol || read.symbol || symbol;
  const price = read.quote && read.quote.priceUSD > 0 ? read.quote.priceUSD : null;
  const minUsd = minTradeUsd(status, coin.networkId, side);
  const now = Date.now();
  const options = (maxImpactPct: number, estimatedImpactPct: number | null): ExecOptions => ({
    dryRun: true,
    practice: true,
    acceptRiskWarnings: settings.acceptRiskWarnings,
    maxImpactPct,
    failClosedOnUnknownImpact: true,
    estimatedImpactPct,
    symbol,
    focused: false,
  });

  let req: ExecRequest;
  let amountUsd: number | null;
  if (side === 'sell') {
    const bal = read.balance;
    if (bal == null || !(bal > 0)) {
      return result('skipped', read.trusted ? `You don't hold any $${symbol} — try a practice buy instead.` : `Tippy couldn't see your $${symbol} in fomo's balances — try again in a moment.`);
    }
    const value = price != null ? bal * price : null;
    if (value != null && value < minUsd) return result('skipped', `Your $${symbol} is worth ${formatUsd(value)} — under fomo's ${formatUsd(minUsd)} minimum sell, so there's nothing to practise with. Try a practice buy instead.`);
    // Half the bag, or all of it when half would be under fomo's minimum.
    const pct = value != null && value * 0.5 < minUsd ? 100 : 50;
    const sellAmount = (bal * pct) / 100;
    amountUsd = price != null ? sellAmount * price : null;
    const action: SellAction = {
      type: 'sell',
      planId: PRACTICE_ID,
      key,
      level: { kind: 'tp', id: PRACTICE_ID },
      targetRemaining: pct === 100 ? 0 : bal - sellAmount,
      sellAmount,
      sellUsd: amountUsd,
      sellPctOfCurrent: pct,
      reason: 'practice run',
      gapFill: false,
      priority: 1,
      queuedAt: now,
    };
    req = { type: 'EXECUTE', action, symbol, options: options(settings.maxImpactTp, estimateImpact(amountUsd, read.quote)) };
  } else {
    if (price == null) return result('skipped', `Tippy can't see $${symbol}'s price right now — try again in a moment.`);
    amountUsd = Math.max(usd != null && Number.isFinite(usd) && usd > 0 ? usd : PRACTICE_BUY_USD, minUsd);
    const action: BuyAction = { type: 'buy', orderId: PRACTICE_ID, key, usd: amountUsd, priority: BUY_PRIORITY, queuedAt: now, reason: 'practice run' };
    req = { type: 'EXECUTE_BUY', action, symbol, options: options(settings.maxImpactBuy, estimateImpact(amountUsd, read.quote)) };
  }

  await setExecuting({ kind: 'practice', side, symbol, startedAt: now });
  try {
    const tabId = await openCoinTab(coin.address, coin.networkId);
    if (tabId == null) return result('error', "Tippy couldn't open fomo.");
    try {
      // Short and single-shot: a practice holds the trade slot, so it must never keep a
      // real stop waiting long (no bring-to-front retry; ~1 minute at most).
      if (!(await waitForContent(tabId, 20_000))) return result('error', "fomo's page didn't load — try again in a moment.");
      const res = await send(tabId, req, 45_000);
      return await practiceResult(res, side, symbol, amountUsd, settings, result);
    } finally {
      closeCoinTab(tabId);
    }
  } finally {
    await setExecuting(null);
  }
}

async function practiceResult(
  res: ExecReply,
  side: 'sell' | 'buy',
  symbol: string,
  amountUsd: number | null,
  settings: Settings,
  result: (stage: PracticeResult['stage'], detail: string, impactPct?: number | null) => PracticeResult,
): Promise<PracticeResult> {
  const button = side === 'buy' ? 'Buy' : 'Sell';
  if (res.clicked) {
    // A practice run must never press anything. If the executor says it did, say so loudly.
    const detail = `⚠️ Tippy's practice run reported pressing fomo's ${button} button — that should never happen. Check fomo for a real ${side}, and please tell us.`;
    console.error('[tippy] practice run reported a click', res);
    await alert(settings, 'attention', `⚠️ Tippy pressed ${button} during a practice run`, detail);
    return { ...result(res.stage, detail, res.impactPct ?? null), ok: false };
  }
  if (res.relayLost) return result('error', 'Tippy lost touch with the fomo tab before it finished — try again in a moment.');
  const amount = amountUsd != null ? ` for ${formatUsd(amountUsd)}` : '';
  switch (res.stage) {
    case 'dry-run':
      return result(
        'dry-run',
        side === 'buy'
          ? `All good! Tippy got all the way to fomo's "Buy ${symbol}" button${amount} and stopped there. Nothing was bought.`
          : `All good! Tippy got all the way to fomo's "Sell ${symbol}" button${amount} and stopped there. Nothing was sold.`,
        res.impactPct ?? null,
      );
    case 'insufficient-ui':
      return result(
        res.stage,
        side === 'buy' ? `Tippy reached fomo's Buy panel, but fomo says you don't have enough cash${amount}. Top up, then try again.` : `Tippy reached fomo's Sell panel, but fomo says there's nothing to sell.`,
        res.impactPct ?? null,
      );
    default:
      return result(res.stage, res.detail, res.impactPct ?? null);
  }
}

async function setExecuting(executing: Status['executing']) {
  await withLock(async () => {
    const { status } = await load('status');
    await save({ status: { ...status, executing } });
  });
}
