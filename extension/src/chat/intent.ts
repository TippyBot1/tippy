// "hey tippy add a tp at 500k mcap on CLAUDIA" → a structured intent.
//
// Built-in and local (no AI, nothing leaves the computer): parse.ts turns a
// message into one of these; run.ts works out exactly what it would change and
// Tippy shows that as a confirm card. Nothing happens until the user taps it.

import type { Trigger } from '../engine/types';

/** A level as typed: market cap ("500k mcap", "$1m"), a price ("$0.004"), a multiple ("2x"), or a move ("-20%", "dips 20%"). */
export type LevelSpec =
  | { kind: 'mc'; value: number }
  | { kind: 'price'; value: number }
  | { kind: 'x'; value: number }
  /** −20 = 20% below the price now, +15 = 15% above. */
  | { kind: 'pct'; value: number };

/** Which coin: a symbol the user typed ("CLAUDIA", "$wif"), or the coin on screen. */
export type CoinSpec = { symbol: string } | { here: true };

export type Intent =
  /**
   * "add a tp at 500k mcap" · "tp 2x sell half" · "sell 25% at 1m mc" · "sell $20 at 1m".
   * `anySide`: said as "sell … at <market cap / price>" with no "tp" and no
   * direction — a level below the price now is then a stop ("sell 10% at 700k"
   * while it's at $719K), worked out against the live price.
   * `sellUsd`: the size was said in dollars — run.ts turns it into a % of the bag
   * at the level's price (sellPct is then null).
   */
  | { type: 'add-tp'; coin: CoinSpec; level: LevelSpec; sellPct: number | null; sellUsd?: number; anySide?: true }
  /**
   * A partial stop: "sell 10% if it drops to 700k" · "stop 10% at 700k" · "sl $2 at 650k".
   * Sized by `sellPct`, or by `sellUsd` at the level's price (sellPct is then null).
   */
  | { type: 'add-stop'; coin: CoinSpec; level: LevelSpec; sellPct: number | null; sellUsd?: number }
  /** "sl at 300k" · "stop loss -30%" · "set my stop to 0.001" — sells the rest */
  | { type: 'set-sl'; coin: CoinSpec; level: LevelSpec }
  /** "trail 20%" · "trailing stop 25% after 2x" */
  | { type: 'set-trail'; coin: CoinSpec; trailPct: number; afterX: number | null }
  /** "move tp1 to 2m" · "move stop 1 to 650k" · "move my stop to 250k" · "move my buy to 400k" */
  | { type: 'move'; coin: CoinSpec; target: { kind: 'tp'; index: number } | { kind: 'stop'; index: number } | { kind: 'sl' } | { kind: 'buy' }; level: LevelSpec }
  /** "remove tp2" · "remove stop 1" · "remove my stop" · "turn off the trailing stop" */
  | { type: 'remove-level'; coin: CoinSpec; target: { kind: 'tp'; index: number } | { kind: 'stop'; index: number } | { kind: 'sl' } | { kind: 'trail' } }
  /**
   * "buy $10 at 1m mcap" · "buy 25 of CLAUDIA if it dips 20% then protect with classic for 24h".
   * `said`: "if it dips to 500k" / "when it breaks 1m" — the side the user expects the level on;
   * run.ts refuses rather than turn a dip buy into a breakout buy (or back).
   */
  | { type: 'limit-buy'; coin: CoinSpec; usd: number; level: LevelSpec; preset: string | null | 'none'; expiresInMs: number | null | 'default'; said?: 'dip' | 'breakout' }
  /** "cancel my buy on CLAUDIA" · "cancel all buys" */
  | { type: 'cancel-buy'; coin: CoinSpec | { all: true } }
  /** "stop guarding CLAUDIA" · "cancel my plan" */
  | { type: 'stop-plan'; coin: CoinSpec }
  /** "pause CLAUDIA" · "pause everything" · "resume" */
  | { type: 'pause'; coin: CoinSpec | { all: true }; paused: boolean }
  /** "guard CLAUDIA with classic" · "use P1 on wif" */
  | { type: 'apply-preset'; coin: CoinSpec; preset: string }
  /** "what are my orders" · "show CLAUDIA" · "status" */
  | { type: 'show'; coin: CoinSpec | { all: true } }
  /** "practice a buy" · "test a sell on SOL" */
  | { type: 'practice'; coin: CoinSpec; side: 'sell' | 'buy'; usd: number | null }
  /** "dry run on" · "use market cap" · "auto guard off" */
  | { type: 'setting'; name: 'dryRun' | 'autoGuard' | 'chartLines' | 'levelUnit'; value: boolean | 'mc' | 'move' }
  | { type: 'help' }
  /**
   * Couldn't work it out: `hint` says what was missing ("Which level? Try 'at 500k mcap'").
   * `cashPct`: "buy 20% …" — Tippy buys in dollars, so it asks, and shows what that % of your cash is.
   */
  | { type: 'unknown'; hint: string; cashPct?: number };

/** What Tippy would do, as a confirm card. `run` is only called when the user taps the button. */
export interface ChatPlan {
  /** Tippy's reply, e.g. "Add a take-profit on $CLAUDIA: sell 50% at $500K MC." */
  say: string;
  /** Present → a confirm button ("Add it", "Place buy", "Cancel it"…). Absent → just an answer. */
  confirm?: { label: string; run: () => Promise<{ ok: true; say?: string } | { ok: false; error: string }> };
  /** Amber reply (couldn't do it / needs more info). */
  warn?: boolean;
}

/** Converts a typed level to the engine's trigger, measured from `ref` (price / market cap now, or a plan's entry). */
export type LevelToTrigger = (level: LevelSpec, ref: { priceUSD: number; mc: number | null }) => Trigger | null;
