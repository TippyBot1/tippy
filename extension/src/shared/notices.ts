// What Tippy tells you when an order fills or runs out: one short title and a
// sentence, the same on fomo's page (a little pop-up from Tippy), as a desktop
// notification and on Telegram. "Tippy filled order — Tippy bought $5 at $716K MC
// on $HIGGS."

import { BUY_BAND, buyLevelText, PRIOR_PRESS_MS } from '../engine/buys';
import { formatUsd } from '../engine/triggers';
import type { BuyEvent, BuyOrder, LevelRef, Plan, StopLevel, TakeProfit } from '../engine/types';

export interface NoticeText {
  /** fomo token key, so a tap can open the coin. */
  key: string;
  title: string;
  text: string;
  tone: 'good' | 'stop' | 'info';
}

export interface Notice extends NoticeText {
  id: string;
  at: number;
}

export const FILLED_TITLE = 'Tippy filled order';
export const EXPIRED_TITLE = 'Tippy order expired';
/** A sell that showed up in your balance long after Tippy pressed (or in a dry run): Tippy doesn't claim it. */
export const UPDATE_TITLE = 'Tippy order update';
/** A stop that hit but was too small for fomo's minimum sell, so nothing was sold. */
export const SKIPPED_TITLE = 'Tippy skipped a stop';
/** Notices kept for fomo's page to show. */
export const KEEP_NOTICES = 10;
/** Older than this, a notice isn't shown when a fomo page opens. */
export const NOTICE_FRESH_MS = 10 * 60_000;

const DRY = ' (dry run)';
const STOPPED_GUARDING = ' Tippy has stopped guarding the rest.';

/** "$5" for whole dollars, "$5.50" otherwise. */
function money(n: number): string {
  return formatUsd(n).replace(/\.00$/, '');
}

/** Market cap when known, else the price: "$790K MC" / "$0.00079". */
function where(mc: number | null | undefined, price: number | null | undefined): string | null {
  if (mc != null && mc > 0) return `${formatUsd(mc)} MC`;
  if (price != null && price > 0) return formatUsd(price);
  return null;
}

/** "Guarding with ⭐ Classic: 2x 50% · …" → "Guarding it with ⭐ Classic." */
function shortGuard(guard: string | null): string {
  if (!guard) return '';
  const m = /^Guarding with ([^:]+):/.exec(guard);
  return m ? ` Guarding it with ${m[1].trim()}.` : ` ${guard}`;
}

/** "Tippy bought $5 at $716K MC on $HIGGS." */
export function buyFilledNotice(order: BuyOrder, guard: string | null = null): NoticeText {
  const level = order.trigger.kind === 'mc' ? buyLevelText(order.trigger) : (where(order.lastMc, order.lastPrice) ?? buyLevelText(order.trigger));
  // A gap can fill well past the level: say where it really was.
  const off = order.trigger.kind === 'mc' && order.lastMc != null && order.lastMc > 0 && Math.abs(order.lastMc / order.trigger.value - 1) > 0.05;
  const filledAt = off ? ` (filled at ${formatUsd(order.lastMc)} MC)` : '';
  if (order.dryRun) {
    return {
      key: order.key,
      title: FILLED_TITLE + DRY,
      text: `Dry run — Tippy would have bought ${money(order.usd)} at ${level} on $${order.symbol}${filledAt}. Nothing was really bought.`,
      tone: 'info',
    };
  }
  return { key: order.key, title: FILLED_TITLE, text: `Tippy bought ${money(order.usd)} at ${level} on $${order.symbol}${filledAt}.${shortGuard(guard)}`, tone: 'good' };
}

/** "50", "12.5", "9.7" — one decimal at most, never "49.99999". */
export function pctText(pct: number): string {
  const p = Math.min(100, Math.max(0, pct));
  const r = Math.round(p * 10) / 10;
  return r === 0 && p > 0 ? '<0.1' : String(r);
}

export interface SellNoticeOptions {
  /** A dry run: nothing was really sold. */
  dryRun?: boolean;
  /** % of the ORIGINAL bag this sell took (null = unknown). */
  soldPct?: number | null;
  /** This sell emptied the bag ("the rest"). */
  emptied?: boolean;
  /**
   * The balance only confirmed it long after Tippy pressed (or in a dry run,
   * where Tippy never presses): say it looks sold, don't claim Tippy filled it.
   */
  late?: boolean;
}

/** "take-profit 1", "stop 2", "stop loss", "trailing stop". */
function sellLabel(plan: Plan, ref: LevelRef): string {
  if (ref.kind === 'sl') return 'stop loss';
  if (ref.kind === 'trail') return 'trailing stop';
  const list: { id: string }[] = ref.kind === 'tp' ? plan.tps : (plan.stops ?? []);
  const name = ref.kind === 'tp' ? 'take-profit' : 'stop';
  const i = list.findIndex((l) => l.id === ref.id);
  return i >= 0 ? `${name} ${i + 1}` : name;
}

const isClosedPlan = (plan: Plan) => plan.state === 'done' || plan.state === 'cancelled';

/**
 * What THIS sell did: "Tippy sold 50% of $HIGGS at $790K MC (take-profit 1)." ·
 * "Stop hit — Tippy sold 10% of $HIGGS at $700K MC (stop 1)." ·
 * "Stop loss hit — Tippy sold the rest of $HIGGS at $644K MC."
 * `plan` is the plan after the sell was recorded.
 */
export function sellFilledNotice(plan: Plan, ref: LevelRef, opts: SellNoticeOptions = {}): NoticeText {
  const at = where(plan.lastMc, plan.lastPrice);
  const atText = at ? ` at ${at}` : '';
  const label = sellLabel(plan, ref);
  // A stop loss / trailing stop always sells the rest.
  const emptied = opts.emptied ?? (ref.kind === 'sl' || ref.kind === 'trail');
  const what = emptied ? 'the rest' : opts.soldPct != null && opts.soldPct > 0 ? `${pctText(opts.soldPct)}%` : 'some';
  // Coins are left but nothing is watching them any more: say so.
  const after = !emptied && isClosedPlan(plan) ? STOPPED_GUARDING : '';

  if (opts.late) {
    return { key: plan.key, title: UPDATE_TITLE, text: `Your ${label} on $${plan.symbol} looks sold — your balance dropped.${after}`, tone: 'info' };
  }
  if (opts.dryRun) {
    return { key: plan.key, title: FILLED_TITLE + DRY, text: `Dry run — Tippy would have sold ${what} of $${plan.symbol}${atText} (${label}). Nothing was really sold.${after}`, tone: 'info' };
  }
  if (ref.kind === 'tp') return { key: plan.key, title: FILLED_TITLE, text: `Tippy sold ${what} of $${plan.symbol}${atText} (${label}).${after}`, tone: 'good' };
  if (ref.kind === 'stop') return { key: plan.key, title: FILLED_TITLE, text: `Stop hit — Tippy sold ${what} of $${plan.symbol}${atText} (${label}).${after}`, tone: 'stop' };
  const why = ref.kind === 'sl' ? 'Stop loss hit' : 'Trailing stop hit';
  return { key: plan.key, title: FILLED_TITLE, text: `${why} — Tippy sold ${what} of $${plan.symbol}${atText}.${after}`, tone: 'stop' };
}

/**
 * A stop hit but its sell was under fomo's minimum, so Tippy skipped it: the
 * plan's latest "too small" note, e.g. "Your stop at $700K mc on $HIGGS would
 * sell $0.48 — below fomo's $2 minimum, so Tippy skipped it." null when the
 * plan has no such note.
 */
export function stopSkippedNotice(plan: Plan): NoticeText | null {
  const note = plan.history.findLast((h) => h.kind === 'too-small');
  return note ? { key: plan.key, title: SKIPPED_TITLE, text: note.text, tone: 'stop' } : null;
}

type Slice = TakeProfit | StopLevel;

/** Σ sellPct of the levels in `is` that weren't 'filled' in `was`. */
function newlyFilledPct(was: Slice[], is: Slice[]): number | null {
  const before = new Map(was.map((l) => [l.id, l.status]));
  const turned = is.filter((l) => l.status === 'filled' && before.get(l.id) !== 'filled');
  return turned.length ? turned.reduce((sum, l) => sum + l.sellPct, 0) : null;
}

/**
 * % of the original bag in the take-profits / partial stops that turned 'filled'
 * between `before` and `after` — the level that sold plus every level that went
 * with it (merged into it, or covered by it). null when none did.
 */
export function filledShare(before: Plan, after: Plan): number | null {
  const tps = newlyFilledPct(before.tps, after.tps);
  const stops = newlyFilledPct(before.stops ?? [], after.stops ?? []);
  return tps == null && stops == null ? null : (tps ?? 0) + (stops ?? 0);
}

/** A sell the balance confirmed after the fact (an 'unknown' or blocked press, or one left by a restart). */
export interface LateSell {
  ref: LevelRef;
  /** % of the original bag: this level plus the ones that went with it (null for exits, which sell the rest). */
  soldPct: number | null;
  emptied: boolean;
  /** Pressed more than PRIOR_PRESS_MS ago: Tippy doesn't claim it. */
  late: boolean;
}

/** Tippy may have pressed Sell for this level (reconcile's own rule). */
const wasPressed = (l: { status: string; clickedAt: number | null }) => l.status === 'executing' || l.status === 'unknown' || (l.status === 'blocked' && l.clickedAt != null);

/**
 * Sells that `reconcile` just confirmed by the balance: one per level Tippy
 * pressed (levels folded into or covered by it count toward its %, never get
 * their own notice). `balance` / `now` are what reconcile saw.
 */
export function lateSells(before: Plan, after: Plan, balance: number | null, now: number): LateSell[] {
  const out: LateSell[] = [];
  const price = after.lastPrice ?? before.lastPrice ?? 0;
  const bagGone = balance != null && price > 0 && balance * price < 1;
  const late = (l: { clickedAt: number | null; executingAt: number | null }) => {
    const at = l.clickedAt ?? l.executingAt;
    return at != null && now - at > PRIOR_PRESS_MS;
  };

  for (const kind of ['sl', 'trail'] as const) {
    const b = kind === 'sl' ? before.sl : before.trailing;
    const a = kind === 'sl' ? after.sl : after.trailing;
    if (b && a?.status === 'filled' && b.status !== 'filled' && wasPressed(b)) out.push({ ref: { kind }, soldPct: null, emptied: true, late: late(b) });
  }

  const slices = (kind: 'tp' | 'stop', was: Slice[], is: Slice[]) => {
    const prev = new Map(was.map((l) => [l.id, l]));
    // The levels as they were before, for the ones that just turned 'filled'.
    const newly = is.flatMap((l) => {
      const b = prev.get(l.id);
      return l.status === 'filled' && b && b.status !== 'filled' ? [b] : [];
    });
    // First hit first (highest target), like coveredBy.
    const pressed = newly.filter(wasPressed).sort((x, y) => y.targetRemaining - x.targetRemaining);
    if (pressed.length === 0) return;
    const claimed = new Set<string>();
    const shares = pressed.map((p) => {
      let pct = 0;
      for (const l of newly) {
        if (claimed.has(l.id)) continue;
        const along = l.id === p.id || (!wasPressed(l) && (l.mergedInto === p.id || l.targetRemaining >= p.targetRemaining));
        if (!along) continue;
        pct += l.sellPct;
        claimed.add(l.id);
      }
      return pct;
    });
    // Anything left went with the deepest sell.
    for (const l of newly) if (!claimed.has(l.id)) shares[shares.length - 1] += l.sellPct;
    pressed.forEach((p, i) => out.push({ ref: { kind, id: p.id }, soldPct: shares[i], emptied: bagGone || p.targetRemaining === 0, late: late(p) }));
  };
  slices('tp', before.tps, after.tps);
  slices('stop', before.stops ?? [], after.stops ?? []);
  return out;
}

/** Why a limit buy ran out, from what happened since it was placed (or last moved). */
function expiryReason(order: BuyOrder): string {
  const history = order.history.at(-1)?.kind === 'expired' ? order.history.slice(0, -1) : order.history;
  const sincePlaced = history.slice(history.findLastIndex((h) => h.kind === 'armed') + 1);
  const relevant: BuyEvent['kind'][] = ['hit', 'too-far', 'no-cash'];
  const last = sincePlaced.findLast((h) => relevant.includes(h.kind))?.kind;
  const band = `${Math.round(BUY_BAND * 100)}%`;
  switch (last) {
    case undefined:
      return 'the price never got there.';
    case 'no-cash':
      return "there wasn't enough cash on fomo when the price got there.";
    case 'too-far':
      return order.direction === 'up' ? `it pumped more than ${band} past your level, so Tippy didn't chase it.` : `it ran more than ${band} past your level, so Tippy held off.`;
    default:
      return 'it expired before Tippy could buy.';
  }
}

/** "Your $5 limit buy on $HIGGS at $716K MC expired — the price never got there." */
export function buyExpiredNotice(order: BuyOrder): NoticeText {
  return {
    key: order.key,
    title: EXPIRED_TITLE,
    text: `Your ${money(order.usd)} limit buy on $${order.symbol} at ${buyLevelText(order.trigger)} expired — ${expiryReason(order)}`,
    tone: 'info',
  };
}
