// "hey tippy add a tp at 500k mcap on CLAUDIA" → exactly what Tippy would change,
// as a confirm card. parse.ts turns the message into an Intent; this file works
// the change out from your plans, buys and the coin's price — validated the way
// Tippy's window validates — and says it in plain words.
//
// Nothing is sent from here until the card's button is tapped: planIntent() only
// reads. confirm.run() reads the coin's price and your plans again (prices move
// while you read), rebuilds the same change from that fresh data, refuses if it's
// no longer the change on the card, and only then sends the command.
//
// Levels: a market cap or a price is used as typed. A multiple ("2x") or a move
// ("-30%") is measured like the window's chips: from your entry on a running
// plan, from the price now for a new plan or a limit buy. Every card says the
// level as a market cap AND how far it is from now, so there's no guessing.
//
// "sell 10% at 700k" works on either side of the price: above it, a take-profit;
// below it, a partial stop ("sell 10% if it drops to $700K"). Without a size,
// below the price, it's the stop loss that sells the rest.

import { isLiveBuy, validateBuyInput } from '../engine/buys';
import { editPlan, hasInFlight, isEditableStop, isEditableTp, normalizePlan, type PlanEdit, planEditWith } from '../engine/orders';
import { formatUsd, formatX, validatePlanInput } from '../engine/triggers';
import type { BuyInput, BuyOrder, LevelStatus, Plan, PlanInput, Trigger } from '../engine/types';
import type { CommandResult } from '../shared/messages';
import type { Preset, Settings } from '../shared/settings';
import { dropText, levelProblem, levelText, levelX, type Now } from '../ui/levels';
import type { AskFor, ChatPlan, CoinSpec, Intent, LevelSpec, LevelToTrigger } from './intent';

/** A coin as the chat sees it (the window's token fits). */
export interface ChatCoin {
  key: string;
  address: string;
  networkId: number;
  symbol: string;
  name: string;
  priceUSD: number | null;
  mc: number | null;
  /** Your bag in token units; null = unknown. */
  balance: number | null;
}

/** The commands a confirmed card can send (bridge.ts `chatApi`). */
export interface ChatApi {
  arm(input: Omit<PlanInput, 'id' | 'now'>): Promise<CommandResult>;
  update(planId: string, edit: PlanEdit): Promise<CommandResult>;
  pause(planId: string): Promise<CommandResult>;
  resume(planId: string): Promise<CommandResult>;
  cancel(planId: string): Promise<CommandResult>;
  armBuy(input: Omit<BuyInput, 'id' | 'now'>): Promise<CommandResult>;
  cancelBuy(orderId: string): Promise<CommandResult>;
  moveBuy(orderId: string, trigger: Trigger, now: { priceUSD: number; mc: number | null }): Promise<CommandResult>;
  practice(key: string, side: 'sell' | 'buy', usd?: number): Promise<CommandResult>;
  setSettings(patch: Partial<Settings>): Promise<CommandResult>;
  pauseAll(paused: boolean): Promise<CommandResult>;
}

export interface ChatState {
  plans: Plan[];
  buys: BuyOrder[];
  settings: Settings;
}

export interface ChatCtx extends ChatState {
  /** The coin open on fomo (null on other pages). */
  coin: ChatCoin | null;
  /** Plans / buys / settings as they are now — read again when a card is confirmed. Defaults to the fields above. */
  latest?: () => ChatState;
  /** fomo's minimum buy on a chain (USD). */
  minBuyUsd(networkId: number): number;
  /** fomo's minimum sell on a chain (USD). */
  minSellUsd(networkId: number): number;
  /** fomo cash (USD), null / absent = unknown. */
  cash?: number | null;
  /** A coin you hold, have orders on, or have open — by symbol ("CLAUDIA"). null = not found. */
  resolveCoin(symbol: string): Promise<ChatCoin | null>;
  /** Fresh price / market cap / bag for a coin. */
  fetchCoin(key: string): Promise<ChatCoin | null>;
  api: ChatApi;
}

const HOUR = 3_600_000;
export const DEFAULT_BUY_EXPIRY_MS = 24 * HOUR;
const MAX_TPS = 5;
const MAX_STOPS = 5;
/** A stop can fill a little below its level: suggest a size with this much room above fomo's minimum. */
const STOP_ROOM = 1.05;
const DEFAULT_TP_PCT = 50;
const SHOW_MAX = 8;

/**
 * A level as typed → the engine's trigger. Market caps and prices are absolute;
 * a multiple stays a multiple and a move becomes one (−30% → 0.7x), both of
 * `ref` — the plan's entry, or the price now for a new plan / a limit buy — which
 * is exactly what the engine measures an 'x' trigger from.
 */
export const levelToTrigger: LevelToTrigger = (level) => {
  if (!Number.isFinite(level.value)) return null;
  switch (level.kind) {
    case 'mc':
    case 'price':
    case 'x':
      return level.value > 0 ? { kind: level.kind, value: level.value } : null;
    case 'pct': {
      const x = +(1 + level.value / 100).toFixed(6);
      return level.value !== 0 && x > 0 ? { kind: 'x', value: x } : null;
    }
  }
};

/** The typed level as a trigger measured from `base` (the plan's entry, or the price now). */
const toTrigger = (level: LevelSpec, base: Now) => levelToTrigger(level, { priceUSD: base.priceUSD ?? 0, mc: base.mc });

// ---------------------------------------------------------------------------
// Words

const sym = (c: { symbol: string }) => `$${c.symbol}`;
/** "25%", "12.5%", "0.25%" — never a rounder number than the one that's sent. */
const trimPct = (n: number) => `${+n.toFixed(n < 1 ? 2 : 1)}%`;
/** "$10", "$12.50", "$1.5K". */
const money = (n: number) => (n >= 1000 ? formatUsd(n) : Number.isInteger(n) ? `$${n}` : `$${n.toFixed(2)}`);
const nowOf = (c: { priceUSD: number | null; mc: number | null }): Now => ({ priceUSD: c.priceUSD, mc: c.mc });
const entryOf = (p: Plan): Now => ({ priceUSD: p.entry.priceUSD, mc: p.entry.mc });
const refOf = (o: BuyOrder): Now => ({ priceUSD: o.ref.priceUSD, mc: o.ref.mc });
/** How far a level is from here: "+79%", "−8.5%", or "3.6x" for big moves. */
function moveText(rel: number): string {
  if (rel >= 2) return `${rel >= 10 ? Math.round(rel) : +rel.toFixed(1)}x`;
  const pct = Math.abs(1 - rel) * 100;
  return `${rel < 1 ? '−' : '+'}${pct >= 10 ? Math.round(pct) : +pct.toFixed(1)}%`;
}
const nowText = (c: { priceUSD: number | null; mc: number | null }) => (c.mc ? `${formatUsd(c.mc)} MC` : formatUsd(c.priceUSD));
/** Cash rounded down to the cent: "$0.48", "$4.85", "$12". */
const cents = (n: number) => money(Math.floor(n * 100 + 1e-6) / 100);
/** A level the way you'd type it back to Tippy: "700k", "$0.0007", "2x", "-30%". */
function typed(l: LevelSpec): string {
  switch (l.kind) {
    case 'mc':
      return formatUsd(l.value).replace(/^\$/, '').toLowerCase();
    case 'price':
      return formatUsd(l.value);
    case 'x':
      return formatX(l.value);
    case 'pct':
      return `${l.value > 0 ? '+' : ''}${l.value}%`;
  }
}

/** A share of the bag the way you'd type it: "all", "half", "25%". */
const sizeWords = (pct: number) => (pct >= 100 ? 'all' : pct === 50 ? 'half' : trimPct(pct));

/**
 * The order again with another level, the way you'd type it — so a "did you mean 2m?"
 * comes with a message that works on its own: "tp at 2m", "sell half at 700k".
 */
function retyped(intent: Intent, level: string): string {
  switch (intent.type) {
    case 'add-tp': {
      const size = intent.sellUsd != null ? money(intent.sellUsd) : intent.sellPct != null ? sizeWords(intent.sellPct) : null;
      return size ? `sell ${size} at ${level}` : intent.anySide ? `sell at ${level}` : `tp at ${level}`;
    }
    case 'add-stop': {
      const size = intent.sellUsd != null ? money(intent.sellUsd) : sizeWords(intent.sellPct ?? 100);
      return `sell ${size} if it drops to ${level}`;
    }
    case 'set-sl':
      return `sl at ${level}`;
    case 'limit-buy':
      return `buy ${money(intent.usd)} at ${level}`;
    case 'move': {
      const t = intent.target;
      return `move ${t.kind === 'tp' ? `tp${t.index}` : t.kind === 'stop' ? `stop ${t.index}` : t.kind === 'sl' ? 'my stop' : 'my buy'} to ${level}`;
    }
    default:
      return level;
  }
}

function levelPrice(t: Trigger, base: Now): number {
  if (t.kind === 'price') return t.value;
  const x = levelX(t, base);
  return base.priceUSD && Number.isFinite(x) ? base.priceUSD * x : NaN;
}

function levelMc(t: Trigger, base: Now): number {
  if (t.kind === 'mc') return t.value;
  const x = levelX(t, base);
  return base.mc && Number.isFinite(x) ? base.mc * x : NaN;
}

/** The level relative to the price now (2 = double from here). NaN if unknown. */
function fromNow(t: Trigger, base: Now, now: Now): number {
  if (t.kind === 'mc' && now.mc) return t.value / now.mc;
  const p = levelPrice(t, base);
  return now.priceUSD && Number.isFinite(p) ? p / now.priceUSD : NaN;
}

/** Why a partial stop can't go there (it has to be below the price now), or null. */
function stopProblem(t: Trigger, base: Now, now: Now): string | null {
  const rel = fromNow(t, base, now);
  if (!Number.isFinite(rel)) return t.kind === 'mc' ? "I can't see this coin's market cap yet." : "I can't see this coin's price yet.";
  return rel >= 1 ? 'A stop has to be below where it is now.' : null;
}

/** "$4M MC", "$0.0041" — the level in absolute terms. */
function short(t: Trigger, base: Now): string {
  const mc = levelMc(t, base);
  if (t.kind !== 'price' && Number.isFinite(mc)) return `${formatUsd(mc)} MC`;
  const p = levelPrice(t, base);
  return Number.isFinite(p) ? formatUsd(p) : levelText(t);
}

/** "$500K MC (−72% from now)", "$4M MC (2x entry · +40% from now)", "$0.0041 (≈$4.1M MC · +20% from now)". */
function at(t: Trigger, base: Now, now: Now, fromEntry = false): string {
  const notes: string[] = [];
  const mc = levelMc(t, base);
  if (t.kind === 'price' && Number.isFinite(mc)) notes.push(`≈${formatUsd(mc)} MC`);
  if (fromEntry && t.kind === 'x') notes.push(t.value >= 1 ? `${formatX(t.value)} entry` : `${dropText(t.value)} from entry`);
  const rel = fromNow(t, base, now);
  if (Number.isFinite(rel)) notes.push(`${moveText(rel)} from now`);
  return notes.length ? `${short(t, base)} (${notes.join(' · ')})` : short(t, base);
}

function sameLevel(a: Trigger, b: Trigger, base: Now): boolean {
  if (a.kind === b.kind && Math.abs(a.value - b.value) <= Math.abs(a.value) * 1e-9) return true;
  const xa = levelX(a, base);
  const xb = levelX(b, base);
  return Number.isFinite(xa) && Number.isFinite(xb) && Math.abs(xa / xb - 1) < 0.006;
}

/** Your bag in dollars ("$100", "$12.40"), or null when unknown / empty. */
function bagUsd(c: ChatCoin): string | null {
  return c.balance != null && c.balance > 0 && c.priceUSD ? money(Math.round(c.balance * c.priceUSD * 100) / 100) : null;
}
const bagText = (c: ChatCoin) => (bagUsd(c) ? ` (${bagUsd(c)})` : '');

function duration(ms: number): string {
  if (ms < HOUR) return `${Math.max(1, Math.round(ms / 60_000))} min`;
  if (ms < 48 * HOUR) return `${+(ms / HOUR).toFixed(1)}h`;
  return `${+(ms / (24 * HOUR)).toFixed(1)} days`;
}

function presetName(p: Preset, presets: Preset[]): string {
  const i = presets.findIndex((x) => x.id === p.id);
  return `${i >= 0 ? `P${i + 1} ` : ''}${p.emoji} ${p.name}`;
}

/** "2x 50% · 5x 25% · SL −30%" */
function presetText(p: Preset): string {
  const parts = p.tps.map((t) => `${formatX(t.x)} ${t.pct}%`);
  if (p.slX != null) parts.push(`SL ${dropText(p.slX)}`);
  if (p.trail) parts.push(`trail ${p.trail.pct}%${p.trail.activateX ? ` after ${formatX(p.trail.activateX)}` : ''}`);
  return parts.join(' · ') || 'no levels';
}

const OPEN: LevelStatus[] = ['waiting', 'queued', 'held', 'executing', 'unknown', 'blocked'];

/** A running plan's open levels: "$4M MC 50% · $10M MC 25% · stop $700K MC 10% · SL $1.4M MC · trail 20%". */
function planLine(p: Plan): string {
  const base = entryOf(p);
  const parts = p.tps.filter((t) => OPEN.includes(t.status)).map((t) => `${short(t.trigger, base)} ${trimPct(t.sellPct)}`);
  for (const t of p.stops ?? []) if (OPEN.includes(t.status)) parts.push(`stop ${short(t.trigger, base)} ${trimPct(t.sellPct)}`);
  if (p.sl && OPEN.includes(p.sl.status)) parts.push(`SL ${short(p.sl.trigger, base)}`);
  if (p.trailing && OPEN.includes(p.trailing.status)) parts.push(`trail ${trimPct(p.trailing.trailPct)}`);
  return parts.join(' · ') || 'no open levels';
}

/** Why a take-profit or partial stop can't be changed any more. */
function lockedWhy(t: { status: LevelStatus }): string {
  switch (t.status) {
    case 'filled':
      return 'already sold';
    case 'done-elsewhere':
      return 'was already sold elsewhere';
    case 'merged':
      return 'was combined with another level';
    case 'blocked':
      return 'may have sold — check fomo, then use Retry in my window';
    case 'cancelled':
      return 'was cancelled';
    default:
      return 'is selling right now';
  }
}

const TP_WORD: Record<LevelStatus, string> = {
  waiting: 'watching',
  queued: 'selling…',
  executing: 'selling…',
  unknown: 'checking…',
  held: 'needs your OK',
  filled: 'sold ✓',
  'done-elsewhere': 'done',
  merged: 'merged',
  blocked: 'needs a retry',
  cancelled: 'cancelled',
};
const BUY_WORD: Record<BuyOrder['state'], string> = {
  armed: 'watching',
  queued: 'about to buy',
  executing: 'buying…',
  unknown: 'check fomo — did it buy?',
  filled: 'bought ✓',
  failed: 'failed',
  cancelled: 'cancelled',
  expired: 'expired',
};

// ---------------------------------------------------------------------------
// Steps: one intent worked out from one snapshot of the data.

interface Snap extends ChatState {
  coin: ChatCoin | null;
  minBuyUsd: (networkId: number) => number;
  minSellUsd: (networkId: number) => number;
  cash: number | null;
}

interface Reply {
  say: string;
  warn?: boolean;
}

interface Act {
  say: string;
  label: string;
  /** Exactly what would be sent. A card only runs if fresh data gives the same. */
  sig: string;
  /** Re-read the coin's price (and bag) before sending. */
  fresh: boolean;
  send: (api: ChatApi) => Promise<CommandResult>;
  done: (res: CommandResult) => string;
  /**
   * What to rebuild from when the card is tapped, if not the message's intent: a
   * size said in dollars is pinned to the % the card showed ("$5 ≈ 50%"), so a
   * price tick between card and tap doesn't make it a different order.
   */
  pinned?: Intent & { shownUsd?: number };
}

type Step = Reply | Act;
const isAct = (s: Step): s is Act => 'send' in s;
const answer = (say: string): Reply => ({ say });
const refuse = (say: string): Reply => ({ say, warn: true });

const isLive = (p: Plan) => p.state === 'armed' || p.state === 'paused';
const livePlan = (plans: Plan[], key: string) => plans.find((p) => p.key === key && isLive(p)) ?? null;
const waitingBuy = (o: BuyOrder) => o.state === 'armed' || o.state === 'queued';
const eqSym = (a: string, b: string) => a.replace(/^\$/, '').trim().toLowerCase() === b.replace(/^\$/, '').trim().toLowerCase();

const WHICH_COIN = 'Which coin? Open one on fomo, or name it — like "tp at 500k mcap on CLAUDIA".';

function needPrice(c: ChatCoin): Reply | null {
  return c.priceUSD != null && c.priceUSD > 0 ? null : refuse(`I can't see ${sym(c)}'s price yet — try again in a moment.`);
}

function needBag(c: ChatCoin): Reply | null {
  if (c.balance == null) return refuse(`I can't see your ${sym(c)} bag right now — open ${sym(c)} on fomo and try again.`);
  if (!(c.balance > 0)) return refuse(`You don't hold ${sym(c)} — want a limit buy instead? Try "buy $10 of ${c.symbol} if it dips 20%".`);
  return null;
}

/** Notes for anything that trades: Tippy paused overall, dry run. */
function tradeNotes(s: Snap, side: 'sell' | 'buy'): string {
  const out: string[] = [];
  if (s.settings.paused) out.push('Tippy is paused overall, so nothing fires until you say "resume".');
  if (s.settings.dryRun) out.push(`Dry run is on, so I won't really ${side}.`);
  return out.length ? ` ${out.join(' ')}` : '';
}

type Levels = Pick<PlanInput, 'tps' | 'stops' | 'sl' | 'trailing'>;

function planInput(c: ChatCoin, levels: Levels): Omit<PlanInput, 'id' | 'now'> {
  return {
    key: c.key,
    networkId: c.networkId,
    address: c.address,
    symbol: c.symbol,
    name: c.name,
    entry: { priceUSD: c.priceUSD ?? 0, mc: c.mc, source: 'armed-at' },
    balance: c.balance ?? 0,
    ...levels,
    origin: 'manual',
  };
}

/** No plan on the coin yet: arm a new one with these levels. */
function armNew(s: Snap, c: ChatCoin, levels: Levels, say: string, label: string, done: string): Step {
  const bag = needBag(c);
  if (bag) return bag;
  const input = planInput(c, levels);
  const issue = validatePlanInput(input)[0];
  if (issue) return refuse(issue.message);
  return {
    say: `${say} I'll start guarding your ${sym(c)} bag${bagText(c)}.${tradeNotes(s, 'sell')}`,
    label,
    sig: `arm|${c.key}|${JSON.stringify(levels)}`,
    fresh: true,
    send: (api) => api.arm(input),
    done: () => done,
  };
}

/** Change the running plan: checked with the engine's own editPlan before the card is shown. */
function editRunning(
  s: Snap,
  c: ChatCoin,
  plan: Plan,
  edit: PlanEdit,
  say: (tpNumber: number | null, stopNumber: number | null) => string,
  label: string,
  done: (tpNumber: number | null, stopNumber: number | null) => string,
  fresh = true,
): Step {
  if (hasInFlight(plan)) return refuse(`I'm in the middle of a sell on ${sym(c)} — try again in a moment.`);
  const r = editPlan(plan, edit, Date.now());
  if (!r.ok) return refuse(r.error);
  // The number a new level gets, by where it lands (take-profits lowest first, stops highest first).
  const i = r.plan.tps.findIndex((t) => !plan.tps.some((o) => o.id === t.id));
  const n = i >= 0 ? i + 1 : null;
  const j = r.plan.stops.findIndex((t) => !plan.stops.some((o) => o.id === t.id));
  const ns = j >= 0 ? j + 1 : null;
  const paused = plan.state === 'paused' ? ` Your ${sym(c)} guard is paused — say "resume ${c.symbol}" to switch it back on.` : '';
  return {
    say: `${say(n, ns)}${paused}${tradeNotes(s, 'sell')}`,
    label,
    sig: `edit|${plan.id}|${JSON.stringify(edit)}`,
    fresh,
    send: (api) => api.update(plan.id, edit),
    done: () => done(n, ns),
  };
}

/**
 * fomo won't sell less than its minimum. A slice that small at its level would
 * be skipped (a stop) or folded into a bigger sell (a take-profit), so say so
 * now. `bag` is what the % is of, in tokens; the slice is valued at the level.
 *
 * A partial stop needs a little room over the minimum (STOP_ROOM, the window's
 * rule too): it usually fills a bit under its level, and a slice that ends up
 * under the minimum is skipped. `usd`: the size was said in dollars.
 */
function minSellProblem(s: Snap, c: ChatCoin, pct: number, bag: number, t: Trigger, base: Now, stop: boolean, usd: number | null = null): string | null {
  const min = s.minSellUsd(c.networkId);
  const price = levelPrice(t, base);
  if (!(min > 0) || !(bag > 0) || !(price > 0) || !Number.isFinite(price)) return null;
  const room = stop ? STOP_ROOM : 1;
  const bagUsd = bag * price;
  const slice = (bagUsd * pct) / 100;
  const enough = (p: number) => (bagUsd * p) / 100 >= min * room - 1e-9;
  if (enough(pct)) return null;
  const where = short(t, base);
  if (bagUsd < min) return `Your whole ${sym(c)} bag would be worth ${cents(bagUsd)} at ${where} — under fomo's ${money(min)} minimum sell, so I couldn't sell it there.`;
  let need = Math.ceil((min * room * 100) / bagUsd - 1e-9);
  if (!enough(need)) need += 1; // never suggest a % this check would still refuse
  const lower = stop && slice < min ? ' (a stop can fill a bit lower)' : '';
  const close = `cutting it close to fomo's ${money(min)} minimum sell, and a stop can fill a bit lower`;
  if (usd != null) {
    const tip = need < 100 ? `Try at least ${money(Math.ceil(min * room * 100) / 100)}${lower}.` : 'Only selling all of it would work there.';
    return slice >= min ? `${money(usd)} at ${where} is ${close}. ${tip}` : `${money(usd)} is under fomo's ${money(min)} minimum sell. ${tip}`;
  }
  const tip = need < 100 ? `Try at least ${need}%${lower}.` : 'Only selling all of it would work there.';
  // Worded like the window: "10% of your $HIGGS bag ($4.98) is $0.48 at $700K MC — …".
  const worth = c.priceUSD ? ` (${money(Math.round(bag * c.priceUSD * 100) / 100)})` : '';
  if (slice >= min) return `${trimPct(pct)} of your ${sym(c)} bag${worth} is ${cents(slice)} at ${where} — ${close}. ${tip}`;
  return `${trimPct(pct)} of your ${sym(c)} bag${worth} is ${cents(slice)} at ${where} — fomo's minimum sell is ${money(min)}. ${tip}`;
}

/** "≈ 18%", "≈ 4.3%", "≈ 0.3%" — a $ size as a share of the bag, for the card. */
function approxPct(p: number): string {
  return `≈ ${p >= 10 ? Math.round(p) : p >= 0.1 ? +p.toFixed(1) : +p.toPrecision(1)}%`;
}

/**
 * A sell's size as a % of `bag` (tokens): as said, or — said in dollars — what
 * that's worth at the level's price, rounded up so it's never less than you
 * said. More than the whole bag there is refused: Tippy never sells more than
 * you asked for, and never quietly sells everything instead.
 */
function sizeAt(i: { sellPct: number | null; sellUsd?: number }, c: ChatCoin, bag: number | null, t: Trigger, base: Now, level: LevelSpec): { pct: number | null; usd: number | null } | Reply {
  if (i.sellUsd == null) return { pct: i.sellPct, usd: null };
  const usd = i.sellUsd;
  if (!(usd > 0) || !Number.isFinite(usd)) return refuse(`Pick an amount above $0 — like "sell $5 at ${typed(level)}".`);
  if (bag == null || !(bag > 0)) return needBag(c) ?? refuse(`I can't see your ${sym(c)} bag right now — open ${sym(c)} on fomo and try again.`);
  const price = levelPrice(t, base);
  if (!(price > 0) || !Number.isFinite(price)) return refuse(`I can't work out ${sym(c)}'s price at that level yet — try a market cap, like "1m mcap".`);
  const worth = bag * price;
  const pct = Math.ceil((usd / worth) * 1e6 - 1e-6) / 1e4;
  if (pct > 100) {
    return refuse(`${money(usd)} is more than your whole ${sym(c)} bag would be worth at ${short(t, base)} (≈${money(Math.round(worth * 100) / 100)}). To sell all of it there, say "sell all at ${typed(level)}".`);
  }
  return { pct, usd };
}
const isReply = (x: object): x is Reply => 'say' in x;

/** Several commands in a row; stops at the first that fails. */
async function sendAll(cmds: (() => Promise<CommandResult>)[]): Promise<CommandResult> {
  let done = 0;
  for (const cmd of cmds) {
    const res = await cmd();
    if (!res.ok) return { ok: false, error: done ? `Did ${done} of ${cmds.length}, then: ${res.error}` : res.error };
    done++;
  }
  return { ok: true };
}

function findPreset(ref: string, s: Snap): Preset | null {
  const { presets, defaultPresetId } = s.settings;
  const r = ref.trim().toLowerCase().replace(/^the\s+/, '').replace(/\s+(preset|plan)$/, '');
  if (!r) return null;
  if (r === 'default' || r === 'my preset' || r === 'my default') return presets.find((p) => p.id === defaultPresetId) ?? presets[0] ?? null;
  const n = r.match(/^p\s*([1-9])$/);
  if (n) return presets[Number(n[1]) - 1] ?? null;
  return (
    presets.find((p) => p.id.toLowerCase() === r || p.name.toLowerCase() === r) ??
    presets.find((p) => p.name.toLowerCase().includes(r) || r.includes(p.id.toLowerCase())) ??
    null
  );
}

function unknownPreset(ref: string, s: Snap): Reply {
  return refuse(`I don't know a preset called "${ref}" — yours are ${s.settings.presets.map((p) => presetName(p, s.settings.presets)).join(', ')}.`);
}

// ---------------------------------------------------------------------------
// Intents

type Of<T extends Intent['type']> = Extract<Intent, { type: T }>;
/** A sell said in dollars, pinned to the % its card showed: `shownUsd` keeps the "$5" in the words. */
type Sell<T extends 'add-tp' | 'add-stop'> = Of<T> & { shownUsd?: number };

/** The card's order, pinned: the % it showed instead of the dollars it was said in. */
function pin(step: Step, intent: Sell<'add-tp'> | Sell<'add-stop'>, pct: number, usd: number | null): Step {
  if (usd == null || !isAct(step)) return step;
  const { sellUsd: _said, ...rest } = intent;
  step.pinned = { ...rest, sellPct: pct, shownUsd: usd };
  return step;
}

/** A level this close to the price now is where it is — neither a take-profit nor a stop (the window's rule). */
const AT_MARKET = 0.005;

function addTp(i: Sell<'add-tp'>, s: Snap, c: ChatCoin): Step {
  const noPrice = needPrice(c);
  if (noPrice) return noPrice;
  const now = nowOf(c);
  const plan = livePlan(s.plans, c.key);
  const base = plan ? entryOf(plan) : now;
  const trigger = toTrigger(i.level, base);
  if (!trigger) return refuse('At what level? Try "tp at 500k mcap" or "tp 2x".');
  if (i.sellPct != null && !(i.sellPct > 0 && i.sellPct <= 100)) return refuse('Sell amount must be between 1% and 100%.');
  const rel = fromNow(trigger, base, now);
  if (i.anySide && Math.abs(rel - 1) < AT_MARKET) {
    return refuse(`That's where ${sym(c)} is now (${nowText(c)}) — I sell at a level, not on the spot. Pick one above it for a take-profit or below it for a stop, like "sell 50% at 2x" or "sell 50% if it drops 20%".`);
  }
  // "sell 10% at 700k" said with no direction: below the price now, it's a stop.
  if (i.anySide && rel < 1) {
    if (i.sellUsd != null) return addStop({ type: 'add-stop', coin: i.coin, level: i.level, sellPct: null, sellUsd: i.sellUsd }, s, c);
    if (i.sellPct == null || i.sellPct >= 100) return setSl({ type: 'set-sl', coin: i.coin, level: i.level }, s, c);
    return addStop({ type: 'add-stop', coin: i.coin, level: i.level, sellPct: i.sellPct, shownUsd: i.shownUsd }, s, c);
  }
  const problem = levelProblem(trigger, 'tp', now, base);
  if (problem) {
    // Below the price: say how to get a stop there instead.
    const all = i.sellUsd == null && (i.sellPct == null || i.sellPct >= 100);
    const some = i.sellUsd != null ? money(i.sellUsd) : trimPct(i.sellPct ?? 100);
    const below = !(rel < 1) ? '' : all ? ` To sell it all if it drops there, say "sl at ${typed(i.level)}".` : ` To sell some if it drops there, say "sell ${some} if it drops to ${typed(i.level)}".`;
    // "sell 10% at 1.2x" on a plan bought lower: 1.2x the entry is already behind — a stop there, or 1.2x from here?
    if (plan && i.level.kind === 'x' && rel < 1 && i.level.value > 1 && now.mc) {
      const ahead = formatUsd(now.mc * i.level.value).replace(/^\$/, '').toLowerCase();
      const how = all ? `"sl at ${typed(i.level)}"` : `"sell ${some} if it drops to ${typed(i.level)}"`;
      return refuse(`${formatX(i.level.value)} your entry is ${short(trigger, base)} — below where ${sym(c)} is now (${nowText(c)}). A stop there, or ${formatX(i.level.value)} from now? Say ${how} for the stop, or "sell ${some} at ${ahead}" to sell higher.`);
    }
    return refuse(`${problem} ${sym(c)} is at ${nowText(c)}.${below}`);
  }
  const where = at(trigger, base, now, !!plan);
  const size = sizeAt(i, c, plan ? plan.origBalance : c.balance, trigger, base, i.level);
  if (isReply(size)) return size;
  const usd = size.usd ?? i.shownUsd ?? null;
  /** "sell $3 ≈ 43% of your bag" for a size said in dollars. */
  const inUsd = (pct: number) => `${money(usd!)} ${approxPct(pct)} of your bag`;

  if (!plan) {
    // The only level: unless you said a size, it sells the whole bag (like a take-profit order anywhere else).
    const pct = size.pct ?? 100;
    const small = c.balance != null && c.balance > 0 ? minSellProblem(s, c, pct, c.balance, trigger, base, false, usd) : null;
    if (small) return refuse(small);
    const what = usd != null ? `sell ${inUsd(pct)} at ${where}.` : i.sellPct == null ? `sell all of it at ${where} — say "sell half at …" to keep some.` : `sell ${trimPct(pct)} at ${where}.`;
    const done = usd != null ? `sell ${trimPct(pct)} of ${sym(c)} (≈${money(usd)})` : `sell ${pct}% of ${sym(c)}`;
    return pin(armNew(s, c, { tps: [{ trigger, sellPct: pct }], sl: null, trailing: null }, `Add a take-profit on ${sym(c)}: ${what}`, 'Add it', `Done! I'll ${done} at ${short(trigger, base)}. No stop loss yet — say "sl -30%" to add one.`), i, pct, size.usd);
  }

  const editable = plan.tps.filter(isEditableTp);
  const locked = plan.tps.filter((t) => !isEditableTp(t) && t.status !== 'cancelled');
  if (editable.length + locked.length >= MAX_TPS) return refuse(`${sym(c)} already has ${MAX_TPS} take-profits — that's the most. Remove one first, like "remove tp${plan.tps.length}".`);
  const dup = editable.find((t) => sameLevel(t.trigger, trigger, base));
  if (dup) {
    const n = plan.tps.indexOf(dup) + 1;
    return refuse(`You already have TP${n} at ${short(dup.trigger, base)} on ${sym(c)} — say "move tp${n} to …" to change it.`);
  }
  const used = [...locked, ...editable].reduce((sum, t) => sum + t.sellPct, 0);
  const room = Math.max(0, +(100 - used).toFixed(4));
  const counting = locked.length ? ' (counting what already sold)' : '';
  if (room < 1) return refuse(`Your take-profits on ${sym(c)} already sell 100% of the bag${counting} — lower or remove one first.`);
  const pct = size.pct ?? (editable.length ? Math.min(DEFAULT_TP_PCT, room) : room);
  if (pct > room + 1e-6) {
    // "sell all at 3m" with take-profits already set: "all" can only be what they don't sell — offered, never assumed.
    if (i.sellUsd == null && i.sellPct != null && i.sellPct >= 100) {
      return refuse(`Your take-profits on ${sym(c)} already sell ${trimPct(used)} of the bag${counting}, so "all" here is the other ${trimPct(room)}. Say "sell ${trimPct(room)} at ${typed(i.level)}" — or remove a take-profit first.`);
    }
    return refuse(`That would sell ${Math.round(used + pct)}% of your ${sym(c)} bag${counting} — there's room for ${trimPct(room)} more. Say "sell ${trimPct(room)} at ${typed(i.level)}" for the rest.`);
  }
  const small = minSellProblem(s, c, pct, plan.origBalance, trigger, base, false, usd);
  if (small) return refuse(small);
  const edit = planEditWith(plan, {});
  edit.tps.push({ id: null, trigger, sellPct: pct });
  const what =
    usd != null
      ? `sell ${inUsd(pct)} at ${where}.`
      : i.sellPct != null
        ? `sell ${trimPct(pct)} of your bag at ${where}.`
        : pct === room
          ? `sell the rest (${trimPct(pct)} of your bag) at ${where}.`
          : `sell ${trimPct(pct)} of your bag at ${where} — you didn't say how much, so I picked ${trimPct(pct)}.`;
  const step = editRunning(
    s,
    c,
    plan,
    edit,
    (n) => `Add ${n ? `TP${n}` : 'a take-profit'} on ${sym(c)}: ${what}`,
    'Add it',
    (n) => `Done! ${n ? `TP${n}` : 'Take-profit'} on ${sym(c)}: sell ${trimPct(pct)}${usd != null ? ` (≈${money(usd)})` : ''} at ${short(trigger, base)}.`,
  );
  return pin(step, i, pct, size.usd);
}

/**
 * A stop asked for above the price ("sl 25% at 2x", "sell half if it tanks to 2x"): the order for
 * each side, the user's own size in both — selling there on the way up, or a stop below now.
 */
function aboveNow(i: { sellPct: number | null; sellUsd?: number; level: LevelSpec }, t: Trigger, base: Now, now: Now): string {
  const rel = fromNow(t, base, now);
  if (!(rel >= 1 + AT_MARKET)) return '';
  const size = i.sellUsd != null ? money(i.sellUsd) : i.sellPct != null && i.sellPct < 100 ? sizeWords(i.sellPct) : 'all';
  // A multiple's mirror below ("2x" up ↔ "drops 50%"), else 20%.
  const drop = i.level.kind === 'x' && i.level.value > 1 ? Math.min(90, Math.round((1 - 1 / i.level.value) * 100)) : 20;
  return ` To sell ${size === 'all' ? 'it all' : size} on the way up, say "sell ${size} at ${typed(i.level)}" — for a stop, pick a level below, like "sell ${size} if it drops ${drop}%".`;
}

/** A partial stop: "sell 10% if it drops to $700K MC" · "sl $2 at 650k". Sized like a take-profit, fires on the way down. */
function addStop(i: Sell<'add-stop'>, s: Snap, c: ChatCoin): Step {
  const noPrice = needPrice(c);
  if (noPrice) return noPrice;
  const now = nowOf(c);
  const plan = livePlan(s.plans, c.key);
  const base = plan ? entryOf(plan) : now;
  const trigger = toTrigger(i.level, base);
  if (!trigger) return refuse('Where should the stop go? Try "sell 10% if it drops to 700k".');
  const problem = stopProblem(trigger, base, now);
  if (problem) return refuse(`${problem} ${sym(c)} is at ${nowText(c)}.${aboveNow(i, trigger, base, now)}`);
  const size = sizeAt(i, c, plan ? plan.origBalance : c.balance, trigger, base, i.level);
  if (isReply(size)) return size;
  const pct = size.pct;
  const usd = size.usd ?? i.shownUsd ?? null;
  if (pct == null || !(pct > 0 && pct <= 100)) return refuse('Sell amount must be between 1% and 100%.');
  // "stop 100% at 700k" is the stop loss that sells the rest (the window does the same).
  if (pct >= 100) return setSl({ type: 'set-sl', coin: i.coin, level: i.level }, s, c);
  const amount = usd != null ? `${money(usd)} ${approxPct(pct)} of your bag` : trimPct(pct);
  const say = `Add a stop on ${sym(c)}: sell ${amount} if it drops to ${at(trigger, base, now, !!plan)}.`;
  const sold = `${trimPct(pct)}${usd != null ? ` (≈${money(usd)})` : ''}`;

  if (!plan) {
    const small = c.balance != null && c.balance > 0 ? minSellProblem(s, c, pct, c.balance, trigger, base, true, usd) : null;
    if (small) return refuse(small);
    return pin(armNew(s, c, { tps: [], stops: [{ trigger, sellPct: pct }], sl: null, trailing: null }, say, 'Add it', `Done! I'll sell ${sold} of ${sym(c)} if it drops to ${short(trigger, base)}.`), i, pct, size.usd);
  }

  const editable = plan.stops.filter(isEditableStop);
  const locked = plan.stops.filter((t) => !isEditableStop(t) && t.status !== 'cancelled');
  if (editable.length + locked.length >= MAX_STOPS) return refuse(`${sym(c)} already has ${MAX_STOPS} stops — that's the most. Remove one first, like "remove stop ${plan.stops.length}".`);
  const dup = editable.find((t) => sameLevel(t.trigger, trigger, base));
  if (dup) {
    const n = plan.stops.indexOf(dup) + 1;
    return refuse(`You already have stop ${n} at ${short(dup.trigger, base)} on ${sym(c)} — say "move stop ${n} to …" to change it.`);
  }
  const used = [...locked, ...editable].reduce((sum, t) => sum + t.sellPct, 0);
  const room = Math.max(0, +(100 - used).toFixed(4));
  const counting = locked.length ? ' (counting what already sold)' : '';
  if (room < 1) return refuse(`Your stops on ${sym(c)} already sell 100% of the bag${counting} — lower or remove one first.`);
  if (pct > room + 1e-6) return refuse(`Your stops on ${sym(c)} would sell ${Math.round(used + pct)}% of the bag${counting} — there's room for ${trimPct(room)} more. Say "sell ${trimPct(room)} if it drops to ${typed(i.level)}" for the rest.`);
  const small = minSellProblem(s, c, pct, plan.origBalance, trigger, base, true, usd);
  if (small) return refuse(small);
  // A stop loss at or above this level sells everything first.
  const slRel = plan.sl ? fromNow(plan.sl.trigger, base, now) : NaN;
  const first = plan.sl && slRel >= fromNow(trigger, base, now) ? ` Heads up: your stop loss at ${short(plan.sl.trigger, base)} is higher, so it would sell everything first.` : '';
  const edit = planEditWith(plan, {});
  edit.stops = [...(edit.stops ?? []), { id: null, trigger, sellPct: pct }];
  const step = editRunning(
    s,
    c,
    plan,
    edit,
    () => `${say}${first}`,
    'Add it',
    (_, n) => `Done! ${n ? `Stop ${n}` : 'Stop'} on ${sym(c)}: sell ${sold} if it drops to ${short(trigger, base)}.`,
  );
  return pin(step, i, pct, size.usd);
}

/**
 * "sl at be" / "sl breakeven": the entry. With no plan yet the entry is the price now, so a stop
 * there would sell at once; on a plan in the red it's above the price. Either way: why, and what to say.
 */
function breakevenProblem(level: LevelSpec, trigger: Trigger, base: Now, now: Now, c: ChatCoin, plan: Plan | null): Reply | null {
  if (!(level.kind === 'x' && level.value === 1)) return null;
  if (!plan) return refuse(`There's no plan on ${sym(c)} yet, so breakeven is the price now (${nowText(c)}) — a stop there would sell at once. Pick a level below it, like "sl -10%".`);
  const rel = fromNow(trigger, base, now);
  if (!Number.isFinite(rel) || rel < 1 - AT_MARKET) return null;
  if (rel < 1 + AT_MARKET) return refuse(`Breakeven (your entry, ${short(trigger, base)}) is where ${sym(c)} is now — a stop there would sell at once. Pick a level below it, like "sl -10%".`);
  return refuse(`Breakeven (your entry, ${short(trigger, base)}) is above where ${sym(c)} is now (${nowText(c)}) — a stop has to be below the price. Try "sl -10%".`);
}

function setSl(i: Of<'set-sl'>, s: Snap, c: ChatCoin): Step {
  const noPrice = needPrice(c);
  if (noPrice) return noPrice;
  const now = nowOf(c);
  const plan = livePlan(s.plans, c.key);
  const base = plan ? entryOf(plan) : now;
  const trigger = toTrigger(i.level, base);
  if (!trigger) return refuse('Where should the stop go? Try "sl at 300k mcap" or "sl -30%".');
  const be = breakevenProblem(i.level, trigger, base, now, c, plan);
  if (be) return be;
  const problem = levelProblem(trigger, 'sl', now, base);
  if (problem) return refuse(`${problem} ${sym(c)} is at ${nowText(c)}.${aboveNow({ sellPct: null, level: i.level }, trigger, base, now)}`);
  // The window's rule: a stop loss sells your whole bag, so the bag has to be worth fomo's minimum there.
  const small = c.balance != null && c.balance > 0 ? minSellProblem(s, c, 100, c.balance, trigger, base, false) : null;
  if (small) return refuse(small);
  const where = at(trigger, base, now, !!plan);
  if (!plan) return armNew(s, c, { tps: [], sl: { trigger }, trailing: null }, `Set a stop loss on ${sym(c)} at ${where}: if it falls there, I sell all of it.`, 'Set it', `Done! Stop loss on ${sym(c)} at ${short(trigger, base)}.`);
  return moveSl(s, c, plan, trigger, where);
}

function moveSl(s: Snap, c: ChatCoin, plan: Plan, trigger: Trigger, where: string): Step {
  const base = entryOf(plan);
  const old = plan.sl;
  if (old && sameLevel(old.trigger, trigger, base)) return answer(`Your stop on ${sym(c)} is already at ${short(old.trigger, base)}.`);
  const edit: PlanEdit = { ...planEditWith(plan, {}), sl: { trigger } };
  return editRunning(
    s,
    c,
    plan,
    edit,
    () => (old ? `Move your stop on ${sym(c)} from ${short(old.trigger, base)} to ${where}. If it falls there, I sell the rest.` : `Add a stop loss on ${sym(c)} at ${where}: if it falls there, I sell the rest.`),
    old ? 'Move it' : 'Set it',
    () => `Done! Your stop on ${sym(c)} is at ${short(trigger, base)}.`,
  );
}

function setTrail(i: Of<'set-trail'>, s: Snap, c: ChatCoin): Step {
  if (!(i.trailPct > 0 && i.trailPct < 100)) return refuse('Trailing distance must be between 1% and 99% — like "trail 20%".');
  if (i.afterX != null && !(i.afterX > 1)) return refuse('Start trailing at a multiple above 1x — like "trail 20% after 2x".');
  const noPrice = needPrice(c);
  if (noPrice) return noPrice;
  const now = nowOf(c);
  const plan = livePlan(s.plans, c.key);
  const base = plan ? entryOf(plan) : now;
  const trailing = { trailPct: i.trailPct, activateX: i.afterX };
  const when = i.afterX ? `once it reaches ${formatX(i.afterX)} ${plan ? 'your entry' : 'from now'} (${short({ kind: 'x', value: i.afterX }, base)})` : 'starting now';
  const what = `${when}, I'll follow it up and sell the rest if it falls ${trimPct(i.trailPct)} from its highest price.`;
  if (!plan) return armNew(s, c, { tps: [], sl: null, trailing }, `Add a trailing stop on ${sym(c)}: ${what}`, 'Set it', `Done! Trailing stop on ${sym(c)}: ${trimPct(i.trailPct)} from the top.`);
  const old = plan.trailing;
  if (old && old.trailPct === i.trailPct && old.activateX === i.afterX) return answer(`Your trailing stop on ${sym(c)} is already ${trimPct(i.trailPct)}${old.activateX ? ` after ${formatX(old.activateX)}` : ''}.`);
  const edit: PlanEdit = { ...planEditWith(plan, {}), trailing };
  return editRunning(s, c, plan, edit, () => `${old ? 'Change your' : 'Add a'} trailing stop on ${sym(c)}: ${what}`, 'Set it', () => `Done! Trailing stop on ${sym(c)}: ${trimPct(i.trailPct)} from the top.`, false);
}

function move(i: Of<'move'>, s: Snap, c: ChatCoin): Step {
  if (i.target.kind === 'buy') return moveBuyStep(i, s, c);
  const plan = livePlan(s.plans, c.key);
  if (!plan) return refuse(`I'm not guarding ${sym(c)} — say "tp at …" or "sl at …" to set one up.`);
  const noPrice = needPrice(c);
  if (noPrice) return noPrice;
  const now = nowOf(c);
  const base = entryOf(plan);
  const trigger = toTrigger(i.level, base);
  if (!trigger) return refuse('Move it where? Try "move tp1 to 2m" or "move my stop to 250k".');
  const where = at(trigger, base, now, true);
  if (i.target.kind === 'stop') return moveStop(i.target.index, s, c, plan, trigger, where);
  if (i.target.kind === 'sl') {
    if (!plan.sl) return refuse(`You don't have a stop loss on ${sym(c)} — ${plan.stops.some(isEditableStop) ? 'to move a partial stop, say "move stop 1 to …"' : 'say "sl at 300k" to set one'}.`);
    const be = breakevenProblem(i.level, trigger, base, now, c, plan);
    if (be) return be;
    const problem = levelProblem(trigger, 'sl', now, base);
    if (problem) return refuse(`${problem} ${sym(c)} is at ${nowText(c)}.`);
    return moveSl(s, c, plan, trigger, where);
  }
  const n = i.target.index;
  const tp = plan.tps[n - 1];
  if (!tp) return refuse(plan.tps.length ? `${sym(c)} has ${plan.tps.length === 1 ? 'only TP1' : `TP1–TP${plan.tps.length}`} — there's no TP${n}.` : `${sym(c)} has no take-profits yet — say "tp at …" to add one.`);
  if (!isEditableTp(tp)) return refuse(`TP${n} on ${sym(c)} ${lockedWhy(tp)} — it stays as it is.`);
  const problem = levelProblem(trigger, 'tp', now, base);
  if (problem) return refuse(`${problem} ${sym(c)} is at ${nowText(c)}.`);
  if (sameLevel(tp.trigger, trigger, base)) return answer(`TP${n} on ${sym(c)} is already at ${short(tp.trigger, base)}.`);
  const dup = plan.tps.find((t) => t !== tp && isEditableTp(t) && sameLevel(t.trigger, trigger, base));
  if (dup) return refuse(`TP${plan.tps.indexOf(dup) + 1} on ${sym(c)} is already at ${short(dup.trigger, base)} — pick another level.`);
  const edit = planEditWith(plan, { tp: { id: tp.id, trigger } });
  return editRunning(
    s,
    c,
    plan,
    edit,
    () => `Move TP${n} on ${sym(c)} from ${short(tp.trigger, base)} to ${where} — still selling ${trimPct(tp.sellPct)} of your bag.`,
    'Move it',
    () => `Done! Moved it to ${short(trigger, base)}.`,
  );
}

/** "stop 3"'s place in words, when it isn't there. */
function noStop(n: number, c: ChatCoin, plan: Plan): Reply {
  const k = plan.stops.length;
  if (k) return refuse(`${sym(c)} has ${k === 1 ? 'only stop 1' : `stops 1–${k}`} — there's no stop ${n}.`);
  return refuse(`${sym(c)} has no partial stops — say "sell 10% if it drops to …" to add one${plan.sl ? ', or "my stop" for your stop loss' : ''}.`);
}

function moveStop(n: number, s: Snap, c: ChatCoin, plan: Plan, trigger: Trigger, where: string): Step {
  const base = entryOf(plan);
  const now = nowOf(c);
  const st = plan.stops[n - 1];
  if (!st) return noStop(n, c, plan);
  if (!isEditableStop(st)) return refuse(`Stop ${n} on ${sym(c)} ${lockedWhy(st)} — it stays as it is.`);
  const problem = stopProblem(trigger, base, now);
  if (problem) return refuse(`${problem} ${sym(c)} is at ${nowText(c)}.`);
  if (sameLevel(st.trigger, trigger, base)) return answer(`Stop ${n} on ${sym(c)} is already at ${short(st.trigger, base)}.`);
  const dup = plan.stops.find((t) => t !== st && isEditableStop(t) && sameLevel(t.trigger, trigger, base));
  if (dup) return refuse(`Stop ${plan.stops.indexOf(dup) + 1} on ${sym(c)} is already at ${short(dup.trigger, base)} — pick another level.`);
  const small = minSellProblem(s, c, st.sellPct, plan.origBalance, trigger, base, true);
  if (small) return refuse(small);
  const edit = planEditWith(plan, { stop: { id: st.id, trigger } });
  return editRunning(
    s,
    c,
    plan,
    edit,
    () => `Move stop ${n} on ${sym(c)} from ${short(st.trigger, base)} to ${where} — still selling ${trimPct(st.sellPct)} of your bag.`,
    'Move it',
    () => `Done! Moved it to ${short(trigger, base)}.`,
  );
}

function moveBuyStep(i: Of<'move'>, s: Snap, c: ChatCoin): Step {
  const noPrice = needPrice(c);
  if (noPrice) return noPrice;
  const open = s.buys.filter((o) => o.key === c.key && waitingBuy(o));
  if (!open.length) return refuse(`You have no limit buy waiting on ${sym(c)} — say "buy $10 at 300k mcap" to place one.`);
  if (open.length > 1) return refuse(`You have ${open.length} buys on ${sym(c)} (${open.map((o) => `${money(o.usd)} at ${short(o.trigger, refOf(o))}`).join(', ')}) — drag the one you want on fomo's chart, or cancel one.`);
  const o = open[0];
  const now = nowOf(c);
  const trigger = toTrigger(i.level, now);
  if (!trigger) return refuse('Move it where? Try "move my buy to 400k".');
  const problem = levelProblem(trigger, 'buy', now);
  if (problem) return refuse(`${problem} ${sym(c)} is at ${nowText(c)}.`);
  const issue = validateBuyInput({ ...o, trigger, ref: { priceUSD: c.priceUSD!, mc: c.mc, source: 'armed-at' }, expiresInMs: null }, 0)[0];
  if (issue) return refuse(issue.message);
  const dip = levelX(trigger, now) < 1;
  return {
    say: `Move your ${money(o.usd)} buy on ${sym(c)} from ${short(o.trigger, refOf(o))} to ${at(trigger, now, now)} — I'll buy if it ${dip ? 'dips' : 'breaks out'} to there.${tradeNotes(s, 'buy')}`,
    label: 'Move it',
    sig: `move-buy|${o.id}|${JSON.stringify(trigger)}|${dip}`,
    fresh: true,
    send: (api) => api.moveBuy(o.id, trigger, { priceUSD: c.priceUSD!, mc: c.mc }),
    done: () => `Done! Your ${money(o.usd)} buy on ${sym(c)} is at ${short(trigger, now)}.`,
  };
}

function removeLevel(i: Of<'remove-level'>, s: Snap, c: ChatCoin): Step {
  const plan = livePlan(s.plans, c.key);
  if (!plan) return refuse(`I'm not guarding ${sym(c)}, so there's nothing to remove.`);
  const base = entryOf(plan);
  const keep = planEditWith(plan, {});
  let edit: PlanEdit;
  let what: string;
  let after = '';
  if (i.target.kind === 'tp') {
    const n = i.target.index;
    const tp = plan.tps[n - 1];
    if (!tp) return refuse(plan.tps.length ? `${sym(c)} has ${plan.tps.length === 1 ? 'only TP1' : `TP1–TP${plan.tps.length}`} — there's no TP${n}.` : `${sym(c)} has no take-profits.`);
    if (!isEditableTp(tp)) return refuse(`TP${n} on ${sym(c)} ${lockedWhy(tp)} — it stays as it is.`);
    edit = { ...keep, tps: keep.tps.filter((t) => t.id !== tp.id) };
    what = `TP${n} on ${sym(c)} (sell ${trimPct(tp.sellPct)} at ${short(tp.trigger, base)})`;
  } else if (i.target.kind === 'stop') {
    const n = i.target.index;
    const st = plan.stops[n - 1];
    if (!st) return noStop(n, c, plan);
    if (!isEditableStop(st)) return refuse(`Stop ${n} on ${sym(c)} ${lockedWhy(st)} — it stays as it is.`);
    edit = { ...keep, stops: (keep.stops ?? []).filter((t) => t.id !== st.id) };
    what = `stop ${n} on ${sym(c)} (sell ${trimPct(st.sellPct)} if it drops to ${short(st.trigger, base)})`;
  } else if (i.target.kind === 'sl') {
    if (!plan.sl) return refuse(`You don't have a stop loss on ${sym(c)}${plan.stops.some(isEditableStop) ? ' — to remove a partial stop, say "remove stop 1"' : ''}.`);
    edit = { ...keep, sl: null };
    what = `your stop loss on ${sym(c)} (${short(plan.sl.trigger, base)})`;
    after = ' Without it, nothing sells if it falls.';
  } else {
    if (!plan.trailing) return refuse(`You don't have a trailing stop on ${sym(c)}.`);
    edit = { ...keep, trailing: null };
    what = `your trailing stop on ${sym(c)} (${trimPct(plan.trailing.trailPct)} from the top)`;
  }
  const blocked = [...plan.tps, ...plan.stops].some((t) => t.status === 'blocked');
  if (!edit.tps.length && !edit.stops?.length && !edit.sl && !edit.trailing && !blocked) {
    return refuse(`That's the last level on ${sym(c)} — say "cancel my plan on ${c.symbol}" to stop guarding it instead.`);
  }
  return editRunning(s, c, plan, edit, () => `Remove ${what}?${after}`, 'Remove it', () => 'Done! Removed.', false);
}

function limitBuy(i: Of<'limit-buy'>, s: Snap, c: ChatCoin): Step {
  const noPrice = needPrice(c);
  if (noPrice) return noPrice;
  if (!(i.usd > 0) || !Number.isFinite(i.usd)) return refuse('How much? Try "buy $10 at 300k mcap".');
  const trigger = toTrigger(i.level, nowOf(c));
  if (!trigger) return refuse('At what level? Try "buy $10 at 300k mcap" or "buy $10 if it dips 20%".');
  const { presets, defaultPresetId } = s.settings;
  const fallback = presets.find((p) => p.id === defaultPresetId) ?? presets[0] ?? null;
  let guard: Preset | null;
  if (i.preset === 'none') guard = null;
  else if (i.preset == null || i.preset === 'default') guard = fallback;
  else {
    guard = findPreset(i.preset, s);
    if (!guard) return unknownPreset(i.preset, s);
  }
  const expiresInMs = i.expiresInMs === 'default' ? DEFAULT_BUY_EXPIRY_MS : i.expiresInMs;
  const input: Omit<BuyInput, 'id' | 'now'> = {
    key: c.key,
    networkId: c.networkId,
    address: c.address,
    symbol: c.symbol,
    name: c.name,
    trigger,
    ref: { priceUSD: c.priceUSD!, mc: c.mc, source: 'armed-at' },
    usd: +i.usd.toFixed(2),
    guardPresetId: guard?.id ?? null,
    expiresInMs,
  };
  const issue = validateBuyInput(input, s.minBuyUsd(c.networkId))[0];
  if (issue) return refuse(issue.field === 'expiry' ? 'Pick when this order should expire — like "for 24h", or "never".' : issue.message);
  const now = nowOf(c);
  const problem = levelProblem(trigger, 'buy', now);
  if (problem) return refuse(`${problem} ${sym(c)} is at ${nowText(c)}.`);
  const dip = levelX(trigger, now) < 1;
  // "if it dips to 1m" while it's at $719K: that level is a breakout — never swap the side you said.
  if (i.said && (i.said === 'dip') !== dip) {
    const other = dip ? `"buy ${money(i.usd)} if it dips to ${typed(i.level)}"` : `"buy ${money(i.usd)} if it breaks out to ${typed(i.level)}"`;
    return refuse(`${short(trigger, now)} is ${dip ? 'below' : 'above'} where ${sym(c)} is now (${nowText(c)}), so that's a ${dip ? 'dip' : 'breakout'}, not a ${i.said}. If that's what you want, say ${other} — or pick a level ${i.said === 'dip' ? 'below' : 'above'} ${nowText(c)}.`);
  }
  const covering = livePlan(s.plans, c.key);
  // Holding the coin with no plan: the preset guards the whole bag (like the window says).
  const withBag = !covering && guard && c.balance != null && c.balance > 0 ? ' — your current bag too' : '';
  const then = covering
    ? `your current guard on ${sym(c)} covers the new coins`
    : guard
      ? `then guard the new coins with ${presetName(guard, presets)} (${presetText(guard)})${withBag}`
      : 'no TP / SL after';
  const expiry = expiresInMs == null ? ' No expiry.' : ` Expires in ${duration(expiresInMs)}.`;
  const cash = s.cash != null && input.usd > s.cash ? ` Heads up: you have ${money(Math.floor(s.cash * 100) / 100)} cash on fomo — top up, or I can't buy when it hits.` : '';
  return {
    say: `Place a limit buy on ${sym(c)}: ${money(input.usd)} if it ${dip ? 'dips' : 'breaks out'} to ${at(trigger, now, now)}, ${then}.${expiry}${cash}${tradeNotes(s, 'buy')}`,
    label: 'Place buy',
    sig: `buy|${c.key}|${input.usd}|${JSON.stringify(trigger)}|${dip}|${input.guardPresetId}|${expiresInMs}`,
    fresh: true,
    send: (api) => api.armBuy(input),
    done: () => `Done! I'm watching ${sym(c)} — ${money(input.usd)} at ${short(trigger, now)}${covering ? ', covered by your guard' : guard ? `, then ${guard.name}` : ''}.`,
  };
}

function cancelBuys(s: Snap, c: ChatCoin | null): Step {
  const mine = s.buys.filter((o) => isLiveBuy(o) && (!c || o.key === c.key));
  const open = mine.filter(waitingBuy);
  const where = c ? ` on ${sym(c)}` : '';
  if (!open.length) {
    if (mine.length) return refuse(`Your buy${where} is going through right now (or may have bought) — check fomo, then answer in my window.`);
    return answer(`You have no limit buys waiting${where}.`);
  }
  const list = open.map((o) => `${c ? '' : `${sym(o)} `}${money(o.usd)} at ${short(o.trigger, refOf(o))}`).join(', ');
  const busy = mine.length > open.length ? ' (One is mid-buy — that one has to finish.)' : '';
  const one = open.length === 1;
  return {
    say: one ? `Cancel your limit buy${c ? where : ` on ${sym(open[0])}`}: ${list}?${busy}` : `Cancel your ${open.length} limit buys${where}: ${list}?${busy}`,
    label: one ? 'Cancel it' : 'Cancel them',
    sig: `cancel-buy|${open.map((o) => o.id).sort().join(',')}`,
    fresh: false,
    send: (api) => sendAll(open.map((o) => () => api.cancelBuy(o.id))),
    done: () => (one ? 'Done! Cancelled.' : `Done! Cancelled ${open.length} buys.`),
  };
}

function stopPlan(s: Snap, c: ChatCoin): Step {
  const plan = livePlan(s.plans, c.key);
  if (!plan) {
    const hasBuy = s.buys.some((o) => o.key === c.key && waitingBuy(o));
    return answer(`I'm not guarding ${sym(c)}.${hasBuy ? ` You have a limit buy on it — say "cancel my buy on ${c.symbol}" to drop that.` : ''}`);
  }
  const selling = hasInFlight(plan) ? ' A sell is going through right now — that one may still finish.' : '';
  return {
    say: `Stop guarding ${sym(c)}? I'll cancel its levels (${planLine(plan)}) — nothing gets sold.${selling}`,
    label: 'Stop it',
    sig: `stop|${plan.id}`,
    fresh: false,
    send: (api) => api.cancel(plan.id),
    done: () => `Done! I stopped guarding ${sym(c)}.`,
  };
}

function pause(i: Of<'pause'>, s: Snap, c: ChatCoin | null): Step {
  if (!c) {
    const paused = s.plans.filter((p) => p.state === 'paused');
    if (i.paused) {
      if (s.settings.paused) return answer("I'm already paused — say \"resume\" to wake me up.");
      return {
        say: 'Pause Tippy? No buys or sells on any coin until you say "resume" — stops included.',
        label: 'Pause',
        sig: 'pause-all',
        fresh: false,
        send: (api) => api.pauseAll(true),
        done: () => 'Paused. Say "resume" when you want me back.',
      };
    }
    if (!s.settings.paused && !paused.length) return answer("I'm already awake and watching.");
    const guards = paused.length ? `${paused.length} paused guard${paused.length === 1 ? '' : 's'} (${paused.map((p) => sym(p)).join(', ')})` : '';
    const cmds: ((api: ChatApi) => Promise<CommandResult>)[] = [...(s.settings.paused ? [(api: ChatApi) => api.pauseAll(false)] : []), ...paused.map((p) => (api: ChatApi) => api.resume(p.id))];
    return {
      say: s.settings.paused ? `Wake Tippy up${guards ? ` and resume your ${guards}` : ''}? Your levels and buys start firing again.` : `Resume your ${guards}?`,
      label: 'Resume',
      sig: `resume-all|${s.settings.paused}|${paused.map((p) => p.id).sort().join(',')}`,
      fresh: false,
      send: (api) => sendAll(cmds.map((cmd) => () => cmd(api))),
      done: () => "I'm back on watch.",
    };
  }
  const plan = livePlan(s.plans, c.key);
  if (!plan) {
    const hasBuy = s.buys.some((o) => o.key === c.key && waitingBuy(o));
    return refuse(`I'm not guarding ${sym(c)}.${hasBuy ? ' Limit buys can\'t be paused one at a time — cancel it, or say "pause everything".' : ''}`);
  }
  if (i.paused) {
    if (plan.state === 'paused') return answer(`Your ${sym(c)} guard is already paused.`);
    return {
      say: `Pause your guard on ${sym(c)}? Its take-profits and stop loss won't fire until you resume it.`,
      label: 'Pause it',
      sig: `pause|${plan.id}`,
      fresh: false,
      send: (api) => api.pause(plan.id),
      done: () => `Paused ${sym(c)}.`,
    };
  }
  if (plan.state === 'armed') return answer(s.settings.paused ? `Your ${sym(c)} guard is on, but I'm paused overall — say "resume everything".` : `I'm already watching ${sym(c)}.`);
  return {
    say: `Resume your guard on ${sym(c)} (${planLine(plan)})?${s.settings.paused ? ' I\'m paused overall too — say "resume everything" for that.' : ''}`,
    label: 'Resume it',
    sig: `resume|${plan.id}`,
    fresh: false,
    send: (api) => api.resume(plan.id),
    done: () => `I'm watching ${sym(c)} again.`,
  };
}

function applyPreset(i: Of<'apply-preset'>, s: Snap, c: ChatCoin): Step {
  const p = findPreset(i.preset, s);
  if (!p) return unknownPreset(i.preset, s);
  const noPrice = needPrice(c);
  if (noPrice) return noPrice;
  const now = nowOf(c);
  const plan = livePlan(s.plans, c.key);
  const base = plan ? entryOf(plan) : now;
  const name = presetName(p, s.settings.presets);
  const tps = p.tps.map((t) => ({ trigger: { kind: 'x' as const, value: t.x }, sellPct: t.pct }));
  const sl = p.slX != null ? { trigger: { kind: 'x' as const, value: p.slX } } : null;
  const trailing = p.trail ? { trailPct: p.trail.pct, activateX: p.trail.activateX } : null;
  for (const t of tps) {
    if (levelProblem(t.trigger, 'tp', now, base)) return refuse(`${name}'s ${formatX(t.trigger.value)} take-profit (${short(t.trigger, base)}) is below where ${sym(c)} is now (${nowText(c)}) — its levels are measured from your entry. Set your own instead, like "tp at" a market cap above ${nowText(c)}.`);
  }
  if (sl && levelProblem(sl.trigger, 'sl', now, base)) return refuse(`${name}'s stop (${short(sl.trigger, base)}) is above where ${sym(c)} is now (${nowText(c)}) — set your own, like "sl -20%".`);
  const parts = tps.map((t) => `${t.sellPct}% at ${short(t.trigger, base)} (${formatX(t.trigger.value)})`);
  const levels = [
    parts.length ? `sell ${parts.join(', ')}` : '',
    sl ? `stop at ${short(sl.trigger, base)} (${dropText(sl.trigger.value)})` : '',
    trailing ? `trail the rest ${trimPct(trailing.trailPct)} from the top${trailing.activateX ? ` after ${formatX(trailing.activateX)}` : ''}` : '',
  ]
    .filter(Boolean)
    .join('; ');
  if (!plan) return armNew(s, c, { tps, sl, trailing }, `Guard ${sym(c)} with ${name}: ${levels}.`, 'Guard it', `Done! Guarding ${sym(c)} with ${p.name}.`);
  // A preset replaces every open level, partial stops included (the card lists them).
  const edit: PlanEdit = { tps: tps.map((t) => ({ id: null, ...t })), stops: [], sl, trailing };
  return editRunning(s, c, plan, edit, () => `Switch ${sym(c)} to ${name}, measured from your entry: ${levels}. This replaces your open levels (${planLine(plan)}).`, 'Use it', () => `Done! ${sym(c)} is on ${p.name}.`);
}

function coinStatus(c: ChatCoin, s: Snap): string {
  const plan = livePlan(s.plans, c.key);
  const buys = s.buys.filter((o) => o.key === c.key && isLiveBuy(o));
  const now: Now = c.priceUSD ? nowOf(c) : plan ? { priceUSD: plan.lastPrice, mc: plan.lastMc } : { priceUSD: null, mc: null };
  const rel = (t: Trigger, base: Now) => {
    const r = fromNow(t, base, now);
    return Number.isFinite(r) ? ` (${moveText(r)})` : '';
  };
  const head = now.priceUSD || now.mc ? ` · ${nowText(now)} now` : '';
  const bag = bagUsd(c);
  const lines = [`${sym(c)}${head}${bag ? ` · bag ${bag}` : ''}`];
  if (s.settings.paused) lines.push('Tippy is paused overall — say "resume" to wake me up.');
  if (plan) {
    const base = entryOf(plan);
    if (plan.state === 'paused') lines.push('Guard is paused.');
    plan.tps.forEach((t, k) => lines.push(`TP${k + 1} · sell ${trimPct(t.sellPct)} at ${short(t.trigger, base)}${OPEN.includes(t.status) ? rel(t.trigger, base) : ''} — ${TP_WORD[t.status]}`));
    plan.stops.forEach((t, k) => lines.push(`Stop ${k + 1} · sell ${trimPct(t.sellPct)} if it drops to ${short(t.trigger, base)}${OPEN.includes(t.status) ? rel(t.trigger, base) : ''} — ${TP_WORD[t.status]}`));
    if (plan.sl) lines.push(`SL · ${short(plan.sl.trigger, base)}${rel(plan.sl.trigger, base)} — sells the rest`);
    if (plan.trailing) {
      const tr = plan.trailing;
      lines.push(`Trail · ${trimPct(tr.trailPct)} from the top${tr.activateX ? ` after ${formatX(tr.activateX)}` : ''} — ${tr.active ? 'on' : 'waiting'}`);
    }
    if (plan.attention) lines.push(`⚠️ ${plan.attention}`);
  }
  for (const o of buys) {
    const left = o.expiresAt != null && o.state === 'armed' ? `, ${duration(Math.max(0, o.expiresAt - Date.now()))} left` : '';
    lines.push(`Buy · ${money(o.usd)} at ${short(o.trigger, refOf(o))}${rel(o.trigger, refOf(o))} — ${BUY_WORD[o.state]}${left}`);
  }
  if (!plan && !buys.length) lines.push('Nothing set yet. Try "tp at 2x", "sl -30%" or "buy $10 if it dips 20%".');
  return lines.join('\n');
}

function allStatus(s: Snap): string {
  const plans = s.plans.filter(isLive);
  const buys = s.buys.filter(isLiveBuy);
  if (!plans.length && !buys.length) return `I'm not watching anything yet. Open a coin on fomo and try "tp at 2x" or "buy $10 if it dips 20%".${s.settings.paused ? ' (I\'m paused, too — say "resume".)' : ''}`;
  const lines: string[] = [];
  if (s.settings.paused) lines.push('Tippy is paused — say "resume" to wake me up.');
  const rows: string[] = [];
  if (plans.length) {
    rows.push(`Guarding ${plans.length} coin${plans.length === 1 ? '' : 's'}:`);
    for (const p of plans) rows.push(`${sym(p)} — ${planLine(p)}${p.state === 'paused' ? ' (paused)' : ''}${p.attention ? ' ⚠️' : ''}`);
  }
  if (buys.length) {
    rows.push(`Limit buy${buys.length === 1 ? '' : 's'}:`);
    for (const o of buys) rows.push(`${sym(o)} — ${money(o.usd)} at ${short(o.trigger, refOf(o))} (${o.direction === 'down' ? 'dip' : 'breakout'})${o.state !== 'armed' ? ` — ${BUY_WORD[o.state]}` : ''}`);
  }
  const extra = rows.length - (SHOW_MAX + 2);
  lines.push(...(extra > 0 ? [...rows.slice(0, SHOW_MAX + 2), `…and ${extra} more.`] : rows));
  return lines.join('\n');
}

function practice(i: Of<'practice'>, s: Snap, c: ChatCoin): Step {
  let usd: number | undefined;
  if (i.side === 'sell') {
    const bag = c.balance == null ? refuse(`I can't see your ${sym(c)} bag right now — open ${sym(c)} on fomo and try again.`) : c.balance > 0 ? null : refuse(`You don't hold ${sym(c)} — nothing to practise selling yet. Try "practice a buy".`);
    if (bag) return bag;
  } else {
    usd = i.usd ?? Math.max(10, s.minBuyUsd(c.networkId));
    if (!(usd > 0)) return refuse('How much? Try "practice a $10 buy".');
  }
  return {
    say: `Practice a ${i.side === 'buy' ? `${money(usd!)} buy` : 'sell'} on ${sym(c)}? I'll walk through fomo's real ${i.side === 'buy' ? 'Buy' : 'Sell'} panel in a background tab and stop right before the final button — nothing gets ${i.side === 'buy' ? 'bought' : 'sold'}.`,
    label: 'Practice',
    sig: `practice|${c.key}|${i.side}|${usd ?? ''}`,
    fresh: false,
    send: (api) => api.practice(c.key, i.side, usd),
    done: (res) => {
      const r = res.ok ? res.practice : undefined;
      if (!r) return "Practising now — I'll show how it went in my window.";
      return `${r.ok ? '✅ Practice worked' : '⚠️ Practice hit a snag'} — ${r.detail}`;
    },
  };
}

function setting(i: Of<'setting'>, s: Snap): Step {
  const { settings } = s;
  const flag = (on: boolean, name: string, current: boolean, patch: Partial<Settings>, sayOn: string, sayOff: string): Step =>
    current === on
      ? answer(`${name} is already ${on ? 'on' : 'off'}.`)
      : { say: on ? sayOn : sayOff, label: on ? 'Turn it on' : 'Turn it off', sig: `setting|${JSON.stringify(patch)}`, fresh: false, send: (api) => api.setSettings(patch), done: () => `${name} is ${on ? 'on' : 'off'}.` };
  if (i.name === 'levelUnit') {
    // Only the chat reads this now: how a bare number after "tp" / "sl" is taken.
    if (i.value !== 'mc' && i.value !== 'move') return refuse('Read bare numbers as moves ("tp 3" = 3x), or ask each time?');
    const unit = i.value;
    if (settings.levelUnit === unit)
      return answer(unit === 'move' ? 'I already read bare numbers in chat as moves ("tp 3" = 3x, "sl 30" = −30%).' : 'I already ask what a bare number means — say "3x", "-30%" or "500k" and I know.');
    return {
      say:
        unit === 'move'
          ? 'I\'ll read bare numbers in chat as moves ("tp 3" = 3x, "sl 30" = −30%). Market caps still need their k or m, like "500k".'
          : 'I\'ll stop reading bare numbers in chat as moves — "tp 3" gets a question, so say "3x", "-30%" or "500k".',
      label: 'Switch',
      sig: `setting|levelUnit|${unit}`,
      fresh: false,
      send: (api) => api.setSettings({ levelUnit: unit }),
      done: () => (unit === 'move' ? 'Done! In chat, "tp 3" now means 3x and "sl 30" −30%.' : 'Done! Say "3x", "-30%" or "500k" — I\'ll ask about a bare number.'),
    };
  }
  if (typeof i.value !== 'boolean') return refuse('On or off?');
  const on = i.value;
  switch (i.name) {
    case 'dryRun':
      return flag(on, 'Dry run', settings.dryRun, { dryRun: on }, "Turn dry run on? I'll walk through every trade but stop before pressing Buy or Sell — nothing real happens.", 'Turn dry run off? From then on I really buy and sell when your levels hit.');
    case 'autoGuard': {
      const p = settings.presets.find((x) => x.id === settings.defaultPresetId) ?? settings.presets[0];
      return flag(
        on,
        'Auto-guard',
        settings.autoGuard.enabled,
        { autoGuard: { ...settings.autoGuard, enabled: on } },
        `Turn auto-guard on? Every coin you buy from now on gets ${p ? `${presetName(p, settings.presets)} (${presetText(p)})` : 'your default preset'}.`,
        "Turn auto-guard off? New buys won't get a take-profit or stop loss automatically.",
      );
    }
    case 'chartLines':
      return flag(on, 'Chart lines', settings.chartLines !== false, { chartLines: on }, "Show my levels on fomo's chart? You can drag a line to move it.", "Hide my levels from fomo's chart?");
  }
}

export const HELP = [
  'I can set things up for you — I always show you first and wait for your tap:',
  '• "tp at 500k mcap" · "sell 25% at 2x"',
  '• "sl -30%" · "trail 20% after 2x"',
  '• "sell 10% if it drops to 700k" · "sell $20 at 1m"',
  '• "move tp1 to 2m" · "remove my stop"',
  '• "buy $10 at 300k mcap" · "cancel my buy"',
  '• "guard with classic" · "pause" · "cancel my plan"',
  '• "show my orders" · "dry run on"',
  'Add "on CLAUDIA" for a coin you hold or have orders on.',
].join('\n');

/** "half", "a quarter", "20%" — a share of your cash in words. */
const shareWords = (pct: number) => (pct === 50 ? 'half' : pct === 25 ? 'a quarter' : pct === 33 ? 'a third' : `${trimPct(pct)}`);

/**
 * A buy with no dollar amount ("buy half at 500k", "buy at 600k"): the question, your cash, and an
 * example amount that fits it — never under fomo's minimum buy, never more than you have.
 */
function buyAsk(b: { ask: string; where: string | null; pct?: number }, s: Snap): string | null {
  if (s.cash == null) return null;
  const where = b.where ?? 'if it dips 20%';
  const min = s.coin ? s.minBuyUsd(s.coin.networkId) : 0;
  const cash = Math.floor(s.cash * 100 + 1e-6) / 100;
  let head = `${b.ask} You have ${cents(cash)} cash on fomo`;
  let amount: number;
  if (b.pct != null && b.pct > 0 && b.pct <= 100) {
    amount = b.pct >= 100 ? cash : Math.floor(cash * (b.pct === 33 ? 100 / 3 : b.pct) + 1e-6) / 100;
    if (b.pct < 100) head += ` — ${shareWords(b.pct)} of it is ${cents(amount)}`;
    if (min > 0 && amount < min) {
      if (cash >= min) return `${head}, under fomo's ${money(min)} minimum buy. Try "buy ${money(min)} ${where}".`;
      return `${head}, under fomo's ${money(min)} minimum buy — top up first.`;
    }
  } else {
    if (min > 0 && cash < min) return `${head}, under fomo's ${money(min)} minimum buy — top up first.`;
    amount = Math.max(min, Math.min(10, Math.floor(cash)));
  }
  return `${head}. Try "buy ${money(amount)} ${where}".`;
}

/**
 * A question made exact from your plan and the price — still a question, never a card:
 * which take-profit "cancel the sell at 2x" is, how much of the bag "half of what's left"
 * or "initials at 1.5m" is, where "70% of the price now" is. null: the parser's hint will do.
 */
function askFor(a: AskFor, s: Snap, c: ChatCoin): string | null {
  if (!c.priceUSD || !(c.priceUSD > 0)) return null;
  const now = nowOf(c);
  const plan = livePlan(s.plans, c.key);
  const base = plan ? entryOf(plan) : now;
  switch (a.kind) {
    case 'remove-sell': {
      const lead = a.negated ? 'I can only place orders, not promise not to sell. ' : '';
      if (!plan) return `${lead}I'm not guarding ${sym(c)}, so there's no sell to remove.`;
      const open = [
        ...plan.tps.map((t, k) => ({ t, ok: isEditableTp(t), name: `tp${k + 1}`, label: `TP${k + 1}`, what: `sell ${trimPct(t.sellPct)} at ${short(t.trigger, base)}` })),
        ...plan.stops.map((t, k) => ({ t, ok: isEditableStop(t), name: `stop ${k + 1}`, label: `stop ${k + 1}`, what: `sell ${trimPct(t.sellPct)} if it drops to ${short(t.trigger, base)}` })),
      ].filter((o) => o.ok);
      const trigger = a.level ? toTrigger(a.level, base) : null;
      if (trigger) {
        const hit = open.find((o) => sameLevel(o.t.trigger, trigger, base));
        if (hit) return `${lead}That's ${hit.label} on ${sym(c)} (${hit.what}) — say "remove ${hit.name}" to remove it.`;
        if (plan.sl && sameLevel(plan.sl.trigger, trigger, base)) return `${lead}That's your stop loss on ${sym(c)} (${short(plan.sl.trigger, base)}) — say "remove my stop" to remove it.`;
      }
      if (!open.length) return `${lead}You have no take-profits or partial stops on ${sym(c)} to remove.`;
      const none = trigger ? `You have no sell at ${short(trigger, base)} on ${sym(c)}. ` : '';
      const list = open.slice(0, 5).map((o) => `${o.label} (${o.what})`).join(', ');
      return `${lead}${none}Yours: ${list}. Say "remove ${open[0].name}" — or the one you mean.`;
    }
    case 'part-of-rest': {
      const lv = plan ? (a.stop ? plan.stops : plan.tps).filter((t) => t.status !== 'cancelled') : [];
      const used = lv.reduce((sum, t) => sum + t.sellPct, 0);
      const room = Math.max(0, 100 - used);
      const pct = +((a.pct * room) / 100).toFixed(1);
      const where = a.stop ? `if it drops to ${typed(a.level)}` : `at ${typed(a.level)}`;
      if (!(pct > 0)) return `Your ${a.stop ? 'stops' : 'take-profits'} on ${sym(c)} already sell all of it — there's nothing left to split.`;
      const already = used > 0 ? ` (your ${a.stop ? 'stops' : 'take-profits'} sell ${trimPct(used)} already)` : '';
      return `${a.pct === 50 ? 'Half' : `${trimPct(a.pct)}`} of what's left is ${trimPct(pct)} of your ${sym(c)} bag${already} — say "${a.verb} ${trimPct(pct)} ${where}".`;
    }
    case 'initials': {
      const trigger = toTrigger(a.level, base);
      const x = trigger ? levelX(trigger, base) : NaN;
      if (!trigger || !Number.isFinite(x)) return null;
      if (!(x > 1)) return `Your initials only come back above ${plan ? 'your entry' : 'the price now'} (${short({ kind: 'x', value: 1 }, base)}) — pick a level above it, like "take initials at 2x".`;
      const pct = Math.round(100 / x);
      return `Your initials at ${short(trigger, base)} are about ${pct}% of your ${sym(c)} bag (${formatX(+x.toFixed(2))} ${plan ? 'your entry' : 'from now'}) — say "sell ${pct}% at ${typed(a.level)}".`;
    }
    case 'now-x': {
      if (!c.mc) return null;
      const mc = c.mc * a.x;
      return `${trimPct(a.x * 100)} of where ${sym(c)} is now (${nowText(c)}) is ${formatUsd(mc)} MC — ${trimPct((1 - a.x) * 100)} below. Say "sl at ${formatUsd(mc).replace(/^\$/, '').toLowerCase()}" for a stop there.`;
    }
  }
}

/** A typed price this many times away from the coin's price (either way) is surely not what was meant. */
const FAR = 50;

/** The market cap closest to the coin's that `n` reads as with a k / m / b ("0.7" → "700k"), within 5x — or null. */
function mcGuess(n: number, mc: number | null): string | null {
  if (!mc || !(n > 0)) return null;
  const best = [1e3, 1e6, 1e9].map((k) => n * k).sort((a, b) => Math.abs(Math.log(a / mc)) - Math.abs(Math.log(b / mc)))[0];
  return Math.abs(Math.log(best / mc)) <= Math.log(5) ? formatUsd(best).replace(/^\$/, '').toLowerCase() : null;
}

/**
 * "sell half at 0.7" while $HIGGS trades at $0.000719: as a price that's ~1000x
 * away ($700M MC) — surely a market cap typed without its k or m. A price that
 * far from the coin's is a question, never a level. Market caps, multiples and
 * moves are said unambiguously and pass.
 */
function farPrice(intent: Intent, level: LevelSpec, c: ChatCoin): Reply | null {
  if (level.kind !== 'price' || !c.priceUSD || !(level.value > 0)) return null;
  const r = level.value / c.priceUSD;
  if (r <= FAR && r >= 1 / FAR) return null;
  const asMc = c.mc ? ` — that's ${formatUsd((level.value / c.priceUSD) * c.mc)} MC` : '';
  const away = r > 1 ? `${Math.round(r).toLocaleString('en-US')}x the price now` : `1/${Math.round(1 / r).toLocaleString('en-US')} of the price now`;
  const guess = mcGuess(level.value, c.mc);
  const meant = guess ? ` Did you mean ${guess} mcap? Then say "${retyped(intent, guess)}".` : ' Say the level as a market cap with its k or m, like "500k", or as a multiple, like "2x".';
  const said = level.value >= 0.01 ? money(level.value) : formatUsd(level.value);
  return refuse(`${said} as a price${asMc}, ${away} (${sym(c)} is at ${nowText(c)}, ${formatUsd(c.priceUSD)}).${meant}`);
}

/** "1.5m", "700k", "2b": a market cap the way you'd type it. */
const mcTyped = (n: number) => formatUsd(n).replace(/^\$/, '').toLowerCase();
/** How far a market cap is from now, in words: "479x below", "974x above". */
const farText = (r: number) => (r > 1 ? `${Math.round(r).toLocaleString('en-US')}x above` : `${Math.round(1 / r).toLocaleString('en-US')}x below`);

/**
 * A market cap more than FAR times from the coin's is surely not what was meant:
 * "sl at 1k" or "buy at 1500" on a $719K coin (a missing k or m), "sell half at
 * 700m" (700k with the wrong letter). Asked, never placed:
 *  - below now: always — a stop or dip buy at −98% can't be the plan;
 *  - above now, a buy: always — nobody waits for a 50x breakout to buy;
 *  - above now, a sell: when the same digits one unit smaller sit within ±30% of
 *    the price now ("700m" → 700k on a $719K coin: the k/m slip). A real moon
 *    target ("sell 5% at 1b") is placed — the card says how far it is — and any
 *    level can be said as a multiple ("974x") to skip the question.
 */
function farMc(intent: Intent, level: LevelSpec, c: ChatCoin, entryMc: number | null): Reply | null {
  if (level.kind !== 'mc' || !c.mc || !(level.value > 0)) return null;
  const r = level.value / c.mc;
  if (r <= FAR && r >= 1 / FAR) return null;
  const buy = intent.type === 'limit-buy' || (intent.type === 'move' && intent.target.kind === 'buy');
  const where = `${formatUsd(level.value)} MC is ${farText(r)} where ${sym(c)} is now (${nowText(c)})`;
  if (r < 1) {
    // The k or m it's missing: "1500" → 1.5m, "1k" → 1m.
    const guess = mcGuess(level.value >= 1000 ? level.value / 1000 : level.value, c.mc);
    if (guess) return refuse(`${where} — did you mean ${guess}? Say "${retyped(intent, guess)}".`);
    return refuse(`${where} — that can't be right. Say the market cap with its k or m, like "500k", or a drop, like "-30%".`);
  }
  const smaller = level.value / 1000;
  const near = smaller / c.mc;
  const slip = near >= 1 / 1.3 && near <= 1.3;
  if (!buy && !slip) return null;
  const meant = near >= 1 / 5 && near <= 5 ? ` Did you mean ${mcTyped(smaller)}? Say "${retyped(intent, mcTyped(smaller))}".` : ' Pick a level nearer the price, like "1m" or "+20%".';
  if (buy) return refuse(`${where} — a breakout buy that far up can't be right.${meant}`);
  // (On a running plan a multiple is of your entry — the one to say is measured from there.)
  const x = Math.round(level.value / (entryMc ?? c.mc));
  return refuse(`${where}.${meant} If you really mean ${formatUsd(level.value)}, say it as a multiple: "${retyped(intent, `${x}x`)}".`);
}

/** The coin an intent is about; null when it isn't about one coin. */
function coinSpecOf(intent: Intent): CoinSpec | null {
  switch (intent.type) {
    case 'help':
    case 'unknown':
    case 'setting':
      return null;
    case 'show':
    case 'cancel-buy':
    case 'pause':
      return 'all' in intent.coin ? null : intent.coin;
    default:
      return intent.coin;
  }
}

/** Status and "pause" without a coin on screen mean every coin; other intents need one. */
const FALLS_BACK_TO_ALL: Intent['type'][] = ['show', 'pause'];

function build(intent: Intent, s: Snap): Step {
  const c = s.coin;
  switch (intent.type) {
    case 'help':
      return answer(HELP);
    case 'unknown': {
      // A buy with no dollar amount: your cash and an amount that fits it.
      const buy = intent.buy ? buyAsk(intent.buy, s) : null;
      if (buy) return refuse(buy);
      const exact = intent.ask && c ? askFor(intent.ask, s, c) : null;
      if (exact) return refuse(exact);
      // The parser's hint usually says what to try; otherwise point at the examples.
      const hint = /\b(try|say|help)\b/i.test(intent.hint) ? intent.hint : `${intent.hint} Say "help" for examples.`;
      if (intent.askCash && s.cash != null) return refuse(`${hint} You have ${cents(s.cash)} cash on fomo.`);
      return refuse(hint);
    }
    case 'setting':
      return setting(intent, s);
    case 'show':
      return answer(c ? coinStatus(c, s) : allStatus(s));
    case 'pause':
      return pause(intent, s, c);
    case 'cancel-buy':
      if (!c && !('all' in intent.coin)) return refuse(WHICH_COIN);
      return cancelBuys(s, c);
  }
  if (!c) return refuse(WHICH_COIN);
  if ('level' in intent) {
    const far = farPrice(intent, intent.level, c) ?? farMc(intent, intent.level, c, livePlan(s.plans, c.key)?.entry.mc ?? null);
    if (far) return far;
  }
  switch (intent.type) {
    case 'add-tp':
      return addTp(intent, s, c);
    case 'add-stop':
      return addStop(intent, s, c);
    case 'set-sl':
      return setSl(intent, s, c);
    case 'set-trail':
      return setTrail(intent, s, c);
    case 'move':
      return move(intent, s, c);
    case 'remove-level':
      return removeLevel(intent, s, c);
    case 'limit-buy':
      return limitBuy(intent, s, c);
    case 'stop-plan':
      return stopPlan(s, c);
    case 'apply-preset':
      return applyPreset(intent, s, c);
    case 'practice':
      return practice(intent, s, c);
  }
}

/**
 * A coin you have a running plan or a live buy on, from what Tippy already knows:
 * the price its last check saw, bag unknown. The fallback when fomo can't be asked
 * (the toolbar popup), so plan / buy changes still work there.
 */
export function knownCoin(s: ChatState, match: (c: { key: string; symbol: string }) => boolean): ChatCoin | null {
  const p = s.plans.find((x) => isLive(x) && match(x));
  const o = s.buys.find((x) => isLiveBuy(x) && match(x));
  const src = p ?? o;
  if (!src) return null;
  return { key: src.key, address: src.address, networkId: src.networkId, symbol: src.symbol, name: src.name, priceUSD: p?.lastPrice ?? o?.lastPrice ?? null, mc: p?.lastMc ?? o?.lastMc ?? null, balance: null };
}

async function resolve(spec: CoinSpec, intent: Intent, ctx: ChatCtx): Promise<ChatCoin | null | string> {
  if ('here' in spec) {
    if (ctx.coin) return ctx.coin;
    return FALLS_BACK_TO_ALL.includes(intent.type) ? null : WHICH_COIN;
  }
  const name = spec.symbol.replace(/^\$/, '').trim();
  if (!name) return WHICH_COIN;
  if (ctx.coin && eqSym(ctx.coin.symbol, name)) return ctx.coin;
  const found = await ctx.resolveCoin(name).catch(() => null);
  return found ?? knownCoin(ctx, (c) => eqSym(c.symbol, name)) ?? `I can only find coins you hold, have orders on, or have open on fomo — open $${name.toUpperCase()} on fomo first.`;
}

function snap(state: ChatState, ctx: ChatCtx, coin: ChatCoin | null): Snap {
  return {
    // Plans saved before partial stops existed have no `stops` list.
    plans: state.plans.map(normalizePlan),
    buys: state.buys,
    settings: state.settings,
    coin,
    minBuyUsd: (n) => ctx.minBuyUsd(n),
    minSellUsd: (n) => ctx.minSellUsd(n),
    cash: ctx.cash ?? null,
  };
}

/** Confirmed: rebuild the step from fresh data and send it only if it's still exactly the card's change. */
async function runStep(intent: Intent, step: Act, coin: ChatCoin | null, ctx: ChatCtx): Promise<{ ok: true; say?: string } | { ok: false; error: string }> {
  let fresh = coin;
  if (coin && step.fresh) {
    const f = await ctx.fetchCoin(coin.key).catch(() => null);
    if (!f || !(f.priceUSD != null && f.priceUSD > 0)) return { ok: false, error: `I couldn't get a fresh price for ${sym(coin)} — nothing was sent. Try again in a moment.` };
    fresh = { ...coin, priceUSD: f.priceUSD, mc: f.mc ?? coin.mc, balance: f.balance ?? coin.balance };
  }
  const again = build(step.pinned ?? intent, snap(ctx.latest?.() ?? ctx, ctx, fresh));
  if (!isAct(again)) return { ok: false, error: `${again.say} Nothing was sent.` };
  if (again.sig !== step.sig) return { ok: false, error: `Things changed${coin ? ` on ${sym(coin)}` : ''} since I asked — nothing was sent. Ask me again and I'll show you the new numbers.` };
  const res = await again.send(ctx.api);
  return res.ok ? { ok: true, say: again.done(res) } : { ok: false, error: res.error };
}

/**
 * What Tippy would do for one message, as a reply or a confirm card. Only reads:
 * nothing is sent until the card's `confirm.run()` — and that runs at most once.
 */
export async function planIntent(intent: Intent, ctx: ChatCtx): Promise<ChatPlan> {
  try {
    const spec = coinSpecOf(intent);
    // A question still knows the coin on screen (its chain's minimum buy, for an example amount).
    let coin: ChatCoin | null = intent.type === 'unknown' ? ctx.coin : null;
    if (spec) {
      const r = await resolve(spec, intent, ctx);
      if (typeof r === 'string') return { say: r, warn: true };
      coin = r;
    }
    const step = build(intent, snap(ctx, ctx, coin));
    if (!isAct(step)) return step.warn ? { say: step.say, warn: true } : { say: step.say };
    let started = false;
    return {
      say: step.say,
      confirm: {
        label: step.label,
        run: async () => {
          if (started) return { ok: false, error: 'I already did that one — ask me again if you want it twice.' };
          started = true;
          try {
            return await runStep(intent, step, coin, ctx);
          } catch {
            return { ok: false, error: 'Something went wrong on my side — check my window before trying again.' };
          }
        },
      },
    };
  } catch {
    return { say: 'Sorry, something went wrong on my side — try again?', warn: true };
  }
}
