import type { PlanEdit } from '../engine/orders';
import type { BuyAction, BuyInput, BuyOrder, LevelRef, Plan, PlanInput, QueuedAction, SellAction, Trigger } from '../engine/types';
import type { Notice } from './notices';
import type { Settings } from './settings';

/** What Tippy is doing right now — drives the mascot's mood everywhere. */
export type Health =
  | 'idle' // nothing to guard
  | 'watching' // all good
  | 'paused' // user paused everything
  | 'no-desk' // no fomo tab and no consent to open one
  | 'blind' // fomo tab not answering (frozen/asleep)
  | 'logged-out' // fomo session expired
  | 'ui-changed' // fomo changed its sell panel — orders paused
  | 'killed'; // remote kill switch

export interface Status {
  health: Health;
  message: string;
  lastTickAt: number;
  lastQuoteAt: number;
  blindSince: number | null;
  deskTabId: number | null;
  userId: string | null;
  handle: string | null;
  /** fomo's trade minimums (USD) from /config, keyed by networkId plus "default". */
  minSellUsd: Record<string, number>;
  minBuyUsd: Record<string, number>;
  /** The one trade running right now (sells and buys share one queue). */
  executing:
    | { kind?: 'sell'; planId: string; level: LevelRef; symbol: string; startedAt: number }
    | { kind: 'buy'; orderId: string; symbol: string; startedAt: number }
    | { kind: 'practice'; side: 'sell' | 'buy'; symbol: string; startedAt: number }
    | null;
  banner: string | null;
}

export const DEFAULT_STATUS: Status = {
  health: 'idle',
  message: '',
  lastTickAt: 0,
  lastQuoteAt: 0,
  blindSince: null,
  deskTabId: null,
  userId: null,
  handle: null,
  minSellUsd: {},
  minBuyUsd: {},
  executing: null,
  banner: null,
};

export interface TokenQuote {
  key: string;
  priceUSD: number;
  mc: number | null;
  /** Pool liquidity in USD (fomo's filterTokens), used to estimate price impact. */
  liquidity?: number | null;
  symbol: string;
  name: string;
}

export interface Holding {
  key: string;
  amount: number;
  priceUSD: number | null;
  mc: number | null;
  symbol: string;
  name: string;
}

export type SessionState = { ok: true; expInSec: number } | { ok: false; reason: 'no-token' | 'expired' | 'malformed' };

// ---- background → content (desk / exec tab) ----
export type RelayRequest =
  | { type: 'PING' }
  | { type: 'QUOTES'; keys: string[] }
  | { type: 'BALANCES' }
  | { type: 'ME' }
  | { type: 'CONFIG' }
  | { type: 'HEALTH' }
  | { type: 'EXECUTE'; action: SellAction; symbol: string; options: ExecOptions }
  /** Limit buy (or a practice buy): drive fomo's Buy panel for `action.usd` of cash. */
  | { type: 'EXECUTE_BUY'; action: BuyAction; symbol: string; options: ExecOptions };

export interface ExecOptions {
  dryRun: boolean;
  acceptRiskWarnings: boolean;
  maxImpactPct: number;
  /** Refuse when fomo mentions price impact but Tippy can't read the number (take-profits). */
  failClosedOnUnknownImpact: boolean;
  /** Background estimate from pool liquidity (% impact), independent of the page. */
  estimatedImpactPct?: number | null;
  /** fomo's symbol for the coin; take-profits only press a button labelled exactly "Sell <symbol>". */
  symbol?: string;
  /** True once the tab has been brought to the front (second attempt). */
  focused: boolean;
  /** A practice run from the window: always a dry run, never tied to a plan or order. */
  practice?: boolean;
}

export type RelayResponse<T = unknown> =
  | { ok: true; data: T; session: SessionState }
  /** authFailed: fomo's API itself said 401/403 — the only proof of "logged out". */
  | { ok: false; error: string; session?: SessionState; authFailed?: boolean };

export type ExecStage =
  | 'submitted' // confirm clicked and the panel reset
  | 'clicked' // confirm clicked, no visual confirmation
  | 'dry-run' // stopped right before confirm
  | 'logged-out'
  | 'no-panel'
  /** fomo's own UI says there's nothing (or not enough) to sell — the background re-checks the balance. */
  | 'insufficient-ui'
  /** The last-moment guard stopped it (paused, kill switch, plan stopped, wrong page) — nothing pressed. */
  | 'aborted'
  | 'below-minimum'
  | 'impact-too-high'
  | 'stalled' // something didn't react while the tab was in the background
  | 'busy'
  | 'error';

export interface ExecResult {
  stage: ExecStage;
  clicked: boolean;
  detail: string;
  /** Step name when stalled, for focus escalation. */
  step?: string;
  /** fomo showed its "Sold …" strip. */
  sold?: boolean;
  /** fomo showed its "Bought …" strip (buys). */
  bought?: boolean;
  impactPct?: number | null;
}

// ---- UI (popup / options / card) → background ----
export type Command =
  | { type: 'ARM'; input: Omit<PlanInput, 'id' | 'now'> }
  | { type: 'PAUSE_PLAN'; planId: string }
  | { type: 'RESUME_PLAN'; planId: string }
  | { type: 'CANCEL_PLAN'; planId: string }
  | { type: 'RESOLVE_HELD'; planId: string; level: LevelRef; sell: boolean }
  | { type: 'RETRY_LEVEL'; planId: string; level: LevelRef }
  /** ✎ Edit on a running plan: change it in place (see editPlan). */
  | { type: 'UPDATE_PLAN'; planId: string; edit: PlanEdit }
  | { type: 'ARM_BUY'; input: Omit<BuyInput, 'id' | 'now'> }
  | { type: 'CANCEL_BUY'; orderId: string }
  /** After an 'unknown' buy: the user checked fomo — it bought, or it didn't (watch again). */
  | { type: 'RESOLVE_BUY'; orderId: string; bought: boolean }
  /** Move a watching limit buy to a new level (dragged on the chart). `now` = the coin's price / market cap now. */
  | { type: 'MOVE_BUY'; orderId: string; trigger: Trigger; now: { priceUSD: number; mc: number | null } }
  /** Walk through a real sell / buy on fomo and stop before the final press. */
  | { type: 'PRACTICE'; key: string; side: 'sell' | 'buy'; usd?: number }
  | { type: 'SET_SETTINGS'; patch: Partial<Settings> }
  | { type: 'PAUSE_ALL'; paused: boolean }
  | { type: 'OPEN_DESK' }
  | { type: 'TEST_ALERT' }
  | { type: 'OPEN_OPTIONS'; section?: string }
  | { type: 'HELLO'; url: string };

export type CommandResult =
  | { ok: true; plan?: Plan; buy?: BuyOrder; practice?: PracticeResult }
  /** stale: the plan changed under the user (reload the draft). */
  | { ok: false; error: string; stale?: boolean };

export interface PracticeResult {
  key: string;
  symbol: string;
  side: 'sell' | 'buy';
  at: number;
  /** true = Tippy got all the way to the final button and stopped. */
  ok: boolean;
  stage: ExecStage | 'skipped';
  detail: string;
  impactPct?: number | null;
}

export interface StorageShape {
  plans: Record<string, Plan>;
  settings: Settings;
  status: Status;
  /** One trade at a time: stops, then take-profits, then buys. */
  queue: QueuedAction[];
  buys: Record<string, BuyOrder>;
  /** The last practice run, so the window can show how it went. */
  practice: PracticeResult | null;
  /** Auto-guard baseline: last seen balance per token key. */
  baseline: Record<string, number> | null;
  /** "Tippy filled order" pop-ups for fomo's page, newest last. */
  notices: Notice[];
}
