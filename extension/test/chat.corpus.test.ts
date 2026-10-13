// The chat corpus: 533 messages the way traders actually type them, and what
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
import { buildPlan } from '../src/engine/orders';
import type { BuyInput, BuyOrder, Plan, PlanInput, Trigger } from '../src/engine/types';
import type { CommandResult } from '../src/shared/messages';
import { withDefaults } from '../src/shared/settings';

type Want = 'sell-above' | 'sell-below' | 'stop-loss-rest' | 'limit-buy' | 'move' | 'remove' | 'cancel-buy' | 'show' | 'pause' | 'practice' | 'setting' | 'ask';

interface Case {
  t: string;
  want: Want;
  /** "mc 700000", "price 0.0007", "x 2", "pct -20". */
  level?: string;
  /** "pct 50" (of the bag) or "usd 20". */
  amount?: string;
  /** A coin named in the message; none = the coin on screen. */
  coin?: string;
  /** Which order a move / remove is about: tp1, stop2, sl, trail, buy. */
  target?: string;
  note?: string;
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
  { t: 'sell half at 1', want: 'ask', amount: 'pct 50', note: '1x (the price now)? $1? 1m?' },
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
  { t: 'sl at breakeven', want: 'ask', level: 'x 1', note: 'no plan/entry yet, so breakeven = the price now — the stop would fire at once' },
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

function ctxWith(balance: number, plans: Plan[], buys: BuyOrder[]): ChatCtx {
  const state = { plans, buys, settings: withDefaults(undefined) };
  return {
    coin: coinOf('HIGGS', balance),
    ...state,
    latest: () => state,
    minBuyUsd: () => 2,
    minSellUsd: () => 2,
    cash: 50,
    resolveCoin: async (symbol) => coinOf(symbol.toUpperCase(), symbol.toUpperCase() === 'HIGGS' ? balance : OTHER_BAG),
    fetchCoin: async (key) => {
      const symbol = key.replace(/111:.*$/, '');
      return coinOf(symbol, symbol === 'HIGGS' ? balance : OTHER_BAG);
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
const groups = (w: Want) => CORPUS.filter((c) => c.want === w);

// ---- The tests ---------------------------------------------------------------------

describe('the chat corpus', () => {
  it('has every case once', () => {
    expect(CORPUS).toHaveLength(533);
    expect(new Set(CORPUS.map((c) => c.t)).size).toBe(CORPUS.length);
  });

  describe.each(['sell-above', 'sell-below', 'stop-loss-rest'] as const)('%s', (want) => {
    it.each(groups(want).map((c) => [c.t, c] as const))('%s', async (text, c) => {
      const { intent, plan } = await card(text, fresh());
      expect(outcome(intent), JSON.stringify(intent)).toEqual(expected(c));
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

  describe('limit-buy', () => {
    it.each(groups('limit-buy').map((c) => [c.t, c] as const))('%s', async (text, c) => {
      const { intent, plan } = await card(text, fresh());
      expect(outcome(intent), JSON.stringify(intent)).toEqual(expected(c));
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

  describe('ask: Tippy asks, and offers nothing to tap', () => {
    it.each(groups('ask').map((c) => [c.t, c] as const))('%s', async (text, c) => {
      for (const ctx of [fresh(), managed()]) {
        const { intent, plan } = await card(text, ctx);
        expect(plan.confirm, `${text} → ${JSON.stringify(intent)}: ${plan.say}`).toBeUndefined();
        expect(plan.warn, plan.say).toBe(true);
        expect(plan.say.length).toBeGreaterThan(10);
        // When it got as far as an order, it read the level and amount right — and still asked.
        const o = intent.type === 'unknown' ? null : outcome(intent);
        if (o && c.level && o.level) expect(o.level, text).toBe(c.level);
        if (o && c.amount && o.amount) expect(o.amount, text).toBe(c.amount);
      }
    });
  });
});
