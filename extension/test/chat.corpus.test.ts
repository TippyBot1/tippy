// The chat corpus: 1094 messages the way traders actually type them, and what
// Tippy must make of each. Table-driven over the real parser and planIntent()
// with $HIGGS at $719K MC ($0.000719) and a $4.98 bag (6,926.3 tokens), no plan
// yet — so "2x" and "+50%" are measured from the price now.
//
// Every message is read by parse(), normalised to what Tippy understood (sell
// above / sell below / the stop loss / a limit buy … with its level, amount and
// coin) and compared with the corpus. Then the card is planned: a sell or a buy
// must come back as a confirm card that sends exactly that order when tapped,
// unless the note says Tippy refuses (under fomo's minimum, more than the bag).
// 'ask' messages must get a question back — and never a confirm button.
//
// A coin named in the message ("on CLAUDIA", "$wif") is found at the same price,
// so its direction is judged the same way. Moves, removes and cancels run
// against a second setup where every coin already has a plan and a limit buy.
import { describe, expect, it } from 'vitest';
import type { ChatPlan, Intent, LevelSpec } from '../src/chat/intent';
import { parse } from '../src/chat/parse';
import { type ChatApi, type ChatCoin, type ChatCtx, DEFAULT_BUY_EXPIRY_MS, planIntent } from '../src/chat/run';
import { buildBuy } from '../src/engine/buys';
import { buildPlan, type PlanEdit } from '../src/engine/orders';
import type { BuyInput, BuyOrder, Plan, PlanInput, Trigger } from '../src/engine/types';
import type { CommandResult } from '../src/shared/messages';
import { withDefaults } from '../src/shared/settings';

type Want = 'sell-above' | 'sell-below' | 'stop-loss-rest' | 'trail' | 'limit-buy' | 'move' | 'remove' | 'cancel-buy' | 'show' | 'pause' | 'practice' | 'setting' | 'ask';

interface Case {
  t: string;
  want: Want;
  /** "mc 700000", "price 0.0007", "x 2", "pct -20". */
  level?: string;
  /** "pct 50" (of the bag) or "usd 20"; for a trail, how far below the top ("pct 25"). */
  amount?: string;
  /** A coin named in the message; none = the coin on screen. */
  coin?: string;
  /** Which order a move / remove is about: tp1, stop2, sl, trail, buy. */
  target?: string;
  note?: string;
  /** What the reply must say (every context it's planned in): a question that names the real problem, with an example to copy. */
  say?: RegExp;
  /** What it must never say: a made-up level ("at 2x"), an absurd reading ("900x"), a $ amount called a level… */
  notSay?: RegExp;
}

// prettier-ignore
const CORPUS: Case[] = [
  // ---- sell-above
  { t: 'sell half at 1m mc', want: 'sell-above', level: 'mc 1000000', amount: 'pct 50' },
  { t: 'tp 50 @ 1.2m', want: 'sell-above', level: 'mc 1200000', amount: 'pct 50', note: 'bare number after tp/stop with its own level = % of bag (trader shorthand); after plain "sell" it is ambiguous' },
  { t: 'dump a quarter if it hits 2x', want: 'sell-above', level: 'x 2', amount: 'pct 25' },
  { t: 'take 25% off at $2m', want: 'sell-above', level: 'mc 2000000', amount: 'pct 25' },
  { t: 'sell 20% at 1.5m mcap', want: 'sell-above', level: 'mc 1500000', amount: 'pct 20' },
  { t: 'sell 40% @ 900k', want: 'sell-above', level: 'mc 900000', amount: 'pct 40' },
  { t: 'sell a third at 3x', want: 'sell-above', level: 'x 3', amount: 'pct 33' },
  { t: 'sell 75% at 5m', want: 'sell-above', level: 'mc 5000000', amount: 'pct 75' },
  { t: 'sell 40% when it hits 1.1m market cap', want: 'sell-above', level: 'mc 1100000', amount: 'pct 40' },
  { t: 'sell 25% once it reaches 2 mil', want: 'sell-above', level: 'mc 2000000', amount: 'pct 25' },
  { t: 'sell 60% above 1.8m', want: 'sell-above', level: 'mc 1800000', amount: 'pct 60' },
  { t: 'sell half over 1m', want: 'sell-above', level: 'mc 1000000', amount: 'pct 50' },
  { t: 'sell 15 percent at 2.5m mcap', want: 'sell-above', level: 'mc 2500000', amount: 'pct 15' },
  { t: 'sell ten percent at 5x', want: 'sell-above', level: 'x 5', amount: 'pct 10' },
  { t: 'sell half at 0.001', want: 'sell-above', level: 'price 0.001', amount: 'pct 50', note: '$0.001 = $1M MC' },
  { t: 'sell 50% at 0.0009', want: 'sell-above', level: 'price 0.0009', amount: 'pct 50', note: 'a tiny decimal is a price: $0.0009 = $900K MC, above the price now' },
  { t: 'sell 25% at $0.0012', want: 'sell-above', level: 'price 0.0012', amount: 'pct 25' },
  { t: 'sell 50% at .0015', want: 'sell-above', level: 'price 0.0015', amount: 'pct 50' },
  { t: 'sell 33% at 1,000,000', want: 'sell-above', level: 'mc 1000000', amount: 'pct 33' },
  { t: 'sell 40% at 1000000 mc', want: 'sell-above', level: 'mc 1000000', amount: 'pct 40' },
  { t: 'sell 50% at 1.2M MC', want: 'sell-above', level: 'mc 1200000', amount: 'pct 50' },
  { t: 'SELL 50% AT 1M MCAP', want: 'sell-above', level: 'mc 1000000', amount: 'pct 50' },
  { t: 'sell 50% at 1m fdv', want: 'sell-above', level: 'mc 1000000', amount: 'pct 50' },
  { t: 'sell 50% at 1m cap', want: 'sell-above', level: 'mc 1000000', amount: 'pct 50' },
  { t: 'sell 50% at 1m market cap', want: 'sell-above', level: 'mc 1000000', amount: 'pct 50' },
  { t: 'sell 50% at 1m mkt cap', want: 'sell-above', level: 'mc 1000000', amount: 'pct 50' },
  { t: 'sell 50% at 0.9m', want: 'sell-above', level: 'mc 900000', amount: 'pct 50' },
  { t: 'sell 50% at .9m', want: 'sell-above', level: 'mc 900000', amount: 'pct 50' },
  { t: 'sell 50% @ $900k', want: 'sell-above', level: 'mc 900000', amount: 'pct 50' },
  { t: 'sell 50% when mcap hits 1m', want: 'sell-above', level: 'mc 1000000', amount: 'pct 50' },
  { t: 'sell half when market cap reaches 1.5m', want: 'sell-above', level: 'mc 1500000', amount: 'pct 50' },
  { t: 'at 2m sell 25%', want: 'sell-above', level: 'mc 2000000', amount: 'pct 25', note: 'level before the verb' },
  { t: '1m mc sell half', want: 'sell-above', level: 'mc 1000000', amount: 'pct 50' },
  { t: '2x sell half', want: 'sell-above', level: 'x 2', amount: 'pct 50' },
  { t: 'tp 2x', want: 'sell-above', level: 'x 2' },
  { t: 'tp 3x 50%', want: 'sell-above', level: 'x 3', amount: 'pct 50' },
  { t: 'tp at 1m', want: 'sell-above', level: 'mc 1000000' },
  { t: 'take profit 50% at 1.5m', want: 'sell-above', level: 'mc 1500000', amount: 'pct 50' },
  { t: 'take profits at 2m, half', want: 'sell-above', level: 'mc 2000000', amount: 'pct 50' },
  { t: 'tp 30% @ 1m mcap', want: 'sell-above', level: 'mc 1000000', amount: 'pct 30' },
  { t: 'tp 50% @ 1.2m', want: 'sell-above', level: 'mc 1200000', amount: 'pct 50' },
  { t: 'tp half 2x', want: 'sell-above', level: 'x 2', amount: 'pct 50' },
  { t: 'set tp 40% at 1.2m', want: 'sell-above', level: 'mc 1200000', amount: 'pct 40' },
  { t: 'add a tp at 1.5m sell 30%', want: 'sell-above', level: 'mc 1500000', amount: 'pct 30' },
  { t: 'sell 20% at +50%', want: 'sell-above', level: 'pct 50', amount: 'pct 20', note: '20% ≈ $1.49 at that level — under fomo\'s $2 minimum; run.ts refuses with "try at least 27%"' },
  { t: 'sell half if it pumps 100%', want: 'sell-above', level: 'pct 100', amount: 'pct 50' },
  { t: 'sell 25% when it\'s up 50%', want: 'sell-above', level: 'pct 50', amount: 'pct 25', note: '25% ≈ $1.87 at that level — under fomo\'s $2 minimum; run.ts refuses with "try at least 27%"' },
  { t: 'sell a third at +100%', want: 'sell-above', level: 'pct 100', amount: 'pct 33' },
  { t: 'take initials at 2x', want: 'sell-above', level: 'x 2', amount: 'pct 50', note: 'initials at 2x = 50% of the bag' },
  { t: 'sell 10% at 10x', want: 'sell-above', level: 'x 10', amount: 'pct 10' },
  { t: 'sell everything at 5x', want: 'sell-above', level: 'x 5', amount: 'pct 100' },
  { t: 'sell all at 3m', want: 'sell-above', level: 'mc 3000000', amount: 'pct 100' },
  { t: 'sell the rest at 10x', want: 'sell-above', level: 'x 10', amount: 'pct 100' },
  { t: 'sell 100% at 2m', want: 'sell-above', level: 'mc 2000000', amount: 'pct 100' },
  { t: 'sell 2/3 at 4x', want: 'sell-above', level: 'x 4', amount: 'pct 67' },
  { t: 'sell 3/4 at 3m', want: 'sell-above', level: 'mc 3000000', amount: 'pct 75' },
  { t: 'sell 1/2 at 1m', want: 'sell-above', level: 'mc 1000000', amount: 'pct 50' },
  { t: 'sell one quarter at 1.6m', want: 'sell-above', level: 'mc 1600000', amount: 'pct 25' },
  { t: 'sell 25% at 1.6 million', want: 'sell-above', level: 'mc 1600000', amount: 'pct 25' },
  { t: 'sell 25% at 1.6 mil mcap', want: 'sell-above', level: 'mc 1600000', amount: 'pct 25' },
  { t: 'sell 30% at 1600k', want: 'sell-above', level: 'mc 1600000', amount: 'pct 30' },
  { t: 'sell 50% at 1.2mm', want: 'sell-above', level: 'mc 1200000', amount: 'pct 50', note: '"mm" = million' },
  { t: 'sell 5% at 1b mcap', want: 'sell-above', level: 'mc 1000000000', amount: 'pct 5' },
  { t: 'sell 10% at 1bn', want: 'sell-above', level: 'mc 1000000000', amount: 'pct 10' },
  { t: 'sell 50% at 750 thousand', want: 'sell-above', level: 'mc 750000', amount: 'pct 50' },
  { t: 'sell half at 800 k', want: 'sell-above', level: 'mc 800000', amount: 'pct 50' },
  { t: 'sell 50% at 1 M mcap', want: 'sell-above', level: 'mc 1000000', amount: 'pct 50' },
  { t: 'sell half at 1,2m', want: 'sell-above', level: 'mc 1200000', amount: 'pct 50', note: 'decimal comma' },
  { t: 'sell half at $1,000,000 market cap', want: 'sell-above', level: 'mc 1000000', amount: 'pct 50' },
  { t: 'sell 50 % at 1m', want: 'sell-above', level: 'mc 1000000', amount: 'pct 50' },
  { t: 'sell 50% @1m', want: 'sell-above', level: 'mc 1000000', amount: 'pct 50', note: 'no space after @' },
  { t: 'Sell Half At 1M!!', want: 'sell-above', level: 'mc 1000000', amount: 'pct 50' },
  { t: 'sell half at 1m 🚀🚀', want: 'sell-above', level: 'mc 1000000', amount: 'pct 50' },
  { t: 'sell half at 1m lfg', want: 'sell-above', level: 'mc 1000000', amount: 'pct 50' },
  { t: 'sell half when it gets to 1m', want: 'sell-above', level: 'mc 1000000', amount: 'pct 50' },
  { t: 'sell half if mc goes above 1m', want: 'sell-above', level: 'mc 1000000', amount: 'pct 50' },
  { t: 'sell 25% when it pumps to 2m', want: 'sell-above', level: 'mc 2000000', amount: 'pct 25' },
  { t: 'sell 10% at 2m', want: 'sell-above', level: 'mc 2000000', amount: 'pct 10', note: '10% ≈ $1.39 at that level — under fomo\'s $2 minimum; run.ts refuses with "try at least 15%"' },
  { t: 'sell half when it doubles', want: 'sell-above', level: 'x 2', amount: 'pct 50' },
  { t: 'sell 25% when it triples', want: 'sell-above', level: 'x 3', amount: 'pct 25' },
  { t: 'tp at x3', want: 'sell-above', level: 'x 3' },
  { t: 'sell 25% at 3 x', want: 'sell-above', level: 'x 3', amount: 'pct 25' },
  { t: 'tp 2.5x', want: 'sell-above', level: 'x 2.5' },
  { t: 'sell half at 1.5x', want: 'sell-above', level: 'x 1.5', amount: 'pct 50' },
  { t: 'tp 10x 10%', want: 'sell-above', level: 'x 10', amount: 'pct 10' },
  { t: 'sell 30% at +100%', want: 'sell-above', level: 'pct 100', amount: 'pct 30' },
  { t: 'tp 2x from entry', want: 'sell-above', level: 'x 2', note: 'no plan yet, so entry = the price now' },
  { t: 'exit at 2m', want: 'sell-above', level: 'mc 2000000', amount: 'pct 100', note: '"exit" = sell all' },
  { t: 'cash out half at 3x', want: 'sell-above', level: 'x 3', amount: 'pct 50', note: '"cash out" = sell' },
  { t: 'trim 25% at 2m', want: 'sell-above', level: 'mc 2000000', amount: 'pct 25', note: '"trim" = sell' },
  { t: 'scale out 25% at 1.5m', want: 'sell-above', level: 'mc 1500000', amount: 'pct 25' },
  { t: 'secure 50% at 2x', want: 'sell-above', level: 'x 2', amount: 'pct 50', note: '"secure" = sell' },
  { t: 'sell 50% at 2x on CLAUDIA', want: 'sell-above', level: 'x 2', amount: 'pct 50', coin: 'CLAUDIA', note: 'direction judged as if $CLAUDIA were at $719K MC too' },
  { t: 'CLAUDIA tp 2x', want: 'sell-above', level: 'x 2', coin: 'CLAUDIA', note: 'direction judged as if $CLAUDIA were at $719K MC too' },
  { t: 'sell 25% of $wif at 1.5m', want: 'sell-above', level: 'mc 1500000', amount: 'pct 25', coin: 'WIF', note: 'direction judged as if $WIF were at $719K MC too' },
  { t: 'sell half of my bonk at 3x', want: 'sell-above', level: 'x 3', amount: 'pct 50', coin: 'BONK', note: 'direction judged as if $BONK were at $719K MC too' },
  { t: 'tp 2x for $wif', want: 'sell-above', level: 'x 2', coin: 'WIF', note: 'direction judged as if $WIF were at $719K MC too' },
  { t: 'on CLAUDIA sell 30% at 1m', want: 'sell-above', level: 'mc 1000000', amount: 'pct 30', coin: 'CLAUDIA', note: 'direction judged as if $CLAUDIA were at $719K MC too' },
  { t: 'for wif, tp at 3x sell half', want: 'sell-above', level: 'x 3', amount: 'pct 50', coin: 'WIF', note: 'direction judged as if $WIF were at $719K MC too' },
  { t: 'popcat sell 30% @ 2m', want: 'sell-above', level: 'mc 2000000', amount: 'pct 30', coin: 'POPCAT', note: 'direction judged as if $POPCAT were at $719K MC too' },
  { t: '$BONK tp 2x', want: 'sell-above', level: 'x 2', coin: 'BONK', note: 'direction judged as if $BONK were at $719K MC too' },
  { t: 'sell 50% at 1m on claudia', want: 'sell-above', level: 'mc 1000000', amount: 'pct 50', coin: 'CLAUDIA', note: 'direction judged as if $CLAUDIA were at $719K MC too' },
  { t: 'sell half at 1m mcap on $HIGGS', want: 'sell-above', level: 'mc 1000000', amount: 'pct 50', coin: 'HIGGS' },
  { t: 'HIGGS: sell half at 1m', want: 'sell-above', level: 'mc 1000000', amount: 'pct 50', coin: 'HIGGS' },
  { t: 'for $wif sell half at 3x', want: 'sell-above', level: 'x 3', amount: 'pct 50', coin: 'WIF', note: 'direction judged as if $WIF were at $719K MC too' },
  { t: 'hey tippy can you sell half at 2x pls', want: 'sell-above', level: 'x 2', amount: 'pct 50' },
  { t: 'pls sell 25% at 1.5m mcap thx', want: 'sell-above', level: 'mc 1500000', amount: 'pct 25' },
  { t: 'yo tippy tp 50% at 1.5m', want: 'sell-above', level: 'mc 1500000', amount: 'pct 50' },
  { t: 'could you take 30% off at 1m please', want: 'sell-above', level: 'mc 1000000', amount: 'pct 30' },
  { t: 'gm tippy, sell a quarter at 2m mc ty', want: 'sell-above', level: 'mc 2000000', amount: 'pct 25' },
  { t: 'i want to sell half at 1m', want: 'sell-above', level: 'mc 1000000', amount: 'pct 50' },
  { t: 'i\'d like to take profit at 2x', want: 'sell-above', level: 'x 2' },
  { t: 'can u set a tp at 1.2m for half', want: 'sell-above', level: 'mc 1200000', amount: 'pct 50' },
  { t: 'sell 50% at 1m mc ser', want: 'sell-above', level: 'mc 1000000', amount: 'pct 50' },
  { t: 'slel 50% at 1m', want: 'sell-above', level: 'mc 1000000', amount: 'pct 50', note: 'typo: slel' },
  { t: 'sel half at 2x', want: 'sell-above', level: 'x 2', amount: 'pct 50', note: 'typo: sel' },
  { t: 'sell 50% at 1m mcpa', want: 'sell-above', level: 'mc 1000000', amount: 'pct 50', note: 'typo: mcpa' },
  { t: 'sell 50% at 1m mcao', want: 'sell-above', level: 'mc 1000000', amount: 'pct 50', note: 'typo: mcao' },
  { t: 'sell half at 1m markt cap', want: 'sell-above', level: 'mc 1000000', amount: 'pct 50', note: 'typo: markt' },
  { t: 'sell half at 1m makret cap', want: 'sell-above', level: 'mc 1000000', amount: 'pct 50', note: 'typo: makret' },
  { t: 'sell half at 1m marketcap', want: 'sell-above', level: 'mc 1000000', amount: 'pct 50' },
  { t: 'tkae profit at 3x', want: 'sell-above', level: 'x 3', note: 'typo: tkae' },
  { t: 'take proift 50% at 2x', want: 'sell-above', level: 'x 2', amount: 'pct 50', note: 'typo: proift' },
  { t: 'sell hlaf at 2x', want: 'sell-above', level: 'x 2', amount: 'pct 50', note: 'typo: hlaf' },
  { t: 'sell a quater at 1.5m', want: 'sell-above', level: 'mc 1500000', amount: 'pct 25', note: 'typo: quater' },
  { t: 'sell evrything at 5x', want: 'sell-above', level: 'x 5', amount: 'pct 100', note: 'typo: evrything' },
  { t: 'sell 50% at 1m mcp', want: 'sell-above', level: 'mc 1000000', amount: 'pct 50', note: 'typo: mcp = mcap, not a coin (a coin named MCP needs $MCP)' },
  { t: 'sell 25 percnt at 3x', want: 'sell-above', level: 'x 3', amount: 'pct 25', note: 'typo: percnt' },
  // ---- sell-below
  { t: 'sell 10% at 700k mcap', want: 'sell-below', level: 'mc 700000', amount: 'pct 10', note: 'the trader\'s original message; 10% ≈ $0.48 at that level — under fomo\'s $2 minimum; run.ts refuses with "try at least 44%"' },
  { t: 'sell 10% at 700k', want: 'sell-below', level: 'mc 700000', amount: 'pct 10', note: 'no "mcap": a k is still a market cap; 10% ≈ $0.48 at that level — under fomo\'s $2 minimum; run.ts refuses with "try at least 44%"' },
  { t: 'stop 10% @ 650k on claudia', want: 'sell-below', level: 'mc 650000', amount: 'pct 10', coin: 'CLAUDIA', note: 'the coin named after the level; $CLAUDIA\'s bag is $719 here, so 10% clears fomo\'s minimum' },
  { t: 'sl half at 0.00065', want: 'sell-below', level: 'price 0.00065', amount: 'pct 50', note: '$0.00065 = $650K MC' },
  { t: 'stop 10% @ 650k', want: 'sell-below', level: 'mc 650000', amount: 'pct 10', note: '10% ≈ $0.45 at that level — under fomo\'s $2 minimum; run.ts refuses with "try at least 47%"' },
  { t: 'if it drops to 500k sell 30%', want: 'sell-below', level: 'mc 500000', amount: 'pct 30', note: 'condition first; 30% ≈ $1.04 at that level — under fomo\'s $2 minimum; run.ts refuses with "try at least 61%"' },
  { t: 'sell half at 600k', want: 'sell-below', level: 'mc 600000', amount: 'pct 50', note: 'no direction word: below the price now, so a partial stop; 50% ≈ $2.08 at that level — over fomo\'s $2 minimum, but a partial stop needs 5% of room (it can fill lower): run.ts refuses with "try at least 51%"' },
  { t: 'sell 50% below 650k', want: 'sell-below', level: 'mc 650000', amount: 'pct 50' },
  { t: 'sell 50% under 600k mc', want: 'sell-below', level: 'mc 600000', amount: 'pct 50', note: '50% ≈ $2.08 at that level — over fomo\'s $2 minimum, but a partial stop needs 5% of room (it can fill lower): run.ts refuses with "try at least 51%"' },
  { t: 'sell a third if it dips to 550k', want: 'sell-below', level: 'mc 550000', amount: 'pct 33', note: '33% ≈ $1.26 at that level — under fomo\'s $2 minimum; run.ts refuses with "try at least 56%"' },
  { t: 'sell half if it falls below 600k', want: 'sell-below', level: 'mc 600000', amount: 'pct 50', note: '50% ≈ $2.08 at that level — over fomo\'s $2 minimum, but a partial stop needs 5% of room (it can fill lower): run.ts refuses with "try at least 51%"' },
  { t: 'sell 60% if mcap drops to 500k', want: 'sell-below', level: 'mc 500000', amount: 'pct 60', note: '60% ≈ $2.08 at that level — over fomo\'s $2 minimum, but a partial stop needs 5% of room (it can fill lower): run.ts refuses with "try at least 61%"' },
  { t: 'sell 50% at -20%', want: 'sell-below', level: 'pct -20', amount: 'pct 50', note: '50% ≈ $1.99 at that level — under fomo\'s $2 minimum; run.ts refuses with "try at least 53%"' },
  { t: 'sell half if it dumps 30%', want: 'sell-below', level: 'pct -30', amount: 'pct 50', note: '50% ≈ $1.74 at that level — under fomo\'s $2 minimum; run.ts refuses with "try at least 61%"' },
  { t: 'sell 50% on a 25% drop', want: 'sell-below', level: 'pct -25', amount: 'pct 50', note: '50% ≈ $1.87 at that level — under fomo\'s $2 minimum; run.ts refuses with "try at least 57%"' },
  { t: 'stop loss 50% at 500k', want: 'sell-below', level: 'mc 500000', amount: 'pct 50', note: '50% ≈ $1.73 at that level — under fomo\'s $2 minimum; run.ts refuses with "try at least 61%"' },
  { t: 'sl 50% at 600k', want: 'sell-below', level: 'mc 600000', amount: 'pct 50', note: '50% ≈ $2.08 at that level — over fomo\'s $2 minimum, but a partial stop needs 5% of room (it can fill lower): run.ts refuses with "try at least 51%"' },
  { t: 'sl 50 at 600k', want: 'sell-below', level: 'mc 600000', amount: 'pct 50', note: 'bare number after sl with its own level = % of bag; 50% ≈ $2.08 at that level — over fomo\'s $2 minimum, but a partial stop needs 5% of room (it can fill lower): run.ts refuses with "try at least 51%"' },
  { t: 'partial stop 50% at 600k', want: 'sell-below', level: 'mc 600000', amount: 'pct 50', note: '"partial" is not a coin; 50% ≈ $2.08 at that level — over fomo\'s $2 minimum, but a partial stop needs 5% of room (it can fill lower): run.ts refuses with "try at least 51%"' },
  { t: 'stop 50% at 0.0006', want: 'sell-below', level: 'price 0.0006', amount: 'pct 50', note: '50% ≈ $2.08 at that level — over fomo\'s $2 minimum, but a partial stop needs 5% of room (it can fill lower): run.ts refuses with "try at least 51%"' },
  { t: 'sell 50 percent at 650k', want: 'sell-below', level: 'mc 650000', amount: 'pct 50' },
  { t: 'sell half @ 0.6m', want: 'sell-below', level: 'mc 600000', amount: 'pct 50', note: '50% ≈ $2.08 at that level — over fomo\'s $2 minimum, but a partial stop needs 5% of room (it can fill lower): run.ts refuses with "try at least 51%"' },
  { t: 'sell half @ .6m', want: 'sell-below', level: 'mc 600000', amount: 'pct 50', note: '50% ≈ $2.08 at that level — over fomo\'s $2 minimum, but a partial stop needs 5% of room (it can fill lower): run.ts refuses with "try at least 51%"' },
  { t: 'sell 60% at 600,000', want: 'sell-below', level: 'mc 600000', amount: 'pct 60' },
  { t: 'sell 60% at 600000', want: 'sell-below', level: 'mc 600000', amount: 'pct 60' },
  { t: 'sell 60% at $600k mc', want: 'sell-below', level: 'mc 600000', amount: 'pct 60' },
  { t: 'sell 50% when it dips under 650k', want: 'sell-below', level: 'mc 650000', amount: 'pct 50' },
  { t: 'if it dips to 600k sell half', want: 'sell-below', level: 'mc 600000', amount: 'pct 50', note: '50% ≈ $2.08 at that level — over fomo\'s $2 minimum, but a partial stop needs 5% of room (it can fill lower): run.ts refuses with "try at least 51%"' },
  { t: 'if mc goes below 550k dump 60%', want: 'sell-below', level: 'mc 550000', amount: 'pct 60' },
  { t: 'sell 60% once it drops to 0.0005', want: 'sell-below', level: 'price 0.0005', amount: 'pct 60', note: '60% ≈ $2.08 at that level — over fomo\'s $2 minimum, but a partial stop needs 5% of room (it can fill lower): run.ts refuses with "try at least 61%"' },
  { t: 'sl 50% at -25%', want: 'sell-below', level: 'pct -25', amount: 'pct 50', note: '50% ≈ $1.87 at that level — under fomo\'s $2 minimum; run.ts refuses with "try at least 57%"' },
  { t: 'stop 2/3 at 500k', want: 'sell-below', level: 'mc 500000', amount: 'pct 67', note: '2/3 = two thirds of the bag — must never be read as "stop 2" (a move)' },
  { t: 'sell 75% at 400k', want: 'sell-below', level: 'mc 400000', amount: 'pct 75', note: '75% ≈ $2.08 at that level — over fomo\'s $2 minimum, but a partial stop needs 5% of room (it can fill lower): run.ts refuses with "try at least 76%"' },
  { t: 'sell 50% at 0.5x', want: 'sell-below', level: 'x 0.5', amount: 'pct 50', note: '50% ≈ $1.25 at that level — under fomo\'s $2 minimum; run.ts refuses with "try at least 85%"' },
  { t: '$HIGGS sell 10% 700k', want: 'sell-below', level: 'mc 700000', amount: 'pct 10', coin: 'HIGGS', note: 'coin first, no "at"; 10% ≈ $0.48 at that level — under fomo\'s $2 minimum; run.ts refuses with "try at least 44%"' },
  { t: 'sell 60% of CLAUDIA if it drops to 500k', want: 'sell-below', level: 'mc 500000', amount: 'pct 60', coin: 'CLAUDIA', note: 'direction judged as if $CLAUDIA were at $719K MC too' },
  { t: 'on wif stop 25% at -30%', want: 'sell-below', level: 'pct -30', amount: 'pct 25', coin: 'WIF', note: 'direction judged as if $WIF were at $719K MC too' },
  { t: 'sel 50% if it dips to 600k', want: 'sell-below', level: 'mc 600000', amount: 'pct 50', note: 'typo: sel; 50% ≈ $2.08 at that level — over fomo\'s $2 minimum, but a partial stop needs 5% of room (it can fill lower): run.ts refuses with "try at least 51%"' },
  { t: 'stpo 50% at 600k', want: 'sell-below', level: 'mc 600000', amount: 'pct 50', note: 'typo: stpo; 50% ≈ $2.08 at that level — over fomo\'s $2 minimum, but a partial stop needs 5% of room (it can fill lower): run.ts refuses with "try at least 51%"' },
  { t: 'stop lsos 50% at 600k', want: 'sell-below', level: 'mc 600000', amount: 'pct 50', note: 'typo: lsos; 50% ≈ $2.08 at that level — over fomo\'s $2 minimum, but a partial stop needs 5% of room (it can fill lower): run.ts refuses with "try at least 51%"' },
  { t: 'sell half at 650k mkt cap', want: 'sell-below', level: 'mc 650000', amount: 'pct 50' },
  { t: 'sell half at 650k fdv', want: 'sell-below', level: 'mc 650000', amount: 'pct 50' },
  { t: 'sell half at 650 thousand', want: 'sell-below', level: 'mc 650000', amount: 'pct 50' },
  { t: 'sell quarter at 600k', want: 'sell-below', level: 'mc 600000', amount: 'pct 25', note: '25% ≈ $1.04 at that level — under fomo\'s $2 minimum; run.ts refuses with "try at least 51%"' },
  { t: 'sell two thirds at 500k', want: 'sell-below', level: 'mc 500000', amount: 'pct 67' },
  { t: 'sell 99% at 500k', want: 'sell-below', level: 'mc 500000', amount: 'pct 99', note: '99% is still a partial stop, not the stop loss' },
  { t: 'hey tippy if it drops to 600k can you sell half pls', want: 'sell-below', level: 'mc 600000', amount: 'pct 50', note: '50% ≈ $2.08 at that level — over fomo\'s $2 minimum, but a partial stop needs 5% of room (it can fill lower): run.ts refuses with "try at least 51%"' },
  { t: 'dump 50% if it dips 20%', want: 'sell-below', level: 'pct -20', amount: 'pct 50', note: '50% ≈ $1.99 at that level — under fomo\'s $2 minimum; run.ts refuses with "try at least 53%"' },
  { t: 'take 50% off if it falls to 600k', want: 'sell-below', level: 'mc 600000', amount: 'pct 50', note: '50% ≈ $2.08 at that level — over fomo\'s $2 minimum, but a partial stop needs 5% of room (it can fill lower): run.ts refuses with "try at least 51%"' },
  { t: 'trim 50% at 650k', want: 'sell-below', level: 'mc 650000', amount: 'pct 50', note: '"trim" = sell' },
  { t: 'sell 10% at 700k if it drops', want: 'sell-below', level: 'mc 700000', amount: 'pct 10', note: 'direction after the level; 10% ≈ $0.48 at that level — under fomo\'s $2 minimum; run.ts refuses with "try at least 44%"' },
  { t: 'cut half at 600k', want: 'sell-below', level: 'mc 600000', amount: 'pct 50', note: '"cut" = sell; 50% ≈ $2.08 at that level — over fomo\'s $2 minimum, but a partial stop needs 5% of room (it can fill lower): run.ts refuses with "try at least 51%"' },
  { t: 'sell 10% at 0.0007', want: 'sell-below', level: 'price 0.0007', amount: 'pct 10', note: '$0.0007 = $700K MC; 10% ≈ $0.48 at that level — under fomo\'s $2 minimum; run.ts refuses with "try at least 44%"' },
  { t: 'sell 50% at $0.00065', want: 'sell-below', level: 'price 0.00065', amount: 'pct 50' },
  { t: 'sell half at .00065', want: 'sell-below', level: 'price 0.00065', amount: 'pct 50' },
  { t: 'sell half at 0.0₃65', want: 'sell-below', level: 'price 0.00065', amount: 'pct 50', note: 'DEX subscript-zero price (0.0₃65 = 0.00065). NFKC turns ₃ into 3 → 0.0365 — must never be read that way; ask if unsupported' },
  { t: 'sell 25% if it\'s down 20%', want: 'sell-below', level: 'pct -20', amount: 'pct 25', note: '25% ≈ $1.00 at that level — under fomo\'s $2 minimum; run.ts refuses with "try at least 53%"' },
  { t: 'sell half at 50% down', want: 'sell-below', level: 'pct -50', amount: 'pct 50', note: '50% ≈ $1.25 at that level — under fomo\'s $2 minimum; run.ts refuses with "try at least 85%"' },
  { t: 'sl 25% at 650k', want: 'sell-below', level: 'mc 650000', amount: 'pct 25', note: '25% ≈ $1.13 at that level — under fomo\'s $2 minimum; run.ts refuses with "try at least 47%"' },
  { t: 'stop 50% at 30% down', want: 'sell-below', level: 'pct -30', amount: 'pct 50', note: '50% ≈ $1.74 at that level — under fomo\'s $2 minimum; run.ts refuses with "try at least 61%"' },
  { t: 'sell 10% at $700k', want: 'sell-below', level: 'mc 700000', amount: 'pct 10', note: '10% ≈ $0.48 at that level — under fomo\'s $2 minimum; run.ts refuses with "try at least 44%"' },
  { t: 'sell 10% at 700,000', want: 'sell-below', level: 'mc 700000', amount: 'pct 10', note: '10% ≈ $0.48 at that level — under fomo\'s $2 minimum; run.ts refuses with "try at least 44%"' },
  { t: 'sell 50% at 0.7m', want: 'sell-below', level: 'mc 700000', amount: 'pct 50' },
  { t: 'sell 50% at .7m', want: 'sell-below', level: 'mc 700000', amount: 'pct 50' },
  { t: 'sell 50% at 700k mc', want: 'sell-below', level: 'mc 700000', amount: 'pct 50' },
  { t: 'sell 10% at 700k market cap', want: 'sell-below', level: 'mc 700000', amount: 'pct 10', note: '10% ≈ $0.48 at that level — under fomo\'s $2 minimum; run.ts refuses with "try at least 44%"' },
  { t: 'sell 50% at 700k mkt cap', want: 'sell-below', level: 'mc 700000', amount: 'pct 50' },
  { t: 'sell 50% at 700k cap', want: 'sell-below', level: 'mc 700000', amount: 'pct 50' },
  { t: 'sell 50% at 700k fdv', want: 'sell-below', level: 'mc 700000', amount: 'pct 50' },
  { t: 'sell 50% @ 700k', want: 'sell-below', level: 'mc 700000', amount: 'pct 50' },
  { t: 'sell 50%@700k', want: 'sell-below', level: 'mc 700000', amount: 'pct 50', note: 'no spaces round @' },
  { t: 'sell 50% when it hits 700k', want: 'sell-below', level: 'mc 700000', amount: 'pct 50', note: '"hits" has no direction: below the price now → stop' },
  { t: 'sell 50% once it reaches 700k', want: 'sell-below', level: 'mc 700000', amount: 'pct 50' },
  { t: 'sell 50% if it dips to 700k', want: 'sell-below', level: 'mc 700000', amount: 'pct 50' },
  { t: 'sell 50% below 700k', want: 'sell-below', level: 'mc 700000', amount: 'pct 50' },
  { t: 'sell 50% under 700k', want: 'sell-below', level: 'mc 700000', amount: 'pct 50' },
  { t: 'sell 50% at 700 thousand', want: 'sell-below', level: 'mc 700000', amount: 'pct 50' },
  { t: 'SELL 10% AT 700K MC', want: 'sell-below', level: 'mc 700000', amount: 'pct 10', note: '10% ≈ $0.48 at that level — under fomo\'s $2 minimum; run.ts refuses with "try at least 44%"' },
  { t: 'sell 50% at 700000', want: 'sell-below', level: 'mc 700000', amount: 'pct 50' },
  { t: 'sell 10 percent at 700k', want: 'sell-below', level: 'mc 700000', amount: 'pct 10', note: '10% ≈ $0.48 at that level — under fomo\'s $2 minimum; run.ts refuses with "try at least 44%"' },
  { t: 'sell ten percent at 700k mcap', want: 'sell-below', level: 'mc 700000', amount: 'pct 10', note: '10% ≈ $0.48 at that level — under fomo\'s $2 minimum; run.ts refuses with "try at least 44%"' },
  { t: 'sell 10 % at 700 k', want: 'sell-below', level: 'mc 700000', amount: 'pct 10', note: '10% ≈ $0.48 at that level — under fomo\'s $2 minimum; run.ts refuses with "try at least 44%"' },
  { t: 'sell 50% at mc 700k', want: 'sell-below', level: 'mc 700000', amount: 'pct 50' },
  { t: 'sell 50% at market cap 700k', want: 'sell-below', level: 'mc 700000', amount: 'pct 50' },
  { t: 'sell 50% at a 700k mcap', want: 'sell-below', level: 'mc 700000', amount: 'pct 50' },
  { t: 'sell 10% at 700k mcpa', want: 'sell-below', level: 'mc 700000', amount: 'pct 10', note: 'typo: mcpa; 10% ≈ $0.48 at that level — under fomo\'s $2 minimum; run.ts refuses with "try at least 44%"' },
  { t: 'slel 10% at 700k mcao', want: 'sell-below', level: 'mc 700000', amount: 'pct 10', note: 'typos: slel, mcao; 10% ≈ $0.48 at that level — under fomo\'s $2 minimum; run.ts refuses with "try at least 44%"' },
  { t: 'sell 10% at 700k markt cap', want: 'sell-below', level: 'mc 700000', amount: 'pct 10', note: 'typo: markt; 10% ≈ $0.48 at that level — under fomo\'s $2 minimum; run.ts refuses with "try at least 44%"' },
  { t: 'sell 50% at 700k mcap pls', want: 'sell-below', level: 'mc 700000', amount: 'pct 50' },
  { t: 'hey tippy can you sell 10% at 700k mcap', want: 'sell-below', level: 'mc 700000', amount: 'pct 10', note: '10% ≈ $0.48 at that level — under fomo\'s $2 minimum; run.ts refuses with "try at least 44%"' },
  { t: 'sell 10% at 700k mcap on $HIGGS', want: 'sell-below', level: 'mc 700000', amount: 'pct 10', coin: 'HIGGS', note: '10% ≈ $0.48 at that level — under fomo\'s $2 minimum; run.ts refuses with "try at least 44%"' },
  { t: 'sell at 700k 50%', want: 'sell-below', level: 'mc 700000', amount: 'pct 50', note: 'size after the level — the level is already given, so 50% is the size' },
  { t: '700k sell 50%', want: 'sell-below', level: 'mc 700000', amount: 'pct 50' },
  { t: 'sell 50% 700k', want: 'sell-below', level: 'mc 700000', amount: 'pct 50', note: 'no "at"' },
  // ---- stop-loss-rest
  { t: 'sell all below 600k', want: 'stop-loss-rest', level: 'mc 600000', amount: 'pct 100' },
  { t: 'sl at 500k', want: 'stop-loss-rest', level: 'mc 500000' },
  { t: 'sl -30%', want: 'stop-loss-rest', level: 'pct -30' },
  { t: 'stop loss at 400k mcap', want: 'stop-loss-rest', level: 'mc 400000' },
  { t: 'sell everything if it drops to 500k', want: 'stop-loss-rest', level: 'mc 500000', amount: 'pct 100' },
  { t: 'sell the rest at 450k', want: 'stop-loss-rest', level: 'mc 450000', amount: 'pct 100' },
  { t: 'sl at 0.0005', want: 'stop-loss-rest', level: 'price 0.0005' },
  { t: 'stop at 550k', want: 'stop-loss-rest', level: 'mc 550000' },
  { t: 'stop loss -25%', want: 'stop-loss-rest', level: 'pct -25' },
  { t: 'sl 30%', want: 'stop-loss-rest', level: 'pct -30', note: 'an unsigned % after sl alone is the drop (existing convention)' },
  { t: 'sell all if it dips 40%', want: 'stop-loss-rest', level: 'pct -40', amount: 'pct 100' },
  { t: 'sl 50% loss', want: 'stop-loss-rest', level: 'pct -50', note: '"50% loss" is the drop, not a size' },
  { t: 'stop loss at 0.5x', want: 'stop-loss-rest', level: 'x 0.5' },
  { t: 'cut losses at -40%', want: 'stop-loss-rest', level: 'pct -40' },
  { t: 'sell everything under 500k', want: 'stop-loss-rest', level: 'mc 500000', amount: 'pct 100' },
  { t: 'dump it all if it hits 400k', want: 'stop-loss-rest', level: 'mc 400000', amount: 'pct 100' },
  { t: 'sl 100% at 500k', want: 'stop-loss-rest', level: 'mc 500000', amount: 'pct 100' },
  { t: 'stop loss everything at 450k', want: 'stop-loss-rest', level: 'mc 450000', amount: 'pct 100' },
  { t: 'set stop loss to 500k mc', want: 'stop-loss-rest', level: 'mc 500000' },
  { t: 'put my sl at 600k', want: 'stop-loss-rest', level: 'mc 600000' },
  { t: 'stoploss 500k', want: 'stop-loss-rest', level: 'mc 500000' },
  { t: 'stpo loss at 500k', want: 'stop-loss-rest', level: 'mc 500000', note: 'typo: stpo' },
  { t: 'stop los at 450k', want: 'stop-loss-rest', level: 'mc 450000', note: 'typo: los' },
  { t: 'sl @ 0.00055', want: 'stop-loss-rest', level: 'price 0.00055' },
  { t: 'sl @ .00055', want: 'stop-loss-rest', level: 'price 0.00055' },
  { t: 'stop at -20%', want: 'stop-loss-rest', level: 'pct -20' },
  { t: 'sl at 20% down', want: 'stop-loss-rest', level: 'pct -20' },
  { t: 'stop loss at minus 30%', want: 'stop-loss-rest', level: 'pct -30' },
  { t: 'sl 600k', want: 'stop-loss-rest', level: 'mc 600000' },
  { t: 'sl on CLAUDIA at 300k', want: 'stop-loss-rest', level: 'mc 300000', coin: 'CLAUDIA', note: 'direction judged as if $CLAUDIA were at $719K MC too' },
  { t: '$wif sl -25%', want: 'stop-loss-rest', level: 'pct -25', coin: 'WIF', note: 'direction judged as if $WIF were at $719K MC too' },
  { t: 'hey tippy set a stop loss at 500k pls', want: 'stop-loss-rest', level: 'mc 500000' },
  { t: 'sell the rest if it falls under 500k', want: 'stop-loss-rest', level: 'mc 500000', amount: 'pct 100' },
  { t: 'sell my whole bag at 400k', want: 'stop-loss-rest', level: 'mc 400000', amount: 'pct 100' },
  { t: 'get me out at 500k', want: 'stop-loss-rest', level: 'mc 500000', amount: 'pct 100', note: '"get me out" = sell all' },
  { t: 'sell all at 600k', want: 'stop-loss-rest', level: 'mc 600000', amount: 'pct 100' },
  { t: 'sell everything at 0.0006', want: 'stop-loss-rest', level: 'price 0.0006', amount: 'pct 100' },
  { t: 'sell at 650k', want: 'stop-loss-rest', level: 'mc 650000', note: 'no amount, below the price now → the stop loss' },
  { t: 'sell at 500k mcap', want: 'stop-loss-rest', level: 'mc 500000' },
  { t: 'stop loss at 500 thousand', want: 'stop-loss-rest', level: 'mc 500000' },
  { t: 'sl at .5m', want: 'stop-loss-rest', level: 'mc 500000' },
  { t: 'sl 0.5m mcap', want: 'stop-loss-rest', level: 'mc 500000' },
  { t: 'sl at 500,000', want: 'stop-loss-rest', level: 'mc 500000' },
  { t: 'stop loss at 500k fdv', want: 'stop-loss-rest', level: 'mc 500000' },
  { t: 'sl at 500k mkt cap', want: 'stop-loss-rest', level: 'mc 500000' },
  { t: 'stop loss 600k market cap on $HIGGS', want: 'stop-loss-rest', level: 'mc 600000', coin: 'HIGGS' },
  { t: 'sell all if mc drops below 550k', want: 'stop-loss-rest', level: 'mc 550000', amount: 'pct 100' },
  { t: 'sell everything if it tanks 50%', want: 'stop-loss-rest', level: 'pct -50', amount: 'pct 100' },
  { t: 'sell all of it at 600k', want: 'stop-loss-rest', level: 'mc 600000', amount: 'pct 100' },
  { t: 'sl 100 percent at 600k', want: 'stop-loss-rest', level: 'mc 600000', amount: 'pct 100' },
  { t: 'sl 30% below entry', want: 'stop-loss-rest', level: 'pct -30', note: '"below entry" is the reference, not a second level; no plan yet so entry = now' },
  { t: 'exit everything below 500k', want: 'stop-loss-rest', level: 'mc 500000', amount: 'pct 100' },
  { t: 'wif: sl -30%', want: 'stop-loss-rest', level: 'pct -30', coin: 'WIF', note: 'direction judged as if $WIF were at $719K MC too' },
  { t: 'sl 10%', want: 'stop-loss-rest', level: 'pct -10' },
  // ---- sell-above
  { t: 'sell $20 at 1m', want: 'sell-above', level: 'mc 1000000', amount: 'usd 20', note: '$20 is more than the bag is worth there (≈$6.93) — run.ts must say so, never oversell' },
  { t: 'take out 50 bucks at 2x', want: 'sell-above', level: 'x 2', amount: 'usd 50', note: '$50 is more than the bag is worth there (≈$9.96) — run.ts must say so, never oversell' },
  { t: 'sell $3 at 1m', want: 'sell-above', level: 'mc 1000000', amount: 'usd 3', note: '≈43% of the bag at that level' },
  { t: 'sell $2 at 2x', want: 'sell-above', level: 'x 2', amount: 'usd 2', note: 'exactly fomo\'s $2 minimum; ≈20% of the bag at that level' },
  { t: 'sell 5 dollars at 3x', want: 'sell-above', level: 'x 3', amount: 'usd 5', note: '≈33% of the bag at that level' },
  { t: 'sell $5 worth at 3m', want: 'sell-above', level: 'mc 3000000', amount: 'usd 5', note: '≈24% of the bag at that level' },
  { t: 'take $3 out at 1.5m', want: 'sell-above', level: 'mc 1500000', amount: 'usd 3', note: '≈29% of the bag at that level' },
  { t: 'sell $2.50 at 1m mcap', want: 'sell-above', level: 'mc 1000000', amount: 'usd 2.5', note: '≈36% of the bag at that level' },
  { t: 'sell 3 usd at 2m', want: 'sell-above', level: 'mc 2000000', amount: 'usd 3', note: '≈22% of the bag at that level' },
  { t: 'sell $4 at 5x', want: 'sell-above', level: 'x 5', amount: 'usd 4', note: '≈16% of the bag at that level' },
  // ---- sell-below
  { t: 'sell $2 if it drops to 600k', want: 'sell-below', level: 'mc 600000', amount: 'usd 2', note: '$2 at that level — over fomo\'s $2 minimum, but a partial stop needs 5% of room (it can fill lower): run.ts refuses with "try at least $2.10"' },
  { t: 'sl $2 at 650k', want: 'sell-below', level: 'mc 650000', amount: 'usd 2', note: '$2 at that level — over fomo\'s $2 minimum, but a partial stop needs 5% of room (it can fill lower): run.ts refuses with "try at least $2.10"' },
  // ---- sell-above
  { t: 'sell 10$ at 3x', want: 'sell-above', level: 'x 3', amount: 'usd 10', note: '"10$" = $10; ≈67% of the bag at that level' },
  { t: 'cash out $5 at 2m', want: 'sell-above', level: 'mc 2000000', amount: 'usd 5', note: '≈36% of the bag at that level' },
  { t: 'sell $3 of $wif at 1m', want: 'sell-above', level: 'mc 1000000', amount: 'usd 3', coin: 'WIF', note: 'direction judged as if $WIF were at $719K MC too' },
  { t: 'pull out $4 at 3x', want: 'sell-above', level: 'x 3', amount: 'usd 4', note: '≈27% of the bag at that level' },
  { t: 'take out my $5 at 2x', want: 'sell-above', level: 'x 2', amount: 'usd 5', note: '≈50% of the bag at that level' },
  { t: 'sell 2 bucks at 1m', want: 'sell-above', level: 'mc 1000000', amount: 'usd 2', note: '≈29% of the bag at that level' },
  // ---- sell-below
  { t: 'sell $2 at -20%', want: 'sell-below', level: 'pct -20', amount: 'usd 2', note: '$2 at that level — over fomo\'s $2 minimum, but a partial stop needs 5% of room (it can fill lower): run.ts refuses with "try at least $2.10"' },
  { t: 'sell $2 below 600k', want: 'sell-below', level: 'mc 600000', amount: 'usd 2', note: '$2 at that level — over fomo\'s $2 minimum, but a partial stop needs 5% of room (it can fill lower): run.ts refuses with "try at least $2.10"' },
  // ---- sell-above
  { t: 'sell five dollars at 2x', want: 'sell-above', level: 'x 2', amount: 'usd 5', note: '≈50% of the bag at that level' },
  { t: 'sell twenty bucks at 10x', want: 'sell-above', level: 'x 10', amount: 'usd 20', note: '≈40% of the bag at that level' },
  { t: 'take profit $3 at 1.5m', want: 'sell-above', level: 'mc 1500000', amount: 'usd 3', note: '≈29% of the bag at that level' },
  { t: 'tp $5 at 3x', want: 'sell-above', level: 'x 3', amount: 'usd 5', note: '≈33% of the bag at that level' },
  { t: 'sell $1 at 2x', want: 'sell-above', level: 'x 2', amount: 'usd 1', note: '$1 is under fomo\'s $2 minimum sell — run.ts refuses' },
  // ---- sell-below
  { t: 'sell 3 dollars worth if it dips to 650k', want: 'sell-below', level: 'mc 650000', amount: 'usd 3', note: '≈67% of the bag at that level' },
  { t: 'sell $2.5 at 0.0006', want: 'sell-below', level: 'price 0.0006', amount: 'usd 2.5', note: '≈60% of the bag at that level' },
  // ---- limit-buy
  { t: 'buy $20 at 500k', want: 'limit-buy', level: 'mc 500000', amount: 'usd 20' },
  { t: 'limit buy 50 usd @ .0004', want: 'limit-buy', level: 'price 0.0004', amount: 'usd 50', note: '"50 usd" is the amount, "@ .0004" the price — not two amounts' },
  { t: 'ape 25 if it dips to 300k mc', want: 'limit-buy', level: 'mc 300000', amount: 'usd 25', note: 'a buy\'s bare number is dollars' },
  { t: 'buy 10 bucks of $wif at 1.5m mcap', want: 'limit-buy', level: 'mc 1500000', amount: 'usd 10', coin: 'WIF' },
  { t: 'bid $5 at 250k', want: 'limit-buy', level: 'mc 250000', amount: 'usd 5' },
  { t: 'buy $10 at 600k', want: 'limit-buy', level: 'mc 600000', amount: 'usd 10' },
  { t: 'buy $25 if it dips 20%', want: 'limit-buy', level: 'pct -20', amount: 'usd 25' },
  { t: 'buy $15 at -30%', want: 'limit-buy', level: 'pct -30', amount: 'usd 15' },
  { t: 'buy $50 at 1m', want: 'limit-buy', level: 'mc 1000000', amount: 'usd 50', note: 'above the price → a breakout buy' },
  { t: 'buy $10 when it breaks 1m', want: 'limit-buy', level: 'mc 1000000', amount: 'usd 10' },
  { t: 'buy 20 usd at 400k mcap', want: 'limit-buy', level: 'mc 400000', amount: 'usd 20' },
  { t: 'buy $20 at 0.0005', want: 'limit-buy', level: 'price 0.0005', amount: 'usd 20' },
  { t: 'buy 20 dollars at 500 thousand mc', want: 'limit-buy', level: 'mc 500000', amount: 'usd 20' },
  { t: 'ape $25 at 300k', want: 'limit-buy', level: 'mc 300000', amount: 'usd 25' },
  { t: 'scoop $10 at 450k', want: 'limit-buy', level: 'mc 450000', amount: 'usd 10' },
  { t: 'buy $1k at 2m', want: 'limit-buy', level: 'mc 2000000', amount: 'usd 1000' },
  { t: 'buy 100 bucks at 600k', want: 'limit-buy', level: 'mc 600000', amount: 'usd 100' },
  { t: 'buy $5 of CLAUDIA at 500k', want: 'limit-buy', level: 'mc 500000', amount: 'usd 5', coin: 'CLAUDIA' },
  { t: 'CLAUDIA buy $10 at 400k', want: 'limit-buy', level: 'mc 400000', amount: 'usd 10', coin: 'CLAUDIA' },
  { t: 'buy $10 of bonk if it drops to 200k', want: 'limit-buy', level: 'mc 200000', amount: 'usd 10', coin: 'BONK' },
  { t: 'limit buy $30 at 350k mc', want: 'limit-buy', level: 'mc 350000', amount: 'usd 30' },
  { t: 'set a limit buy for $20 at 500k', want: 'limit-buy', level: 'mc 500000', amount: 'usd 20' },
  { t: 'place a buy $15 @ 0.00045', want: 'limit-buy', level: 'price 0.00045', amount: 'usd 15' },
  { t: 'buy $20 at .5m', want: 'limit-buy', level: 'mc 500000', amount: 'usd 20' },
  { t: 'buy $20 at 0.5m', want: 'limit-buy', level: 'mc 500000', amount: 'usd 20' },
  { t: 'buy $20 at 500,000', want: 'limit-buy', level: 'mc 500000', amount: 'usd 20' },
  { t: 'buy $20 at 500000 mcap', want: 'limit-buy', level: 'mc 500000', amount: 'usd 20' },
  { t: 'byu $20 at 500k', want: 'limit-buy', level: 'mc 500000', amount: 'usd 20', note: 'typo: byu' },
  { t: 'buy $20 at 500k mcpa', want: 'limit-buy', level: 'mc 500000', amount: 'usd 20', note: 'typo: mcpa' },
  { t: 'buy $10 at 600k mcao', want: 'limit-buy', level: 'mc 600000', amount: 'usd 10', note: 'typo: mcao' },
  { t: 'hey tippy buy $10 if it dips to 600k pls', want: 'limit-buy', level: 'mc 600000', amount: 'usd 10' },
  { t: 'can you buy 25 bucks at 400k thx', want: 'limit-buy', level: 'mc 400000', amount: 'usd 25' },
  { t: 'buy ten dollars at 650k', want: 'limit-buy', level: 'mc 650000', amount: 'usd 10' },
  { t: 'buy $10 at 2x', want: 'limit-buy', level: 'x 2', amount: 'usd 10' },
  { t: 'buy $10 if it pumps 25%', want: 'limit-buy', level: 'pct 25', amount: 'usd 10' },
  { t: 'buy $5 when it dips 10 percent', want: 'limit-buy', level: 'pct -10', amount: 'usd 5' },
  { t: 'buy $5 when it dips ten percent', want: 'limit-buy', level: 'pct -10', amount: 'usd 5' },
  { t: 'dip buy $10 at 500k', want: 'limit-buy', level: 'mc 500000', amount: 'usd 10' },
  { t: 'rebuy $10 at 400k', want: 'limit-buy', level: 'mc 400000', amount: 'usd 10' },
  { t: 'buy $20 at 500k mkt cap', want: 'limit-buy', level: 'mc 500000', amount: 'usd 20' },
  { t: 'buy $20 at 500k market cap', want: 'limit-buy', level: 'mc 500000', amount: 'usd 20' },
  { t: 'buy $20 under 500k', want: 'limit-buy', level: 'mc 500000', amount: 'usd 20' },
  { t: 'buy $20 below 500k', want: 'limit-buy', level: 'mc 500000', amount: 'usd 20' },
  { t: 'buy $20 above 1m', want: 'limit-buy', level: 'mc 1000000', amount: 'usd 20' },
  { t: 'buy $20 over 1m', want: 'limit-buy', level: 'mc 1000000', amount: 'usd 20' },
  { t: 'accumulate $10 at 450k', want: 'limit-buy', level: 'mc 450000', amount: 'usd 10' },
  { t: 'grab $10 at 500k', want: 'limit-buy', level: 'mc 500000', amount: 'usd 10' },
  { t: 'buy $10 at 300k fdv', want: 'limit-buy', level: 'mc 300000', amount: 'usd 10' },
  { t: 'buy $10 at 300k cap', want: 'limit-buy', level: 'mc 300000', amount: 'usd 10' },
  { t: 'snipe $15 at 250k', want: 'limit-buy', level: 'mc 250000', amount: 'usd 15' },
  { t: 'load up $50 at 300k', want: 'limit-buy', level: 'mc 300000', amount: 'usd 50' },
  { t: 'buy $10 at $0.0005', want: 'limit-buy', level: 'price 0.0005', amount: 'usd 10' },
  { t: 'buy $10 of $HIGGS at 500k', want: 'limit-buy', level: 'mc 500000', amount: 'usd 10', coin: 'HIGGS' },
  { t: 'buy 20 at 500k', want: 'limit-buy', level: 'mc 500000', amount: 'usd 20', note: 'a buy\'s bare number is dollars' },
  { t: 'limit buy 5 usd @ .0006', want: 'limit-buy', level: 'price 0.0006', amount: 'usd 5', note: '"5 usd" is the amount, ".0006" the price ($600K MC)' },
  { t: 'buy $10 on a 15% dip', want: 'limit-buy', level: 'pct -15', amount: 'usd 10' },
  { t: 'buy $10 on a 20% pullback', want: 'limit-buy', level: 'pct -20', amount: 'usd 10' },
  { t: 'buy $10 at -25%', want: 'limit-buy', level: 'pct -25', amount: 'usd 10' },
  { t: 'buy $20 at 500K MC', want: 'limit-buy', level: 'mc 500000', amount: 'usd 20' },
  { t: 'BUY $20 @ 500K', want: 'limit-buy', level: 'mc 500000', amount: 'usd 20' },

  { t: 'buy $10 once it reaches 1.5m', want: 'limit-buy', level: 'mc 1500000', amount: 'usd 10' },
  { t: 'buy $15 at 0.4m', want: 'limit-buy', level: 'mc 400000', amount: 'usd 15' },
  { t: 'bid 10 usd at 600k mcap', want: 'limit-buy', level: 'mc 600000', amount: 'usd 10' },
  { t: 'limit buy $10 at 600k on popcat', want: 'limit-buy', level: 'mc 600000', amount: 'usd 10', coin: 'POPCAT' },
  { t: 'buy the dip at 500k with $20', want: 'limit-buy', level: 'mc 500000', amount: 'usd 20', note: '"buy the dip" is a figure of speech' },
  { t: 'buy the dip -20% with 10 bucks', want: 'limit-buy', level: 'pct -20', amount: 'usd 10' },
  { t: 'i want to buy $15 at 0.0004', want: 'limit-buy', level: 'price 0.0004', amount: 'usd 15' },
  // ---- ask
  { t: 'buy $20 at 5oo k', want: 'ask', amount: 'usd 20', note: '"5oo" — letter o for zero; ask, never guess' },
  // ---- move
  { t: 'move tp1 to 2m', want: 'move', level: 'mc 2000000', target: 'tp1' },
  { t: 'move stop 1 to 600k', want: 'move', level: 'mc 600000', target: 'stop1', note: 'stop 1 = partial stop #1' },
  { t: 'move my sl to 500k', want: 'move', level: 'mc 500000', target: 'sl' },
  { t: 'move my stop loss to -40%', want: 'move', level: 'pct -40', target: 'sl' },
  { t: 'raise tp2 to 3x', want: 'move', level: 'x 3', target: 'tp2' },
  { t: 'lower stop 2 to 550k', want: 'move', level: 'mc 550000', target: 'stop2' },
  { t: 'change my buy to 400k', want: 'move', level: 'mc 400000', target: 'buy' },
  { t: 'move my buy to 0.0004', want: 'move', level: 'price 0.0004', target: 'buy' },
  { t: 'bump tp 1 to 1.5m', want: 'move', level: 'mc 1500000', target: 'tp1' },
  { t: 'move the first tp to 2.5m', want: 'move', level: 'mc 2500000', target: 'tp1' },
  { t: 'set tp1 to 4x', want: 'move', level: 'x 4', target: 'tp1' },
  { t: 'move sl to 450k on CLAUDIA', want: 'move', level: 'mc 450000', coin: 'CLAUDIA', target: 'sl' },
  { t: 'tp2 at 5x', want: 'move', level: 'x 5', target: 'tp2', note: 'no verb + a numbered tp = edit it' },
  { t: 'moev tp1 to 2m', want: 'move', level: 'mc 2000000', target: 'tp1', note: 'typo: moev' },
  { t: 'move stop #2 to 500k', want: 'move', level: 'mc 500000', target: 'stop2' },
  { t: 'move my stop up to 650k', want: 'move', level: 'mc 650000', target: 'sl' },
  { t: 'change the 2nd stop to 500k', want: 'move', level: 'mc 500000', target: 'stop2' },
  { t: 'move tp1 to 2m mcap on $wif', want: 'move', level: 'mc 2000000', coin: 'WIF', target: 'tp1' },
  { t: 'move my limit buy to 350k mc', want: 'move', level: 'mc 350000', target: 'buy' },
  { t: 'raise my stop loss to 600k', want: 'move', level: 'mc 600000', target: 'sl' },
  { t: 'move tp 3 to 10x', want: 'move', level: 'x 10', target: 'tp3' },
  { t: 'stop 2 at 600k', want: 'move', level: 'mc 600000', target: 'stop2', note: 'no verb + a numbered stop = edit it' },
  { t: 'can you move tp1 to 1.8m pls', want: 'move', level: 'mc 1800000', target: 'tp1' },
  // ---- remove
  { t: 'remove tp2', want: 'remove', target: 'tp2' },
  { t: 'delete stop 1', want: 'remove', target: 'stop1' },
  { t: 'cancel my stop loss', want: 'remove', target: 'sl' },
  { t: 'remove the sl on $wif', want: 'remove', coin: 'WIF', target: 'sl' },
  { t: 'get rid of tp 3', want: 'remove', target: 'tp3' },
  { t: 'remvoe tp1', want: 'remove', target: 'tp1', note: 'typo: remvoe' },
  { t: 'delete the second take profit', want: 'remove', target: 'tp2' },
  { t: 'kill stop 2', want: 'remove', target: 'stop2' },
  { t: 'remove partial stop 1', want: 'remove', target: 'stop1' },
  { t: 'no more stop loss on CLAUDIA', want: 'remove', coin: 'CLAUDIA', target: 'sl' },
  { t: 'turn off trailing', want: 'remove', target: 'trail', note: 'removes the trailing stop' },
  { t: 'cancel tp1', want: 'remove', target: 'tp1' },
  { t: 'remove my stop', want: 'remove', target: 'sl', note: 'a plain "stop" is the stop loss' },
  { t: 'delete the first stop', want: 'remove', target: 'stop1' },
  { t: 'rm tp2', want: 'remove', target: 'tp2' },
  // ---- cancel-buy
  { t: 'cancel my buy', want: 'cancel-buy' },
  { t: 'cancel all buys', want: 'cancel-buy', note: 'every coin' },
  { t: 'cancel my limit buy on CLAUDIA', want: 'cancel-buy', coin: 'CLAUDIA' },
  { t: 'kill my bids on wif', want: 'cancel-buy', coin: 'WIF' },
  { t: 'remove my buy order', want: 'cancel-buy' },
  { t: 'cancle my buy', want: 'cancel-buy', note: 'typo: cancle' },
  { t: 'delete the limit order on $HIGGS', want: 'cancel-buy', coin: 'HIGGS' },
  { t: 'scrap my dip buy', want: 'cancel-buy' },
  // ---- show
  { t: 'show my orders', want: 'show' },
  { t: 'what are my orders on CLAUDIA', want: 'show', coin: 'CLAUDIA' },
  { t: 'status', want: 'show' },
  { t: 'whats my stop on wif', want: 'show', coin: 'WIF' },
  { t: 'list my tps', want: 'show' },
  { t: 'show $HIGGS', want: 'show', coin: 'HIGGS' },
  { t: 'my buys', want: 'show' },
  { t: 'what\'s tippy doing', want: 'show' },
  { t: 'orders?', want: 'show' },
  { t: 'show my stops', want: 'show' },
  { t: 'stauts', want: 'show', note: 'typo: stauts' },
  { t: 'what have i got on bonk', want: 'show', coin: 'BONK' },
  // ---- pause
  { t: 'pause CLAUDIA', want: 'pause', coin: 'CLAUDIA' },
  { t: 'pause everything', want: 'pause' },
  { t: 'resume', want: 'pause', note: 'resume = unpause' },
  { t: 'unpause wif', want: 'pause', coin: 'WIF' },
  { t: 'puase all', want: 'pause', note: 'typo: puase' },
  { t: 'kill switch', want: 'pause' },
  { t: 'pause this coin', want: 'pause' },
  { t: 'freeze all orders', want: 'pause', note: 'freeze = pause, not show' },
  // ---- practice
  { t: 'practice a sell', want: 'practice' },
  { t: 'practice buying $5', want: 'practice', amount: 'usd 5' },
  { t: 'test a buy on wif', want: 'practice', coin: 'WIF' },
  { t: 'dry run a sell on CLAUDIA', want: 'practice', coin: 'CLAUDIA', note: 'the "on" belongs to "on CLAUDIA" — not the "dry run on" setting' },
  { t: 'practise a buy of $3', want: 'practice', amount: 'usd 3' },
  // ---- setting
  { t: 'dry run on', want: 'setting' },
  { t: 'turn off dry run', want: 'setting' },
  { t: 'use market cap', want: 'setting' },
  { t: 'use percent', want: 'setting' },
  { t: 'auto guard on', want: 'setting' },
  { t: 'hide chart lines', want: 'setting' },
  { t: 'go live', want: 'setting', note: 'dry run off' },
  // ---- ask
  { t: 'sell 10 at 700', want: 'ask', note: '10% or $10? and 700 what — $700K MC?' },
  { t: 'trim 25 at 1m mc', want: 'ask', say: /^25% of your bag, or \$25 worth\? Say "sell 25% at 1m" or "sell \$25 at 1m"\.$/, note: 'a bare number after a plain sell verb (trim) is 25% or $25 — never guessed' },
  { t: 'buy 20% at 500k', want: 'ask', say: /^How much in dollars\? I buy with a \$ amount, not a share of your cash\. You have \$50 cash on fomo — 20% of it is \$10\. Try "buy \$10 at 500k"\.$/ },
  { t: 'sell at 2', want: 'ask', note: '$2 price ($2B MC) or 2x?' },
  { t: 'buy 50', want: 'ask', amount: 'usd 50', note: 'no level — where should it buy?' },
  { t: 'sell everything', want: 'ask', amount: 'pct 100', note: 'no level — at what market cap / price? (not on the spot)' },
  { t: 'sell 10 at 700k', want: 'ask', level: 'mc 700000', note: '10% of the bag or $10?' },
  { t: 'sell 50 at 2x', want: 'ask', level: 'x 2', note: '50% or $50?' },
  { t: 'sell 20 at 1m', want: 'ask', level: 'mc 1000000', note: '20% or $20?' },
  { t: 'sell 100 at 1m', want: 'ask', level: 'mc 1000000', note: '100% or $100?' },
  { t: 'sell 3 at 3x', want: 'ask', level: 'x 3', note: '3% or $3?' },
  { t: 'sell 0.5 at 1m', want: 'ask', level: 'mc 1000000', note: '0.5%, $0.50 or half?' },
  { t: 'sell 10% at 700', want: 'ask', amount: 'pct 10', note: '700 what — $700K MC?' },
  { t: 'sell 10% at $700', want: 'ask', amount: 'pct 10', note: '$700 as a price = $700B MC — surely $700K MC? ask' },
  { t: 'sell half at 70', want: 'ask', amount: 'pct 50', note: '70k? $70? 70%?' },
  { t: 'tp at 500', want: 'ask', note: '$500K MC or $500?' },
  { t: 'buy 10 at 5', want: 'ask', note: 'how much and where — both bare numbers' },
  { t: 'sell 5 at 5', want: 'ask', note: 'both bare numbers' },
  { t: 'buy at 300k', want: 'ask', level: 'mc 300000', note: 'how much should it buy?' },
  { t: 'buy the dip -20%', want: 'ask', level: 'pct -20', note: 'how much should it buy?' },
  { t: 'buy the dip', want: 'ask', note: 'how much, and where?' },
  { t: 'buy $10', want: 'ask', amount: 'usd 10', note: 'where should it buy?' },
  { t: 'buy $10 if it dips', want: 'ask', amount: 'usd 10', note: 'dips how far?' },
  { t: 'sell $3', want: 'ask', amount: 'usd 3', note: 'at what level? never read $3 as a price (= selling the whole bag at $3B MC)' },
  { t: 'sell 10%', want: 'ask', amount: 'pct 10', note: 'at what level?' },
  { t: 'sell half if it pumps', want: 'ask', amount: 'pct 50', note: 'pumps to where?' },
  { t: 'sl 30', want: 'ask', note: '-30% or $30K MC?' },
  { t: 'stop 10', want: 'ask', note: 'a stop selling 10%, a 10% drop, or 10k?' },
  { t: 'tp 2', want: 'ask', note: '2x or $2M MC?' },
  { t: 'tp at 1.5', want: 'ask', note: '1.5x or $1.5M MC?' },
  { t: 'sell 25 at 1.5', want: 'ask', note: '25% or $25? 1.5x or $1.5M?' },
  { t: 'sell half at 1', want: 'ask', amount: 'pct 50', note: '1x (the price now)? $1? 1m? — 1x is never offered', say: /^Is "1" \$1M MC\? Say "sell half at 1m"\.$/, notSay: /1x/ },
  { t: 'sell 50% when it hits 2', want: 'ask', amount: 'pct 50', note: '2x or $2M MC?' },
  { t: 'buy $10 at 20%', want: 'ask', amount: 'usd 10', note: 'a 20% dip or a 20% breakout?' },
  { t: 'sell half at 20%', want: 'ask', amount: 'pct 50', note: 'up 20% or down 20%? (with "tp" an unsigned % is up; with plain "sell" it could be either)' },
  { t: 'sell 10% at 700k and 25% at 1m', want: 'ask', note: 'two orders — one at a time' },
  { t: 'sell half at 2x and a quarter at 3x', want: 'ask', note: 'two orders — one at a time' },
  { t: 'sell 50% at 1m, 25% at 2m', want: 'ask', note: 'two orders — one at a time' },
  { t: 'tp 2x and sl -30%', want: 'ask', note: 'one thing at a time' },
  { t: 'buy $20 at 500k sell at 1m', want: 'ask', note: 'a buy and a sell in one message' },
  { t: 'buy $10 at 1m and $20 at 500k', want: 'ask', note: 'two buys — one at a time' },
  { t: 'sell 50% at 700k mc or 650k', want: 'ask', amount: 'pct 50', note: 'two levels' },
  { t: 'sell all at 1m or 2m', want: 'ask', amount: 'pct 100', note: 'two levels' },
  { t: 'sell half between 650k and 700k', want: 'ask', amount: 'pct 50', note: 'a range, not a level' },
  { t: 'sell 10% every 2x', want: 'ask', amount: 'pct 10', note: 'a ladder — Tippy places one level at a time' },
  { t: 'buy $10 or $20 at 500k', want: 'ask', level: 'mc 500000', note: 'two amounts' },
  { t: 'sell $3 and 50% at 2x', want: 'ask', level: 'x 2', note: 'two sizes' },
  { t: 'sell half now', want: 'ask', amount: 'pct 50', note: 'not on the spot — fomo\'s Sell button does that' },
  { t: 'buy $20 now', want: 'ask', amount: 'usd 20', note: 'not on the spot — fomo\'s Buy button does that' },
  { t: 'market sell 50%', want: 'ask', amount: 'pct 50', note: 'an instant trade, not a level' },
  { t: 'dump it', want: 'ask', note: 'where? (and not on the spot)' },
  { t: 'sell my bag', want: 'ask', amount: 'pct 100', note: 'at what level?' },
  { t: 'sl', want: 'ask', note: 'where should the stop go?' },
  { t: 'tp', want: 'ask', note: 'where should the take-profit go?' },
  { t: 'tp 50%', want: 'ask', note: 'sell 50%, or +50%?' },
  { t: 'sell 50% if it drops to 2m', want: 'ask', level: 'mc 2000000', amount: 'pct 50', note: 'a drop to $2M MC while it\'s at $719K — a stop must be below the price' },
  { t: 'tp at 500k', want: 'ask', level: 'mc 500000', note: 'a take-profit below the price ($719K) — did you mean a stop? never silently flip it' },
  { t: 'take profit 50% at 600k', want: 'ask', level: 'mc 600000', amount: 'pct 50', note: 'take-profit below the price — did you mean "sell 50% if it drops to 600k"?' },
  { t: 'tp half at -20%', want: 'ask', level: 'pct -20', amount: 'pct 50', note: 'take-profits go above the price' },
  { t: 'sl at 800k', want: 'ask', level: 'mc 800000', note: 'a stop above the price ($719K) would fire at once — refuse/ask' },
  { t: 'sell everything if it drops to 900k', want: 'ask', level: 'mc 900000', amount: 'pct 100', note: 'a drop to above the price' },
  { t: 'stop loss 50% at 1m', want: 'ask', level: 'mc 1000000', amount: 'pct 50', note: 'a partial stop above the price' },
  { t: 'sell 50% at 700k if it pumps', want: 'ask', level: 'mc 700000', amount: 'pct 50', note: '"pumps" to a level below the price — up or down?' },
  { t: 'sell 25% at 3x if it drops', want: 'ask', level: 'x 3', amount: 'pct 25', note: '"drops" to 3x — up or down?' },
  { t: 'sell 50% at 719k', want: 'ask', level: 'mc 719000', amount: 'pct 50', note: 'that\'s the price now — not on the spot; above or below?' },
  { t: 'buy $20 at 719k', want: 'ask', level: 'mc 719000', amount: 'usd 20', note: 'that\'s the price now — a limit buy needs a dip or a breakout' },
  { t: 'ape 20 bucks into $wif if it dips to 1m', want: 'ask', level: 'mc 1000000', amount: 'usd 20', coin: 'WIF', note: 'was limit-buy: with $WIF at $719K like every coin here, 1M is above the price — "dips to" a level above is a contradiction, so Tippy asks rather than place a breakout buy' },
  { t: 'sl at breakeven', want: 'ask', level: 'x 1', note: 'no plan/entry yet, so breakeven = the price now — the stop would fire at once', say: /breakeven is the price now \(\$719K MC\)|Breakeven \(your entry, \$719K MC\) is where \$HIGGS is now/, notSay: /has to be below where it is now/ },
  { t: 'sell half at 0.7', want: 'ask', amount: 'pct 50', note: '$0.70 = $700M MC, 1000x the price — did you mean 700k ($0.0007)?' },
  { t: 'sl at 0.7', want: 'ask', note: '$0.70 is far above the price — a stop there would sell at once; did you mean 700k?' },
  { t: 'sell 50% at 1.250.000', want: 'ask', amount: 'pct 50', note: 'dots as thousands separators — $1.25M MC? never read as $1.25' },
  { t: 'sell 150% at 2x', want: 'ask', level: 'x 2', note: 'more than the whole bag' },
  { t: 'sell 0% at 2x', want: 'ask', level: 'x 2', note: 'nothing to sell' },
  { t: 'buy $0 at 500k', want: 'ask', level: 'mc 500000', note: 'pick an amount above $0' },
  { t: 'sl -100%', want: 'ask', note: 'a coin can\'t drop 100%' },
  { t: 'buy 0.5 sol at 500k', want: 'ask', level: 'mc 500000', note: 'Tippy buys in dollars — how many $? never read as $0.50 of a coin called SOL' },
  { t: 'buy 1m at 500k', want: 'ask', level: 'mc 500000', note: '1m what — tokens? dollars?' },
  { t: 'buy 500k', want: 'ask', note: 'an amount or a level?' },
  { t: 'sell 1m', want: 'ask', note: '1M tokens (the bag is ≈6.9M tokens) or everything at $1M MC? ask' },
  { t: 'buy $10 at 1m for 30m', want: 'ask', amount: 'usd 10', note: '30m = 30 minutes or $30M MC?' },
  { t: 'sell 50% at 1m on CLAUDIA and WIF', want: 'ask', level: 'mc 1000000', amount: 'pct 50', note: 'two coins' },
  { t: 'sell half at 1.5m on $CLAUDIA and $WIF', want: 'ask', level: 'mc 1500000', amount: 'pct 50', note: 'two coins' },
  { t: 'sell 10% at 700k on 0x1234567890abcdef1234567890abcdef12345678', want: 'ask', level: 'mc 700000', amount: 'pct 10', note: 'a contract address — Tippy finds coins by ticker' },
  { t: 'move my tp to 2m', want: 'ask', level: 'mc 2000000', note: 'which take-profit?' },
  { t: 'remove my tp', want: 'ask', note: 'which take-profit?' },
  { t: 'remove the last stop', want: 'ask', note: 'which stop? say its number' },
  { t: '10% at 700k', want: 'ask', level: 'mc 700000', amount: 'pct 10', note: 'no verb — sell? (never assume)' },
  { t: '$20 at 500k', want: 'ask', level: 'mc 500000', amount: 'usd 20', note: 'buy or sell?' },
  { t: 'half at 2x', want: 'ask', level: 'x 2', amount: 'pct 50', note: 'no verb — sell half at 2x?' },
  { t: '700k', want: 'ask', level: 'mc 700000', note: 'what should happen at $700K MC?' },
  { t: 'sell 10% at 700k cancel that', want: 'ask', level: 'mc 700000', amount: 'pct 10', note: 'self-cancelled — do nothing / ask' },

  // ==== Misreads fixed (danger pass): a size is never dropped, a side never flipped, a level never invented ====
  // ---- sell-above: shorthands, typos and number words are read — or asked — never skipped (each of these sold 100%)
  { t: 'sell 50pc at 2x', want: 'sell-above', level: 'x 2', amount: 'pct 50', note: '"pc" = percent' },
  { t: 'dump 30pc at 3x', want: 'sell-above', level: 'x 3', amount: 'pct 30', note: '"pc" = percent' },
  { t: 'tp 2x 50pc', want: 'sell-above', level: 'x 2', amount: 'pct 50', note: '"pc" = percent' },
  { t: '$CLAUDIA sell hlf at 2x', want: 'sell-above', level: 'x 2', amount: 'pct 50', coin: 'CLAUDIA', note: 'typo: hlf — with a $COIN the unread word used to be ignored' },
  { t: 'sell haf of $CLAUDIA at 2x', want: 'sell-above', level: 'x 2', amount: 'pct 50', coin: 'CLAUDIA', note: 'typo: haf' },
  { t: '$CLAUDIA sell quartr at 3x', want: 'sell-above', level: 'x 3', amount: 'pct 25', coin: 'CLAUDIA', note: 'typo: quartr' },
  { t: 'sell thrid at 3x on $CLAUDIA', want: 'sell-above', level: 'x 3', amount: 'pct 33', coin: 'CLAUDIA', note: 'typo: thrid' },
  { t: '$CLAUDIA tp 2x hlf', want: 'sell-above', level: 'x 2', amount: 'pct 50', coin: 'CLAUDIA', note: 'typo: hlf, after the level' },
  { t: 'sell thrid of $claudia at 2x', want: 'sell-above', level: 'x 2', amount: 'pct 33', coin: 'CLAUDIA', note: 'typo: thrid' },
  { t: 'sell haf at 2x on claudia', want: 'sell-above', level: 'x 2', amount: 'pct 50', coin: 'CLAUDIA', note: 'typo: haf — it lost the coin vote to "on claudia" and was dropped' },
  { t: 'sell halfe of $claudia at 3x', want: 'sell-above', level: 'x 3', amount: 'pct 50', coin: 'CLAUDIA', note: 'typo: halfe' },
  { t: 'sell a quartr at 2m on claudia', want: 'sell-above', level: 'mc 2000000', amount: 'pct 25', coin: 'CLAUDIA', note: 'typo: quartr' },
  { t: 'sell a 3rd at 2x', want: 'sell-above', level: 'x 2', amount: 'pct 33', note: '"a 3rd" = a third' },
  { t: 'sell %20 at 1m', want: 'sell-above', level: 'mc 1000000', amount: 'pct 20', note: '"%20" = 20%; 20% ≈ $1.38 at that level — under fomo\'s $2 minimum; run.ts refuses with "try at least 29%"' },
  { t: 'sell 10pc at 2x', want: 'sell-above', level: 'x 2', amount: 'pct 10', note: '"pc" = percent; 10% ≈ $0.99 at that level — under fomo\'s $2 minimum; run.ts refuses with "try at least 21%"' },
  { t: 'sell a fifth at 2x', want: 'sell-above', level: 'x 2', amount: 'pct 20', note: '20% ≈ $1.99 at that level — under fomo\'s $2 minimum; run.ts refuses with "try at least 21%"' },
  { t: 'sell a fifth of $claudia at 2x', want: 'sell-above', level: 'x 2', amount: 'pct 20', coin: 'CLAUDIA' },
  { t: 'sell a tenth of $claudia at 2x', want: 'sell-above', level: 'x 2', amount: 'pct 10', coin: 'CLAUDIA' },
  { t: 'sell twenty-five percent of $claudia at 2x', want: 'sell-above', level: 'x 2', amount: 'pct 25', coin: 'CLAUDIA', note: 'number words read whole (it was "twenty-5%", then dropped)' },
  { t: 'sell twenty five percent at 2x', want: 'sell-above', level: 'x 2', amount: 'pct 25', note: 'was 5% of a coin called TWENTY' },
  { t: 'sell seventy five percent of $claudia at 2x', want: 'sell-above', level: 'x 2', amount: 'pct 75', coin: 'CLAUDIA', note: 'was 5%' },
  { t: 'sell fifteen percent of $claudia at 2x', want: 'sell-above', level: 'x 2', amount: 'pct 15', coin: 'CLAUDIA' },
  { t: 'sell sixty percent of $claudia at 2x', want: 'sell-above', level: 'x 2', amount: 'pct 60', coin: 'CLAUDIA' },
  { t: 'sell half of $claudia at one point five million', want: 'sell-above', level: 'mc 1500000', amount: 'pct 50', coin: 'CLAUDIA', note: 'was $5M MC ("five million")' },
  { t: 'sell half at 2x send it', want: 'sell-above', level: 'x 2', amount: 'pct 50', note: '"send it" is slang, never a coin called SEND' },
  // ---- sell-above: "<n> bucks" after tp / stop is an amount, never TP<n> / stop <n> (it moved TP2 on a running plan)
  { t: 'tp 2 bucks at 2x', want: 'sell-above', level: 'x 2', amount: 'usd 2', note: '≈20% of the bag at that level' },
  { t: 'tp 3 dollars at 3m', want: 'sell-above', level: 'mc 3000000', amount: 'usd 3', note: '≈14% of the bag at that level' },
  // ---- sell-below
  { t: 'sl 3 bucks 600k', want: 'sell-below', level: 'mc 600000', amount: 'usd 3', note: 'never stop 3; ≈72% of the bag at that level' },
  { t: 'stop 2 dollars at 600k', want: 'sell-below', level: 'mc 600000', amount: 'usd 2', note: 'never stop 2; $2 at that level — a partial stop needs 5% of room: run.ts refuses with "try at least $2.10"' },
  { t: 'sl 2 usd at 650k', want: 'sell-below', level: 'mc 650000', amount: 'usd 2', note: 'never stop 2; run.ts refuses with "try at least $2.10"' },
  { t: 'sl 1 buck 650k', want: 'sell-below', level: 'mc 650000', amount: 'usd 1', note: 'never stop 1 on a coin called BUCK; $1 is under fomo\'s $2 minimum — run.ts refuses with "try at least $2.10"' },
  { t: '$CLAUDIA sl 500k hlf', want: 'sell-below', level: 'mc 500000', amount: 'pct 50', coin: 'CLAUDIA', note: 'a partial stop of half — it was the stop loss, selling everything' },
  { t: 'sell haf if it drops to 600k on claudia', want: 'sell-below', level: 'mc 600000', amount: 'pct 50', coin: 'CLAUDIA', note: 'typo: haf — it was the stop loss, selling everything' },
  { t: 'sell 50pc if it drops to 600k', want: 'sell-below', level: 'mc 600000', amount: 'pct 50', note: 'it was the stop loss; 50% ≈ $2.08 — a partial stop needs 5% of room: run.ts refuses with "try at least 51%"' },
  { t: 'sell thrid of $claudia if it falls to 550k', want: 'sell-below', level: 'mc 550000', amount: 'pct 33', coin: 'CLAUDIA', note: 'it was the stop loss, selling everything' },
  // "down 2x" halves: a stop at 0.5x — it was a take-profit at 2x (it sold when the coin DOUBLED)
  { t: 'sell half when it\'s down 2x', want: 'sell-below', level: 'x 0.5', amount: 'pct 50', note: '50% ≈ $1.24 at that level — under fomo\'s $2 minimum; run.ts refuses with "try at least 85%"' },
  { t: 'sell half if its down 2x', want: 'sell-below', level: 'x 0.5', amount: 'pct 50', note: 'run.ts refuses with "try at least 85%"' },
  { t: 'sell half at 2x down', want: 'sell-below', level: 'x 0.5', amount: 'pct 50', note: 'run.ts refuses with "try at least 85%"' },
  // ---- stop-loss-rest
  { t: 'sell all when it\'s down 2x', want: 'stop-loss-rest', level: 'x 0.5', amount: 'pct 100', note: 'it was a take-profit at 2x' },
  { t: 'sell all when it\'s 2x down', want: 'stop-loss-rest', level: 'x 0.5', amount: 'pct 100' },
  { t: 'sl at 50% of entry', want: 'stop-loss-rest', level: 'x 0.5', note: '"50% of entry" is the level, not the size (no plan yet, so entry = now)' },
  { t: 'sl at 50 percent of entry', want: 'stop-loss-rest', level: 'x 0.5' },
  { t: 'stop at half my entry', want: 'stop-loss-rest', level: 'x 0.5' },
  { t: 'sell all of $claudia at seven hundred k', want: 'stop-loss-rest', level: 'mc 700000', amount: 'pct 100', coin: 'CLAUDIA', note: 'was $100K MC ("hundred k")' },
  // The window's rule: the whole bag has to be worth fomo's minimum at the stop loss.
  { t: 'sl 30000', want: 'stop-loss-rest', level: 'mc 30000', note: 'the whole $4.98 bag is $0.20 there — under fomo\'s $2 minimum sell: run.ts refuses' },
  { t: 'sl 200k', want: 'stop-loss-rest', level: 'mc 200000', note: 'the whole bag is $1.38 there: run.ts refuses' },
  { t: 'sl -70%', want: 'stop-loss-rest', level: 'pct -70', note: 'the whole bag is $1.49 there: run.ts refuses' },
  { t: 'sell all at 250k', want: 'stop-loss-rest', level: 'mc 250000', amount: 'pct 100', note: 'the whole bag is $1.73 there: run.ts refuses' },
  { t: 'sell everything at 0.00002', want: 'stop-loss-rest', level: 'price 0.00002', amount: 'pct 100', note: 'the whole bag is $0.13 there: run.ts refuses' },
  // ---- limit-buy
  { t: 'buy $3 when it\'s down 2x', want: 'limit-buy', level: 'x 0.5', amount: 'usd 3', note: 'a dip buy at half the price — it was a breakout buy at 2x' },
  { t: 'buy $3 on a 2x dip', want: 'limit-buy', level: 'x 0.5', amount: 'usd 3' },
  { t: 'buy $3 at 2x down', want: 'limit-buy', level: 'x 0.5', amount: 'usd 3' },
  { t: 'buy twenty five dollars of $claudia at 500k', want: 'limit-buy', level: 'mc 500000', amount: 'usd 25', coin: 'CLAUDIA', note: 'was $5' },
  { t: 'buy twenty five bucks of $claudia at 500k', want: 'limit-buy', level: 'mc 500000', amount: 'usd 25', coin: 'CLAUDIA' },
  { t: 'buy $3 of $claudia at five hundred thousand', want: 'limit-buy', level: 'mc 500000', amount: 'usd 3', coin: 'CLAUDIA', note: 'was $100K MC' },
  // ---- ask: sizes that aren't one
  { t: 'sell some at 2x', want: 'ask', note: '"some" is part of the bag — how much? never all, never a guessed 50%' },
  { t: 'sell some of $claudia at 2x', want: 'ask' },
  { t: 'take some profit at 2x', want: 'ask' },
  { t: 'sell most of $claudia at 2x', want: 'ask' },
  { t: 'sell most of $claudia at 3m', want: 'ask' },
  { t: 'sell a little bit of $claudia at 2x', want: 'ask' },
  { t: 'sell some of my claudia if it dumps to 600k', want: 'ask', note: 'it was the stop loss, selling everything' },
  { t: 'sell hal of claudia if it drops to 600k', want: 'ask', note: '"hal" — half? never the stop loss that sells everything' },
  { t: 'sell quart at 2m on claudia', want: 'ask', note: '"quart" — a quarter?' },
  { t: 'sell $20% at 1m', want: 'ask', note: '$20 or 20%?' },
  { t: 'buy -$10 at 500k', want: 'ask', note: 'a negative amount — the minus was dropped' },
  { t: 'buy 500 at 500k', want: 'ask', note: 'a bare 500 — dollars or coins? (the reply says the cash)' },
  // ---- ask: a side that isn't clear
  { t: 'buy $3 at -2x', want: 'ask', note: 'half (0.5x) or 2x? the minus was dropped and it became a breakout buy' },
  { t: 'sell half at -2x', want: 'ask' },
  { t: 'sell $3 at -2x', want: 'ask' },
  { t: 'dump 10 bucks into claudia at 500k', want: 'ask', note: '"dump $X into <coin>" is buying talk — buy or sell?' },
  { t: 'sell all if mc < 1m', want: 'ask', level: 'mc 1000000', note: '"<" is below: a stop above the price is refused (it was a take-profit)' },
  { t: 'buy $3 if mc > 500k', want: 'ask', level: 'mc 500000', amount: 'usd 3', note: '">" is above: a breakout below the price is refused (it was a dip buy)' },
  { t: 'sell half if mc > 600k', want: 'ask', level: 'mc 600000', amount: 'pct 50', note: 'a take-profit below the price is refused (it was a partial stop)' },
  { t: 'tp at 200%', want: 'ask', note: '2x the price, or up 200% (3x)?' },
  // ---- ask: levels that can't be right (>50x from the market cap, or a market cap under $1,000)
  { t: 'buy 20 at 1500', want: 'ask', level: 'mc 1500', amount: 'usd 20', note: '$1.5K MC is 479x below — did you mean 1.5m?' },
  { t: 'bid 10 at 2000', want: 'ask', level: 'mc 2000', amount: 'usd 10' },
  { t: 'sl 1500', want: 'ask', level: 'mc 1500' },
  { t: 'sl 5000', want: 'ask', level: 'mc 5000' },
  { t: 'stop loss at 7000', want: 'ask', level: 'mc 7000' },
  { t: 'buy $3 at 5000', want: 'ask', level: 'mc 5000', amount: 'usd 3' },
  { t: 'sell all at 1000', want: 'ask', level: 'mc 1000', note: 'on a running plan it moved the stop loss to $1K MC' },
  { t: 'sl at 1k', want: 'ask', level: 'mc 1000' },
  { t: 'sl at 1000', want: 'ask', level: 'mc 1000' },
  { t: 'sell half at 1000', want: 'ask', level: 'mc 1000', amount: 'pct 50' },
  { t: 'sell half at 1500', want: 'ask', level: 'mc 1500', amount: 'pct 50', say: /did you mean 1\.5m\? Say "sell half at 1\.5m"\./, notSay: /minimum sell/ },
  { t: 'sell half at 1,000', want: 'ask', level: 'mc 1000', amount: 'pct 50' },
  { t: 'sell 25% at 1500', want: 'ask', level: 'mc 1500', amount: 'pct 25' },
  { t: 'sell half at 1,500', want: 'ask', level: 'mc 1500', amount: 'pct 50' },
  { t: 'buy $3 at 1k', want: 'ask', level: 'mc 1000', amount: 'usd 3' },
  { t: 'sl at 0.0005 mcap', want: 'ask', note: 'a tiny decimal with "mcap" — the price $0.0005?' },
  { t: 'buy $3 at 0.0005 mcap', want: 'ask' },
  { t: 'sell half at .0012 mcap', want: 'ask' },
  { t: 'sell half at $0.001 mc', want: 'ask' },
  { t: 'buy $3 at 300 mcap', want: 'ask', note: 'a $300 market cap — 300k?' },
  { t: 'sell half at 900 mc', want: 'ask' },
  { t: 'sell half at 1.2 mc', want: 'ask' },
  { t: 'sell half at 1 mcap', want: 'ask' },
  { t: 'sell half at 1.5 mcap', want: 'ask' },
  { t: 'sell half at mc 2', want: 'ask' },
  { t: 'sell half at -700k', want: 'ask', note: 'a negative market cap' },
  { t: 'buy $3 at 500m', want: 'ask', level: 'mc 500000000', amount: 'usd 3', note: 'a breakout buy 695x up — did you mean 500k?' },
  { t: 'sell half at 700m', want: 'ask', level: 'mc 700000000', amount: 'pct 50', note: '974x up, and 700k sits right by the price: the k/m slip. (A moon target like "sell 5% at 1b mcap" is placed.)' },
  { t: 'sell all at 700m', want: 'ask', level: 'mc 700000000', amount: 'pct 100', say: /Did you mean 700k\? Say "sell all at 700k"\. If you really mean \$700M, say it as a multiple: "sell all at 974x"\./ },
  { t: 'tp at 2000000000', want: 'ask', note: 'a long run of zeros — say it with k, m or b' },
  { t: 'tp at 100000000', want: 'ask' },
  // ---- ask: which coin, and is it an order at all?
  { t: 'sell my claudia for wif at 2x', want: 'ask', note: 'two coins — a swap? it sold the whole WIF bag' },
  { t: 'sell half of $wif at 2x on claudia', want: 'ask', note: 'two coins named' },
  { t: 'buy $3 of wif with claudia at 500k', want: 'ask', note: 'paying with another coin — Tippy buys with cash only' },
  { t: 'sell half at 2x if btc dumps', want: 'ask', note: 'Tippy only watches the coin\'s own price' },
  { t: 'dry run sell half at 2x', want: 'ask', note: 'for real, or a dry run? it placed a real order' },
  { t: 'test sell half at 2x', want: 'ask' },
  { t: 'pretend to sell half at 2x', want: 'ask' },
  { t: 'simulate a stop at 500k', want: 'ask' },
  { t: 'paper trade buy $3 at 500k', want: 'ask' },
  { t: 'sell half at 2x actually no', want: 'ask', note: 'taken back' },
  { t: 'sell half at 2x nah', want: 'ask', note: 'taken back' },
  { t: 'should i sell half at 2x?', want: 'ask', note: 'a question, not an instruction' },
  { t: 'i might sell half at 2x', want: 'ask' },
  { t: 'maybe sell half at 2x', want: 'ask' },
  { t: 'sell half at 1m for 24h', want: 'ask', note: 'take-profits don\'t expire' },
  // ---- Understood along the way (the same patterns, from the "should understand" list)
  { t: 'sl 30pc', want: 'stop-loss-rest', level: 'pct -30', note: '"pc" = percent' },
  { t: 'tp 2x 50 pc', want: 'sell-above', level: 'x 2', amount: 'pct 50' },
  { t: 'tp 2x 50 percnet', want: 'sell-above', level: 'x 2', amount: 'pct 50', note: 'typo: percnet' },
  { t: 'tp 2x hlf', want: 'sell-above', level: 'x 2', amount: 'pct 50', note: 'typo: hlf (was a coin called HLF)' },
  { t: 'tp 2x quartr', want: 'sell-above', level: 'x 2', amount: 'pct 25', note: 'typo: quartr' },
  { t: 'sell ½ at 2x', want: 'sell-above', level: 'x 2', amount: 'pct 50', note: 'NFKC makes ½ "1⁄2" (fraction slash)' },
  { t: 'sell 1/5 at 2x', want: 'sell-above', level: 'x 2', amount: 'pct 20', note: 'was "1% or $1?"; 20% ≈ $1.99 at that level — under fomo\'s $2 minimum; run.ts refuses with "try at least 21%"' },
  { t: 'sell 1/10 at 10x', want: 'sell-above', level: 'x 10', amount: 'pct 10' },
  { t: 'sell 2/5 at 3x', want: 'sell-above', level: 'x 3', amount: 'pct 40' },
  { t: 'sell 1/3rd at 2x', want: 'sell-above', level: 'x 2', amount: 'pct 33', note: 'was a coin called RD' },
  { t: 'sell 2/3rds at 2x', want: 'sell-above', level: 'x 2', amount: 'pct 67', note: 'was a coin called RDS' },
  { t: 'sell fifty % at 2x', want: 'sell-above', level: 'x 2', amount: 'pct 50', note: 'was a coin called FIFTY' },
  { t: 'sell half at 2x gang', want: 'sell-above', level: 'x 2', amount: 'pct 50', note: 'slang tail, not a coin' },
  { t: 'sell half at 2x ngl', want: 'sell-above', level: 'x 2', amount: 'pct 50', note: 'slang tail, not a coin' },
  { t: 'tp 5 bucks 2m', want: 'sell-above', level: 'mc 2000000', amount: 'usd 5', note: 'never TP5' },
  { t: 'when it hits a mil sell $3 for me', want: 'sell-above', level: 'mc 1000000', amount: 'usd 3', note: '"a mil" = 1m' },
  { t: 'sell half at 0,001', want: 'sell-above', level: 'price 0.001', amount: 'pct 50', note: 'a decimal comma: a thousands group never starts with 0' },
  { t: 'sell half when it halves', want: 'sell-below', level: 'x 0.5', amount: 'pct 50', note: 'run.ts refuses with "try at least 85%"' },
  { t: 'sell everything if it halves', want: 'stop-loss-rest', level: 'x 0.5', amount: 'pct 100' },
  { t: 'buy $3 if it halves', want: 'limit-buy', level: 'x 0.5', amount: 'usd 3' },
  { t: 'buy 20$ 300k', want: 'limit-buy', level: 'mc 300000', amount: 'usd 20', note: '"20$" read before "$ 300k" is joined' },
  { t: 'sell part of my bag at 2x', want: 'ask', note: 'how much?', say: /^How much is "part"\? Say a % or \$ — like "sell 25% at 2x"/, notSay: /\$PART/ },
  { t: 'sell half when sol hits 200', want: 'ask', note: 'another coin\'s move' },

  // ==== Misreads fixed (second pass): phrasings Tippy should have understood ====
  // ---- sell-above: filler is filler wherever it sits — pleasantries, "we", greetings drawn out — never a coin ($WE, $LOT, $HEYY…)
  { t: 'sell half if we 2x', want: 'sell-above', level: 'x 2', amount: 'pct 50', note: '"we" is the holders, not a coin called WE' },
  { t: 'sell half when we hit 1m', want: 'sell-above', level: 'mc 1000000', amount: 'pct 50' },
  { t: 'if we hit 1.5m mc i\'d like to sell half pls', want: 'sell-above', level: 'mc 1500000', amount: 'pct 50', note: 'it was a take-profit on a coin called WE' },
  { t: 'heyy can you sell everything at 1.2m market cap please, i wanna be out', want: 'sell-above', level: 'mc 1200000', amount: 'pct 100', note: 'was a coin called HEYY' },
  { t: 'heyyy tippy sell half at 2x', want: 'sell-above', level: 'x 2', amount: 'pct 50' },
  { t: 'hii tippy can u sell half at 2x', want: 'sell-above', level: 'x 2', amount: 'pct 50' },
  { t: 'sell 50% at 1m mc thanks tippy you\'re the best', want: 'sell-above', level: 'mc 1000000', amount: 'pct 50', note: 'was "$YOURE or $BEST?"' },
  { t: 'i think i wanna sell half at 1m mc', want: 'sell-above', level: 'mc 1000000', amount: 'pct 50' },
  { t: 'hey tippy hope ur good, can u sell half at 1m', want: 'sell-above', level: 'mc 1000000', amount: 'pct 50' },
  { t: 'sell half at 1m mc, thank you so much', want: 'sell-above', level: 'mc 1000000', amount: 'pct 50' },
  { t: 'sell half at 1m mc, thanks a lot', want: 'sell-above', level: 'mc 1000000', amount: 'pct 50', note: 'was a coin called LOT' },
  { t: 'take half off the table at 3x', want: 'sell-above', level: 'x 3', amount: 'pct 50', note: '"off the table" is an idiom' },
  { t: 'take $3 off the table at 1m', want: 'sell-above', level: 'mc 1000000', amount: 'usd 3', note: '≈43% of the bag at that level' },
  { t: 'sell half at 1m mc if possible', want: 'sell-above', level: 'mc 1000000', amount: 'pct 50' },
  { t: 'can you sell 1/3 when mc hits 1.5m, appreciate it', want: 'sell-above', level: 'mc 1500000', amount: 'pct 33' },
  { t: 'sell 50% at 1m mc no matter what', want: 'sell-above', level: 'mc 1000000', amount: 'pct 50' },
  { t: 'honestly just sell half at 2x', want: 'sell-above', level: 'x 2', amount: 'pct 50' },
  { t: 'sell half at 1m mc before it rugs lol', want: 'sell-above', level: 'mc 1000000', amount: 'pct 50' },
  { t: 'sell half at 2x pretty please', want: 'sell-above', level: 'x 2', amount: 'pct 50' },
  { t: 'sell half at 2x if u dont mind', want: 'sell-above', level: 'x 2', amount: 'pct 50' },
  { t: 'sell half at 2x when u get a chance', want: 'sell-above', level: 'x 2', amount: 'pct 50' },
  { t: 'sell half at 2x, you rock', want: 'sell-above', level: 'x 2', amount: 'pct 50' },
  { t: 'sell half at 2x i guess', want: 'sell-above', level: 'x 2', amount: 'pct 50' },
  { t: 'sell half at 2x lmk', want: 'sell-above', level: 'x 2', amount: 'pct 50' },
  { t: 'sell like half-ish at 2x', want: 'sell-above', level: 'x 2', amount: 'pct 50', note: '"-ish" is roughly; the card says exactly 50%' },
  // ---- sell-above: "out", "close", "lock in profits" are sells; "take … off" is a sell, not "tp off"
  { t: 'tp 2x take half off', want: 'sell-above', level: 'x 2', amount: 'pct 50', note: 'a trailing "off" read as "remove a tp"' },
  { t: 'out at 2x', want: 'sell-above', level: 'x 2', amount: 'pct 100', note: '"out" = sell all, like "exit at 2m"' },
  { t: 'im out at 2x', want: 'sell-above', level: 'x 2', amount: 'pct 100' },
  { t: 'out 2x', want: 'sell-above', level: 'x 2', amount: 'pct 100' },
  { t: 'get out at 1m', want: 'sell-above', level: 'mc 1000000', amount: 'pct 100' },
  { t: 'close half at 2x', want: 'sell-above', level: 'x 2', amount: 'pct 50' },
  { t: 'lock in profits, half at 2x', want: 'sell-above', level: 'x 2', amount: 'pct 50', note: '"lock in profits" = a take-profit (a bare "lock in some profits" asks how much)' },
  { t: 'dont sell until it hits 1m then sell half', want: 'sell-above', level: 'mc 1000000', amount: 'pct 50', note: '"don\'t sell until X, then …" is "at X …" — not a promise not to trade' },
  // ---- sell-above: a plain number after the level is the size, like before it ("tp 25 at 3x")
  { t: 'tp 3x 25', want: 'sell-above', level: 'x 3', amount: 'pct 25', note: 'it asked "is 25 a multiple?"; after a plain "sell" it still asks 25% or $25' },
  { t: 'tp 4x 25', want: 'sell-above', level: 'x 4', amount: 'pct 25' },
  { t: 'tp 1.5m 50', want: 'sell-above', level: 'mc 1500000', amount: 'pct 50', note: 'the same as "tp 50 1.5m"' },
  { t: 'tp 2m 50', want: 'sell-above', level: 'mc 2000000', amount: 'pct 50' },
  { t: 'tp 2x 25 of it', want: 'sell-above', level: 'x 2', amount: 'pct 25' },
  { t: 'sell 25 of my bag at 2x', want: 'sell-above', level: 'x 2', amount: 'pct 25', note: '"of my bag" makes it a share — never "25% or $25?"' },
  { t: 'sell 30 of my bag at 2x', want: 'sell-above', level: 'x 2', amount: 'pct 30' },
  // ---- sell-above: dollars next to a level are the amount, never a second level ($5 as a price)
  { t: 'tp $5 2x', want: 'sell-above', level: 'x 2', amount: 'usd 5', note: 'was "two levels (2x and $5.00)"' },
  { t: 'sell $5 2x', want: 'sell-above', level: 'x 2', amount: 'usd 5' },
  { t: 'tp 2x $5', want: 'sell-above', level: 'x 2', amount: 'usd 5' },
  { t: 'sell 5$ 2x', want: 'sell-above', level: 'x 2', amount: 'usd 5' },
  { t: 'tp 5$ 2x', want: 'sell-above', level: 'x 2', amount: 'usd 5' },
  { t: 'take $4 profit at 1.5m', want: 'sell-above', level: 'mc 1500000', amount: 'usd 4' },
  { t: 'take profit at 1m for $3', want: 'sell-above', level: 'mc 1000000', amount: 'usd 3', note: '"for $3" is how much; a price would be "at $0.001"' },
  // ---- sell-above: missed spaces and signs
  { t: 'tp2x half', want: 'sell-above', level: 'x 2', amount: 'pct 50', note: 'it said "I never guess buy or sell" — to a "tp"' },
  { t: 'tp 2x50%', want: 'sell-above', level: 'x 2', amount: 'pct 50' },
  { t: 'sell half at 2×', want: 'sell-above', level: 'x 2', amount: 'pct 50', note: 'the multiplication sign' },
  { t: 'sell half at2x', want: 'sell-above', level: 'x 2', amount: 'pct 50' },
  // ---- sell-above: the rest that's kept is never a second size; "all but 10%" is 90%
  { t: 'sell half of claudia at 2x and keep the rest', want: 'sell-above', level: 'x 2', amount: 'pct 50', coin: 'CLAUDIA', note: 'was "50% or 100%?"' },
  { t: 'sell half at 2x and keep the rest', want: 'sell-above', level: 'x 2', amount: 'pct 50' },
  { t: 'sell half at 2x, let the rest ride', want: 'sell-above', level: 'x 2', amount: 'pct 50' },
  { t: 'take my initials out at 2x and let the rest ride pls', want: 'sell-above', level: 'x 2', amount: 'pct 50', note: 'initials at 2x = 50%' },
  { t: 'sell all but 10% at 2x', want: 'sell-above', level: 'x 2', amount: 'pct 90', note: 'it suggested "sell 100%" — the opposite' },
  { t: 'can you not sell all, just half at 2x', want: 'sell-above', level: 'x 2', amount: 'pct 50', note: '"not all" takes the 100% back' },
  // ---- sell-below
  { t: 'stop 50% on a 20% drop', want: 'sell-below', level: 'pct -20', amount: 'pct 50', note: '"drop" here is a move, not "drop my stop"; 50% ≈ $1.99 at that level — under fomo\'s $2 minimum; run.ts refuses with "try at least 53%"' },
  { t: 'sl 500k 50', want: 'sell-below', level: 'mc 500000', amount: 'pct 50', note: 'like "sl 50 at 600k"; 50% ≈ $1.73 at that level — under fomo\'s $2 minimum; run.ts refuses with "try at least 61%"' },
  { t: 'sl $3 -20%', want: 'sell-below', level: 'pct -20', amount: 'usd 3', note: '≈75% of the bag there — was "two levels"' },
  { t: 'sell half if it drops to 600k, thanks a lot', want: 'sell-below', level: 'mc 600000', amount: 'pct 50', note: 'was a stop on a coin called LOT; run.ts refuses with "try at least 51%"' },
  { t: 'i want a partial stop, 80% at 500k', want: 'sell-below', level: 'mc 500000', amount: 'pct 80', note: 'was a coin called WANT' },
  { t: 'if it starts dumping to 550k sell 2/3 pls', want: 'sell-below', level: 'mc 550000', amount: 'pct 67', note: 'was a coin called STARTS' },
  { t: 'sell half if it drops to 600k but keep my stop loss', want: 'sell-below', level: 'mc 600000', amount: 'pct 50', note: 'was a coin called KEEP; run.ts refuses with "try at least 51%"' },
  { t: 'i dont want to lose everything so sell half if it drops to 600k', want: 'sell-below', level: 'mc 600000', amount: 'pct 50', note: '"lose everything" is the reason, not a size; run.ts refuses with "try at least 51%"' },
  // ---- stop-loss-rest
  { t: 'sl if we drop 30%', want: 'stop-loss-rest', level: 'pct -30', note: 'was "Want to move it instead?" (a "drop" read as remove)' },
  { t: 'sl on a 30% drop', want: 'stop-loss-rest', level: 'pct -30' },
  { t: 'sl if it drop 30%', want: 'stop-loss-rest', level: 'pct -30' },
  { t: 'get out at 300k', want: 'stop-loss-rest', level: 'mc 300000', amount: 'pct 100', note: '"get out" was in ALL_OUT but not a sell word' },
  { t: 'out at 500k', want: 'stop-loss-rest', level: 'mc 500000', amount: 'pct 100' },
  { t: 'gtfo at 300k', want: 'stop-loss-rest', level: 'mc 300000', amount: 'pct 100' },
  { t: 'bail at 400k', want: 'stop-loss-rest', level: 'mc 400000', amount: 'pct 100' },
  { t: 'can you get me out completely if it dumps to 400k mc', want: 'stop-loss-rest', level: 'mc 400000', note: 'was a coin called COMPLETELY' },
  // ---- limit-buy: every way of saying buy, and every way of saying the dip
  { t: 'buy 20 at 300k no tp', want: 'limit-buy', level: 'mc 300000', amount: 'usd 20', note: '"no tp" = no guard after the buy' },
  { t: 'buy more 20 at 400k', want: 'limit-buy', level: 'mc 400000', amount: 'usd 20' },
  { t: 'dca 10 at 500k', want: 'limit-buy', level: 'mc 500000', amount: 'usd 10', note: 'it offered a sell first' },
  { t: 'dca $3 at 500k', want: 'limit-buy', level: 'mc 500000', amount: 'usd 3' },
  { t: 'long $3 at 500k', want: 'limit-buy', level: 'mc 500000', amount: 'usd 3' },
  { t: 'double down with $3 at 500k', want: 'limit-buy', level: 'mc 500000', amount: 'usd 3', note: '"double" is never a 2x level here' },
  { t: 'average down $3 at 500k', want: 'limit-buy', level: 'mc 500000', amount: 'usd 3', note: 'a dip buy — above the price it would be refused' },
  { t: 'throw $3 at it if it dips to 500k', want: 'limit-buy', level: 'mc 500000', amount: 'usd 3' },
  { t: 'get me $3 of claudia at 500k', want: 'limit-buy', level: 'mc 500000', amount: 'usd 3', coin: 'CLAUDIA' },
  { t: 'spend 4 bucks on claudia if it drops to 600k thx', want: 'limit-buy', level: 'mc 600000', amount: 'usd 4', coin: 'CLAUDIA', note: '"spend" can only be a buy' },
  { t: 'spend $3 if it dips to 500k', want: 'limit-buy', level: 'mc 500000', amount: 'usd 3' },
  { t: 'add $3 to my bag if it dips to 500k', want: 'limit-buy', level: 'mc 500000', amount: 'usd 3' },
  { t: 'scoop $5 more if it bleeds to 0.0005', want: 'limit-buy', level: 'price 0.0005', amount: 'usd 5', note: 'was a coin called BLEEDS' },
  { t: 'buy $3 more if it bleeds down to 0.5m pls', want: 'limit-buy', level: 'mc 500000', amount: 'usd 3' },
  { t: 'buy $3 if it sinks to 500k', want: 'limit-buy', level: 'mc 500000', amount: 'usd 3' },
  { t: 'buy $3 if it slides to 500k', want: 'limit-buy', level: 'mc 500000', amount: 'usd 3' },
  { t: 'if it ever breaks 1m buy $3', want: 'limit-buy', level: 'mc 1000000', amount: 'usd 3', note: 'was a coin called EVER' },
  // ---- move: "a bit" is how far, never a coin called BIT
  { t: 'can you push tp1 a bit higher to like 1.3m', want: 'move', level: 'mc 1300000', target: 'tp1' },
  { t: 'move my stop loss up a bit to 400k pls', want: 'move', level: 'mc 400000', target: 'sl' },
  // ---- setting
  { t: 'can you read numbers as moves pls', want: 'setting' },
  // ---- the same patterns, said other ways — and where they stop (asked, never guessed)
  { t: 'sell half at 1,500,000, thanks', want: 'sell-above', level: 'mc 1500000', amount: 'pct 50', note: 'a comma after the number is punctuation — it was read as 1,500.000' },
  { t: '-5% sell half', want: 'sell-below', level: 'pct -5', amount: 'pct 50', note: 'the leading minus was stripped as punctuation (it became a 5% size)' },
  { t: 'sell at 3x and keep the rest', want: 'ask', level: 'x 3', note: 'keeping the rest means part of the bag — how much? never all' },
  { t: 'sell all at 3x and keep the rest', want: 'ask', level: 'x 3', note: 'all, or keep the rest?' },
  { t: 'lock in some profits at 2x', want: 'ask', level: 'x 2', note: '"some" — how much?' },
  { t: 'sell half of my rug at 2x', want: 'ask', note: 'an everyday word named as the coin — $RUG, or the coin on screen?' },
  { t: 'buy $5 if it dips +50%', want: 'ask', note: 'a dip to +50% — the sign says breakout; it was placed as a breakout buy' },
  { t: 'average down $5 +50%', want: 'ask', note: 'averaging down at +50%?' },
  // ---- Replies that name the real problem, with an example to copy (the wording pass). Every "Say …" is a whole message
  // ---- that works on its own — the user's own size and level, never a made-up "at 2x", an absurd "900x", or a fragment like "2m".
  // Buy words: "long", "top up" — never "what should happen at 300k?" (which led with a sell).
  { t: 'long 20 at 300k', want: 'limit-buy', level: 'mc 300000', amount: 'usd 20' },
  { t: 'top up 20 at 400k', want: 'limit-buy', level: 'mc 400000', amount: 'usd 20', note: 'was "Hmm, I didn\'t catch that"' },
  { t: 'long $5 at 500k', want: 'limit-buy', level: 'mc 500000', amount: 'usd 5' },
  { t: 'long at 300k', want: 'ask', level: 'mc 300000', say: /^How much should I buy at \$300K MC\? You have \$50 cash on fomo\. Try "buy \$10 at 300k"\.$/ },
  { t: 'top up my bag at 400k', want: 'ask', level: 'mc 400000', say: /^How much should I buy at \$400K MC\?/ },
  { t: 'short at 1m', want: 'ask', say: /^I can't short — I only sell coins you hold and buy with your cash\. To sell yours at 1m, say "sell all at 1m"\.$/ },
  // Movement words and slang that became coins ($RUGS, $NUKES, $FR, $BOUT…).
  { t: 'sell all if it rugs to 300k', want: 'stop-loss-rest', level: 'mc 300000', note: 'was $RUGS' },
  { t: 'sell half if it nukes 30%', want: 'sell-below', level: 'pct -30', amount: 'pct 50', note: 'was "At what level?" with the 30% ignored. 50% ≈ $1.74 there — under fomo\'s $2 minimum; run.ts refuses with "try at least 61%"' },
  { t: 'sell half at 2x frfr', want: 'sell-above', level: 'x 2', amount: 'pct 50' },
  { t: 'sell half at 2x fr', want: 'sell-above', level: 'x 2', amount: 'pct 50' },
  { t: 'sell half at 2x tbh', want: 'sell-above', level: 'x 2', amount: 'pct 50' },
  { t: 'sell half at 2x idk', want: 'sell-above', level: 'x 2', amount: 'pct 50', note: 'slang tail (the card is the confirmation)' },
  { t: 'sell half at 2x nfa', want: 'sell-above', level: 'x 2', amount: 'pct 50' },
  { t: 'sell half at 2x bruh', want: 'sell-above', level: 'x 2', amount: 'pct 50' },
  { t: 'sell half at 2x yolo', want: 'sell-above', level: 'x 2', amount: 'pct 50' },
  { t: 'sell half at 2x on fomo', want: 'sell-above', level: 'x 2', amount: 'pct 50', note: 'was $FOMO' },
  { t: 'sell bout half at 2x', want: 'sell-above', level: 'x 2', amount: 'pct 50', note: '"bout" = about — was $BOUT' },
  { t: 'sell 25%ish at 2x', want: 'sell-above', level: 'x 2', amount: 'pct 25' },
  { t: 'sell half at 1m-ish', want: 'sell-above', level: 'mc 1000000', amount: 'pct 50' },
  { t: 'sell hlf at 2x', want: 'sell-above', level: 'x 2', amount: 'pct 50' },
  { t: 'sell halfish at 2x', want: 'sell-above', level: 'x 2', amount: 'pct 50' },
  { t: 'sell hald at 2x', want: 'ask', level: 'x 2', say: /^Did you mean "half"\? Say "sell half at 2x"/ },
  { t: 'sell hald at 1m', want: 'ask', say: /^Did you mean "half"\? Say "sell half at 1m"/ },
  // Everyday English is never a ticker without its $ ($TOMORROW, $GOOD, $HAPPENS…): the real problem is answered.
  { t: 'sell half at 1m tomorrow', want: 'ask', say: /^I don't do timed orders — I sell when it reaches the level, whenever that is\. Say "sell half at 1m" to set it now\.$/ },
  { t: 'sell half at 2x tonight', want: 'ask', say: /I don't do timed orders.*Say "sell half at 2x" to set it now\./ },
  { t: 'buy $5 at 500k tomorrow', want: 'ask', say: /^I can't start a buy later.*Say "buy \$5 at 500k" to place it now\.$/ },
  { t: 'buy $5 at 500k today', want: 'ask', say: /^How long should the buy wait\? I count hours, not times of day — say "buy \$5 at 500k for 12h"\.$/ },
  { t: 'sell half at 2x today', want: 'ask', say: /^Take-profits and stops don't expire — they wait until they sell or you remove them\. Say just "sell half at 2x"\.$/ },
  { t: 'sell half later at 2x', want: 'ask', say: /I don't do timed orders.*Say "sell half at 2x" to set it now\./ },
  { t: 'is 1m a good tp?', want: 'ask', say: /^That's your call — I don't give trading advice\. If you want it, say "tp at 1m"/ },
  { t: 'is 500k a good entry', want: 'ask', say: /trading advice.*say "buy \$10 at 500k"/ },
  { t: 'is 2x a good tp for half', want: 'ask', say: /trading advice.*say "sell half at 2x"/ },
  { t: 'move tp1 to 2x tomorrow', want: 'ask', say: /^I don't do timed changes — nothing waits for a time\. Say "move tp1 to 2x" when you want it done\.$/ },
  { t: 'remove my stop tonight', want: 'ask', say: /Say "remove my stop" when you want it done\./ },
  { t: 'good morning sell half at 2x', want: 'sell-above', level: 'x 2', amount: 'pct 50', note: 'a greeting, never "I didn\'t catch good"' },
  { t: 'sell half at 200%', want: 'ask', say: /^Is "200%" 2x the price, or up 200% \(3x\)\? Say "sell half at 2x" or "sell half at \+200%"\.$/, notSay: /drops 200%/ },
  { t: 'what happens if i sell half at 2x', want: 'ask', say: /^Want me to set that up\? Say "sell half at 2x" and I'll show you exactly what it does/ },
  { t: 'thinking about selling half at 2x', want: 'ask', say: /Say "sell half at 2x"/, notSay: /"selling/ },
  { t: 'sell half at 2x or not', want: 'ask', say: /Say "sell half at 2x"/ },
  { t: 'sell half at 2x wait no', want: 'ask', say: /won't do anything/ },
  { t: 'sell half at 2x good', want: 'ask', level: 'x 2', amount: 'pct 50', say: /^I didn't catch "good" — try "sell half at 2x"\.$/ },
  { t: 'sell half at 2x not', want: 'ask', level: 'x 2', amount: 'pct 50', say: /I didn't catch "not"/ },
  { t: 'sell half of good at 2x', want: 'ask', say: /Is "good" the coin\? Put a \$ in front/ },
  // Vague sizes: asked with the word that was said.
  { t: 'sell a bit at 2x', want: 'ask', say: /^How much is "a bit"\? Say a % or \$ — like "sell 25% at 2x" or "sell \$3 at 2x"\./ },
  { t: 'sell a little at 2x', want: 'ask', say: /^How much is "a little"\?/ },
  { t: 'sell a portion at 2x', want: 'ask', say: /^How much is "a portion"\?/ },
  { t: 'sell a chunk at 2x', want: 'ask', say: /^How much is "a chunk"\?/ },
  { t: 'sell a lil bit at 2x', want: 'ask', say: /^How much is "a little bit"\?/, notSay: /\$LIL|\$BIT/ },
  { t: 'sell most of my bag at 3m', want: 'ask', say: /^How much is "most"\? Say a % or \$ — like "sell 75% at 3m"/, notSay: /\$MOST/ },
  // Levels too far from the market cap: "did you mean …?" with the whole message to copy — never "sl at 2k" (−99.7%).
  { t: 'tp 2000', want: 'ask', level: 'mc 2000', say: /^\$2K MC is 360x below where \$HIGGS is now \(\$719K MC\) — did you mean 2m\? Say "tp at 2m"\.$/, notSay: /sl at/ },
  { t: 'tp 1000', want: 'ask', level: 'mc 1000', say: /did you mean 1m\? Say "tp at 1m"\./, notSay: /sl at/ },
  { t: 'tp at 1.5k', want: 'ask', level: 'mc 1500', say: /did you mean 1\.5m\? Say "tp at 1\.5m"\./, notSay: /sl at/ },
  { t: 'sell half at 3k', want: 'ask', level: 'mc 3000', amount: 'pct 50', say: /did you mean 3m\? Say "sell half at 3m"\./, notSay: /minimum sell/ },
  // A bare level (and a bare size): one question, with the user's own size and level — no "at 2x", no "900x".
  { t: 'sell 20 at 600', want: 'ask', say: /^20% of your bag or \$20 worth — and is "600" \$600K MC\? Say "sell 20% at 600k" or "sell \$20 at 600k"\.$/, notSay: /2x|600x/ },
  { t: 'sell 15 at 800', want: 'ask', say: /^15% of your bag or \$15 worth — and is "800" \$800K MC\? Say "sell 15% at 800k" or "sell \$15 at 800k"\.$/, notSay: /2x|800x/ },
  { t: 'sell half at 900', want: 'ask', say: /^Is "900" \$900K MC\? Say "sell half at 900k"\.$/, notSay: /900x/ },
  { t: 'tp 50 700', want: 'ask', say: /^Is "700" \$700K MC\? Say "tp 50% at 700k"\.$/, notSay: /700x/ },
  { t: 'dump half 700', want: 'ask', say: /^Is "700" \$700K MC\? Say "sell half at 700k"\.$/, notSay: /700x/ },
  { t: 'stop 25% at 900', want: 'ask', say: /^Is "900" \$900K MC\? Say "sell 25% if it drops to 900k"\.$/ },
  { t: 'sell 20 at 5', want: 'ask', say: /^20% of your bag or \$20 worth — and is "5" 5x or \$5M MC\?/ },
  { t: 'sell my moonbag at 10x', want: 'sell-above', level: 'x 10', amount: 'pct 100', note: 'the bag kept for the moon is the rest — was "Is moon the coin?"' },
  { t: 'sell half at 2x in a year', want: 'ask', say: /don't expire.*Say just "sell half at 2x"\./, notSay: /\$YEAR|"year"/ },
  { t: 'buy $-10 at 500k', want: 'ask', say: /can't be negative/ },
  { t: 'sell half if it moves 20%', want: 'ask', say: /^Up 20% or down 20%\? Say "sell half if it pumps 20%" or "sell half if it drops 20%"\.$/, notSay: /25%/ },
  { t: 'sell half at 1mk', want: 'ask', say: /^Is "1mk" 1m or 1k\? Say "sell half at 1m" or "sell half at 1k"\.$/ },
  { t: 'sell half at 2kk', want: 'ask', say: /^Is "2kk" 2m\? Say "sell half at 2m"\.$/ },
  { t: 'protect half my bag at 600k', want: 'ask', say: /^Sell half if it drops to 600k\? Say "sell half if it drops to 600k"/, notSay: /preset/ },
  // Dollars: never a price level, never a European "1.000" read as $1.
  { t: 'sell usd 5 at 2x', want: 'sell-above', level: 'x 2', amount: 'usd 5', note: '"usd 5" is $5 — was "is 5 a multiple or a market cap?"' },
  { t: 'sell $5 (50%) at 2x', want: 'ask', say: /\$5 or 50%\? Pick one/, notSay: /two levels/ },
  { t: 'dump $10 into it at 500k', want: 'ask', say: /"Dumping into" a coin usually means buying it — say "buy \$10 at 500k"/, notSay: /two levels/ },
  { t: 'dump another $3 into claudia if it dips to 500k', want: 'ask', say: /say "buy \$3 at 500k" to buy/, notSay: /two levels/ },
  { t: 'sell 5k at 2x', want: 'ask', say: /^Is "5k" dollars or coins\?.*say "sell \$5k at 2x" or "sell 25% at 2x"\.$/, notSay: /two levels/ },
  { t: 'buy $1.000 at 500k', want: 'ask', say: /^Is "\$1\.000" \$1 or \$1K\? Say "buy \$1 at 500k" or "buy \$1000 at 500k"\.$/ },
  { t: 'buy at $3', want: 'ask', say: /^Is \$3 how much to spend\? Then say where — like "buy \$3 if it dips 20%" or "buy \$3 at 500k"/ },
  // A buy said as a share of your cash: asked in dollars, with your cash and an amount to copy at the level said.
  { t: 'buy half at 500k', want: 'ask', say: /^How much in dollars\? I buy with a \$ amount, not a share of your cash\. You have \$50 cash on fomo — half of it is \$25\. Try "buy \$25 at 500k"\.$/ },
  { t: 'buy a quarter at 500k', want: 'ask', say: /a quarter of it is \$12\.50\. Try "buy \$12\.50 at 500k"\.$/ },
  { t: 'buy a quarter of my cash at 500k', want: 'ask', say: /a quarter of it is \$12\.50\. Try "buy \$12\.50 at 500k"\.$/ },
  { t: 'buy all at 300k', want: 'ask', say: /You have \$50 cash on fomo\. Try "buy \$50 at 300k"\.$/ },
  { t: 'buy with all my cash at 500k', want: 'ask', say: /You have \$50 cash on fomo\. Try "buy \$50 at 500k"\.$/ },
  { t: 'buy max at 500k', want: 'ask', say: /You have \$50 cash on fomo\. Try "buy \$50 at 500k"\.$/ },
  { t: 'buy at 500k 20%', want: 'ask', say: /20% of it is \$10\. Try "buy \$10 at 500k"\.$/, notSay: /dip or a/ },
  { t: 'buy 20% if it dips to 600k', want: 'ask', say: /20% of it is \$10\. Try "buy \$10 at 600k"\.$/, notSay: /500k/ },
  { t: 'sl at be', want: 'ask', level: 'x 1', say: /breakeven is the price now \(\$719K MC\) — a stop there would sell at once\. Pick a level below it, like "sl -10%"|Breakeven \(your entry, \$719K MC\) is where \$HIGGS is now/, notSay: /has to be below where it is now/ },
  // ---- Round 4 (second testers). A "2x dump" is a fall to 0.5x — never a 2x take-profit ("dump" was read as the verb).
  { t: 'sell half on a 2x dump', want: 'sell-below', level: 'x 0.5', amount: 'pct 50', note: 'was a TP 50% at 2x UP. 50% ≈ $1.24 at 0.5x — under fomo\'s $2 minimum; run.ts refuses with "try at least 85%"' },
  { t: 'sell 1% on a 2x dump', want: 'sell-below', level: 'x 0.5', amount: 'pct 1', note: 'was "Add TP2 … at 2x" on a running plan. 1% is under fomo\'s minimum; run.ts refuses with "try at least 85%"' },
  { t: 'sell half on 2x dump', want: 'sell-below', level: 'x 0.5', amount: 'pct 50', note: '50% ≈ $1.24 at 0.5x — under fomo\'s $2 minimum; run.ts refuses with "try at least 85%"' },
  { t: 'sell half on any 2x dump', want: 'sell-below', level: 'x 0.5', amount: 'pct 50', note: '50% ≈ $1.24 at 0.5x — under fomo\'s $2 minimum; run.ts refuses with "try at least 85%"' },
  { t: 'sell half if there is a 2x dump', want: 'sell-below', level: 'x 0.5', amount: 'pct 50', note: '50% ≈ $1.24 at 0.5x — under fomo\'s $2 minimum; run.ts refuses with "try at least 85%"' },
  { t: 'sell half if we get a 2x dump', want: 'sell-below', level: 'x 0.5', amount: 'pct 50', note: '50% ≈ $1.24 at 0.5x — under fomo\'s $2 minimum; run.ts refuses with "try at least 85%"' },
  { t: 'sell half after a 2x dump', want: 'sell-below', level: 'x 0.5', amount: 'pct 50', note: '50% ≈ $1.24 at 0.5x — under fomo\'s $2 minimum; run.ts refuses with "try at least 85%"' },
  { t: 'sell all on a 2x dump', want: 'stop-loss-rest', level: 'x 0.5', amount: 'pct 100', note: 'was a TP selling 100% at 2x up' },
  { t: 'sell all on a 3x dump', want: 'stop-loss-rest', level: 'x 0.333333', amount: 'pct 100', note: 'the whole bag is $1.66 at 1/3x — under fomo\'s $2 minimum sell, so run.ts refuses' },
  { t: 'sell half on a 2x nuke', want: 'sell-below', level: 'x 0.5', amount: 'pct 50', note: '50% ≈ $1.24 at 0.5x — under fomo\'s $2 minimum; run.ts refuses with "try at least 85%"' },
  { t: 'sell half on a 2x rug', want: 'sell-below', level: 'x 0.5', amount: 'pct 50', note: '50% ≈ $1.24 at 0.5x — under fomo\'s $2 minimum; run.ts refuses with "try at least 85%"' },
  { t: 'sell half if it 2x dumps', want: 'sell-below', level: 'x 0.5', amount: 'pct 50', note: '50% ≈ $1.24 at 0.5x — under fomo\'s $2 minimum; run.ts refuses with "try at least 85%"' },
  { t: 'sell 60% if it 3x dumps', want: 'sell-below', level: 'x 0.333333', amount: 'pct 60', note: 'the whole bag is $1.66 at 1/3x — under fomo\'s $2 minimum sell, so run.ts refuses' },
  { t: 'sell everything if it 2x dumps', want: 'stop-loss-rest', level: 'x 0.5', amount: 'pct 100' },
  { t: 'if it hits 2x dump the rest', want: 'sell-above', level: 'x 2', amount: 'pct 100', note: '"dump" with something to dump is still the verb — 2x up' },
  { t: '2x dump half', want: 'sell-above', level: 'x 2', amount: 'pct 50' },
  { t: 'sell half on a double dump', want: 'ask', say: /^Is a "double dump" a fall to 0\.5x of the price\? Say "sell half if it drops 50%"/, notSay: /take-profit/ },
  { t: 'sell 25% at +50% profit', want: 'sell-above', level: 'pct 50', amount: 'pct 25', note: '"+50% profit" is the level, never a share of the profit. 25% ≈ $1.86 there — under fomo\'s $2 minimum; run.ts refuses with "try at least 27%"' },
  { t: 'sell half of what i have at 2x', want: 'sell-above', level: 'x 2', amount: 'pct 50', note: 'was $HAVE' },
  // ---- ask: taking a sell (or a buy) back is never a new order — it names the take-profit to remove, or asks.
  { t: 'cancel the sell at 2x', want: 'ask', say: /no sell to remove|You have no sell at \$1\.44M MC on \$HIGGS\. Yours: TP1/, notSay: /^Add|Place/ },
  { t: 'cancel my sell at 2x', want: 'ask', say: /no sell to remove|You have no sell at \$1\.44M MC/ },
  { t: 'remove the sell at 2x', want: 'ask', say: /no sell to remove|You have no sell at \$1\.44M MC/ },
  { t: 'remove sell order at 1m', want: 'ask', say: /no sell to remove|You have no sell at \$1M MC/ },
  { t: 'cancel selling half at 2x', want: 'ask', say: /no sell to remove|You have no sell at/ },
  { t: 'undo sell half at 2x', want: 'ask', say: /no sell to remove|You have no sell at/ },
  { t: 'remove sell half at 2x', want: 'ask', say: /no sell to remove|You have no sell at/ },
  { t: 'cancel sell 50% at 1.5x', want: 'ask', say: /no sell to remove|That's TP1 on \$HIGGS \(sell 20% at \$1\.08M MC\) — say "remove tp1" to remove it\./ },
  { t: 'scrap the sell at 2x', want: 'ask', say: /no sell to remove|You have no sell at/ },
  { t: 'forget selling at 2x', want: 'ask', say: /no sell to remove|You have no sell at/ },
  { t: 'skip the sell at 2x', want: 'ask', say: /no sell to remove|You have no sell at/, notSay: /\$SKIP/ },
  { t: 'nvm the sell at 2x', want: 'ask', say: /no sell to remove|You have no sell at/, notSay: /\$NVM/ },
  { t: 'hold off selling at 2x', want: 'ask', say: /^I can only place orders, not promise not to sell\./ },
  { t: 'no more selling at 2x', want: 'ask', say: /^I can only place orders, not promise not to sell\./ },
  { t: 'quit selling at 2x', want: 'ask', say: /^I can only place orders, not promise not to sell\./ },
  { t: 'no selling at 2x', want: 'ask', say: /^I can only place orders, not promise not to sell\./ },
  { t: 'not selling at 2x anymore', want: 'ask', say: /^I can only place orders, not promise not to sell\./, notSay: /didn't catch/ },
  { t: 'stop dumping at 600k', want: 'ask', say: /^I can only place orders, not promise not to sell\./, notSay: /stop loss/ },
  { t: 'cancel buying $3 at 500k', want: 'ask', say: /^To cancel a limit buy, say "cancel my buy"/ },
  { t: 'cancel the $3 buy at 500k', want: 'ask', say: /^To cancel a limit buy, say "cancel my buy"/ },
  { t: 'no buy at 500k', want: 'ask', say: /^I can only place orders, not promise not to buy\. To drop a limit buy, say "cancel my buy"/ },
  // ---- ask: a moonbag of no size is never 100% — how much to keep? (A number kept is taken off: see below.)
  { t: 'sell all but a moonbag at 5x', want: 'ask', say: /^How big a moonbag\? Say how much to sell, like "sell 90% at 5x" to keep 10%/ },
  { t: 'leave a moonbag and sell the rest at 5x', want: 'ask', say: /^How big a moonbag\?.*"sell 90% at 5x"/ },
  { t: 'keep a moonbag, sell rest at 5x', want: 'ask', say: /^How big a moonbag\?/ },
  { t: 'sell everything but my moonbag at 10x', want: 'ask', say: /^How big a moonbag\?.*"sell 90% at 10x"/ },
  { t: 'sell everything but keep a moonbag at 5x', want: 'ask', say: /^How big a moonbag\?/ },
  { t: 'sell all but a little at 5x', want: 'ask', say: /^How big a moonbag\?/ },
  { t: 'sell all except a moonbag at 5x', want: 'ask', say: /^How big a moonbag\?/, notSay: /\$EXCEPT/ },
  { t: 'sell everything but a moonbag at 3m', want: 'ask', say: /^How big a moonbag\?.*"sell 90% at 3m"/ },
  { t: 'sell all and keep a moonbag at 5x', want: 'ask', say: /^How big a moonbag\?/ },
  { t: 'tp 5x keep a moonbag', want: 'ask', say: /^How big a moonbag\?.*"tp 90% at 5x"/ },
  { t: 'sell all except a moonbag at 4x', want: 'ask', say: /^How big a moonbag\?/, notSay: /\$EXCEPT/ },
  { t: 'take everything off but a small bag at 3x', want: 'ask', say: /^How big a moonbag\?/, notSay: /\$SMALL/ },
  { t: 'sell all but a few at 5x', want: 'ask', say: /^How big a moonbag\?/, notSay: /\$FEW/ },
  { t: 'moonbag 10% at 10x', want: 'ask', say: /^Keep 10% as a moonbag, or sell 10% at 10x\? Say "sell 90% at 10x" to keep 10%, or "sell 10% at 10x"/, notSay: /^Guard|^Switch/ },
  { t: 'moon bag 10% at 10x', want: 'ask', say: /^Keep 10% as a moonbag, or sell 10% at 10x\?/ },
  // ---- sell-above: a number kept comes off what's sold ("keep 20%, sell the rest" = 80%); a moonbag after a size is what's left.
  { t: 'keep 20% sell the rest at 2x', want: 'sell-above', level: 'x 2', amount: 'pct 80', note: 'was "100% or 20%? try sell 100%"' },
  { t: 'keep 30% and sell the rest at 2x', want: 'sell-above', level: 'x 2', amount: 'pct 70' },
  { t: 'hold 25% sell rest at 3x', want: 'sell-above', level: 'x 3', amount: 'pct 75' },
  { t: 'keep a quarter sell the rest at 3x', want: 'sell-above', level: 'x 3', amount: 'pct 75' },
  { t: 'keep 1/3 sell the rest at 3x', want: 'sell-above', level: 'x 3', amount: 'pct 67' },
  { t: 'sell the rest but keep 10% at 2x', want: 'sell-above', level: 'x 2', amount: 'pct 90' },
  { t: 'sell all but like 10% at 5x', want: 'sell-above', level: 'x 5', amount: 'pct 90' },
  { t: 'keep 20% sell the rest at 3x', want: 'sell-above', level: 'x 3', amount: 'pct 80' },
  { t: 'leave 10% and sell the rest at 5x', want: 'sell-above', level: 'x 5', amount: 'pct 90' },
  { t: 'keep a 10% moonbag, sell the rest at 5x', want: 'sell-above', level: 'x 5', amount: 'pct 90' },
  { t: 'sell the rest but keep 10% at 10x', want: 'sell-above', level: 'x 10', amount: 'pct 90' },
  { t: 'sell 90% at 5x keep a moonbag', want: 'sell-above', level: 'x 5', amount: 'pct 90', note: 'the moonbag is the 10% kept — never a second size' },
  { t: 'sell half at 2x, keep the rest as a moonbag', want: 'sell-above', level: 'x 2', amount: 'pct 50' },
  { t: 'sell 80% at 5x and leave a moonbag', want: 'sell-above', level: 'x 5', amount: 'pct 80' },
  // ---- ask: a share of a share, of what's left or of the profit is never read as a share of the bag — the bag's share is offered.
  { t: 'sell half of half at 2x', want: 'ask', say: /^Half of half is 25% of your bag — say "sell 25% at 2x"\.$/ },
  { t: 'sell half of my half at 2x', want: 'ask', say: /is 25% of your bag — say "sell 25% at 2x"/ },
  { t: 'sell half of 50% at 2x', want: 'ask', say: /is 25% of your bag — say "sell 25% at 2x"/ },
  { t: 'sell 50% of half at 2x', want: 'ask', say: /is 25% of your bag — say "sell 25% at 2x"/ },
  { t: 'sell 1/2 of 1/2 at 2x', want: 'ask', say: /is 25% of your bag — say "sell 25% at 2x"/ },
  { t: 'sell 10% of half at 2x', want: 'ask', say: /^10% of half is 5% of your bag — say "sell 5% at 2x"\.$/, notSay: /sell 10% at/ },
  { t: 'sell a quarter of half at 2x', want: 'ask', say: /is 12\.5% of your bag — say "sell 12\.5% at 2x"/, notSay: /sell 50% at/ },
  { t: 'sell half of whats left at 3x', want: 'ask', say: /^Half of what's left is (?:50% of your \$HIGGS bag — say "sell 50% at 3x"|20% of your \$HIGGS bag \(your take-profits sell 60% already\) — say "sell 20% at 3x")\.$/, notSay: /\$LEFT/ },
  { t: 'sell half of the rest at 10x', want: 'ask', say: /^Half of what's left is (?:50%|20%) of your \$HIGGS bag.*say "sell (?:50|20)% at 10x"/ },
  { t: 'sell 50% of my profits at 2x', want: 'ask', say: /not of the profit — .* is about 25% of your bag\. Say "sell 25% at 2x"\.$/ },
  { t: 'sell 50% of my gains at 3x', want: 'ask', say: /is about 33% of your bag\. Say "sell 33% at 3x"\.$/ },
  { t: 'sell half my profits at 2x', want: 'ask', say: /is about 25% of your bag\. Say "sell 25% at 2x"\.$/ },
  { t: 'take 50% of profits at 2x', want: 'ask', say: /is about 25% of your bag\. Say "sell 25% at 2x"\.$/ },
  { t: 'sell half the gains at 3x', want: 'ask', say: /is about 33% of your bag\. Say "sell 33% at 3x"\.$/ },
  { t: 'sell my profits at 2x', want: 'ask', say: /the profit at 2x is about 50% of your bag\. Say "sell 50% at 2x"\.$/ },
  // ---- ask: "more than half", "almost all" — how much exactly? Never the size next to it.
  { t: 'sell more than half at 2x', want: 'ask', say: /^How much exactly is "more than half"\? Say a %, like "sell 60% at 2x"/ },
  { t: 'sell over half at 2x', want: 'ask', say: /^How much exactly is "over half"\?/ },
  { t: 'sell under half at 600k', want: 'ask', say: /^How much exactly is "under half"\? Say a %, like "sell 40% at 600k"/ },
  { t: 'sell less than half at 2x', want: 'ask', say: /^How much exactly is "less than half"\?/, notSay: /\$LESS/ },
  { t: 'sell almost all at 5x', want: 'ask', say: /^How much exactly is "almost all"\? Say a %, like "sell 90% at 5x"/, notSay: /\$ALMOST/ },
  { t: 'sell nearly everything at 5x', want: 'ask', say: /^How much exactly is "nearly everything"\?/, notSay: /\$NEARLY/ },
  { t: 'sell at least 40% at 2x', want: 'sell-above', level: 'x 2', amount: 'pct 40', note: 'was $LEAST' },
  { t: 'sell at most 40% at 2x', want: 'sell-above', level: 'x 2', amount: 'pct 40', note: 'was $MOST' },
  // ---- ask: "0.5 of my bag" — half, or 0.5%? (The card once said 0.3% and sent 0.25%.)
  { t: 'sell .5 of my bag at 2x', want: 'ask', say: /^Is "0\.5" half of your bag \(50%\), or 0\.5%\? Say "sell half at 2x" or "sell 0\.5% at 2x"\.$/ },
  { t: 'sell 0.5 of my bag at 2x', want: 'ask', say: /half of your bag \(50%\), or 0\.5%\?/ },
  { t: 'sell 0.25 of my bag at 3x', want: 'ask', say: /^Is "0\.25" a quarter of your bag \(25%\), or 0\.25%\? Say "sell 25% at 3x" or "sell 0\.25% at 3x"\.$/ },
  // ---- ask: a coin only compared with, or two coins at once
  { t: 'sell half at 2x like wif did', want: 'ask', say: /^Is \$WIF the coin, or just how it went before\? Say "sell half at 2x on WIF" for \$WIF — or "sell half at 2x" for the coin on screen\.$/ },
  { t: 'buy $3 at 500k like i did on wif', want: 'ask', say: /Say "buy \$3 at 500k on WIF" for \$WIF — or "buy \$3 at 500k" for the coin on screen/ },
  { t: 'sell half at 2x on this and wif', want: 'ask', say: /^One coin at a time — the one on screen, or \$WIF\?/ },
  // ---- an up-word ("recovers to", "bounces to") at a level below the price is a question, never a stop; never a coin called $RECOVERS
  { t: 'sell when it recovers to 600k', want: 'ask', level: 'mc 600000', say: /take-profit has to be above where it is now.*"sl at 600k"/, notSay: /\$RECOVERS/ },
  { t: 'sell half when it recovers to 600k', want: 'ask', level: 'mc 600000', amount: 'pct 50', say: /take-profit has to be above.*"sell 50% if it drops to 600k"/ },
  { t: 'sell half if it bounces to 600k', want: 'ask', level: 'mc 600000', amount: 'pct 50', say: /take-profit has to be above/, notSay: /\$BOUNCES/ },
  // ---- "the", "the rest", "what's left" said other ways — never a coin ($TEH, $LEFT, $REMAINDER)
  { t: 'sell teh rest at 5x', want: 'sell-above', level: 'x 5', amount: 'pct 100' },
  { t: 'sell th rest at 400k', want: 'stop-loss-rest', level: 'mc 400000', amount: 'pct 100' },
  { t: 'sell da rest at 5x', want: 'sell-above', level: 'x 5', amount: 'pct 100' },
  { t: 'sell what\'s left at 5x', want: 'sell-above', level: 'x 5', amount: 'pct 100' },
  { t: 'sell the remainder at 5x', want: 'sell-above', level: 'x 5', amount: 'pct 100' },
  { t: 'sell whatever is left at 5x', want: 'sell-above', level: 'x 5', amount: 'pct 100' },
  { t: 'sell remainder at 4m', want: 'sell-above', level: 'mc 4000000', amount: 'pct 100' },
  { t: 'sold half already, sell the rest at 5x', want: 'sell-above', level: 'x 5', amount: 'pct 100', note: 'what was sold is the reason — the rest is what is held now' },
  { t: 'sell two quarters at 2x', want: 'sell-above', level: 'x 2', amount: 'pct 50' },
  { t: 'halve my bag at 2x', want: 'sell-above', level: 'x 2', amount: 'pct 50' },
  { t: 'sell init at 2x', want: 'sell-above', level: 'x 2', amount: 'pct 50', note: '"init" = initials, never $INIT' },
  { t: 'pull initials at 2x', want: 'sell-above', level: 'x 2', amount: 'pct 50' },
  { t: 'sell50% at 2x', want: 'sell-above', level: 'x 2', amount: 'pct 50', note: 'missed space' },
  { t: 'sell half at 1.5mn', want: 'sell-above', level: 'mc 1500000', amount: 'pct 50', note: '"mn" = million' },
  { t: 'take initials at 1.5m', want: 'ask', say: /^Your initials at \$1\.5M MC are about 48% of your \$HIGGS bag .* — say "sell 48% at 1\.5m"\.$/ },
  // ---- dollars typed wrong — never a coin called $DOLARS
  { t: 'buy 5 dolars at 500k', want: 'limit-buy', level: 'mc 500000', amount: 'usd 5' },
  { t: 'buy 5 dollers at 500k', want: 'limit-buy', level: 'mc 500000', amount: 'usd 5' },
  { t: 'buy 5 buks at 500k', want: 'limit-buy', level: 'mc 500000', amount: 'usd 5' },
  { t: 'sl 3 dolars at 650k', want: 'sell-below', level: 'mc 650000', amount: 'usd 3', note: 'was a move of "stop 3" on $DOLARS' },
  // ---- what the coin does ("if it reclaims 1m", "once it prints 1m") is never the coin
  { t: 'sell half if it bounces to 1m', want: 'sell-above', level: 'mc 1000000', amount: 'pct 50' },
  { t: 'sell half if it rebounds to 1m', want: 'sell-above', level: 'mc 1000000', amount: 'pct 50' },
  { t: 'sell half if it reclaims 1m', want: 'sell-above', level: 'mc 1000000', amount: 'pct 50' },
  { t: 'buy $3 if it reclaims 1m', want: 'limit-buy', level: 'mc 1000000', amount: 'usd 3' },
  { t: 'buy $10 if it reclaims 1m', want: 'limit-buy', level: 'mc 1000000', amount: 'usd 10' },
  { t: 'sell half if it flips 1m', want: 'sell-above', level: 'mc 1000000', amount: 'pct 50' },
  { t: 'sell half when it touches 1m', want: 'sell-above', level: 'mc 1000000', amount: 'pct 50' },
  { t: 'sell half when it tags 1m', want: 'sell-above', level: 'mc 1000000', amount: 'pct 50' },
  { t: 'sell half once it prints 1m', want: 'sell-above', level: 'mc 1000000', amount: 'pct 50' },
  { t: 'sell half if it flies to 1m', want: 'sell-above', level: 'mc 1000000', amount: 'pct 50' },
  { t: 'sell half if it wicks to 600k', want: 'sell-below', level: 'mc 600000', amount: 'pct 50', note: '50% ≈ $2.07 at that level — over fomo\'s $2 minimum, but a partial stop needs 5% of room (it can fill lower): run.ts refuses with "try at least 51%"' },
  { t: 'sell 25% on a long wick down to 600k', want: 'sell-below', level: 'mc 600000', amount: 'pct 25', note: '25% is under fomo\'s minimum there; run.ts refuses with "try at least 51%"' },
  { t: 'sell half if it slips to 600k', want: 'sell-below', level: 'mc 600000', amount: 'pct 50', note: '50% ≈ $2.07 at that level — over fomo\'s $2 minimum, but a partial stop needs 5% of room (it can fill lower): run.ts refuses with "try at least 51%"' },
  { t: 'sell half if it closes below 600k', want: 'sell-below', level: 'mc 600000', amount: 'pct 50', note: '50% ≈ $2.07 at that level — over fomo\'s $2 minimum, but a partial stop needs 5% of room (it can fill lower): run.ts refuses with "try at least 51%"' },
  { t: 'sell all if it closes under 500k', want: 'stop-loss-rest', level: 'mc 500000', amount: 'pct 100' },
  { t: 'buy $3 if it gets dumped to 500k', want: 'limit-buy', level: 'mc 500000', amount: 'usd 3' },
  { t: 'buy $3 if it cuts to 500k', want: 'limit-buy', level: 'mc 500000', amount: 'usd 3' },
  { t: 'buy $3 when it trims down to 500k', want: 'limit-buy', level: 'mc 500000', amount: 'usd 3' },
  { t: 'buy $3 when it bails to 500k', want: 'limit-buy', level: 'mc 500000', amount: 'usd 3' },
  // ---- the crowd moves the price ("when whales dump it to 500k") — never a coin called $WHALES or $JEETS
  { t: 'sell half when buyers push it to 1m', want: 'sell-above', level: 'mc 1000000', amount: 'pct 50' },
  { t: 'sell half when everyone apes in at 2x', want: 'sell-above', level: 'x 2', amount: 'pct 50' },
  { t: 'buy $3 if sellers push it to 500k', want: 'limit-buy', level: 'mc 500000', amount: 'usd 3' },
  { t: 'buy $3 when whales dump it to 500k', want: 'limit-buy', level: 'mc 500000', amount: 'usd 3' },
  { t: 'buy $3 if someone exits at 500k', want: 'limit-buy', level: 'mc 500000', amount: 'usd 3' },
  { t: 'buy $3 once the dumpers are out at 500k', want: 'limit-buy', level: 'mc 500000', amount: 'usd 3' },
  { t: 'ape $3 when jeets dump to 500k', want: 'limit-buy', level: 'mc 500000', amount: 'usd 3' },
  { t: 'buy $3 when paper hands sell at 500k', want: 'limit-buy', level: 'mc 500000', amount: 'usd 3', note: '"paper" here is paper hands, not paper trading' },
  // ---- "a 30% dump", "a 50% hit": how far it falls
  { t: 'sell half on a 30% dump', want: 'sell-below', level: 'pct -30', amount: 'pct 50', note: '50% ≈ $1.74 at that level — under fomo\'s $2 minimum; run.ts refuses with "try at least 61%"' },
  { t: 'sell half on a 50% dump', want: 'sell-below', level: 'pct -50', amount: 'pct 50', note: '50% ≈ $1.24 at 0.5x — under fomo\'s $2 minimum; run.ts refuses with "try at least 85%"' },
  { t: 'sell half if it takes a 50% hit', want: 'sell-below', level: 'pct -50', amount: 'pct 50', note: '50% ≈ $1.24 at 0.5x — under fomo\'s $2 minimum; run.ts refuses with "try at least 85%"' },
  { t: 'buy $3 if it takes a 30% hit', want: 'limit-buy', level: 'pct -30', amount: 'usd 3' },
  // ---- trail: "from the top", "from ath", "below the peak" is a trailing stop — never a fixed stop from now or the entry
  { t: 'sell everything if it dumps 30% from the top', want: 'trail', amount: 'pct 30' },
  { t: 'sl 25% from the top', want: 'trail', amount: 'pct 25' },
  { t: 'sell all if it drops 50% from ath', want: 'trail', amount: 'pct 50', note: 'was $ATH' },
  { t: 'sell if it drops 20% from ath', want: 'trail', amount: 'pct 20' },
  { t: 'sell all if it drops 40% from the peak', want: 'trail', amount: 'pct 40' },
  { t: 'sell all 30% below peak', want: 'trail', amount: 'pct 30' },
  { t: 'stop 20% below the high', want: 'trail', amount: 'pct 20' },
  { t: 'sell everything if it retraces 30% from the high', want: 'trail', amount: 'pct 30' },
  { t: 'sell everything if it falls 25% off the high', want: 'trail', amount: 'pct 25' },
  { t: 'trailing sl 20%', want: 'trail', amount: 'pct 20' },
  { t: 'sl 30% trailing', want: 'trail', amount: 'pct 30' },
  { t: 'trailing sl 25% from the top', want: 'trail', amount: 'pct 25' },
  { t: 'trail 25% from ath', want: 'trail', amount: 'pct 25' },
  { t: 'sell half if it drops 20% from the top', want: 'ask', say: /^My trailing stop sells the rest, not part of it — say "trail 20%".* or "sell half if it drops 20%"/, notSay: /575K/ },
  // ---- trader shorthand around a buy or a sell — never the coin ($EXP, $TTL, $LMT, $SUPPORT, $RETEST, $RESISTANCE, $BOUNCE, $GL)
  { t: 'buy $10 at 400k exp 12h', want: 'limit-buy', level: 'mc 400000', amount: 'usd 10' },
  { t: 'buy $10 at 400k exp. 6h', want: 'limit-buy', level: 'mc 400000', amount: 'usd 10' },
  { t: 'buy $10 at 400k ttl 6h', want: 'limit-buy', level: 'mc 400000', amount: 'usd 10' },
  { t: 'lmt buy $10 at 400k', want: 'limit-buy', level: 'mc 400000', amount: 'usd 10' },
  { t: 'buy $10 at 400k support', want: 'limit-buy', level: 'mc 400000', amount: 'usd 10' },
  { t: 'buy $10 at 400k on the retest', want: 'limit-buy', level: 'mc 400000', amount: 'usd 10' },
  { t: 'sell half at the 1m resistance', want: 'sell-above', level: 'mc 1000000', amount: 'pct 50' },
  { t: 'sell 50% at 2x on the bounce', want: 'sell-above', level: 'x 2', amount: 'pct 50' },
  { t: 'sell half at 2x gl', want: 'sell-above', level: 'x 2', amount: 'pct 50' },
  { t: 'take profit before the dip at 1m', want: 'sell-above', level: 'mc 1000000', note: '"before the dip" is the reason — it said "take-profits go above the price" for a level above it' },
  // ---- ask: slippage, fees and MEV are fomo's — never a size, a level or a coin
  { t: 'sell half at 2x mev protect', want: 'ask', say: /^I don't set slippage, priority fees or MEV protection.*Say "sell half at 2x" for the order itself\.$/ },
  { t: 'sell 50% at 2x slippage 15%', want: 'ask', say: /Say "sell 50% at 2x" for the order itself/, notSay: /15%/ },
  { t: 'sell 50% at 2x with 20% slippage', want: 'ask', say: /Say "sell 50% at 2x" for the order itself/ },
  { t: 'buy $10 at 400k slippage 20%', want: 'ask', say: /Say "buy \$10 at 400k" for the order itself/, notSay: /dip or a/ },
  { t: 'buy $10 at 400k slip 10', want: 'ask', say: /Say "buy \$10 at 400k" for the order itself/ },
  { t: 'sell 50% at 2x priority fee 0.001', want: 'ask', say: /Say "sell 50% at 2x" for the order itself/, notSay: /two levels/ },
  // ---- show, pause and cancel said the short way
  { t: 'open orders', want: 'show' },
  { t: 'pending orders', want: 'show' },
  { t: 'active orders', want: 'show' },
  { t: 'what\'s my trail', want: 'show', note: 'was "how far below the top should it sell?"' },
  { t: 'what\'s set on popcat', want: 'show', coin: 'POPCAT' },
  { t: 'bids?', want: 'show' },
  { t: 'pos', want: 'show' },
  { t: 'pause bot', want: 'pause', note: 'was "I\'m not guarding $BOT"' },
  { t: 'pause the bot', want: 'pause' },
  { t: 'cxl buy', want: 'cancel-buy' },
  { t: 'cancel limit', want: 'cancel-buy' },
  { t: 'move my limit to 250k', want: 'move', level: 'mc 250000', target: 'buy' },
  { t: 'stop all orders', want: 'ask', say: /^Pause everything, or cancel something\?/ },
  { t: 'clear my stops', want: 'ask', say: /^Which stop\?/, note: 'removed only the stop loss' },
  { t: 'delete my buys', want: 'ask', say: /^This coin's buys, or all of them\?/, note: 'cancelled only the $HIGGS buy' },
  { t: 'stop loss at 70% of current', want: 'ask', say: /^70% of where \$HIGGS is now \(\$719K MC\) is \$503K MC — 30% below\. Say "sl at 503k"/, notSay: /-70%/ },
  // ---- the wording pass: every example is the user's own order, for the right side
  { t: 'short 50% at 1m', want: 'ask', say: /To sell yours at 1m, say "sell 50% at 1m"\.$/, notSay: /sell all at 50/ },
  { t: 'sell half at -0.5x', want: 'ask', say: /or 1\.5x up\? Say "sell half if it drops 50%" for down, or "sell half at 1\.5x" for up\.$/, notSay: /at 0\.5x" for up/ },
  { t: 'sl 25% at 2x', want: 'ask', level: 'x 2', amount: 'pct 25', say: /A stop has to be below where it is now\. \$HIGGS is at \$719K MC\. To sell 25% on the way up, say "sell 25% at 2x" — for a stop, pick a level below, like "sell 25% if it drops 50%"\./ },
  { t: 'sell half if it tanks to 2x', want: 'ask', level: 'x 2', amount: 'pct 50', say: /say "sell half at 2x" — for a stop, pick a level below, like "sell half if it drops 50%"/ },
  { t: 'sell half if it goes down to 1m', want: 'ask', level: 'mc 1000000', amount: 'pct 50', say: /say "sell half at 1m" — for a stop, pick a level below/ },
  { t: 'sell half on a dip to 1m', want: 'ask', level: 'mc 1000000', amount: 'pct 50', say: /say "sell half at 1m" — for a stop/ },
  { t: 'tp 20% at 20%', want: 'sell-above', level: 'pct 20', amount: 'pct 20', note: 'with tp an unsigned % after "at" is up. 20% ≈ $1.19 there — under fomo\'s $2 minimum; run.ts refuses with "try at least 34%"' },
  { t: 'sell 50/50 at 2x', want: 'ask', say: /^Is "50\/50" half\? Say "sell half at 2x"/, notSay: /50k/ },
  { t: 'sell $1m at 2x', want: 'ask', level: 'x 2', amount: 'usd 1000000', say: /^\$1M is more than your whole \$HIGGS bag would be worth at \$1\.44M MC.*say "sell all at 2x"\.$/, notSay: /dollars or coins/ },
  { t: 'sell 90-100% at 5x', want: 'ask', say: /^I sell one size, not a range — say one, like "sell 90% at 5x"\.$/, notSay: /2x|drop 100%/ },
  { t: 'sell 40-50% at 2x', want: 'ask', say: /^I sell one size, not a range — say one, like "sell 40% at 2x"\.$/, notSay: /two levels/ },
  { t: 'sell 50%-60% at 2x', want: 'ask', say: /^I sell one size, not a range/, notSay: /two levels/ },
  { t: 'buy $3-5 at 500k', want: 'ask', say: /^How much — \$3 or \$5\? Say one amount, like "buy \$3 at 500k"\.$/ },
  { t: 'buy $3 to $5 at 500k', want: 'ask', say: /^How much — \$3 or \$5\?/, notSay: /two levels/ },
  { t: 'sell 50 at 50%', want: 'ask', say: /^Is "50" 50% of your bag or \$50 — and up 50% or down 50%\?/, notSay: /sell all/ },
  { t: 'sell half at 2x by 5pm', want: 'ask', say: /Say "sell half at 2x" to set it now\.$/, notSay: /5pm|25%/ },
  { t: 'sell half of $2X at 3x', want: 'ask', say: /^Is \$2X the coin\?.*say "sell half at 3x" there\.$/ },
  { t: 'no stop loss at 500k', want: 'ask', say: /^Remove it, or move it\? Say "remove my stop" — or "move my stop to 500k"\.$/, notSay: /2m/ },
  { t: 'no sl at 500k', want: 'ask', say: /"move my stop to 500k"/, notSay: /2m/ },
  { t: 'no stop at 600k', want: 'ask', say: /"move my stop to 600k"/, notSay: /2m/ },
  { t: 'remove my stop at 600k', want: 'ask', say: /^Remove it, or move it\? Say "remove my stop"/, notSay: /2m/ },
  { t: 'instead of half sell a third at 2x', want: 'ask', say: /^A third, not half\? Say "sell a third at 2x"/, notSay: /50%/ },
  { t: 'sell half at 2x no wait a third', want: 'ask', say: /^A third, not half\? Say "sell a third at 2x"/ },
  { t: 'tp 2x sl -50%', want: 'ask', say: /^One thing at a time, please! Try "tp at 2x" first, then "sl -50%"\.$/ },
  { t: 'SL -25% / TP 2x', want: 'ask', say: /Try "tp at 2x" first, then "sl -25%"/, notSay: /-30%/ },
  { t: 'buy $10 at 400k and set tp 2x', want: 'ask', say: /^One thing at a time: place the buy.*"buy \$10 at 400k then protect with classic"/, notSay: /move tp1/ },
  { t: 'sell 50% in 2 hours', want: 'ask', say: /at what level\? Say "sell 50% at 2x"/ },
  { t: 'buy $10 at 400k til tomorrow', want: 'ask', say: /Say "buy \$10 at 400k" to place it now\.$/, notSay: /til"/ },
  { t: 'sell 50% at 100%', want: 'ask', say: /^Is "100%" up 100% \(2x\)\? Say "sell half at \+100%"\.$/, notSay: /1x/ },
];

// ---- The setup -----------------------------------------------------------------

const SOL = 1399811149;
const PRICE = 0.000719;
const MC = 719_000;
/** 6,926.3 tokens × $0.000719 = $4.98. */
const BAG = 6926.3;

/** Another coin's bag ($719): the corpus only says its price is the same, and the trader's $4.98 is $HIGGS's. */
const OTHER_BAG = 1_000_000;
const coinOf = (symbol: string, balance = BAG): ChatCoin => ({ key: `${symbol}111:${SOL}`, address: `${symbol}111`, networkId: SOL, symbol, name: symbol, priceUSD: PRICE, mc: MC, balance });

let calls: { fn: keyof ChatApi; args: unknown[] }[] = [];

function api(): ChatApi {
  const rec =
    (fn: keyof ChatApi) =>
    async (...args: unknown[]): Promise<CommandResult> => {
      calls.push({ fn, args });
      return { ok: true };
    };
  return {
    arm: rec('arm'),
    update: rec('update'),
    pause: rec('pause'),
    resume: rec('resume'),
    cancel: rec('cancel'),
    armBuy: rec('armBuy'),
    cancelBuy: rec('cancelBuy'),
    moveBuy: rec('moveBuy'),
    practice: rec('practice'),
    setSettings: rec('setSettings'),
    pauseAll: rec('pauseAll'),
  };
}

/** `onScreen` is the coin the trader is looking at (its bag is `balance`); every other coin has a $719 bag. */
function ctxWith(balance: number, plans: Plan[], buys: BuyOrder[], onScreen = 'HIGGS'): ChatCtx {
  const state = { plans, buys, settings: withDefaults(undefined) };
  return {
    coin: coinOf(onScreen, balance),
    ...state,
    latest: () => state,
    minBuyUsd: () => 2,
    minSellUsd: () => 2,
    cash: 50,
    resolveCoin: async (symbol) => coinOf(symbol.toUpperCase(), symbol.toUpperCase() === onScreen ? balance : OTHER_BAG),
    fetchCoin: async (key) => {
      const symbol = key.replace(/111:.*$/, '');
      return coinOf(symbol, symbol === onScreen ? balance : OTHER_BAG);
    },
    api: api(),
  };
}

const COINS = ['HIGGS', 'CLAUDIA', 'WIF', 'BONK', 'POPCAT'];
/** A running plan bought at the price now: TP1 1.5x, TP2 4.5x, TP3 8x, stop 1 −5%, stop 2 −15%, SL −50%, trail 20% after 2x. */
function planOn(symbol: string): Plan {
  const c = coinOf(symbol, 1_000_000);
  const input: PlanInput = {
    id: `plan-${symbol}`,
    key: c.key,
    networkId: SOL,
    address: c.address,
    symbol,
    name: symbol,
    entry: { priceUSD: PRICE, mc: MC, source: 'armed-at' },
    balance: 1_000_000,
    tps: [1.5, 4.5, 8].map((value) => ({ trigger: { kind: 'x' as const, value }, sellPct: 20 })),
    stops: [0.95, 0.85].map((value) => ({ trigger: { kind: 'x' as const, value }, sellPct: 10 })),
    sl: { trigger: { kind: 'x', value: 0.5 } },
    trailing: { trailPct: 20, activateX: 2 },
    origin: 'manual',
    now: 1,
  };
  return buildPlan(input);
}
function buyOn(symbol: string): BuyOrder {
  const c = coinOf(symbol);
  const input: BuyInput = {
    id: `buy-${symbol}`,
    key: c.key,
    networkId: SOL,
    address: c.address,
    symbol,
    name: symbol,
    trigger: { kind: 'mc', value: 300_000 },
    ref: { priceUSD: PRICE, mc: MC, source: 'armed-at' },
    usd: 10,
    guardPresetId: null,
    expiresInMs: DEFAULT_BUY_EXPIRY_MS,
    now: Date.now(),
  };
  return buildBuy(input);
}

/** No plans, no buys, a $4.98 bag: where new orders are placed. */
const fresh = () => ctxWith(BAG, [], []);
/** Every coin already has a plan and a limit buy (and a $719 bag): where orders are moved, removed, cancelled. */
const managed = () => ctxWith(1_000_000, COINS.map(planOn), COINS.map(buyOn));

// ---- What Tippy understood, in the corpus's words ----------------------------------

interface Outcome {
  want: Want;
  level: string;
  amount: string;
  coin: string;
  target?: string;
}

/** A level as a multiple of the price now (no plan yet: "x" is from now too). */
function relNow(l: LevelSpec): number {
  switch (l.kind) {
    case 'mc':
      return l.value / MC;
    case 'price':
      return l.value / PRICE;
    case 'x':
      return l.value;
    case 'pct':
      return 1 + l.value / 100;
  }
}

const levelOf = (l: LevelSpec) => `${l.kind} ${l.value}`;
const coinName = (c: object) => ('symbol' in c ? String((c as { symbol: string }).symbol).toUpperCase() : '');

function amountOf(i: { sellPct: number | null; sellUsd?: number | null }): string {
  if (i.sellUsd != null) return `usd ${i.sellUsd}`;
  return i.sellPct != null ? `pct ${i.sellPct}` : '';
}

function targetOf(t: { kind: string; index?: number }): string {
  return t.index != null ? `${t.kind}${t.index}` : t.kind;
}

function outcome(i: Intent): Outcome | null {
  switch (i.type) {
    case 'add-tp': {
      const rel = relNow(i.level);
      const amount = amountOf(i);
      // "sell … at <level>" with no direction: a take-profit above the price now, below it a stop.
      if (i.anySide && rel < 1) {
        const all = i.sellUsd == null && (i.sellPct == null || i.sellPct >= 100);
        return { want: all ? 'stop-loss-rest' : 'sell-below', level: levelOf(i.level), amount: all ? '' : amount, coin: coinName(i.coin) };
      }
      return { want: 'sell-above', level: levelOf(i.level), amount, coin: coinName(i.coin) };
    }
    case 'add-stop':
      return { want: 'sell-below', level: levelOf(i.level), amount: amountOf(i), coin: coinName(i.coin) };
    case 'set-sl':
      return { want: 'stop-loss-rest', level: levelOf(i.level), amount: '', coin: coinName(i.coin) };
    case 'set-trail':
      return { want: 'trail', level: i.afterX != null ? `x ${i.afterX}` : '', amount: `pct ${i.trailPct}`, coin: coinName(i.coin) };
    case 'limit-buy':
      return { want: 'limit-buy', level: levelOf(i.level), amount: `usd ${i.usd}`, coin: coinName(i.coin) };
    case 'move':
      return { want: 'move', level: levelOf(i.level), amount: '', coin: coinName(i.coin), target: targetOf(i.target) };
    case 'remove-level':
      return { want: 'remove', level: '', amount: '', coin: coinName(i.coin), target: targetOf(i.target) };
    case 'cancel-buy':
      return { want: 'cancel-buy', level: '', amount: '', coin: coinName(i.coin) };
    case 'show':
      return { want: 'show', level: '', amount: '', coin: coinName(i.coin) };
    case 'pause':
      return { want: 'pause', level: '', amount: '', coin: coinName(i.coin) };
    case 'practice':
      return { want: 'practice', level: '', amount: i.usd != null ? `usd ${i.usd}` : '', coin: coinName(i.coin) };
    case 'setting':
      return { want: 'setting', level: '', amount: '', coin: '' };
    default:
      return null;
  }
}

/** The corpus's expectation in the same shape (the stop loss sells the rest: "all" is no extra amount). */
function expected(c: Case): Outcome {
  const amount = c.want === 'stop-loss-rest' && c.amount === 'pct 100' ? '' : (c.amount ?? '');
  const out: Outcome = { want: c.want, level: c.level ?? '', amount, coin: c.coin ?? '' };
  if (c.target) out.target = c.target;
  return out;
}

// ---- What the tapped card sends -----------------------------------------------------

/** The trigger the engine gets for a corpus level (a move "−20%" becomes 0.8x of now). */
function triggerOf(level: string): Trigger {
  const [kind, raw] = level.split(' ');
  const v = Number(raw);
  if (kind === 'pct') return { kind: 'x', value: 1 + v / 100 };
  return { kind: kind as Trigger['kind'], value: v };
}

function expectTrigger(got: Trigger | undefined, level: string, msg: string) {
  const want = triggerOf(level);
  expect(got?.kind, msg).toBe(want.kind);
  expect(got!.value / want.value, msg).toBeCloseTo(1, 6);
}

/** The level's price — what a $ amount on a sell is converted at ("x" is from now: no plan yet). */
function priceAt(level: string): number {
  const t = triggerOf(level);
  return t.kind === 'price' ? t.value : t.kind === 'mc' ? (t.value / MC) * PRICE : t.value * PRICE;
}
const bagOf = (c: Case) => (c.coin && c.coin !== 'HIGGS' ? OTHER_BAG : BAG);

/** The % of the bag a sell sends, from the corpus amount — dollars are worked out at the level's price. */
function pctOf(c: Case): number | null {
  if (!c.amount) return null;
  const [kind, raw] = c.amount.split(' ');
  if (kind === 'pct') return Number(raw);
  return (Number(raw) / (bagOf(c) * priceAt(c.level!))) * 100;
}

/** "$3", "$2.50" — how the card writes a dollar size. */
const dollars = (n: number) => (Number.isInteger(n) ? `$${n}` : `$${n.toFixed(2)}`);

/** Every trigger in a sent command (an edit's levels, a moved buy's level). */
function triggersIn(args: unknown[]): Trigger[] {
  const out: Trigger[] = [];
  const walk = (v: unknown) => {
    if (!v || typeof v !== 'object') return;
    const o = v as Record<string, unknown>;
    if (typeof o.kind === 'string' && typeof o.value === 'number') out.push(o as unknown as Trigger);
    else Object.values(o).forEach(walk);
  };
  walk(args);
  return out;
}

async function card(text: string, ctx: ChatCtx): Promise<{ intent: Intent; plan: ChatPlan }> {
  calls = [];
  const intent = parse(text);
  const plan = await planIntent(intent, ctx);
  expect(calls, `${text}: planning sends nothing`).toEqual([]);
  return { intent, plan };
}

const refuses = (c: Case) => /\brefuses\b|never oversell/.test(c.note ?? '');
/** The reply says what the corpus says it must (and nothing it must not). */
function wording(c: Case, say: string) {
  if (c.say) expect(say, c.t).toMatch(c.say);
  if (c.notSay) expect(say, c.t).not.toMatch(c.notSay);
}
const groups = (w: Want) => CORPUS.filter((c) => c.want === w);

// ---- The tests ---------------------------------------------------------------------

describe('the chat corpus', () => {
  it('has every case once', () => {
    expect(CORPUS).toHaveLength(1094);
    expect(new Set(CORPUS.map((c) => c.t)).size).toBe(CORPUS.length);
  });

  describe.each(['sell-above', 'sell-below', 'stop-loss-rest'] as const)('%s', (want) => {
    it.each(groups(want).map((c) => [c.t, c] as const))('%s', async (text, c) => {
      const { intent, plan } = await card(text, fresh());
      expect(outcome(intent), JSON.stringify(intent)).toEqual(expected(c));
      wording(c, plan.say);
      if (refuses(c)) {
        expect(plan.confirm, plan.say).toBeUndefined();
        expect(plan.warn, plan.say).toBe(true);
        const least = c.note!.match(/try at least (\d+%|\$\d+\.\d\d)/);
        if (least) expect(plan.say).toContain(`Try at least ${least[1]}`);
        const worth = c.note!.match(/≈(\$\d+\.\d\d)\)/);
        if (worth) expect(plan.say).toContain(worth[1]);
        return;
      }
      expect(plan.confirm, plan.say).toBeTruthy();
      calls = [];
      const res = await plan.confirm!.run();
      expect(res, plan.say).toMatchObject({ ok: true });
      expect(calls.map((x) => x.fn)).toEqual(['arm']);
      const input = calls[0].args[0] as Omit<PlanInput, 'id' | 'now'>;
      expect(input.symbol).toBe(c.coin ?? 'HIGGS');
      const stops = input.stops ?? [];
      if (want === 'stop-loss-rest') {
        expect([input.tps.length, stops.length]).toEqual([0, 0]);
        expectTrigger(input.sl?.trigger, c.level!, text);
        return;
      }
      const lv = want === 'sell-above' ? input.tps : stops;
      expect([input.tps.length, stops.length, input.sl]).toEqual(want === 'sell-above' ? [1, 0, null] : [0, 1, null]);
      expectTrigger(lv[0].trigger, c.level!, text);
      // No size on a first take-profit sells the whole bag (the card says so).
      expect(lv[0].sellPct, `${text}: sells ${lv[0].sellPct}%`).toBeCloseTo(pctOf(c) ?? 100, 3);
      if (c.amount?.startsWith('usd')) {
        const usd = Number(c.amount.split(' ')[1]);
        // Never less than the dollars said, at the level's price — and the card says both.
        expect((lv[0].sellPct / 100) * bagOf(c) * priceAt(c.level!)).toBeGreaterThanOrEqual(usd - 1e-9);
        expect(plan.say).toMatch(new RegExp(`\\${dollars(usd)} ≈ [\\d.]+% of your bag`));
      }
    });
  });

  // "25% from the top", "from ath", "trailing sl 20%": a trailing stop that sells the rest — never a fixed stop.
  describe('trail', () => {
    it.each(groups('trail').map((c) => [c.t, c] as const))('%s', async (text, c) => {
      const { intent, plan } = await card(text, fresh());
      expect(outcome(intent), JSON.stringify(intent)).toEqual(expected(c));
      wording(c, plan.say);
      expect(plan.confirm, plan.say).toBeTruthy();
      calls = [];
      expect(await plan.confirm!.run(), plan.say).toMatchObject({ ok: true });
      expect(calls.map((x) => x.fn)).toEqual(['arm']);
      const input = calls[0].args[0] as Omit<PlanInput, 'id' | 'now'>;
      expect([input.tps.length, (input.stops ?? []).length, input.sl]).toEqual([0, 0, null]);
      expect(input.trailing).toEqual({ trailPct: Number(c.amount!.split(' ')[1]), activateX: c.level ? Number(c.level.split(' ')[1]) : null });
    });
  });

  describe('limit-buy', () => {
    it.each(groups('limit-buy').map((c) => [c.t, c] as const))('%s', async (text, c) => {
      const { intent, plan } = await card(text, fresh());
      expect(outcome(intent), JSON.stringify(intent)).toEqual(expected(c));
      wording(c, plan.say);
      expect(plan.confirm, plan.say).toBeTruthy();
      expect(plan.confirm!.label).toBe('Place buy');
      calls = [];
      expect(await plan.confirm!.run(), plan.say).toMatchObject({ ok: true });
      expect(calls.map((x) => x.fn)).toEqual(['armBuy']);
      const input = calls[0].args[0] as Omit<BuyInput, 'id' | 'now'>;
      expect(input.symbol).toBe(c.coin ?? 'HIGGS');
      expectTrigger(input.trigger, c.level!, text);
      expect(input.usd).toBe(Number(c.amount!.split(' ')[1]));
    });
  });

  describe.each([
    ['move', ['update', 'moveBuy']],
    ['remove', ['update']],
    ['cancel-buy', ['cancelBuy']],
    ['pause', ['pause', 'pauseAll', 'resume']],
    ['practice', ['practice']],
    ['setting', ['setSettings']],
  ] as const)('%s', (want, fns) => {
    it.each(groups(want).map((c) => [c.t, c] as const))('%s', async (text, c) => {
      const { intent, plan } = await card(text, managed());
      expect(outcome(intent), JSON.stringify(intent)).toEqual(expected(c));
      expect(plan.warn, plan.say).toBeFalsy();
      // Some settings / resumes are already that way: a plain answer, no card.
      if (!plan.confirm) {
        expect(['pause', 'setting'], plan.say).toContain(want);
        return;
      }
      calls = [];
      expect(await plan.confirm.run(), plan.say).toMatchObject({ ok: true });
      expect(calls.length).toBeGreaterThan(0);
      for (const call of calls) expect(fns as readonly string[]).toContain(call.fn);
      if (c.level) {
        const at = triggerOf(c.level);
        expect(
          triggersIn(calls[0].args).some((t) => t.kind === at.kind && Math.abs(t.value / at.value - 1) < 1e-6),
          `${text}: sends ${JSON.stringify(calls[0].args)}`,
        ).toBe(true);
      }
    });
  });

  describe('show', () => {
    it.each(groups('show').map((c) => [c.t, c] as const))('%s', async (text, c) => {
      const { intent, plan } = await card(text, managed());
      expect(outcome(intent), JSON.stringify(intent)).toEqual(expected(c));
      expect(plan.confirm).toBeUndefined();
      expect(plan.warn, plan.say).toBeFalsy();
    });
  });

  // Misreads that only showed on a running plan: "<n> bucks" after tp / stop moved TP<n> / stop <n>.
  describe('on a running plan, "<n> bucks" is an amount — it adds a level, never moves TP<n> / stop <n>', () => {
    it.each([
      ['tp 2 bucks at 2x', 'add-tp', 2],
      ['tp 3 dollars at 3m', 'add-tp', 3],
      ['sl 3 bucks 600k', 'add-stop', 3],
      ['stop 2 dollars at 600k', 'add-stop', 2],
      ['sl 2 usd at 650k', 'add-stop', 2],
      ['sl 1 buck 650k', 'add-stop', 1],
      ['tp 5 bucks 2m', 'add-tp', 5],
    ] as const)('%s', async (text, type, usd) => {
      const ctx = managed();
      const { intent, plan } = await card(text, ctx);
      expect(intent).toMatchObject({ type, sellUsd: usd });
      expect(plan.say).not.toMatch(/\bMove\b/);
      if (!plan.confirm) {
        // Too small for a stop: fomo's minimum, said in dollars.
        expect(plan.say).toMatch(/Try at least \$2\.10/);
        return;
      }
      calls = [];
      expect(await plan.confirm.run(), plan.say).toMatchObject({ ok: true });
      const [, edit] = calls[0].args as [string, { tps: unknown[]; stops: unknown[] }];
      const before = ctx.plans.find((p) => p.symbol === 'HIGGS')!;
      if (type === 'add-tp') expect(edit.tps).toHaveLength(before.tps.length + 1);
      else expect(edit.stops).toHaveLength(before.stops.length + 1);
    });

    it('"sl at 30% of entry" moves the stop loss to 0.3x the entry — "30% of" is the level, not a size', async () => {
      const { intent, plan } = await card('sl at 30% of entry', managed());
      expect(intent).toMatchObject({ type: 'set-sl', level: { kind: 'x', value: 0.3 } });
      calls = [];
      expect(await plan.confirm!.run(), plan.say).toMatchObject({ ok: true });
      expect(triggersIn(calls[0].args)).toContainEqual({ kind: 'x', value: 0.3 });
    });
  });

  // A plan bought lower (entry $500K, the coin now at $719K): breakeven is a real level, and "1.2x" is already behind.
  describe('on a plan bought at $500K MC', () => {
    const boughtLower = () => {
      const plan = planOn('HIGGS');
      return ctxWith(1_000_000, [{ ...plan, entry: { ...plan.entry, priceUSD: 0.0005, mc: 500_000 } }], []);
    };
    it.each(['sl be', 'sl be pls', 'sl breakeven'])('"%s" moves the stop loss to the entry', async (text) => {
      const { intent, plan } = await card(text, boughtLower());
      expect(intent).toMatchObject({ type: 'set-sl', level: { kind: 'x', value: 1 } });
      expect(plan.say).toContain('$500K MC');
      calls = [];
      expect(await plan.confirm!.run(), plan.say).toMatchObject({ ok: true });
      expect(triggersIn(calls[0].args)).toContainEqual({ kind: 'x', value: 1 });
    });
    it('"sell 10% at 1.2x" asks — a stop at 1.2x the entry ($600K MC, below now), or 1.2x from now?', async () => {
      const { plan } = await card('sell 10% at 1.2x', boughtLower());
      expect(plan.confirm).toBeUndefined();
      expect(plan.warn).toBe(true);
      expect(plan.say).toContain('$600K MC');
      expect(plan.say).toContain('"sell 10% if it drops to 1.2x"');
      expect(plan.say).toContain('"sell 10% at 863k"');
    });
  });

  // The wording pass: replies that only show on a running plan, a plan bought higher, or with little cash.
  describe('replies that name the real problem, with an example to copy', () => {
    it.each(['sell all at 3m', 'sell everything at 3m'])('"%s" on a plan whose take-profits sell 60% already: "all" is offered as the other 40%, never assumed', async (text) => {
      const { plan } = await card(text, managed());
      expect(plan.confirm).toBeUndefined();
      expect(plan.say).toBe('Your take-profits on $HIGGS already sell 60% of the bag, so "all" here is the other 40%. Say "sell 40% at 3m" — or remove a take-profit first.');
      // The example it offers is a card for exactly that.
      const offered = await card('sell 40% at 3m', managed());
      expect(offered.plan.say).toMatch(/^Add TP\d on \$HIGGS: sell 40% of your bag at \$3M MC/);
    });

    it('"sell half at 2x" past the room left says how much there is room for, as a message to copy', async () => {
      const { plan } = await card('sell half at 2x', managed());
      expect(plan.say).toBe('That would sell 110% of your $HIGGS bag — there\'s room for 40% more. Say "sell 40% at 2x" for the rest.');
    });

    it('"sl be" on a plan bought higher: breakeven is above the price — said so, never "has to be below" alone', async () => {
      const plan = planOn('HIGGS');
      const ctx = ctxWith(1_000_000, [{ ...plan, entry: { ...plan.entry, priceUSD: 0.0009, mc: 900_000 } }], []);
      const r = await card('sl be', ctx);
      expect(r.plan.confirm).toBeUndefined();
      expect(r.plan.say).toBe('Breakeven (your entry, $900K MC) is above where $HIGGS is now ($719K MC) — a stop has to be below the price. Try "sl -10%".');
    });

    it('"buy 20% if it dips to 600k" with $5.27 cash: that share is under fomo\'s $2 minimum buy — said so, and the example is the minimum at their level', async () => {
      const ctx = { ...fresh(), cash: 5.27 };
      const { plan } = await card('buy 20% if it dips to 600k', ctx);
      expect(plan.say).toBe('How much in dollars? I buy with a $ amount, not a share of your cash. You have $5.27 cash on fomo — 20% of it is $1.05, under fomo\'s $2 minimum buy. Try "buy $2 at 600k".');
      expect((await card('buy half at 500k', ctx)).plan.say).toMatch(/half of it is \$2\.63\. Try "buy \$2\.63 at 500k"\.$/);
      expect((await card('buy at 500k', ctx)).plan.say).toBe('How much should I buy at $500K MC? You have $5.27 cash on fomo. Try "buy $5 at 500k".');
    });
  });

  // In 'move' units a bare number is a multiple after "tp" (and a drop after "sl") only — "sell half at 700" was 700x.
  describe('levelUnit "move": a bare number after a plain "sell" still asks', () => {
    it.each(['sell half at 700', 'sell 10% at 30'])('%s', (text) => {
      expect(parse(text, { levelUnit: 'move' }).type).toBe('unknown');
    });
    it('"tp 3" is still 3x and "sl 30" still −30%', () => {
      expect(parse('tp 3', { levelUnit: 'move' })).toMatchObject({ type: 'add-tp', level: { kind: 'x', value: 3 } });
      expect(parse('sl 30', { levelUnit: 'move' })).toMatchObject({ type: 'set-sl', level: { kind: 'pct', value: -30 } });
    });
  });

  // The danger check: sixteen messages as traders type them, with $CLAUDIA on screen at $719K MC
  // ($0.000719). Each must be the card for exactly what was said, or a question — never the wrong side
  // or amount — with the trader's $4.98 bag, with a $719 bag, and on a running plan (bought at the
  // price now: take-profits already selling 60%, stops at 0.95x and 0.85x, the stop loss at 0.5x).
  describe('the danger check: $CLAUDIA on screen, three bags', () => {
    /** What the tapped card sends: a take-profit, a partial stop, the stop loss (sells the rest) or a limit buy, at a corpus level. */
    type Order = { side: 'tp' | 'stop'; at: string; pct?: number; usd?: number } | { side: 'sl'; at: string } | { side: 'buy'; at: string; usd: number };
    interface Danger {
      t: string;
      /** None: Tippy asks, with every bag. */
      order?: Order;
      /** The reply with the trader's $4.98 bag and no plan yet, word for word. */
      say: string;
      /** Where it is refused rather than placed: the $4.98 bag under fomo's minimum, or a plan whose take-profits leave no room. */
      refusedIn?: ('small' | 'big' | 'plan')[];
    }
    const GUARD_NEW = "I'll start guarding your $CLAUDIA bag ($4.98).";
    const BUY_GUARD = 'then guard the new coins with P2 ⭐ Classic (2x 50% · 5x 25% · SL −30%) — your current bag too. Expires in 24h.';
    const DANGER: Danger[] = [
      { t: 'sell 10% at 700k mcap', order: { side: 'stop', at: 'mc 700000', pct: 10 }, refusedIn: ['small'], say: "10% of your $CLAUDIA bag ($4.98) is $0.48 at $700K MC — fomo's minimum sell is $2. Try at least 44% (a stop can fill a bit lower)." },
      { t: 'sell 10% at 700k', order: { side: 'stop', at: 'mc 700000', pct: 10 }, refusedIn: ['small'], say: "10% of your $CLAUDIA bag ($4.98) is $0.48 at $700K MC — fomo's minimum sell is $2. Try at least 44% (a stop can fill a bit lower)." },
      { t: 'tp 50% @ 1.2m', order: { side: 'tp', at: 'mc 1200000', pct: 50 }, refusedIn: ['plan'], say: `Add a take-profit on $CLAUDIA: sell 50% at $1.2M MC (+67% from now). ${GUARD_NEW}` },
      { t: 'sl half at 0.00065', order: { side: 'stop', at: 'price 0.00065', pct: 50 }, say: `Add a stop on $CLAUDIA: sell 50% if it drops to $0.00065 (≈$650K MC · −9.6% from now). ${GUARD_NEW}` },
      { t: 'buy $20 at 500k', order: { side: 'buy', at: 'mc 500000', usd: 20 }, say: `Place a limit buy on $CLAUDIA: $20 if it dips to $500K MC (−30% from now), ${BUY_GUARD}` },
      { t: 'buy 20 at 500k', order: { side: 'buy', at: 'mc 500000', usd: 20 }, say: `Place a limit buy on $CLAUDIA: $20 if it dips to $500K MC (−30% from now), ${BUY_GUARD}` },
      { t: 'dump a quarter if it hits 2x', order: { side: 'tp', at: 'x 2', pct: 25 }, say: `Add a take-profit on $CLAUDIA: sell 25% at $1.44M MC (2x from now). ${GUARD_NEW}` },
      { t: 'sell all below 600k', order: { side: 'sl', at: 'mc 600000' }, say: `Set a stop loss on $CLAUDIA at $600K MC (−17% from now): if it falls there, I sell all of it. ${GUARD_NEW}` },
      { t: 'sell $3 at 1m', order: { side: 'tp', at: 'mc 1000000', usd: 3 }, say: `Add a take-profit on $CLAUDIA: sell $3 ≈ 43% of your bag at $1M MC (+39% from now). ${GUARD_NEW}` },
      { t: 'sell 10 at 700', say: '10% of your bag or $10 worth — and is "700" $700K MC? Say "sell 10% at 700k" or "sell $10 at 700k".' },
      { t: 'buy 20% at 500k', say: 'How much in dollars? I buy with a $ amount, not a share of your cash. You have $50 cash on fomo — 20% of it is $10. Try "buy $10 at 500k".' },
      { t: 'sell 50% at 0.0009', order: { side: 'tp', at: 'price 0.0009', pct: 50 }, refusedIn: ['plan'], say: `Add a take-profit on $CLAUDIA: sell 50% at $0.0009 (≈$900K MC · +25% from now). ${GUARD_NEW}` },
      { t: 'stop 10% @ 650k on claudia', order: { side: 'stop', at: 'mc 650000', pct: 10 }, refusedIn: ['small'], say: "10% of your $CLAUDIA bag ($4.98) is $0.45 at $650K MC — fomo's minimum sell is $2. Try at least 47% (a stop can fill a bit lower)." },
      { t: 'limit buy 5 usd @ .0006', order: { side: 'buy', at: 'price 0.0006', usd: 5 }, say: `Place a limit buy on $CLAUDIA: $5 if it dips to $0.0006 (≈$600K MC · −17% from now), ${BUY_GUARD}` },
      { t: 'sell 50pc at 2x', order: { side: 'tp', at: 'x 2', pct: 50 }, refusedIn: ['plan'], say: `Add a take-profit on $CLAUDIA: sell 50% at $1.44M MC (2x from now). ${GUARD_NEW}` },
      { t: 'trim 25 at 1m mc', say: '25% of your bag, or $25 worth? Say "sell 25% at 1m" or "sell $25 at 1m".' },
    ];
    const bags = {
      small: () => ctxWith(BAG, [], [], 'CLAUDIA'),
      big: () => ctxWith(1_000_000, [], [], 'CLAUDIA'),
      plan: () => ctxWith(1_000_000, [planOn('CLAUDIA')], [], 'CLAUDIA'),
    };
    const levelsOf = (ls: readonly { id: string | null; trigger: Trigger; sellPct: number }[]) => ls.map((l) => [l.id, l.trigger, l.sellPct]);

    /** The one command the tapped card sent is exactly the order: on its side, at its level, for its amount — and nothing else moves. */
    function expectSent(o: Order, ctx: ChatCtx, where: string) {
      expect(calls.map((x) => x.fn), where).toHaveLength(1);
      const [{ fn, args }] = calls;
      if (o.side === 'buy') {
        expect(fn, where).toBe('armBuy');
        const input = args[0] as Omit<BuyInput, 'id' | 'now'>;
        expect(input.symbol, where).toBe('CLAUDIA');
        expectTrigger(input.trigger, o.at, where);
        expect(input.usd, where).toBe(o.usd);
        return;
      }
      let added: { tps: { trigger: Trigger; sellPct: number }[]; stops: { trigger: Trigger; sellPct: number }[]; sl: { trigger: Trigger } | null };
      const running = ctx.plans[0];
      if (!running) {
        expect(fn, where).toBe('arm');
        const input = args[0] as Omit<PlanInput, 'id' | 'now'>;
        expect(input.symbol, where).toBe('CLAUDIA');
        added = { tps: input.tps, stops: input.stops ?? [], sl: input.sl ?? null };
      } else {
        // An edit of the running plan: every level it had stays exactly as it was, plus the one said.
        expect(fn, where).toBe('update');
        const [id, edit] = args as [string, PlanEdit];
        expect(id, where).toBe(running.id);
        expect(levelsOf(edit.tps.filter((l) => l.id !== null)), where).toEqual(levelsOf(running.tps));
        expect(levelsOf((edit.stops ?? running.stops).filter((l) => l.id !== null)), where).toEqual(levelsOf(running.stops));
        expect(edit.trailing, where).toEqual({ trailPct: running.trailing!.trailPct, activateX: running.trailing!.activateX });
        added = { tps: edit.tps.filter((l) => l.id === null), stops: (edit.stops ?? []).filter((l) => l.id === null), sl: o.side === 'sl' ? edit.sl : null };
        if (o.side !== 'sl') expect(edit.sl?.trigger, where).toEqual(running.sl!.trigger);
      }
      if (o.side === 'sl') {
        expect([added.tps.length, added.stops.length], where).toEqual([0, 0]);
        expectTrigger(added.sl?.trigger, o.at, where);
        return;
      }
      expect([added.tps.length, added.stops.length, added.sl], where).toEqual(o.side === 'tp' ? [1, 0, null] : [0, 1, null]);
      const [level] = o.side === 'tp' ? added.tps : added.stops;
      expectTrigger(level.trigger, o.at, where);
      if (o.usd == null) {
        expect(level.sellPct, where).toBe(o.pct);
        return;
      }
      // Dollars become the share of the bag that is worth at least that much at the level's price.
      const worth = (level.sellPct / 100) * ctx.coin!.balance! * priceAt(o.at);
      expect(worth, where).toBeGreaterThanOrEqual(o.usd - 1e-9);
      expect(worth, where).toBeLessThan(o.usd * 1.001);
    }

    it('covers sixteen messages', () => {
      expect(DANGER).toHaveLength(16);
      expect(new Set(DANGER.map((d) => d.t)).size).toBe(16);
    });

    it.each(DANGER.map((d) => [d.t, d] as const))('%s', async (text, d) => {
      for (const [name, make] of Object.entries(bags) as [keyof typeof bags, () => ChatCtx][]) {
        const ctx = make();
        const { plan } = await card(text, ctx);
        const where = `${text} [${name}]: ${plan.say}`;
        if (name === 'small') expect(plan.say, where).toBe(d.say);
        if (!d.order || d.refusedIn?.includes(name)) {
          expect(plan.confirm, where).toBeUndefined();
          expect(plan.warn, where).toBe(true);
          continue;
        }
        expect(plan.confirm, where).toBeTruthy();
        calls = [];
        expect(await plan.confirm!.run(), where).toMatchObject({ ok: true });
        expectSent(d.order, ctx, where);
      }
      // A question's examples are whole messages that read as the order they offer.
      if (!d.order) {
        const offered = [...d.say.matchAll(/"((?:sell|buy) [^"]+)"/g)].map((m) => m[1]);
        expect(offered.length, d.say).toBeGreaterThan(0);
        for (const example of offered) expect(parse(example).type, example).toMatch(example.startsWith('buy') ? /^limit-buy$/ : /^(add-tp|add-stop|set-sl)$/);
      }
    });
  });

  describe('ask: Tippy asks, and offers nothing to tap', () => {
    it.each(groups('ask').map((c) => [c.t, c] as const))('%s', async (text, c) => {
      for (const ctx of [fresh(), managed()]) {
        const { intent, plan } = await card(text, ctx);
        expect(plan.confirm, `${text} → ${JSON.stringify(intent)}: ${plan.say}`).toBeUndefined();
        expect(plan.warn, plan.say).toBe(true);
        expect(plan.say.length).toBeGreaterThan(10);
        wording(c, plan.say);
        // When it got as far as an order, it read the level and amount right — and still asked.
        const o = intent.type === 'unknown' ? null : outcome(intent);
        if (o && c.level && o.level) expect(o.level, text).toBe(c.level);
        if (o && c.amount && o.amount) expect(o.amount, text).toBe(c.amount);
      }
    });
  });
});
