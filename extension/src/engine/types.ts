// Core data model for Tippy's order engine. Everything here is plain JSON so it
// can live in chrome.storage.local and be rendered by the UI without mapping.

/** x = multiple of entry price (2 = 2x, 0.7 = −30%), mc = market cap USD, price = USD per token. */
export type TriggerKind = 'x' | 'mc' | 'price';

export interface Trigger {
  kind: TriggerKind;
  value: number;
}

export type LevelStatus =
  | 'waiting' // armed, watching the price
  | 'queued' // trigger hit, waiting its turn in the execution queue
  | 'held' // trigger hit after a sleep gap and the user asked to confirm first
  | 'executing' // the executor is driving fomo's sell panel right now
  | 'unknown' // we clicked but the balance has not moved yet — never re-click blindly
  | 'filled' // sold by Tippy
  | 'done-elsewhere' // the bag was already at/below this level's target (sold on phone, other device…)
  | 'merged' // folded into another level (gap past several levels, or too small for fomo's minimum)
  | 'blocked' // a take-profit / partial stop Tippy gave up on (may have sold, or keeps failing) — waits for the user's Retry
  | 'cancelled'; // plan ended (stop loss fired, user cancelled…)

interface LevelBase {
  status: LevelStatus;
  executingAt: number | null;
  /** When Tippy (may have) pressed fomo's confirm for this level. */
  clickedAt: number | null;
  attempts: number;
  /** Cool-down after a failed attempt so a stuck sell doesn't hammer fomo. */
  retryAfter: number | null;
  /**
   * 'filled' in a dry run — nothing was really sold. Turning dry run off puts
   * these back to watching, so going live starts from the real bag.
   */
  dryRun?: boolean;
}

export interface TakeProfit extends LevelBase {
  id: string;
  trigger: Trigger;
  /** % of the original bag this level sells. */
  sellPct: number;
  /** Token units that should remain after this level has sold (declarative target). */
  targetRemaining: number;
  /** When merged into another level's sell (a price jump), that level's id — restored if that sell is withdrawn. */
  mergedInto: string | null;
}

/**
 * A partial stop: "sell 10% if it drops to $700K MC". Sized like a take-profit
 * (a declarative target, a slice of the original bag), but it fires on the way
 * down, after a few ticks at or below its level. The stop loss below is
 * different: it always sells the rest.
 */
export interface StopLevel extends LevelBase {
  /** 'st1', 'st2', … */
  id: string;
  trigger: Trigger;
  /** % of the original bag this stop sells. */
  sellPct: number;
  /** Token units that should remain after this stop has sold (declarative target). */
  targetRemaining: number;
  /** When merged into another stop's sell (a fast drop), that stop's id — restored if that sell is withdrawn. */
  mergedInto: string | null;
  /** Consecutive ticks at/below the level before selling (wick protection). */
  confirmTicks: number;
  ticksBelow: number;
}

export interface StopLoss extends LevelBase {
  trigger: Trigger;
  /** Consecutive ticks below the level before firing (wick protection). */
  confirmTicks: number;
  ticksBelow: number;
}

export interface Trailing extends LevelBase {
  /** Sell the rest if price falls this % from the highest price seen. */
  trailPct: number;
  /** Only start trailing once price reaches entry × activateX (null = immediately). */
  activateX: number | null;
  peakPrice: number | null;
  active: boolean;
  confirmTicks: number;
  ticksBelow: number;
}

/** "Needs attention" is a notice (Plan.attention), not a state — stops keep working. */
export type PlanState = 'armed' | 'paused' | 'done' | 'cancelled';

export interface Entry {
  priceUSD: number;
  mc: number | null;
  source: 'fill' | 'trades' | 'armed-at' | 'manual';
}

export interface PlanEvent {
  at: number;
  kind:
    | 'armed'
    | 'queued'
    | 'held'
    | 'filled'
    | 'unknown'
    | 'failed'
    | 'retry'
    | 'done-elsewhere'
    | 'merged'
    | 'sold-elsewhere'
    | 'too-small'
    | 'rescaled'
    | 'edited'
    | 'trailing-on'
    | 'gap'
    | 'paused'
    | 'resumed'
    | 'cancelled'
    | 'done'
    | 'attention';
  text: string;
}

export interface Plan {
  id: string;
  /** fomo token id "<address>:<networkId>" (EVM addresses lowercased). */
  key: string;
  networkId: number;
  address: string;
  symbol: string;
  name: string;
  entry: Entry;
  /** Bag size the percentages refer to. */
  origBalance: number;
  tps: TakeProfit[];
  /**
   * Partial stops, highest first. Plans saved before partial stops existed have
   * no `stops` field — the engine treats a missing list as [].
   */
  stops: StopLevel[];
  sl: StopLoss | null;
  trailing: Trailing | null;
  state: PlanState;
  attention: string | null;
  origin: 'manual' | 'auto-guard';
  createdAt: number;
  updatedAt: number;
  gapAt: number | null;
  lastPrice: number | null;
  lastMc: number | null;
  history: PlanEvent[];
}

export interface Quote {
  priceUSD: number;
  mc: number | null;
  at: number;
}

export interface EvalContext {
  now: number;
  /** True on the first tick after Tippy was asleep/blind for a while. */
  gap: boolean;
  /** What to do when a stop fires right after a gap. */
  gapPolicy: 'sell' | 'ask';
  /** fomo's minimum trade size for this chain, USD. */
  minSellUsd: number;
  /** Remainders worth less than this are dust and get swept. */
  dustUsd: number;
}

export type LevelRef = { kind: 'tp'; id: string } | { kind: 'stop'; id: string } | { kind: 'sl' } | { kind: 'trail' };

export interface SellAction {
  type: 'sell';
  planId: string;
  key: string;
  level: LevelRef;
  /** Balance that should remain after the sell (0 = sell everything). */
  targetRemaining: number;
  /** Token units to sell, or null when the balance is unknown (only for sell-all). */
  sellAmount: number | null;
  sellUsd: number | null;
  /** 0–100 of the current balance; 100 means "Max". */
  sellPctOfCurrent: number;
  reason: string;
  gapFill: boolean;
  /**
   * Lower runs first: stop loss / trailing stop 0, partial stops 0.5,
   * take-profits 1 — the stop that sells the rest beats everything.
   */
  priority: number;
  /** When the trigger fired; stale stops are re-checked before selling. */
  queuedAt: number;
  /** The user explicitly said "sell now" (e.g. after a sleep gap). */
  consented?: boolean;
}

export interface AskAction {
  type: 'ask';
  planId: string;
  key: string;
  level: LevelRef;
  text: string;
}

export type Action = SellAction | AskAction;

export interface PlanInput {
  id: string;
  key: string;
  networkId: number;
  address: string;
  symbol: string;
  name: string;
  entry: Entry;
  balance: number;
  tps: { trigger: Trigger; sellPct: number }[];
  /** Partial stops: sell `sellPct`% of the bag if it drops to `trigger`. */
  stops?: { trigger: Trigger; sellPct: number }[];
  sl: { trigger: Trigger; confirmTicks?: number } | null;
  trailing: { trailPct: number; activateX?: number | null; confirmTicks?: number } | null;
  origin: 'manual' | 'auto-guard';
  now: number;
}

// ---------------------------------------------------------------------------
// Limit buys: "buy $10 of this coin when it dips to $1M MC" (or breaks out to a
// level). One-shot: once Tippy may have pressed Buy, it never presses again for
// that order without the user saying so.

export type BuyState =
  | 'armed' // watching the price
  | 'queued' // level hit, waiting its turn (sells go first)
  | 'executing' // driving fomo's Buy panel right now
  | 'unknown' // Tippy pressed Buy but the coins haven't shown up — never pressed again without the user
  | 'filled' // bought (confirmed by your balance), or simulated in a dry run
  | 'failed' // gave up — needs the user
  | 'cancelled'
  | 'expired';

export interface BuyEvent {
  at: number;
  kind: 'armed' | 'hit' | 'executing' | 'filled' | 'unknown' | 'failed' | 'retry' | 'stale' | 'too-far' | 'no-cash' | 'cancelled' | 'expired' | 'protected';
  text: string;
}

export interface BuyOrder {
  id: string;
  key: string;
  networkId: number;
  address: string;
  symbol: string;
  name: string;
  /** The level. 'x' is relative to `ref` (0.8 = 20% below where it was when placed). */
  trigger: Trigger;
  /** 'down' buys the dip when the price falls to the level; 'up' buys a breakout when it rises to it. */
  direction: 'down' | 'up';
  /** Price / market cap when the order was placed. */
  ref: Entry;
  /** Cash (USD) to spend. */
  usd: number;
  state: BuyState;
  /** Preset to protect the new coins with once bought (null = don't). */
  guardPresetId: string | null;
  expiresAt: number | null;
  createdAt: number;
  updatedAt: number;
  /** Consecutive ticks at the level (wick protection). */
  ticksAt: number;
  attempts: number;
  retryAfter: number | null;
  queuedAt: number | null;
  executingAt: number | null;
  /** Token balance right before Tippy pressed Buy, and the coins it expected — used to confirm the fill. */
  balanceBefore: number | null;
  expectedAmount: number | null;
  /**
   * An earlier press the user said "didn't buy". fomo's balances can lag for
   * minutes, so if those coins show up after all, the order counts as filled and
   * Tippy doesn't buy a second time.
   */
  priorPress?: { balanceBefore: number; expectedAmount: number; at: number } | null;
  /** When the last tick at the level was (wick protection only counts consecutive ticks). */
  lastAtTick?: number | null;
  filledAt: number | null;
  /** Coins received (balance increase), when known. */
  got: number | null;
  fillPrice: number | null;
  /** The take-profit / stop-loss plan armed on the new coins. */
  planId: string | null;
  /** Filled in a dry run — nothing was really bought. */
  dryRun: boolean;
  lastPrice: number | null;
  lastMc: number | null;
  attention: string | null;
  history: BuyEvent[];
}

export interface BuyAction {
  type: 'buy';
  orderId: string;
  key: string;
  usd: number;
  /** Lower runs first. Buys go after every sell (stops 0, partial stops 0.5, take-profits 1). */
  priority: number;
  queuedAt: number;
  reason: string;
}

export interface BuyInput {
  id: string;
  key: string;
  networkId: number;
  address: string;
  symbol: string;
  name: string;
  trigger: Trigger;
  /** The coin's price / market cap right now. */
  ref: Entry;
  usd: number;
  guardPresetId: string | null;
  /** null = never expires. */
  expiresInMs: number | null;
  now: number;
}

/** Everything that can wait in Tippy's one-at-a-time trade queue. */
export type QueuedAction = SellAction | BuyAction;
