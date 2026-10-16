// "hey tippy add a tp at 500k mcap on CLAUDIA" → an Intent (see intent.ts).
//
// Built-in and deterministic: no AI, nothing leaves the computer. It reads the
// way memecoin traders actually type — lowercase, no punctuation, slang, the
// odd typo — and never guesses when a message could mean two things (buy or
// sell, two levels, two coins, a bare "500"): it answers with an 'unknown' and
// a hint instead. Nothing here acts; run.ts turns the intent into a confirm
// card and only the user's tap does anything.
//
// How it works: tidy the message (numbers, "$", typos, "hey tippy", "pls"),
// then try each command in turn. A command recognises its keywords, then
// *takes* (blanks out) the pieces it understands — expiry, preset, amount,
// sell size, the level — so the words left over can only be the coin.

import { formatUsd, formatX } from '../engine/triggers';
import { DEV_TOOLS } from '../shared/config';
import type { CoinSpec, Intent, LevelSpec } from './intent';

export interface ParseOptions {
  /** How the chat reads a bare number: in 'move', "tp 3" is 3x and "sl 30" −30%; in 'mc' (default) Tippy asks. */
  levelUnit?: 'mc' | 'move';
}

type Side = 'tp' | 'sl' | 'buy';
type Unit = 'mc' | 'move';
type Unknown = Extract<Intent, { type: 'unknown' }>;
type Hint = { hint: string };

const MAX_LEN = 400;

// ---- Replies -------------------------------------------------------------

const GENERAL_HINT =
  'Hmm, I didn\'t catch that. Try "tp at 500k mcap", "sl -30%" or "buy $10 if it dips 20%" — or say "help".';
const NOW_SELL =
  'I sell at a level, not on the spot (fomo\'s Sell button does that). Try "sell half at 2x" or "sl -30%".';
const NOW_BUY = 'I buy at a level, not on the spot (fomo\'s Buy button does that). Try "buy $10 if it dips 20%".';
const ONE_THING = 'One thing at a time, please! Try "tp at 2x" first, then "sl -30%".';
/** "tp 2x sl -50%", "SL -25% / TP 2x": two orders — one at a time, each the way it was said. */
function oneThing(s: string): string {
  const t = s.replace(/·+/g, ' ');
  const LV = String.raw`(?:[+-]\d+(?:\.\d+)?%|\$?\d+(?:\.\d+)?[kmbx]|\d+(?:\.\d+)?%|\$\d*\.\d+)`;
  const tp = t.match(new RegExp(String.raw`\b(?:tp|take ?profits?)\s+(?:at\s+)?(${LV})(?![\w.%])`));
  const sl = t.match(new RegExp(String.raw`\b(?:sl|stop ?loss|stop)\s+(?:at\s+)?(${LV})(?![\w.%])`));
  const tr = t.match(/\b(?:trailing stop|trailing|trail|tsl)\s+(?:by\s+)?(\d+(?:\.\d+)?%)/);
  const slSay = sl ? (/%$/.test(sl[1]) ? `sl ${/^[+-]/.test(sl[1]) ? sl[1] : `-${sl[1]}`}` : `sl at ${sl[1]}`) : null;
  const parts = [tp ? `tp at ${tp[1]}` : null, slSay, tr ? `trail ${tr[1]}` : null].filter((x): x is string => !!x);
  return parts.length >= 2 ? `One thing at a time, please! Try "${parts[0]}" first, then "${parts[1]}".` : ONE_THING;
}
const UP_OR_DOWN = 'Up or down? Try "sell 25% at 2x" or "sell 25% if it drops to 700k".';
const PRESETS = 'P1 Play it safe, P2 Classic or P3 Moon bag';

const unknown = (hint: string): Unknown => ({ type: 'unknown', hint });
const isHint = (x: unknown): x is Hint => typeof x === 'object' && x !== null && 'hint' in x;

/** "$500K MC", "$0.004", "2x", "−20%". */
function levelWords(l: LevelSpec): string {
  switch (l.kind) {
    case 'mc':
      return `${formatUsd(l.value)} MC`;
    case 'price':
      return formatUsd(l.value);
    case 'x':
      return formatX(l.value);
    case 'pct':
      return `${l.value > 0 ? '+' : '−'}${Math.abs(l.value)}%`;
  }
}

const twoLevels = (ls: LevelSpec[]) =>
  `I spotted two levels there (${ls.slice(0, 2).map(levelWords).join(' and ')}) — one at a time, please.`;

// ---- Tidying ---------------------------------------------------------------

/** Common slips → the word Tippy knows. Only whole words, never a $COIN. */
const TYPOS: Record<string, string> = {
  takeprofit: 'take profit', takeprofits: 'take profits', tkae: 'take', taek: 'take',
  proft: 'profit', profti: 'profit', porfit: 'profit', prfit: 'profit', proffit: 'profit', profitt: 'profit',
  stoploss: 'stop loss', stoplos: 'stop loss', stopp: 'stop', sotp: 'stop', stpo: 'stop', los: 'loss', lsos: 'loss',
  trailling: 'trailing', trialing: 'trailing', traling: 'trailing', trailng: 'trailing', trailin: 'trailing',
  trailingstop: 'trailing stop', trale: 'trail', tral: 'trail',
  gaurd: 'guard', gurad: 'guard', guad: 'guard', gaurding: 'guarding', guardin: 'guarding', protec: 'protect', portect: 'protect',
  cancle: 'cancel', cancell: 'cancel', cancal: 'cancel', cnacel: 'cancel', canel: 'cancel', cancl: 'cancel', cacnel: 'cancel',
  remvoe: 'remove', remoev: 'remove', rmeove: 'remove', remov: 'remove', reomve: 'remove', delte: 'delete', delet: 'delete',
  puase: 'pause', pasue: 'pause', paus: 'pause', unpuase: 'unpause', unpaus: 'unpause', resum: 'resume', resmue: 'resume', reusme: 'resume',
  practise: 'practice', practising: 'practicing', pratice: 'practice', practic: 'practice', pracitce: 'practice', practce: 'practice',
  clasic: 'classic', classsic: 'classic', calssic: 'classic', classik: 'classic',
  moonbag: 'moon bag', playitsafe: 'play it safe',
  mcao: 'mcap', mcpa: 'mcap', macp: 'mcap', mkap: 'mcap', mcaps: 'mcap', marketcap: 'market cap', mktcap: 'market cap',
  mkt: 'market', mrkt: 'market', makret: 'market', markt: 'market', maket: 'market', marekt: 'market',
  biy: 'buy', buyy: 'buy', byu: 'buy', bui: 'buy', sel: 'sell', sll: 'sell', selll: 'sell', slel: 'sell', sele: 'sell',
  moev: 'move', mvoe: 'move', mov: 'move', moce: 'move',
  proift: 'profit', porift: 'profit', profir: 'profit',
  // "mcp" is a typo of mcap here — a coin called MCP needs its $ ("$MCP").
  mcp: 'mcap', mcsp: 'mcap', mcal: 'mcap', mcapp: 'mcap',
  satus: 'status', staus: 'status', stauts: 'status', ordrs: 'orders', oders: 'orders', ordres: 'orders',
  halp: 'help', hlep: 'help', hepl: 'help', quater: 'quarter', qtr: 'quarter', hlaf: 'half', hafl: 'half',
  // Size words typed in a hurry: read as the word (the card says the %). Fuzzier ones ("hal", "quart") get a question — see sizeTypo().
  hlf: 'half', haf: 'half', halfe: 'half', hallf: 'half', thrid: 'third', thrd: 'third', quartr: 'quarter', qurter: 'quarter', quartre: 'quarter',
  evrything: 'everything', everythin: 'everything', everyting: 'everything', erything: 'everything', everthing: 'everything', everyhting: 'everything',
  autoguard: 'auto guard', autoprotect: 'auto protect', dryrun: 'dry run', unguard: 'unguard',
  // "sell bout half at 2x", "a lil bit": filler said short.
  bout: 'about', lil: 'little',
  // "sell teh rest", "sell da rest": "the" typed fast — never a coin called TEH.
  teh: 'the', hte: 'the', th: 'the', da: 'the', tha: 'the', thee: 'the',
  // "buy 5 dolars", "5 buks": dollars — never a coin called DOLARS.
  dolars: 'dollars', dolar: 'dollar', dollers: 'dollars', doller: 'dollar', dollas: 'dollars', dolla: 'dollar', dollah: 'dollar', dolllars: 'dollars', dollrs: 'dollars',
  buks: 'bucks', buk: 'buck', bucs: 'bucks', bux: 'bucks',
  // "cxl buy", "lmt buy": cancel, limit.
  cxl: 'cancel', cncl: 'cancel', canx: 'cancel', lmt: 'limit', lmit: 'limit', limt: 'limit',
  // "sell init at 2x": initials (a coin called INIT needs its $).
  init: 'initials', inits: 'initials', intials: 'initials', initals: 'initials', initails: 'initials', inital: 'initial', initail: 'initial',
};

/** Restricted Damerau–Levenshtein distance (a swap of two letters counts as one slip). */
function slips(a: string, b: string): number {
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array<number>(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++) {
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  return d[a.length][b.length];
}

// ---- Number words: "twenty-five percent" → "25%", "seven hundred k" → "700k", "one point five million" → "1.5m".
const ONES: Record<string, number> = { zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9 };
const TEENS: Record<string, number> = { ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19 };
const TENS: Record<string, number> = { twenty: 20, thirty: 30, forty: 40, fourty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };
const W_ONE = `(?:${Object.keys(ONES).join('|')})`;
const W_TEEN = `(?:${Object.keys(TEENS).join('|')})`;
const W_TEN = `(?:${Object.keys(TENS).join('|')})`;
const UNDER_100 = String.raw`(?:${W_TEN}(?:\s+${W_ONE})?|${W_TEEN}|${W_ONE})`;
const NUMBER_PHRASE = new RegExp(
  String.raw`\b(?:(?:(?:a|${UNDER_100})\s+hundred(?:\s+(?:and\s+)?${UNDER_100})?|${UNDER_100})(?:\s+point(?:\s+${W_ONE})+)?|point(?:\s+${W_ONE})+)\b`,
  'g',
);
/** What a number said in words is followed by when it's surely a number: "five dollars", "ten percent", "two x", "seven hundred k". */
const NUMBER_UNIT = /^\s*(?:(?:bucks?|dollars?|usd[ct]?|x|times|percent|per cent|pct|pc|k|thousand|grand|millions?|mill?|mm|billions?|bil|bn|b|m)\b|%)/;
/** "two thirds", "one quarter", "one more tp": the word is part of a size or a count, not a number to convert. */
const NUMBER_KEEP = /^\s+(?:halves|half|thirds?|quarters?|fifths?|sixths?|sevenths?|eighths?|ninths?|tenths?|more|of\s+(?:my|the|your)\s+(?:tps|stops|take profits))\b/;
/** Right after a trade verb a number is an amount ("sell five at 2x" → "sell 5 at 2x", which then asks 5% or $5). */
const NUMBER_AFTER_VERB = /\b(?:sell|sells|selling|dump|trim|cut|buy|buying|ape|bid|spend|scoop|grab|snipe|secure|take|unload|offload|exit)\s+(?:like\s+|about\s+|around\s+|only\s+|just\s+|another\s+)?$/;
/** "tp two", "stop three": a level's number (TP2, stop 3). */
const NUMBER_INDEX = /\b(?:tps?|take ?profits?|stops?|sl|partial stop)\s+(?:number\s+|no\s+|num\s+)?$/;

function numberValue(phrase: string): number {
  let n = 0;
  let decimals = '';
  let point = false;
  for (const w of phrase.split(/\s+/)) {
    if (point) decimals += String(ONES[w] ?? '');
    else if (w === 'point') point = true;
    else if (w === 'a') n = 1;
    else if (w === 'hundred') n = (n || 1) * 100;
    else if (w !== 'and') n += ONES[w] ?? TEENS[w] ?? TENS[w] ?? 0;
  }
  return decimals ? +`${n}.${decimals}` : n;
}

function numberWords(s: string): string {
  return s.replace(NUMBER_PHRASE, (phrase: string, at: number, all: string) => {
    const before = all.slice(0, at);
    const after = all.slice(at + phrase.length);
    const words = phrase.split(/\s+/).filter((w) => w !== 'and');
    const n = numberValue(phrase);
    if (NUMBER_UNIT.test(after)) return String(n);
    if (NUMBER_KEEP.test(after)) return phrase;
    if (words.length > 1) return String(n);
    // A single "one".."nine": a level's number after "tp" / "stop", or a word ("this one", "one of them") — unless it follows a trade verb.
    if (n < 10) return NUMBER_AFTER_VERB.test(before) && !NUMBER_INDEX.test(before) ? String(n) : phrase;
    return String(n);
  });
}

/** "1/5" → "one fifth", "2/3rds" → "two thirds", "3/4" → "three quarters": a share of the bag, read by takeSize. */
const FRACTION_WORD: Record<number, string> = { 3: 'third', 4: 'quarter', 5: 'fifth', 6: 'sixth', 7: 'seventh', 8: 'eighth', 9: 'ninth', 10: 'tenth' };
const COUNT_WORDS = ['', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];
function fractionWords(a: string, b: string, whole: string): string {
  const n = +a;
  const d = +b;
  if (!(n > 0 && n < d)) return whole;
  if (n * 2 === d) return ' half ';
  const word = FRACTION_WORD[d];
  if (!word) return whole;
  return n === 1 ? ` a ${word} ` : ` ${COUNT_WORDS[n]} ${word}s `;
}

const SUBSCRIPT = '₀₁₂₃₄₅₆₇₈₉';

/**
 * DEX-style prices with a subscript count of zeros: "0.0₃65" = 0.00065. Done
 * before NFKC, which would turn ₃ into a plain 3 and read 0.0365 — 56x off.
 */
function subscriptZeros(raw: string): string {
  return raw.replace(/(\d*)\.0([₀-₉]+)(\d+)/g, (_, int: string, sub: string, rest: string) => {
    const zeros = Number([...sub].map((ch) => SUBSCRIPT.indexOf(ch)).join(''));
    return `${int || '0'}.${'0'.repeat(Math.min(zeros, 30))}${rest}`;
  });
}

/** Lowercase, plain ASCII, numbers in one shape ("1,5 mil" → "1.5m", "10$" → "$10", "20 percent" → "20%"). */
function tidy(raw: string): string {
  let s = ` ${subscriptZeros(raw).normalize('NFKC').toLowerCase()} `;
  s = s.replace(/[’‘`´]/g, "'").replace(/[“”"]/g, ' ').replace(/[−–—]/g, '-').replace(/ /g, ' ').replace(/⁄/g, '/');
  s = s.replace(/'/g, '').replace(/@/g, ' at ');
  // "2×" is 2x; "at2x", "at500k": a missed space.
  s = s.replace(/(\d)\s*[×✕✖]/g, '$1x').replace(/\bat(?=\$?\.?\d)/g, 'at ');
  // "mc < 1m", "if mc > 500k": the signs are words here, never dropped as punctuation (that flips the side).
  s = s.replace(/->|=>|→/g, ' to ').replace(/<=|=<|≤|</g, ' below ').replace(/>=|≥|>/g, ' above ');
  s = s
    .replace(/\bw\/o\b/g, ' without ')
    .replace(/\bw\//g, ' with ')
    .replace(/\btp\s*\/\s*sl\b/g, ' tpsl ')
    .replace(/\bs\/l\b/g, ' sl ')
    .replace(/\bt\/p\b/g, ' tp ')
    .replace(/\bb\/e\b/g, ' breakeven ');
  s = s.replace(/(?<![\d.\/])(\d{1,2})\s*\/\s*(\d{1,2})(?:st|nd|rd|th)?s?(?![\d.\/\w])/g, (m, a: string, b: string) => fractionWords(a, b, m));
  // "a 3rd" is a third of the bag ("3rd tp" stays TP3).
  s = s.replace(/\b(a|one)\s+(3rd|4th|5th|10th)\b(?!\s+(?:tps?|take|stops?|sl|partial|one)\b)/g, (_, a: string, o: string) => `${a} ${({ '3rd': 'third', '4th': 'quarter', '5th': 'fifth', '10th': 'tenth' } as Record<string, string>)[o]}`);
  // Thousands commas ("2,500,000"), then decimal commas ("1,5m") — a thousands group never starts with 0 ("0,001" is a price).
  // (A comma after the number is punctuation: "at 1,000,000, thanks".)
  s = s.replace(/(?<![\d.,])[1-9]\d{0,2}(?:,\d{3})+(?:\.\d+)?(?!\d|,\d)/g, (m) => m.replace(/,/g, ''));
  s = s.replace(/(\d),(\d)/g, '$1.$2');
  s = s.replace(/\b(twenty|thirty|forty|fourty|fifty|sixty|seventy|eighty|ninety)-(one|two|three|four|five|six|seven|eight|nine)\b/g, '$1 $2');
  // "half a mil" is $500K — never "half" (a size) plus "a mil" (a level).
  s = s
    .replace(/\bhalf (?:a |of a )?mil(?:l|lion)?\b/g, ' 0.5m ')
    .replace(/\b(?:a |one )?quarter (?:of a )?mil(?:l|lion)?\b/g, ' 0.25m ')
    .replace(/\ba (?:mil|mill|million)\b/g, ' 1m ')
    .replace(/\ba (?:bil|billion|bn)\b/g, ' 1b ');
  s = numberWords(s);
  s = s.replace(/\b(?:minus|negative)\s*(?=[\d.])/g, '-').replace(/\bplus\s*(?=[\d.])/g, '+');
  // "10$" → "$10" before "$ 300k" → "$300k", so "buy 20$ 300k" keeps its $20.
  s = s.replace(/(?<![\w.$])(\d+(?:\.\d+)?)\s*\$(?!\w)/g, ' $$$1 ');
  s = s.replace(/\$\s+(?=[\d.])/g, '$');
  // "usd 5", "usdc 10": dollars said first — never a bare 5 (a level?). Not after a number: "sell 5 usd 700k".
  s = s.replace(/(?<!\d\s*)\busd[ct]?\s+(\d+(?:\.\d+)?k?)(?![\w.%])/g, ' $$$1 ');
  s = s
    .replace(/(\d)\s*(?:thousand|grand|thou)\b/g, '$1k')
    .replace(/(\d)\s*(?:millions?|mill?|mm|mln|mn|mio)\b/g, '$1m')
    .replace(/(\d)\s*(?:billions?|bil|bn|bln)\b/g, '$1b')
    .replace(/(\d)\s+([kmb])\b/g, '$1$2')
    .replace(/(\d)\s+x\b/g, '$1x')
    .replace(/(\d)\s*times\b/g, '$1x')
    .replace(/(\d)\s*(?:percent|per cent|pct|pcts|prct|perc|percnt|prcnt|precent|percet|pecent|pecrent|percentage|pc|pcs|pcnt|pcent|prc)\b/g, '$1%')
    // Any other slip of "percent" right after a number ("50 percnet", "20 persent").
    .replace(/(\d)\s*(p[a-z]{3,9})\b/g, (m, d: string, w: string) => (slips(w, 'percent') <= 2 ? `${d}%` : m))
    .replace(/(\d)\s+%/g, '$1%')
    // "%20" is 20%.
    .replace(/(?<![\w.%$])%\s?(\d+(?:\.\d+)?)(?![\w.%])/g, ' $1% ');
  // Missed spaces: "tp2x" / "sl30%" (never "tp2", a level's number), "2x50%".
  s = s.replace(/\b(tp|sl)(?=\d+(?:\.\d+)?[xkmb%](?![\w.]))/g, '$1 ').replace(/\b(sell|buy|dump|trim|take|cut|ape)(?=\$?\d+(?:\.\d+)?%?(?![\w.]))/g, '$1 ').replace(/(\d[xkmb])(?=\d+(?:\.\d+)?%)/g, '$1 ');
  s = s.replace(/\btrial(?=\s+(?:stop|by|of|at|[+-]?\d))/g, 'trail');
  // "half-ish", "2x-ish": roughly — the card says exactly what it does.
  s = s.replace(/([a-z0-9%])-ish\b/g, '$1').replace(/\b(half|quarter|third)ish\b/g, '$1');
  s = s.replace(/([a-z])-(?=[a-z])/g, '$1 '); // stop-loss, take-profit, auto-guard
  s = s.replace(/[^a-z0-9$.%+\-?\s]/g, ' ');
  s = s.replace(/\.(?![\d])/g, ' ').replace(/([+-])(?![\d.])/g, ' ');
  s = s.replace(/(?<!\$)\b[a-z]+\b/g, (w) => TYPOS[w] ?? w);
  // "sl be", "stop be pls": breakeven ("to be" / "at be" are read by the stop's level reader).
  s = s.replace(/\b(sl|stop loss|stop)\s+be\b(?=\s*$|\s+(?:pls|please|plz|thx|ty|thanks|now|asap|rn|ser|bro|sir|on|for)\b)/g, '$1 breakeven');
  return s.replace(/\s+/g, ' ').trim();
}

// ("heyy", "hiii", "yooo": a greeting drawn out is still one — never a coin called HEYY.)
const GREETING = /^(?:(?:he+y+a*|hi+|hel+o+|yo+|oi+|ayo+|gm+|sup|dear|hiya|heya|howdy|hola)\b\s*)+(?:@?(?:tippy|tipy|tippie|tippi)\b)?\s*|^@?(?:tippy|tipy|tippie|tippi)\b\s*/;
const LEAD =
  /^(?:(?:ok|okay|alright|right|so|um|uh|hmm|pls|please|plz|pleas|kindly|just|quickly|quick|also|now|then|can you|could you|would you|will you|can u|could u|would u|will u|go ahead and|i want to|i wanna|i want you to|i want|i would like to|i would like|i d like to|id like to|i d like|id like|i need to|i need you to|i need|lets|let s|help me|dont forget to|do not forget to|remember to|make sure to|tippy|tipy)\b\s*|[,:;!]+\s*|[.\-]+(?![\d.])\s*)/;
const TAIL =
  /\s*(?:\b(?:pls|please|plz|thanks|thank you|thx|ty|tysm|tippy|bro|ser|sir|fren|mate|man|dude|lol|lmao|lfg|asap|etc|kthx|cheers|for me|ok|okay|rn|right now|now|boss|chief|my friend|send it|gang|frfr|fr|ngl|tbh|idk|nfa|dyor|bruh|yolo|wagmi|gg|ez|xoxo|ily|love you|love u|gl|glhf|good luck)|[,:;!.\-]+)\s*$/;

/**
 * Pleasantries, hedging fillers and reasons, wherever they sit in the message
 * ("thanks a lot", "if possible", "you rock", "hope ur good", "before it rugs",
 * "but keep my stop loss"): they say nothing about the order, and left in, their
 * words read as a coin ($LOT, $ROCK, $HOPE…). Phrases only — a lone "rock" or
 * "lot" is still read (and questioned) as a word.
 */
const POLITE = new RegExp(
  [
    String.raw`thank (?:you|u) (?:so|very) much|thanks (?:so|very) much|thanks a (?:lot|bunch|ton|million)|thank (?:you|u) (?:a lot|kindly)|many thanks|much appreciated`,
    String.raw`(?:i |really )?appreciate (?:it|you|u|that|ya)(?: a lot)?`,
    String.raw`if (?:its |it s )?possible|if (?:you|u) (?:can|could)|if (?:you|u) (?:dont|do not) mind|if (?:thats|that s|that is) (?:ok|okay|alright|fine)`,
    String.raw`when(?:ever)? (?:you|u) (?:get|have) (?:a |the )?(?:chance|sec|second|minute|moment)|when(?:ever)? (?:you|u) can`,
    String.raw`good (?:morning|evening|afternoon|night)|(?:have a )?(?:good|great|nice) (?:one|day|night|weekend)|no matter what|(?:you|u) rock|(?:youre|you are|you re|ur|u r|u are) (?:the best|a legend|amazing|awesome|the goat|goated|a star)`,
    String.raw`(?:i )?(?:hope|hoping) (?:youre|you are|you re|ur|u r|u are|all is|its|it s|things are) (?:good|well|doing (?:good|well|great|ok|okay|fine)|ok|okay|fine|great|going well)`,
    String.raw`pretty please|i guess|lmk|let me know|i think|honestly|to be honest|tbh|(?:just )?to be (?:safe|sure)|to be on the safe side|for safety`,
    String.raw`(?:before|in case|incase|just in case) (?:it|this|the dev|dev) (?:rugs?|rugged|dies|goes to (?:zero|0))`,
    // "take profit before the dip at 1m": the reason, never the direction ("before it drops 30%" still reads its 30%).
    String.raw`(?:before|ahead of) (?:the |a |any |it |its |it s )?(?:dips?|dumps?|dumping|dipping|crash(?:es)?|rugs?|drops?|corrects?|correction|retraces?|pullback|nukes?|tanks?|bleeds?)(?! ?(?:to|below|under|by|another|[+-]?\$?\.?\d))`,
    // "on the bounce", "on the retest": chart talk around a level that's already said.
    String.raw`on (?:the|a) (?:bounce|retest|reclaim)`,
    // "… but keep my stop loss": leave the rest of the plan alone (never "keep stop at 500k", which sets one).
    String.raw`(?:but|and|just) (?:keep|leave|dont touch|do not touch|dont change|do not change) (?:my |the |all )?(?:stop loss|sl|stops?(?! ?loss)|tps|take profits|other orders|plan)(?: (?:as is|as it is|where it is|alone|too|as well))?(?!\s+(?:at|to|on|around)?\s*[+-]?\$?\.?\d)`,
  ].join('|')
    .replace(/^/, String.raw`\b(?:`)
    .replace(/$/, String.raw`)\b`),
  'g',
);

/**
 * Said the long way round: "don't sell until it hits 1m then sell half" is
 * "when it hits 1m sell half"; "not all, just half" and "I don't want to lose
 * everything, so …" are the reason, never a second size.
 */
/** Who moves the price in "when whales dump it to 500k", "if paper hands sell at 500k", "when everyone apes in at 2x". */
const CROWD = String.raw`(?:whales?|jeets?|sellers|buyers|paper ?hands|paperhands|weak hands|dumpers|snipers|bots|devs?|insiders|holders|degens|people|everyone|everybody|someone|somebody|they|retail|bundlers|kols?|apes|bears|bulls)`;
const CROWD_DOWN = String.raw`(?:sell|sells|selling|dump|dumps|dumping|exit|exits|exiting|capitulate|capitulates|panic sells?|bail|bails|rug|rugs|cash out|cashes out|take profits?|takes profits?|are out|are done|are gone|give up|gives up|leave|leaves|jeet|jeets)`;
const CROWD_UP = String.raw`(?:ape in|apes in|fomo in|fomos in|pile in|piles in|rush in|rushes in|buy|buys|buying|ape|apes|aping|fomo|fomos|pump|pumps|pumping|send|sends)`;
const CROWD_PUSH = String.raw`(?:push|pushes|take|takes|bring|brings|drive|drives|get|gets|move|moves|drag|drags)`;
const CROWD_MOVE = new RegExp(
  String.raw`\b(if|when|once|after|whenever|as soon as)\s+(?:the\s+|some\s+|all\s+(?:the\s+)?|a\s+few\s+|a\s+|enough\s+)?(${CROWD})\s+(?:start\s+(?:to\s+)?|starts\s+(?:to\s+)?|finally\s+|all\s+)?(?:(${CROWD_DOWN})|(${CROWD_UP})|(${CROWD_PUSH}))(?:\s+(?:it|this|the price|price))?(?:\s+(?:down|up))?\b`,
  'g',
);
const CROWD_SELLS = /^(?:jeets?|sellers|paper ?hands|paperhands|weak hands|dumpers|bears)$/;
const CROWD_BUYS = /^(?:buyers|apes|bulls)$/;

function reword(s: string): string {
  return s
    // The crowd moves the price: "when whales dump it to 500k" is "when it dips to 500k" — never a coin called WHALES.
    .replace(CROWD_MOVE, (_m, when: string, who: string, down?: string, up?: string) => {
      const dir = down ? 'dips' : up ? 'pumps' : CROWD_SELLS.test(who) ? 'dips' : CROWD_BUYS.test(who) ? 'pumps' : 'hits';
      return `${when} it ${dir}`;
    })
    // "sold half already, sell the rest at 5x": what's done is the reason — never a second size.
    .replace(/\b(?:i\s+)?(?:already\s+)?(?:sold|took|taken|cashed out)\s+(?:out\s+|off\s+)?(?:half|a quarter|a third|some|most|\d+(?:\.\d+)?%|my initials?|initials?)(?:\s+(?:off|out))?(?:\s+already)?\b/g, ' ')
    // "sell at least 40%", "at most a third": the size itself.
    .replace(/\bat (?:least|most)\s+(?=\$?\.?\d|half\b|a (?:quarter|third)\b|one\b|two\b)/g, '')
    // "halve my bag at 2x": sell half.
    .replace(/\bhalve\s+(?:my\s+|the\s+|your\s+|this\s+)?(?:bag|position|stack|holdings?|tokens?|coins?|it)\b|\bhalve\b(?=\s+(?:at|if|when|once|on)\b)/g, 'sell half')
    .replace(POLITE, ' ')
    .replace(/\b(?:i\s+)?(?:dont|do not)\s+(?:want|wanna)\s+(?:to\s+)?(?:lose|get rekt|get wrecked|round ?trip|give back)\b(?:\s+(?:everything|it all|all(?: of it)?|my (?:bag|gains|profits?|money)|this|it))?(?:\s+so\b)?/g, ' ')
    .replace(/\b(?:not|dont|do not)\s+(sell(?:ing)?\s+)?(?:all|everything|it all|the whole (?:bag|thing)|my whole bag)(?:\s+of it)?\s+(?:just|only|but|rather)\b/g, (_, verb?: string) => (verb ? ' sell ' : ' '))
    .replace(/^(?:dont|do not|never)\s+sell\s+(?:anything\s+|it\s+|yet\s+)?(?:until|till|til|before)\s+/, 'when ')
    .replace(/\boff the table\b/g, 'off')
    .replace(/\s+/g, ' ')
    .trim();
}
const THANKS = /^(?:thanks|thank you|thx|ty|tysm|cheers|ok|okay|cool|nice|great|perfect|awesome|got it|k|kk)$/;
const NOW = /\b(?:now|right now|rn|immediately|instantly|asap|at market|market (?:buy|sell|order))\b/;

function strip(s: string): { s: string; greeted: boolean } {
  let greeted = false;
  for (let i = 0; i < 12; i++) {
    const g = s.match(GREETING);
    if (g && g[0]) {
      greeted = true;
      s = s.slice(g[0].length);
      continue;
    }
    const l = s.match(LEAD);
    if (l && l[0]) {
      s = s.slice(l[0].length);
      continue;
    }
    const t = s.match(TAIL);
    if (t && t[0]) {
      s = s.slice(0, s.length - t[0].length);
      continue;
    }
    break;
  }
  return { s: s.trim(), greeted };
}

/** A pasted contract address (0x… or a Solana mint) — Tippy finds coins by ticker. */
const ADDRESS = /\b0x[0-9a-fA-F]{40}\b|\b[1-9A-HJ-NP-Za-km-z]{32,44}\b/;

// ---- A message being read: pieces are taken (blanked) as they're understood ----

/**
 * What a taken piece is blanked with. Not a space, so a later pattern can't
 * match across it ("sell at 700k 50%": the 50% doesn't follow "at" once 700k is
 * taken) — and not a word character, so \b still works next to it.
 */
const GAP = '·';

class Msg {
  constructor(public s: string) {}
  has(re: RegExp): boolean {
    return new RegExp(re.source, re.flags.replace('g', '')).test(this.s);
  }
  /** Every match of `re` that `keep` accepts, blanked out so later passes can't read it twice. */
  take(re: RegExp, keep: (m: RegExpExecArray) => boolean = () => true): RegExpExecArray[] {
    const g = new RegExp(re.source, re.flags.includes('g') ? re.flags : `${re.flags}g`);
    const found: RegExpExecArray[] = [];
    for (let x = g.exec(this.s); x; x = g.exec(this.s)) {
      if (!x[0]) {
        g.lastIndex++;
        continue;
      }
      if (keep(x)) found.push(x);
    }
    let s = this.s;
    for (const x of found) s = s.slice(0, x.index) + x[0].replace(/\S/g, GAP) + s.slice(x.index + x[0].length);
    this.s = s;
    return found;
  }
  /** The words still unread. */
  words(): string[] {
    return this.s.split(/[\s·]+/).filter(Boolean);
  }
  /** The message without the taken pieces (for a fresh read of what's left). */
  rest(): string {
    return this.s.replace(/·+/g, ' ').replace(/\s+/g, ' ').trim();
  }
}

const rx = (src: string) => new RegExp(src);

// A number: "500", "1.5", ".004". One capture group.
const NUM = String.raw`(\d+(?:\.\d+)?|\.\d+)`;
const MCW = String.raw`(?:mc|mcap|m cap|market cap|market caps|fdv|cap|valuation)`;
/** The number ends here (not 2x, 500k, 20%, 1.5.2). */
const END = String.raw`(?![\w.%])`;
const NOT_MC = String.raw`(?!\s*${MCW}(?!\w))`;

// ---- Words -----------------------------------------------------------------

/** "lock in profits": a take-profit ("lock in some profits" still asks how much). */
const LOCK_IN = String.raw`lock(?:ing)? in(?=\s+(?:some\s+|my\s+|the\s+|\$\d+(?:\.\d+)?k?\s+(?:of\s+)?)?(?:profits?|gains?)\b)`;
const TP_W = new RegExp(String.raw`\b(?:tps?|take ?profits?|profit taking|tp\d|${LOCK_IN})\b`);
/** "out at 2x", "im out at 2m", "gtfo at 300k", "bail at 400k", "get me out completely": the whole bag, unless a size is said. */
const OUT = String.raw`^(?:im |i m |i am |ill be |i ll be )?out\b|\b(?:get me out|get out|gtfo|bail(?: out)?|be out|im out|i m out|i am out|all out)\b|\bclose (?:out )?(?:my |the |this )?(?:position|bag|trade)\b`;
const SELL_W = new RegExp(
  String.raw`\b(?:sell|sells|selling|offload|unload|scale out|dump|trim|cut|cash ?out|exit|pull out)\b|${OUT}|\b(?:secure|close)\s+(?=[\d$]|half|a\s|all|some|the rest|everything|my initials|initials)|\btake\s+(?:off\s+|out\s+)?(?:my\s+)?(?:half|a quarter|a third|quarter|third|some|initials?|all|everything|the rest|profits?|\d|\$)|\b(?:pull|get|grab|recover)\s+(?:out\s+|back\s+)?(?:my\s+)?initials?\b`,
);
const SL_W = /\b(?:sl|stop ?loss|stop|stops|stop out|partial stops?|cut (?:my )?loss(?:es)?|loss limit|max loss)\b/;
/** "exit at 2m", "get me out at 500k", "out at 2x": sell all of it unless a size is said. */
const ALL_OUT = new RegExp(String.raw`\bexit\b|${OUT}`);
/** "sell 10% every 2x" — a ladder; Tippy places one level at a time. */
const EVERY = /\b(?:every|each)\s+(?:[+-]?\d|\.\d|time|other)/;
const LADDER = 'I place one level at a time — try "sell 10% at 2x" first, then "sell 10% at 4x".';
const NOT_COUNTED = 'I sell a % of your bag or a $ amount, not a number of coins — try "sell 50% at 2x" or "sell $5 at 2x".';

/** Verbs a sell's size can follow: "sell 10 at 700k", "tp 50 @ 1.2m", "sl $2 at 650k", "take out my $5". */
const TP_VERB = String.raw`tps?|take ?profits?|lock(?:ing)? in(?: some| my| the)? (?:profits?|gains?)`;
const SL_VERB = String.raw`sl|stop ?loss|stop|partial stop`;
const SELL_VERB = String.raw`sell|sells|selling|dump|trim|cut|cash ?out|secure|exit|unload|offload|scale out|take out|take off|take|pull out|close|get out|get me out|gtfo|bail(?: out)?|im out|i m out|be out|^out`;
const SIZE_FILL = String.raw`(?:out\s+|off\s+)?(?:my\s+|another\s+|like\s+|about\s+|around\s+|only\s+|just\s+)?`;
const TRAIL_W = /\b(?:trailing ?stop(?: ?loss)?|trail ?stop|trailing|trails|trail|tsl|tsls)\b/;
/** "$3", "$1.5k", "10 bucks", "5 usd": dollars as typed. */
const DOLLARS = String.raw`(?:\$\.?\d[\d.]*k?|\d[\d.]*k?\s*(?:bucks?|dollars?|usd[ct]?|bux)\b)`;
/**
 * Buying, however it's said: "dca 10 at 500k", "long $3", "double down with $3", "average down", "spend $4",
 * "throw $3 at it", "get me $3 of wif", "add $3 to my bag" (the last few only with dollars right after).
 */
const BUY_V = new RegExp(
  String.raw`\b(?:buy|buying|limit buy|bid|ape|aping|ape in|scoop|snipe|grab|accumulate|load up|purchase|dip buy|rebuy|buy back|dca|dcaing|spend(?:ing)?(?=\s+(?:another\s+|like\s+|about\s+)?(?:\$|\.?\d))|double down|doubling down|average down|averaging down|avg down|go long|long(?=\s+(?:another\s+|more\s+)?\$?\.?\d)|^long(?=\s+(?:at|if|when|once|below|under|on)\b)|(?:top|topping) up(?=\s+(?:another\s+|more\s+)?(?:\$?\.?\d|(?:my\s+)?(?:bag|position|stack)\b)))\b|\b(?:throw|throwing)(?=\s+(?:in\s+)?(?:another\s+)?${DOLLARS}\s+(?:more\s+)?(?:at|of|in|into|to|on|if|when|below|under)\b)|\bget me(?=\s+(?:another\s+)?${DOLLARS})|\bget(?=\s+(?:another\s+)?${DOLLARS}\s+(?:more\s+)?(?:of|worth)\b)|\badd(?=\s+(?:another\s+)?${DOLLARS}\s+(?:more\s+(?:at|if|when|on)|(?:more\s+)?(?:to|into|in))\b)`,
);
const BUY_N = /\b(?:limit )?(?:buy|buys|buying|bid|bids|buy orders?|limit orders?|limit buys?|dip buys?)\b|\blimits?(?=\s*$|\s+(?:on|for|at|to)\b)/;
const ADD_V = /\b(?:add|another|new|extra|create|one more)\b/;
const GUARD_V = /\b(?:guard|protect|cover)\b/;

const DOWN =
  'dips?|dipped|dipping|drops?|dropped|dropping|dumps?|dumped|dumping|falls?|fell|falling|down|crash(?:es|ed)?|crashing|tanks?|tanked|tanking|bleeds?|bleeding|sinks?|sank|sinking|corrects?|correcting|pulls? back|pulling back|pullback|retraces?|retraced|retracing|loses|lost|declines?|declining|slides?|sliding|goes down|is down|lower by|red by|nukes?|nuked|nuking|rugs|rugged|rugging|craters?|cratered|cratering|plummets?|plummeted|plummeting|plunges?|plunged|plunging|collapses?|collapsed|collapsing|slips|slipped|slipping';
const UP =
  'up|pumps?|pumped|pumping|rises?|rose|rising|breaks? ?out|broke ?out|breaking ?out|breakout|goes up|gains?|gained|rally|rallies|rallying|moons?|mooning|climbs?|climbing|jumps?|jumped|jumping|rips?|ripping|spikes?|spiking|is up|higher by|green by|runs? up|ran up|surges?|surging|sends?|rockets?|rocketed|rocketing|soars?|soared|soaring|recovers?|recovered|recovering|bounces?|bounced|bouncing|rebounds?|rebounded|rebounding|reclaims?|reclaimed|reclaiming|flips?|flipped|flies|flew|flying|squeezes?|squeezed';

/** "if it drops to", "dips below", "falls under", "below 700k" — a level reached on the way down. */
const DOWN_TO = new RegExp(String.raw`\b(?:${DOWN})\s+(?:back\s+)?(?:to|below|under|beneath|toward|towards|into|at)\b|\b(?:below|under|beneath)\b(?=\s*[+-]?\$?[\d.])`);
/** "if it pumps to", "breaks out above", "above 2m" — a level reached on the way up. */
const UP_TO = new RegExp(String.raw`\b(?:${UP})\s+(?:back\s+)?(?:to|above|over|past|at)\b|\b(?:above|past)\b(?=\s*[+-]?\$?[\d.])|(?<!\b(?:${DOWN}|${UP})\s+)\bover\b(?=\s*[+-]?\$?[\d.])`);

/** Who moves in "if it drops", "when it's down", "once the price pumps", "if mc dips". */
const SUBJECT = String.raw`(?:(?:it|its|it is|it s|we|were|we re|we are|the price|price|mc|mcap|market cap|the mc|the mcap|the market cap)\s+)?(?:(?:is|has|gets|goes|ever|starts|starts to|begins to)\s+)?`;

/** "tp at 200%": 2x the price (200% of it), or up 200% (3x)? */
function bigPct(n: number, at: (level: string) => string = (l) => `tp at ${l}`): string {
  // ("at 100%" as 1x is the price now — never a take-profit.)
  if (n === 100) return `Is "100%" up 100% (2x)? Say "${at('+100%')}".`;
  const of = formatX(n / 100);
  const up = formatX(1 + n / 100);
  return `Is "${n}%" ${of} the price, or up ${n}% (${up})? Say "${at(of)}" or "${at(`+${n}%`)}".`;
}

/** Words that can't be a coin's ticker (a coin named like one needs a $: "$MOON" is fine). */
const VOCAB = new Set(
  `a an the my me mine i im ive id you u your ur yours it its this that these those here there now then than
  and or but so if when whenever once after before until till while as at to from by of on in into onto for with without w via per
  is are was were be been being am do does did doing done dont doesnt didnt cant can could would should will wont shall may might must
  gonna wanna gotta let lets pls please plz thanks thank thx ty tippy hey hi hello yo ok okay sure yes yeah yep yup no nope nah ya
  just also too very really quickly quick fast asap rn right immediately instantly soon later again still already maybe probably
  actually basically like about around near approx roughly only exactly over under above below between
  add adds added adding set sets setting put place placed create make makes new another extra one more some any other
  tp tps take takes taking took profit profits takeprofit tpsl initial initials investment
  sl stop stops stopped loss losses stoploss cut limit max
  trail trailing trails tsl
  sell sells selling sold dump offload unload scale buy buys buying bought bid bids ape aping scoop snipe grab accumulate load purchase
  order orders rebuy trim trimming secure cash cashout exit partial every each ladder
  move moved moving change changing changed chg raise raising lower lowering bump adjust shift drag push pull lift tighten loosen
  update edit modify switch reset remove removing delete del cancel cancelled canceled cancelling kill drop clear scrap nuke ditch undo
  rm rid get turn off disable enable enabled disabled pause paused pausing unpause unpaused resume resumed continue restart unfreeze
  freeze suspend halt snooze wake up back on guard guarding guarded protect protecting protection protected cover watch watching
  unguard unprotect unwatch plan plans preset presets classic forget abort close end quit
  show list status stats what whats how hows where wheres which check view see display tell give gimme lemme report summary overview
  happening going doing practice practicing test testing dry run rehearse simulate mock demo
  half quarter quarters third thirds two three all everything rest remaining whole entire full bag bags position positions stack
  holdings tokens token coins coin supply
  mcap mc market cap fdv valuation price prices level levels target targets point
  dip dips dipping dipped drops dropping dropped dumps dumping falls falling fell down crash crashes crashed tanks tanked retrace
  retraces pullback correction red green
  pumps pumping pumped rises rising rise breaks break breakout broke out goes go going gains gain rally rallies moons climbs jumps rips
  higher hits hit reaches reach reached gets got
  x times double doubles doubled twice triple triples
  dollars dollar bucks usd usdc usdt worth
  hour hours hr hrs day days week weeks min mins minute minutes
  expire expires expiry expiring expiration never forever gtc
  entry breakeven even cost basis
  etc lol lmao bro ser sir fren mate man dude lfg gm gn wagmi ngmi fam boss chief
  first second fourth fifth last final number no num
  afterwards also auto automatically lines line chart dashed percent percentage moves multiple multiples mode units unit
  live real money paper trading simulation sim fake pretend sell-off everyone every coin moon
  send gang fr frfr ngl tbh idk nfa dyor bruh yolo gg ez
  four five six seven eight nine ten eleven twelve twenty thirty forty fifty sixty seventy eighty ninety hundred point
  fomo pump way strength weakness top bottom wait solana chain
  we us ours ourselves ur youre yall ill youll theyre hes shes them they their him her his she he someone anyone anything something nothing
  ever honestly literally seriously totally completely fully entirely kinda sorta definitely def prob probs hopefully finally eventually
  anyway anyways ish much many lot lots want wants wanted need needs needed think thought guess hope hoping wish feel know mean meant
  try trying keep keeping hold holding ride riding leave stay start starts started starting begin begins rug rugs rugged rugging rugpull
  bleed bleeds bleeding sink sinks sank sinking slide slides sliding decline declines declining correct corrects correcting retraced
  retracing pulls pulling lose loses lost tank tanking crashing rose rally rallying mooning climb climbing jump jumped jumping rip
  ripping spike spikes spiking runs ran surge surges surging sends gained gtfo bail bailing lock locking
  spend spending dca dcaing long short throw throwing average averaging avg trade trades bit tad smidge little notch slightly somewhat n nd
  nuke nukes nuked nuking crater craters cratered cratering plummet plummets plummeted plummeting plunge plunges plunged plunging
  collapse collapses collapsed collapsing rocket rockets rocketed rocketing soar soars soared soaring
  moves swing swings swung swinging shorts shorting top topping cool nice great awesome perfect fine sweet dope
  except besides remainder left leftover leftovers whatever remains remain least less fewer almost nearly anymore
  ath atl peak peaks high highs low lows support resistance retest retests bounce bounces bounced bouncing wick wicks wicked wicking
  reclaim reclaims reclaimed flip flips flipped touch touches touched tag tags tagged print prints printed slip slips slipped
  fly flies flew flying closes closed recover recovers recovered recovering rebound rebounds rebounded dumped dumpers
  open pending active working outstanding existing bot bots gl glhf mev slippage slip priority prio fee fees gas tip jito exp ttl
  whale whales jeet jeets seller sellers buyer buyers hands everybody somebody people crowd apes exits cuts trims bails
  skip skipped nvm nevermind scratch cease halve pos have having had`.split(/\s+/),
);

/**
 * Everyday English that is never a ticker without its $ ("sell half at 2x tomorrow", "is 1m a good tp"),
 * but not filler either: left over in an order it changes what was meant, so Tippy asks about it.
 */
const COMMON = new Set(
  `tomorrow tmrw tmr tonight today yesterday morning evening afternoon weekend night month year later earlier
  monday tuesday wednesday thursday friday saturday sunday mon tue tues wed thu thur thurs fri sat sun
  good bad best better worse worst smart wise dumb stupid crazy insane decent solid safe risky idea ideas
  happens happen happened why who whose whom not nor neither either unless instead otherwise because cause cuz since though although
  question advice opinion recommend suggest`.split(/\s+/),
);

const PREPS = new Set(['on', 'for', 'of', 'in', 'into', 'from']);
/**
 * Everyday words that are filler in a message ("a bit higher", "if it ever breaks", "go long") but could be a
 * ticker too. Named as the coin ("of my rug", "on long") one of them is asked about — never swapped for the coin on screen.
 */
const SOFT = new Set(
  `long short lock rug rugs rugged bit tad smidge notch hope wish think guess feel know mean try stay ride hold keep
  ever honestly literally lot lots ish bail gtfo spend throw average avg dca completely fully entirely totally start starts pump moon send gang`.split(/\s+/),
);
const FILLER = new Set(['my', 'the', 'our', 'this', 'coin', 'token', 'bag']);
const HERE_W = /\b(?:this|here|current|this coin|this one|this token)\b/;
const ALL_W = /\b(?:all|everything|every coin|all coins|everyone|every plan|tippy|yourself|globally|all of them|bot|the bot|bots)\b/;

/** After "it" / "we" (and "is", "gets"…) a word is what the coin does — "if it reclaims 1m", "once it prints 1m" — never a ticker. */
const SUBJECTS = new Set(['it', 'its', 'we']);
const AUX = new Set(['is', 'has', 'gets', 'got', 'was', 'goes', 'ever', 'starts', 'begins', 'to', 'just', 'finally', 'really', 'then', 's', 'll', 'actually']);
function verbSlot(ws: string[], i: number): boolean {
  let j = i - 1;
  for (let hops = 0; j >= 0 && hops < 2 && AUX.has(ws[j]); hops++) j--;
  return j >= 0 && SUBJECTS.has(ws[j]);
}

const isTicker = (w: string) =>
  /^[a-z][a-z0-9]{1,19}$/.test(w) && !VOCAB.has(w) && !COMMON.has(w) && !/^(?:tps?|sl|p|x)\d+$/.test(w);

/** "$CLAUDIA", "$wif" — a $ before letters (a $ before a number is money). */
function takeDollarCoins(m: Msg): string[] {
  const out = m.take(/(?<![\w$])\$([a-z0-9_]+)/g, (x) => /[a-z]/.test(x[1]) && !/^\d*\.?\d+[kmbx]?$/.test(x[1]));
  return [...new Set(out.map((x) => x[1].toUpperCase()))];
}

interface Ctx {
  unit: Unit;
  /** "now", "rn", "at market" — someone asking for an instant trade. */
  now: boolean;
  /** $COINS already taken out of the message. */
  dollars: string[];
}

/** Which coin the message is about: a $COIN, a ticker word, "all", or the coin on screen. */
function findCoin(m: Msg, c: Ctx, opts: { all?: boolean; dflt?: 'here' | 'all' } = {}): CoinSpec | { all: true } | Hint {
  if (c.dollars.length > 1) return { hint: `One coin at a time, please — I saw ${c.dollars.map((d) => `$${d}`).join(' and ')}.` };
  const ws = m.words();
  const cands: { w: string; named: boolean }[] = [];
  ws.forEach((w, i) => {
    if (!isTicker(w) || verbSlot(ws, i)) return;
    // Named as the coin: "on CLAUDIA", "of my wif", "sell my bonk".
    const named = PREPS.has(ws[i - 1] ?? '') || ws[i - 1] === 'my' || (FILLER.has(ws[i - 1] ?? '') && PREPS.has(ws[i - 2] ?? ''));
    cands.push({ w, named });
  });
  const named = [...new Set(cands.filter((x) => x.named).map((x) => x.w))];
  // "sell half of my rug at 2x": an everyday word named as the coin — that coin, or the one on screen? Asked.
  if (!c.dollars.length && !cands.length) {
    const soft = ws.find((w, i) => (SOFT.has(w) || COMMON.has(w)) && (PREPS.has(ws[i - 1] ?? '') || ws[i - 1] === 'my' || (FILLER.has(ws[i - 1] ?? '') && PREPS.has(ws[i - 2] ?? ''))));
    if (soft) return { hint: `Is "${soft}" the coin? Put a $ in front of it, like "$${soft.toUpperCase()}" — or leave it out for the coin on screen.` };
  }
  if (c.dollars.length === 1) {
    // "sell half of $wif at 2x on claudia": a second coin named too — ask, never pick one.
    const other = named.filter((w) => w !== c.dollars[0].toLowerCase());
    if (other.length) return { hint: `Which coin — $${c.dollars[0]} or $${other[0].toUpperCase()}? One at a time: put a $ in front of the one you mean, like "$${c.dollars[0]}".` };
    return { symbol: c.dollars[0] };
  }
  const uniq = [...new Set(cands.map((x) => x.w))];
  // "sell half at 2x on this and wif": the coin on screen and another — one at a time, never just the other one.
  if (uniq.length === 1 && rx(String.raw`\b(?:this|here|this coin|this one|current)\s+(?:and|&|plus|or|n)\s+|\b(?:and|&|plus|or|n)\s+(?:this|here|this coin|this one)\b`).test(m.s))
    return { hint: `One coin at a time — the one on screen, or $${uniq[0].toUpperCase()}? Say the order once for each, like "sell half at 2x on ${uniq[0].toUpperCase()}".` };
  if (uniq.length === 1) return { symbol: uniq[0].toUpperCase() };
  if (uniq.length > 1 && /\b(?:and|&|plus|n)\b|,|\//.test(m.s)) {
    // "on CLAUDIA and WIF": two coins on purpose — ask, never pick one.
    return { hint: `One coin at a time — ${uniq.slice(0, 3).map((w) => `$${w.toUpperCase()}`).join(' or ')}? Which coin first?` };
  }
  if (uniq.length > 1) {
    // "sell haf at 2x on claudia": the coin is the one named with "on" — the stray word is the caller's to question.
    if (named.length === 1) return { symbol: named[0].toUpperCase() };
    // "sell my claudia for wif": two coins named — a swap? Never pick one.
    const names = (named.length > 1 ? named : uniq).slice(0, 3).map((w) => `$${w.toUpperCase()}`);
    return { hint: `Which coin — ${names.join(' or ')}? Put a $ in front of it, like $TIPPY.` };
  }
  if (opts.all && m.has(ALL_W)) return { all: true };
  if (m.has(HERE_W)) return { here: true };
  return opts.dflt === 'all' ? { all: true } : { here: true };
}

/** findCoin for commands that work on one coin (no "all"). */
function oneCoin(m: Msg, c: Ctx, allHint: string): CoinSpec | Hint {
  const coin = findCoin(m, c, { all: true });
  if ('all' in coin) return { hint: allHint };
  return coin;
}

// ---- Levels ------------------------------------------------------------------

interface Found {
  spec: LevelSpec;
  /** Said as a nudge ("up 10%", "down 20%") rather than a place. */
  rel: boolean;
  /** Said on the way down ("down 2x", "a 2x dip"): a buy there is a dip buy. */
  down?: true;
}
interface Scan {
  levels: Found[];
  amb: string[];
  /** Unsigned "50%" — the caller decides (a sell size, a drop, a rise…). */
  bare: { n: number; at: boolean }[];
  /** The first level asked about for its missing k / m ("600" → "600k"): to ask about it and a size in one question. */
  fix?: { q: string; levels: string[] };
}

/**
 * The message's own order with a level put in, for an example to copy whole:
 * "sell half at 600k", "buy $5 if it dips 20%", "move tp1 to 2m". Every "Say …"
 * in a reply is a message that works on its own — never a fragment like "600k".
 */
interface Eg {
  /** "600k" → "sell half at 600k". */
  at: (level: string) => string;
  /** 20 → "sell half if it drops 20%" / "sl -20%" / "buy $5 if it dips 20%". */
  drop: (n: number) => string;
  /** The amount was said (a buy's dollars) — a bare number is then surely the level. */
  sized: boolean;
}

function egFor(verb: 'tp' | 'sl' | 'sell' | 'buy', size?: string | null): Eg {
  const sized = !!size;
  if (verb === 'buy') {
    const u = size ?? '$10';
    return { at: (l) => `buy ${u} at ${l}`, drop: (n) => `buy ${u} if it dips ${n}%`, sized };
  }
  if (size) {
    const at = verb === 'tp' ? (l: string) => `tp ${size} at ${l}` : verb === 'sl' ? (l: string) => `sell ${size} if it drops to ${l}` : (l: string) => `sell ${size} at ${l}`;
    return { at, drop: (n) => `sell ${size} if it drops ${n}%`, sized };
  }
  if (verb === 'sell') return { at: (l) => `sell at ${l}`, drop: (n) => `sell all if it drops ${n}%`, sized };
  return { at: (l) => `${verb} at ${l}`, drop: (n) => `sl -${n}%`, sized };
}

/** A share of the bag the way you'd type it in an example: "all", "half", "25%". */
const pctWords = (n: number) => (n >= 100 ? 'all' : n === 50 ? 'half' : `${n}%`);

/** A bare "600", "5" or "30": which readings make sense, as levels to put in an example ("600k"; "5x" or "5m"). */
function bareReadings(n: number, side: Side): { q: string; levels: string[]; drop: boolean } {
  const k = `${n}k`;
  if ((side === 'sl' && n < 100) || (side === 'buy' && n < 50)) return { q: `Is "${n}" a ${side === 'buy' ? 'dip' : 'drop'} or a market cap?`, levels: [k], drop: true };
  if (side === 'tp' && n > 1 && n < 50) return { q: `Is "${n}" ${formatX(n)} or ${formatUsd(n * 1e6)} MC?`, levels: [`${n}x`, `${n}m`], drop: false };
  if (n < 50) return { q: `Is "${n}" ${formatUsd(n * 1e6)} MC?`, levels: [`${n}m`], drop: false };
  // (A multiple of 50x+ is never offered: "900x" isn't what "sell half at 900" meant — nor 1x, the price now.)
  return { q: `Is "${n}" ${formatUsd(n * 1e3)} MC?`, levels: [k], drop: false };
}

function bareHint(n: number, side: Side, eg: Eg): string {
  if (!(n > 0)) return 'That level doesn\'t look right — try something like "500k mcap" or "2x".';
  if (side === 'buy' && !eg.sized) {
    const lvl = n < 50 ? `"buy $10 if it dips ${n}%"` : `"buy $10 at ${n}k"`;
    return `Is "${n}" how much to spend, or where to buy? Say "buy $${n} if it dips 20%" for the amount, or ${lvl} for the level.`;
  }
  const r = bareReadings(n, side);
  const says = [...(r.drop ? [eg.drop(n)] : []), ...r.levels.map(eg.at)].map((x) => `"${x}"`);
  return `${r.q} Say ${says.join(' or ')}.`;
}

/**
 * A number with no k/m/b, no "x", no "%" — "1000000", "0.0007", "$0.0012", "700".
 * Big ones are market caps (memecoin prices are tiny) and small decimals are
 * prices; run.ts still checks a price is anywhere near the coin's before using
 * it. A plain "2" or "700" could be a multiple, a drop, a market cap or a price,
 * so Tippy asks — unless the chat reads bare numbers as moves.
 */
function plainLevel(raw: string, dollar: boolean, side: Side, unit: Unit, eg: Eg = egFor(side)): LevelSpec | string {
  const n = +raw;
  if (n >= 1000) return { kind: 'mc', value: n };
  if (dollar || (n < 1 && raw.includes('.'))) return { kind: 'price', value: n };
  if (unit === 'move' && side === 'tp') return { kind: 'x', value: n };
  if (unit === 'move' && side === 'sl' && n > 0 && n < 100) return { kind: 'pct', value: -n };
  return bareHint(n, side, eg);
}

const dedupe = (fs: Found[]) => fs.filter((f, i) => fs.findIndex((g) => g.spec.kind === f.spec.kind && g.spec.value === f.spec.value) === i);

/** Find every level in the message (taking them out), read for a take-profit, a stop or a buy. `eg`: the order, for examples. */
function scanLevels(m: Msg, side: Side, unit: Unit, eg: Eg = egFor(side)): Scan {
  const out: Scan = { levels: [], amb: [], bare: [] };
  const lv = (spec: LevelSpec, rel = false, down = false) => {
    if (!(spec.value !== 0 && Number.isFinite(spec.value)) || (spec.kind !== 'pct' && spec.value < 0)) out.amb.push("That level doesn't look right — try something like \"500k mcap\" or \"2x\".");
    else out.levels.push({ spec, rel, ...(down ? { down: true as const } : {}) });
  };
  /** "-700k", "-$0.0005": a minus in front of a market cap or a price — never quietly dropped. */
  const negative = (x: RegExpExecArray) => /(?:^|\s)-\s?$/.test(x.input.slice(0, x.index));
  const NEGATIVE = "A market cap or a price can't be negative — try something like \"700k\", or a drop like \"-20%\".";
  /** A market cap under $1,000 isn't a real one: "900 mc" (900k?), "0.0005 mcap" (the price?). */
  const mcAt = (n: number, said: string) => {
    if (n >= 1000) return lv({ kind: 'mc', value: n });
    if (n < 1) return out.amb.push(`Is "${said}" the price, $${n}? A market cap can't be that small. Say "${eg.at(`$${n}`)}" for the price — or the market cap with its k or m, like "${eg.at('500k')}".`);
    const guess = n < 50 ? `${n}m` : `${n}k`;
    const q = `Is "${said}" ${formatUsd(n * (n < 50 ? 1e6 : 1e3))} MC?`;
    out.fix ??= { q, levels: [guess] };
    out.amb.push(`${q} Say "${eg.at(guess)}".`);
  };
  // "down 2x", "2x down", "a 2x dip", "dips 3x": it halves (thirds…) — a multiple below now, never the 2x above.
  const downX = (n: number) => {
    if (n === 1) return out.amb.push('Down 1x? Say how far, like "if it drops 50%" or "0.5x".');
    lv({ kind: 'x', value: n > 1 ? +(1 / n).toFixed(6) : n }, false, true);
  };
  for (const x of m.take(rx(String.raw`\b(?:${DOWN})\s+(?:by\s+|another\s+|like\s+|about\s+|around\s+)?${NUM}x(?:s|es)?(?![\w.])`))) downX(+x[1]);
  for (const x of m.take(rx(String.raw`(?<![\w.$-])${NUM}x\s+(?:down|dips?|drops?|dumps?|dumping|lower|crash(?:es)?|correction|pullback|pull back|retrace|retracement|red|loss|nukes?|rugs?|tanks?|bleeds?)\b`))) downX(+x[1]);
  for (const _ of m.take(/\b(?:halves|halved|halving)\b/)) lv({ kind: 'x', value: 0.5 }, false, true);
  // "a double dump": down to half — or twice? Asked, never read as "double" (2x up).
  for (const x of m.take(/\b(double|triple)\s+(?:dumps?|dips?|drops?|crash(?:es)?|down|nukes?|rugs?|tanks?)\b/))
    out.amb.push(`Is a "${x[0]}" a fall to ${x[1] === 'double' ? '0.5x' : '0.33x'} of the price? Say "${eg.drop(x[1] === 'double' ? 50 : 67)}" — or the level, like "${eg.at('500k')}".`);
  // "-2x": half the price, or double? A signed multiple is a question, never the opposite side.
  for (const x of m.take(rx(String.raw`(?<![\w.$])-\s?${NUM}x(?:s|es)?(?![\w.])`))) {
    const n = +x[1];
    const half = n > 1 ? formatX(+(1 / n).toFixed(4)) : formatX(n);
    // ("-0.5x" up is 1.5x — never 0.5x, which is below the price.)
    const upX = n > 1 ? formatX(n) : formatX(+(1 + n).toFixed(4));
    out.amb.push(`Is "-${x[1]}x" down to ${half} of the price, or ${upX} up? Say "${eg.drop(Math.round((1 - (n > 1 ? 1 / n : n)) * 100))}" for down, or "${eg.at(upX)}" for up.`);
  }
  const pct = (n: number, sign: 1 | -1, rel = false) => {
    if (sign < 0 && n >= 100) out.amb.push("A coin can't drop 100% or more — try something like \"-30%\".");
    else lv({ kind: 'pct', value: sign * n }, rel);
  };
  const nudge = (s: string) => /^(?:up|down|is up|is down|higher by|lower by)\b/.test(s.trim());

  if (side === 'sl') for (const _ of m.take(/\b(?:break ?even|(?:my |the )?entry(?: price)?|cost basis)\b|(?<=\b(?:to|at) )be\b/)) lv({ kind: 'x', value: 1 });
  for (const _ of m.take(/\b(?:doubles?|doubled|doubling|twice)\b/)) lv({ kind: 'x', value: 2 });
  for (const _ of m.take(/\b(?:triples?|tripled|tripling)\b/)) lv({ kind: 'x', value: 3 });
  for (const x of m.take(rx(String.raw`(?<![\w.$])${NUM}x(?:s|es)?(?![\w.])`))) lv({ kind: 'x', value: +x[1] });
  for (const x of m.take(rx(String.raw`(?<![\w.])x${NUM}${END}`))) lv({ kind: 'x', value: +x[1] });

  // Moves: "dips 20%", "20% dip", "breaks out 15%", "up 15%", "-20%", "+15%".
  for (const x of m.take(rx(String.raw`\b(?:${DOWN})\s+(?:by\s+|another\s+|over\s+|more than\s+|like\s+|about\s+|around\s+)?-?${NUM}%?${END}${NOT_MC}`)))
    pct(+x[1], -1, nudge(x[0]));
  for (const x of m.take(rx(String.raw`(?<![\w.$+-])${NUM}%\s*(?:dips?|drops?|dumps?|down|lower|below|pullback|pull back|retracement|retrace|correction|red|loss|decline|under|hit|haircut|nukes?|rugs?|crash(?:es)?|tanks?|bleeds?)\b`)))
    pct(+x[1], -1);
  for (const x of m.take(rx(String.raw`\b(?:${UP})\s+(?:by\s+|another\s+|over\s+|more than\s+|like\s+|about\s+|around\s+)?\+?${NUM}%?${END}${NOT_MC}`)))
    pct(+x[1], 1, nudge(x[0]));
  for (const x of m.take(rx(String.raw`(?<![\w.$+-])\+?${NUM}%\s*(?:up|higher|above|breakout|break out|pump|green|gains?|profits?|rise|in profit)\b`)))
    pct(+x[1], 1);
  for (const x of m.take(rx(String.raw`(?<![\w.$%])([+-])${NUM}%?${END}${NOT_MC}`))) pct(+x[2], x[1] === '-' ? -1 : 1);

  // Market caps and prices.
  for (const x of m.take(rx(String.raw`\bprice\s+(?:of\s+|at\s+|is\s+|hits\s+|target\s+|reaches\s+)?\$?${NUM}${END}`))) lv({ kind: 'price', value: +x[1] });
  for (const x of m.take(rx(String.raw`(?<![\w.])\$?${NUM}([kmb])(?![\w.%])(?:\s*${MCW}(?!\w))?`))) {
    if (negative(x)) out.amb.push(NEGATIVE);
    else mcAt(+x[1] * { k: 1e3, m: 1e6, b: 1e9 }[x[2] as 'k' | 'm' | 'b'], x[0].trim());
  }
  for (const x of m.take(rx(String.raw`(?<![\w.])\$?${NUM}\s*${MCW}(?!\w)`))) {
    if (negative(x)) out.amb.push(NEGATIVE);
    else mcAt(+x[1], x[0].trim());
  }
  for (const x of m.take(rx(String.raw`\b${MCW}\s+(?:of\s+|at\s+|is\s+|hits\s+|around\s+|reaches\s+)?\$?${NUM}${END}`))) mcAt(+x[1], x[0].trim());
  for (const x of m.take(rx(String.raw`(?<![\w.%+$-])(\$)?${NUM}${END}`))) {
    const l = plainLevel(x[2], !!x[1], side, unit, eg);
    if (typeof l === 'string') {
      out.amb.push(l);
      if (!out.fix && !(side === 'buy' && !eg.sized)) {
        const r = bareReadings(+x[2], side);
        if (!r.drop) out.fix = { q: r.q, levels: r.levels };
      }
    } else lv(l);
  }
  for (const x of m.take(rx(String.raw`(?<![\w.%+$-])${NUM}%`))) {
    const before = x.input.slice(0, x.index);
    out.bare.push({ n: +x[1], at: /\b(?:at|to|hits?|reach(?:es)?|around)\s*$/.test(before) });
  }
  out.levels = dedupe(out.levels);
  return out;
}

/**
 * "sl at 50% of entry", "stop at half my entry", "tp at 3x my entry": a level
 * measured from the entry — taken before the size reader, which would read the
 * "50% of" as half the bag.
 */
function takeEntryLevels(m: Msg): Found[] {
  const out: Found[] = [];
  const ENTRY = String.raw`(?:my\s+|the\s+|your\s+)?(?:entry|buy ?in|cost basis|avg|average)(?:\s+price)?\b`;
  for (const x of m.take(rx(String.raw`(?<![\w.%+$-])${NUM}%\s+(?:of\s+)${ENTRY}`))) out.push({ spec: { kind: 'x', value: +(+x[1] / 100).toFixed(6) }, rel: false });
  for (const x of m.take(rx(String.raw`\b(?:a\s+|one\s+)?(half|third|quarter)\s+(?:of\s+)?${ENTRY}`)))
    out.push({ spec: { kind: 'x', value: { half: 0.5, third: 0.333333, quarter: 0.25 }[x[1] as 'half' | 'third' | 'quarter'] }, rel: false });
  for (const x of m.take(rx(String.raw`(?<![\w.$-])${NUM}x\s+(?:of\s+)?${ENTRY}`))) out.push({ spec: { kind: 'x', value: +x[1] }, rel: false });
  return out;
}

const isDown = (l: LevelSpec) => (l.kind === 'pct' && l.value < 0) || (l.kind === 'x' && l.value < 1);

/** A share as said: "25%", "half", "a quarter", "two thirds" — three capture groups (see shareOf). */
const SHARE = String.raw`(?:(\d+(?:\.\d+)?)%|(?:a\s+|one\s+)?(half|quarter|third|fifth|tenth)\b|(two thirds|three quarters))`;
const PART: Record<string, number> = { half: 50, quarter: 25, third: 33, fifth: 20, tenth: 10 };
/** The % a SHARE match says, from its capture groups starting at `i`. */
const shareOf = (x: RegExpExecArray, i: number) => (x[i] != null ? +x[i] : x[i + 1] ? PART[x[i + 1]] : x[i + 2] === 'two thirds' ? 67 : 75);
/** "what's left", "the remainder", "whatever is left": the rest of the bag. */
const REST_W = String.raw`(?:the rest|the remainder|remainder|whats left|what s left|what is left|whatever is left|whatevers left|whatever s left|whatever left|whats remaining|what remains|whatever remains|what i have left|what i got left|the remaining|my remaining|the leftovers?|my leftovers?|leftovers?)`;

/**
 * A size said as a share of something else — never read as a share of the bag:
 * "half of half" (25%), "half of what's left", "50% of my profits", "more than half".
 * The caller asks, with the share of the bag worked out where it can be.
 */
type Of =
  | { kind: 'nested'; said: string; pct: number }
  | { kind: 'rest'; said: string; pct: number }
  | { kind: 'profit'; said: string; pct: number }
  | { kind: 'fuzzy'; said: string; eg: number };

/** "sell half", "25%", "a third", "the rest", "initials". */
function takeSize(m: Msg): { pct: number | null; vals: number[]; initials: boolean; hint?: string; of?: Of } {
  const vals: number[] = [];
  let of: Of | undefined;
  for (const x of m.take(rx(String.raw`\b${SHARE}\s+of\s+(?:my\s+|the\s+|your\s+|that\s+|this\s+|our\s+)?${SHARE}(?!\s*(?:of\s+)?(?:my\s+|the\s+|your\s+)?(?:entry|buy ?in|cost basis|cash|balance|wallet|funds|money|usd|buying power)\b)`)))
    of ??= { kind: 'nested', said: x[0].trim(), pct: +((shareOf(x, 1) * shareOf(x, 4)) / 100).toFixed(2) };
  for (const x of m.take(rx(String.raw`\b${SHARE}\s+of\s+${REST_W}\b`))) of ??= { kind: 'rest', said: x[0].trim(), pct: shareOf(x, 1) };
  // ("sell half at 50% profit": a level, +50% — never a share of the profit.)
  for (const x of m.take(rx(String.raw`(?<!\b(?:at|to|hits?|reach(?:es)?|around|on|with|in|by)\s+|[+-])\b${SHARE}\s+(?:of\s+)?(?:my\s+|the\s+|your\s+|our\s+)?(?:profits?|gains?|pnl|winnings|upside)\b`))) of ??= { kind: 'profit', said: x[0].trim(), pct: shareOf(x, 1) };
  for (const x of m.take(/\b(?:sell|sells|selling|take|taking|dump|cash out|secure|unload|offload|pull out|take out)\s+(?:out\s+|off\s+)?(?:all\s+(?:of\s+)?)?(?:my|the|your|our)\s+(?:profits?|gains?|pnl|winnings)\b/))
    of ??= { kind: 'profit', said: x[0].trim().replace(/^\S+\s+/, ''), pct: 100 };
  // "more than half", "almost all", "sell under 50%": not a size yet — how much exactly?
  const FUZZY = String.raw`more than|over|less than|under|fewer than|almost|nearly|just under|just over|(?:a bit|a little|slightly) (?:more|less|over|under)(?: than)?`;
  for (const x of m.take(rx(String.raw`\b(${FUZZY})\s+(half|a quarter|a third|quarter|third|two thirds|three quarters|all|everything|the rest|it all|all of it)\b|(?<=\b(?:sell|sells|selling|dump|trim|take|cut|unload|offload|secure|tp|sl|stop)\s+)(${FUZZY})\s+(\d+(?:\.\d+)?)%`))) {
    const word = x[1] ?? x[3];
    const base = x[2] ? ({ half: 50, 'a quarter': 25, quarter: 25, 'a third': 33, third: 33, 'two thirds': 67, 'three quarters': 75 } as Record<string, number>)[x[2]] ?? 100 : +x[4];
    const less = /less|under|fewer|almost|nearly/.test(word);
    of ??= { kind: 'fuzzy', said: x[0].trim(), eg: Math.max(5, Math.min(95, base + (less ? -10 : 10))) };
  }
  // "all but 10%", "everything except a quarter", "all but like 10%": what's left after the part kept.
  for (const x of m.take(rx(String.raw`\b(?:all|everything|it all|the whole bag|my whole bag|my bag)\s+(?:off\s+)?(?:but|except(?: for)?|minus|apart from|save for|other than|bar|besides)\s+(?:like\s+|about\s+|around\s+|only\s+|just\s+|keep(?:ing)?\s+|leave\s+|leaving\s+)?(?:(\d+(?:\.\d+)?)%|(?:a\s+|one\s+)?(half|quarter|third|fifth|tenth)\b)`)))
    vals.push(+(100 - (x[1] != null ? +x[1] : PART[x[2]])).toFixed(4));
  // ("if we dump 40%" is a move, not a size.)
  for (const x of m.take(rx(String.raw`(?<!\b(?:if|when|once|it|its|it s|we|price|mc|mcap|cap)\s+)\b(?:sell|sells|selling|take|takes|taking|dump|offload|unload|scale out|close|trim|cut|cash ?out|secure|exit|pull out)\s+(?:off\s+|out\s+|another\s+|like\s+|about\s+)?${NUM}%`))) vals.push(+x[1]);
  for (const x of m.take(rx(String.raw`(?<![\w.%+$-])${NUM}%\s+(?=(?:of|off|out)\b)`))) vals.push(+x[1]);
  for (const _ of m.take(/\b(?:two|2) thirds\b/)) vals.push(67);
  for (const _ of m.take(/\b(?:three|3) quarters\b/)) vals.push(75);
  for (const _ of m.take(/\b(?:two|2) quarters\b/)) vals.push(50);
  for (const _ of m.take(/\b(?:a |one )?half\b/)) vals.push(50);
  for (const _ of m.take(/\b(?:a |one )?quarter\b/)) vals.push(25);
  for (const _ of m.take(/\b(?:a |one )?third\b/)) vals.push(33);
  // "a fifth", "two fifths", "a tenth", "three tenths" ("1/5", "3/10" read the same).
  const count = (w: string | undefined) => (!w || w === 'a' || w === 'an' ? 1 : COUNT_WORDS.indexOf(w));
  for (const x of m.take(/\b(?:(a|one|two|three|four)\s+)?fifths?\b/)) vals.push(20 * count(x[1]));
  for (const x of m.take(/\b(?:(a|one|two|three|four|five|six|seven|eight|nine)\s+)?tenths?\b/)) vals.push(10 * count(x[1]));
  // "sell my moonbag at 10x": the bag kept for the moon — the rest, never a coin called MOON.
  for (const _ of m.take(/\b(?:my |the |your )?moon bags?\b/)) vals.push(100);
  for (const _ of m.take(rx(String.raw`\b(?:all of it|it all|all|everything left|everything|${REST_W}|rest|whole bag|entire bag|full bag|whole thing|remaining|whole position|full position|entire position|completely|entirely)\b`))) vals.push(100);
  const initials = m.take(/\b(?:my )?initials?(?: investment)?\b|\binitial investment\b/).length > 0;
  const uniq = [...new Set(vals)];
  if (uniq.length > 1) return { pct: null, vals, initials, of, hint: `How much should it sell — ${uniq.slice(0, 2).map((v) => `${v}%`).join(' or ')}? Pick one.` };
  return { pct: uniq[0] ?? null, vals, initials, of };
}

/** "sell some", "most of it", "a little bit": part of the bag, but how much? Tippy asks — never all, never a guessed 50%. */
const VAGUE = /\b(?:some|(?<!\bat )most|(?:a )?(?:little )?bit|a little|a few|a portion|portion|part|a chunk|chunk|a piece|a bunch|a tad|a smidge|majority|the bulk|bulk|partially|partial(?!\s+stops?\b)|a couple|a slice|a small amount|a fraction|a lot|lots|a ton|tons|loads|heaps|a good amount|a good chunk)\b/;

/** The size words a slip could be meant as ("hal", "quart", "everyting"). */
const SIZE_WORDS = ['half', 'quarter', 'third', 'fifth', 'tenth', 'all', 'everything', 'rest', 'whole'];
/** A word that's probably a size typed wrong, or null. Clear slips are already fixed by TYPOS — these get a question. */
function sizeTypo(w: string): string | null {
  if (w.length < 3 || VOCAB.has(w) || !/^[a-z]+$/.test(w)) return null;
  for (const size of SIZE_WORDS) {
    if (slips(w, size) <= (size.length >= 6 ? 2 : 1)) return size;
    if (/^(?:half|quarter|third|fifth)$/.test(size) && size.startsWith(w) && size.length - w.length <= 3) return size; // "hal", "quart", "thir"
  }
  return null;
}
/** A number word nothing has read ("sell seven at 2x"): an amount, never something to skip. */
const NUMBER_LEFT = /^(?:two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|\S*\d\S*)$/;

/**
 * Words still unread once a sell or a buy is understood, apart from the coin: a
 * slip ("hlf"), a number ("50p"), a second coin… Leaving one out could change
 * how much is sold, so the caller asks instead.
 */
function unread(m: Msg, coin: CoinSpec): string[] {
  const own = 'symbol' in coin ? coin.symbol.toLowerCase() : '';
  return m.words().filter((w) => {
    if (w === own || !/[a-z0-9]/.test(w)) return false;
    if (/\d/.test(w)) return true; // "50p", "3rds"
    return !VOCAB.has(w) || NUMBER_LEFT.test(w);
  });
}

/**
 * A sell said in dollars: "sell $20", "take out 50 bucks", "5 dollars worth",
 * "$3 of $wif", "take $3 out", "tp $5 at 3x". run.ts turns it into a % of the
 * bag at the level's price. A "$" after "at" / "if it hits" is a level, not this.
 */
function takeSellUsd(m: Msg): number[] {
  const vals: number[] = [];
  const add = (n: string, k?: string) => vals.push(+n * (k ? 1000 : 1));
  for (const x of m.take(rx(String.raw`(?<![\w.])\$?${NUM}(k)?\s*(?:usd[ct]?|dollars?|bucks?|bux)(?:\s+worth)?(?!\w)`))) add(x[1], x[2]);
  for (const x of m.take(rx(String.raw`(?<![\w.])\$${NUM}(k)?(?:\s+worth\b|\s+(?=(?:of|out|off|into)\b))`))) add(x[1], x[2]);
  // Right after the verb. After "tp" / "sl" a "$0.004" is still a price level ("tp $0.004" = "tp at $0.004").
  // "sell $20 at 1m" / "sell $20 if …" / "sell $3": followed by how the level is said, or nothing ("sell $100k $372" is a question).
  // ("tp $5 2x", "sl $3 -20%": the level comes right after the dollars.)
  const after = rx(String.raw`(?<=\b(${SELL_VERB}|${TP_VERB}|${SL_VERB})\s+${SIZE_FILL})\$${NUM}(k)?${END}${NOT_MC}(?=[\s·]*$|\s+(?:at|if|when|whenever|once|below|above|under|over|on|for|of|worth|out|off|by|and|or|plus|profits?|gains?)\b|\s+${LEVEL_SAID})`);
  for (const x of m.take(after, (x) => !!x[3] || +x[2] >= 1 || !rx(`^(?:${TP_VERB}|${SL_VERB})$`).test(x[1]))) add(x[2], x[3]);
  // "sell $1m at 2x": dollars said after "sell" (run.ts says it's more than the bag) — never "dollars or coins?" again.
  for (const x of m.take(rx(String.raw`(?<=\b(?:${SELL_VERB})\s+${SIZE_FILL})\$${NUM}m${END}${NOT_MC}(?=\s+(?:at|if|when|whenever|once|on|for)\b|\s+${LEVEL_SAID})`))) vals.push(+x[1] * 1e6);
  // "sell $5 (50%) at 2x": dollars next to a % are a second size (asked), never a $5 price. ("stop $100k 1%" is a level and a size.)
  for (const x of m.take(rx(String.raw`(?<=\b(?:${SELL_VERB}|${TP_VERB}|${SL_VERB})\s+${SIZE_FILL})\$${NUM}(?![\w.%])(?=\s+(?:\d+(?:\.\d+)?|\.\d+)%)`), (x) => +x[1] >= 1)) add(x[1]);
  // "take $4 profit at 1.5m"; "tp at 1m for $3"; "tp 2x $5" (dollars last, after the level) — never a price of $3, $4, $5.
  for (const x of m.take(rx(String.raw`(?<![\w.])\$${NUM}(k)?\s+(?=(?:profits?|gains?)\b)`))) add(x[1], x[2]);
  for (const x of m.take(rx(String.raw`\bfor\s+\$${NUM}(k)?${END}${NOT_MC}`), (x) => !!x[2] || +x[1] >= 1)) add(x[1], x[2]);
  for (const x of m.take(rx(String.raw`(?<=(?:\d[kmbx]|[+-]\d+(?:\.\d+)?%|\b${MCW})\s+)\$${NUM}(k)?${END}${NOT_MC}(?=[\s·]*$)`), (x) => !!x[2] || +x[1] >= 1)) add(x[1], x[2]);
  return [...new Set(vals)];
}

/**
 * A plain number right after the verb: "tp 50 @ 1.2m", "sl 50 at 600k", "sell 10 at 700k".
 * Taken out so the caller can decide, once it knows whether there's a level too.
 */
function takeLead(m: Msg): { n: number; raw: string; verb: 'tp' | 'sl' | 'sell' } | null {
  const re = rx(String.raw`(?<=\b(${TP_VERB}|${SL_VERB}|${SELL_VERB})\s+(?:another\s+|like\s+|about\s+|around\s+|only\s+|just\s+)?)${NUM}(?![\w.%$])${NOT_MC}`);
  // "tp 3x 25", "sl 500k 50", "tp 2x 25 of it": the plain number right after the verb's level is the size too ("tp 25 at 3x").
  const after = rx(String.raw`(?<=\b(${TP_VERB}|${SL_VERB}|${SELL_VERB})\s+(?:at\s+|to\s+)?${LEVEL_SAID}\s+)${NUM}(?![\w.%$])${NOT_MC}${NOT_MONEY}`);
  // After "tp" / "sl" a small decimal is a price ("sl 0.0005"), not a size — leave it for the level reader.
  const keep = (x: RegExpExecArray) => +x[2] >= 1 || !rx(`^(?:${TP_VERB}|${SL_VERB})$`).test(x[1]);
  const x = m.take(re, keep)[0] ?? m.take(after, keep)[0];
  if (!x) return null;
  const verb = rx(`^(?:${TP_VERB})$`).test(x[1]) ? 'tp' : rx(`^(?:${SL_VERB})$`).test(x[1]) ? 'sl' : 'sell';
  return { n: +x[2], raw: x[2], verb };
}

/** A level said with its unit, the way it follows a verb: "3x", "500k", "1.5m mcap", "-20%", "x3" (a bare "$2" could be dollars too). */
const LEVEL_SAID = String.raw`(?:[+-]\d+(?:\.\d+)?%|\$?\d+(?:\.\d+)?[kmbx](?:\s*${MCW})?|\$?(?:\d+(?:\.\d+)?|\.\d+)\s*${MCW}|x\d+(?:\.\d+)?)(?![\w.%])`;

/** "Is 10 a % of your bag or dollars?" — a plain number after "sell" could be either. */
function sizeHint(raw: string, level: LevelSpec | null): string {
  const n = +raw;
  const at = level ? ` at ${typedLevel(level)}` : ' at 2x';
  const usd = usdText(n);
  if (n > 100) return `Is "${raw}" dollars? Say "sell ${usd}${at}" — or a % of your bag, like "sell 50%${at}".`;
  if (n < 1) return `Sell ${raw}% of your bag, ${usd} worth, or half? Say "sell ${raw}%${at}", "sell ${usd}${at}" or "sell half${at}".`;
  return `${raw}% of your bag, or ${usd} worth? Say "sell ${raw}%${at}" or "sell ${usd}${at}".`;
}

/** A level the way you'd type it: "700k", "$0.0007", "2x", "-20%". */
function typedLevel(l: LevelSpec): string {
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

/** "for 24h", "a day", "7d", "a week", "never expires" → ms / null; nothing → 'default'. */
function takeExpiry(m: Msg): number | null | 'default' | Hint {
  const vals: (number | null)[] = [];
  const never =
    /\b(?:never expires?|never expiring|never expire|no expiry|no expiration|no expire|no time limit|doesnt expire|dont expire|does not expire|do not expire|without (?:an )?expiry|gtc|good (?:till|til|until) cancel(?:l?ed)?|(?:until|till) (?:i )?cancel(?:l?ed|l?ing)?(?: it)?|forever|indefinitely)\b/;
  for (const _ of m.take(never)) vals.push(null);
  const UNIT: Record<string, number> = { h: 3_600_000, d: 86_400_000, w: 604_800_000, m: 60_000 };
  const re =
    /\b(?:(?:for|expires?(?: in| after)?|expiring(?: in)?|exp|expiry|expiration|ttl|valid for|good for|within|in|over|lasts?|keep it for|keep for)\s+)?(?:the next\s+)?(?:(an?|one)\s+|(\d+(?:\.\d+)?)\s*)(h|hr|hrs|hours?|d|days?|w|wk|wks|weeks?|mins?|minutes?)(?!\w)/;
  // ("a"/"an"/"one" need a space before the unit: "and" is not "an d" = one day.)
  for (const x of m.take(re)) {
    const n = x[2] ? +x[2] : 1;
    const u = x[3].startsWith('mi') ? 'm' : x[3][0] === 'w' ? 'w' : x[3][0] === 'd' ? 'd' : 'h';
    vals.push(n * UNIT[u]);
  }
  const uniq = [...new Set(vals)];
  if (uniq.length > 1) return { hint: 'How long should the buy wait? Pick one, like "for 24h" or "never expires".' };
  if (uniq.length === 1 && uniq[0] !== null && !(uniq[0] > 0)) return { hint: 'How long should the buy wait? Try "for 24h".' };
  return uniq.length ? uniq[0] : 'default';
}

const PRESET_IDS = ['safe', 'classic', 'moon'];

/** "with classic", "p2", "play it safe", "moon bag", "no guard" → preset id / 'none'; not mentioned → null. */
function takePreset(m: Msg): string | 'none' | null | Hint {
  const vals: string[] = [];
  const none =
    /\b(?:no|without|dont|do not|skip(?: the)?|zero)\s+(?:guard(?:ing)?|protection|protecting|protect(?: it)?|tpsl|tp\s*(?:or|and|&)?\s*sl|sl|tps?|preset|plan|stops?|take profits?)\b|\b(?:protect|guard)(?:ed)?(?: it)? with (?:none|nothing|no preset)\b|\bpreset none\b|\bunguarded\b|\bunprotected\b|\bnaked\b/;
  for (const _ of m.take(none)) vals.push('none');
  for (const _ of m.take(/\bplay(?:ing)? it safe\b/)) vals.push('safe');
  for (const _ of m.take(/\bclassic\b/)) vals.push('classic');
  for (const _ of m.take(/\bmoon ?bag\b/)) vals.push('moon');
  for (const x of m.take(/\b(?:p|preset\s*)([1-3])\b/)) vals.push(PRESET_IDS[+x[1] - 1]);
  for (const x of m.take(/(?<=\b(?:with|use|using|apply|preset)\s+(?:the\s+)?)(safe|moon)\b/)) vals.push(x[1] === 'safe' ? 'safe' : 'moon');
  const uniq = [...new Set(vals)];
  if (uniq.length > 1) return { hint: `Pick one preset — ${PRESETS}.` };
  return uniq[0] ?? null;
}

/** Dollar amounts for a buy: "$10", "10 bucks", "buy 25 of", "spend $5". */
function takeUsd(m: Msg): number[] {
  const vals: number[] = [];
  const add = (n: string, k?: string) => vals.push(+n * (k ? 1000 : 1));
  for (const x of m.take(rx(String.raw`(?<![\w.])\$?${NUM}(k)?\s*(?:usd[ct]?|dollars?|bucks?|bux)(?!\w)`))) add(x[1], x[2]);
  for (const x of m.take(
    rx(String.raw`\b(?:buy|buying|limit buy|ape(?: in(?:to)?)?|aping|spend(?:ing)?|put(?: in)?|bid|grab|scoop|snipe|purchase|get(?: me)?|with|using|for|worth|dca|long|throw|add|top up|topping up)\s+(?:me\s+|in\s+|another\s+|like\s+|about\s+|around\s+|only\s+|just\s+|more\s+)?\$${NUM}(k)?${END}${NOT_MC}`),
  ))
    add(x[1], x[2]);
  for (const x of m.take(rx(String.raw`(?<![\w.])\$${NUM}(k)?\s+(?=(?:of|worth|in|into)\b)`))) add(x[1], x[2]);
  for (const x of m.take(rx(String.raw`\b(?:buy|buying|limit buy|ape(?: in)?|bid|spend|purchase|grab|scoop|dca|long|top up|topping up)\s+(?:more\s+|another\s+)?${NUM}(k)?(?![\w.%$])(?!\s*(?:${MCW}|x)(?!\w))`))) add(x[1], x[2]);
  for (const x of m.take(rx(String.raw`(?<![\w.$])${NUM}(k)?\s+worth\b`))) add(x[1], x[2]);
  // "a buy of $3", "an order of $10" (a plain "of $0.004" is still a price).
  for (const x of m.take(rx(String.raw`\b(?:buy|buys|purchase|order|bid)\s+of\s+\$${NUM}(k)?${END}${NOT_MC}`))) add(x[1], x[2]);
  // "buy wif $10 at 1m": a plain "$10" that isn't introduced as a level.
  for (const x of m.take(rx(String.raw`(?<![\w.])\$${NUM}${END}${NOT_MC}`), (x) => {
    const before = x.input.slice(0, x.index);
    return +x[1] >= 1 && +x[1] < 1000 && !/\b(?:at|to|if|when|below|above|under|over|hits?|reach(?:es)?|around|near|price|is|of|@)\s*$/.test(before);
  }))
    add(x[1]);
  return [...new Set(vals)];
}

// ---- Which level of a plan: tp1 / the stop / the trail / the buy ----

type Target = { kind: 'tp'; index: number } | { kind: 'stop'; index: number } | { kind: 'sl' } | { kind: 'trail' } | { kind: 'buy' } | { kind: 'tp?' } | { kind: 'tps' };

/** "2 bucks", "3 dollars", "1 usd": an amount — the number before it is never a level's number. */
const NOT_MONEY = String.raw`(?!\s*(?:bucks?|dollars?|usd[ct]?|bux)\b)`;

const ORD: Record<string, number> = { first: 1, '1st': 1, second: 2, '2nd': 2, third: 3, '3rd': 3, fourth: 4, '4th': 4, fifth: 5, '5th': 5, one: 1, two: 2, three: 3, four: 4, five: 5 };

function takeTargets(m: Msg): Target[] | Hint {
  const ts: Target[] = [];
  for (const _ of m.take(TRAIL_W)) ts.push({ kind: 'trail' });
  for (const x of m.take(/\b(first|second|third|fourth|fifth|1st|2nd|3rd|4th|5th)\s+(?:tp|take ?profit)\b/)) ts.push({ kind: 'tp', index: ORD[x[1]] });
  if (m.take(/\b(?:last|final|top|highest|lowest|bottom|biggest|smallest)\s+(?:tp|take ?profit)\b/).length)
    return { hint: 'Which take-profit? Say its number, like "tp2".' };
  // ("tp 2 bucks at 2x" is a $2 take-profit, never TP2.)
  for (const x of m.take(rx(String.raw`\b(?:tp|take ?profit)\s*(?:number\s+|no\s+|num\s+)?([1-9])(?![\w.%])${NOT_MONEY}`))) ts.push({ kind: 'tp', index: +x[1] });
  // ("tp two" is TP2; "stop two thirds at 500k" is a size, never stop 2.)
  for (const x of m.take(rx(String.raw`\b(?:tp|take ?profit)\s+(one|two|three|four|five)\b(?!\s+(?:thirds?|quarters?|halves|half|fifths?|tenths?)\b)${NOT_MONEY}`))) ts.push({ kind: 'tp', index: ORD[x[1]] });
  for (const _ of m.take(/\b(?:tps|take ?profits|all (?:my |the )?(?:tps|take ?profits))\b/)) ts.push({ kind: 'tps' });
  for (const _ of m.take(/\b(?:tp|take ?profit)\b/)) ts.push({ kind: 'tp?' });
  // Partial stops by number ("stop 1", "the second stop"); a plain "stop" is the stop loss.
  for (const x of m.take(/\b(first|second|third|fourth|fifth|1st|2nd|3rd|4th|5th)\s+(?:partial\s+)?(?:stop|sl)\b(?!\s*loss)/)) ts.push({ kind: 'stop', index: ORD[x[1]] });
  if (m.take(/\b(?:last|final|top|highest|lowest|bottom|biggest|smallest)\s+(?:partial\s+)?stop\b(?!\s*loss)/).length)
    return { hint: 'Which stop? Say its number, like "stop 2".' };
  for (const x of m.take(rx(String.raw`\b(?:partial\s+)?(?:stop|sl)\s*(?:number\s+|no\s+|num\s+)?([1-9])(?![\w.%])${NOT_MONEY}`))) ts.push({ kind: 'stop', index: +x[1] });
  for (const x of m.take(rx(String.raw`\b(?:partial\s+)?stop\s+(one|two|three|four|five)\b(?!\s+(?:thirds?|quarters?|halves|half|fifths?|tenths?)\b)${NOT_MONEY}`))) ts.push({ kind: 'stop', index: ORD[x[1]] });
  if (m.take(/\bpartial\s+stops?\b/).length) return { hint: 'Which stop? Say its number, like "stop 2".' };
  // "clear my stops", "remove my stop losses": which one? (Never just the stop loss.)
  if (m.take(/\b(?:stops|stop ?losses|sls)\b/).length) return { hint: 'Which stop? Say "my stop" for the stop loss, or a partial stop by its number, like "stop 1".' };
  for (const _ of m.take(/\b(?:sl|stop ?loss|stoploss|stop)\b/)) ts.push({ kind: 'sl' });
  for (const _ of m.take(/\b(?:limit )?(?:buy|bid)s?(?: orders?)?\b|\blimit(?: orders?)?\b/)) ts.push({ kind: 'buy' });
  return ts.filter((t, i) => ts.findIndex((u) => u.kind === t.kind && (u as { index?: number }).index === (t as { index?: number }).index) === i);
}

const TARGET_START = String.raw`(?:tps?\d?|take ?profits?|sl|stop|stops|stop ?loss|stoploss|partial|trail|trailing|tsl|buy|buys|bid|limit|first|second|third|fourth|fifth|1st|2nd|3rd|4th|5th|last|final)(?![a-z])`;
const ART = String.raw`(?:(?:the|my|that|this|our|current)\s+)?`;
const MOVE_V = 'move|moving|change|changing|chg|raise|raising|lower|lowering|bump|adjust|shift|drag|push|pull|lift|tighten|loosen|update|edit|modify|switch|reset';
const SET_V = 'set|put|place|make';

/** Which families of order a message talks about — two at once is "one thing at a time". */
function families(s: string): Set<'tp' | 'sl' | 'trail' | 'buy'> {
  const f = new Set<'tp' | 'sl' | 'trail' | 'buy'>();
  let t = s;
  if (TRAIL_W.test(t)) {
    f.add('trail');
    t = t.replace(new RegExp(TRAIL_W.source, 'g'), ' ');
  }
  if (SL_W.test(t)) f.add('sl');
  if (TP_W.test(t)) f.add('tp');
  if (BUY_V.test(t)) f.add('buy');
  return f;
}

// ---- Commands ------------------------------------------------------------------

type Handler = (m: Msg, c: Ctx) => Intent | null;

const HELP =
  /^(?:help|h|commands?|menu|examples?|tutorial|guide|instructions|info|options|start|get started|what can i (?:say|ask|type)|how (?:do|does|can) (?:i|you|this|it|tippy)(?: use (?:you|this|it|tippy)| work| do this)?|how to use(?: (?:you|this|it|tippy))?|what (?:can|do|should) (?:you|i|u) (?:do|say|type|ask|understand)(?: here)?|what do you do|what are (?:the |your )?commands|who are you|what are you|what is this|whats this|i need help|need help|help me)$/;

const setting: Handler = (m) => {
  if (/\d/.test(m.s)) return null;
  const s = m.s;
  const on = /\b(?:on|enable|enabled|activate|start|yes|true|use|turn on|switch on)\b/.test(s);
  const off = /\b(?:off|disable|disabled|deactivate|no|false|kill|stop|dont use|turn off|switch off|without)\b/.test(s);
  const found: Intent[] = [];
  const pick = (name: 'dryRun' | 'autoGuard'): Intent | Unknown | null => {
    if (on && off) return unknown(`On or off? Say "${name === 'dryRun' ? 'dry run' : 'auto guard'} on" or "… off".`);
    if (on || off) return { type: 'setting', name, value: on };
    return null;
  };

  if (/\b(?:go live|live mode|real mode|real trading|real money|for real|live trading)\b/.test(s)) found.push(DEV_TOOLS ? { type: 'setting', name: 'dryRun', value: off } : unknown(ALL_REAL));
  else if (/\b(?:dry ?run(?:s|ning)?|paper(?: trading| trade| mode)?|(?:practice|test|testing|sim|simulation|demo|fake) mode)\b/.test(s)) {
    // "dry run a sell on CLAUDIA" is a practice run — its "on" is the coin's, not the setting's.
    if (/\b(?:buy|sell|buying|selling|tp|sl)\b/.test(s)) return null;
    if (!DEV_TOOLS) return unknown(ALL_REAL);
    const r = pick('dryRun');
    if (r) found.push(r);
    else return unknown('Dry run on or off? Say "dry run on" (I stop before the final button) or "dry run off".');
  }
  if (/\bauto ?(?:guard|guarding|protect|protection)\b|\bguard (?:new )?(?:buys|coins|bags) automatically\b|\bautomatically guard\b/.test(s)) {
    const r = pick('autoGuard');
    found.push(r ?? unknown('Auto guard on or off? Say "auto guard on" or "auto guard off".'));
  }
  if (/\b(?:chart lines?|lines? on (?:the )?chart|level lines?|dashed lines?|lines)\b/.test(s)) {
    const hide = /\b(?:hide|remove|no|off|disable|turn off|without|kill|stop)\b/.test(s);
    const show = /\b(?:show|on|enable|turn on|draw|display|bring back|unhide)\b/.test(s);
    found.push(hide === show ? unknown('Show or hide the chart lines? Say "show chart lines" or "hide chart lines".') : { type: 'setting', name: 'chartLines', value: show });
  }
  const UNIT_V = String.raw`\b(?:use|show|switch to|change to|set to|go to|display|prefer|levels? (?:in|as)|in|by|(?:read|treat|take|interpret|understand|count|see)\s+(?:bare\s+|plain\s+|my\s+|the\s+)?(?:numbers?|levels?)\s+(?:as|in))\s+(?:the\s+)?`;
  if (rx(`${UNIT_V}(?:market ?caps?|mcaps?|mc|market caps|fdv)(?!\\w)|\\b(?:market ?cap|mcap|mc) (?:mode|view|units?)\\b`).test(s))
    found.push({ type: 'setting', name: 'levelUnit', value: 'mc' });
  if (rx(`${UNIT_V}(?:percent(?:age)?s?|%|moves?|multiples?|multipliers?|x|xs|x and %|% and x)(?![\\w%])|\\b(?:percent|percentage|%|move|x|multiple) (?:mode|view|units?)\\b`).test(s))
    found.push({ type: 'setting', name: 'levelUnit', value: 'move' });
  if (found.length > 1) return unknown('One setting at a time, please — like "auto guard on".');
  return found[0] ?? null;
};

/** The store build has no practice runs or dry run: every order is real, and always shown first. */
const ALL_REAL = 'Every order I place is real — there\'s no practice mode. Tell me one, like "sell 25% at 1m", and I\'ll show you exactly what I\'ll do and wait for your tap.';

const PRACTICE_W = /\b(?:practice|practicing|practise|practising|rehearse|rehearsal|simulate|simulated|simulation|mock|dummy|demo|test|testing|dry run|fake|pretend|paper(?: trade| trading| mode| money)?)\b/;
const practice: Handler = (m, c) => {
  if (!m.has(PRACTICE_W)) return null;
  // With a level ("… at 2x", "500k", "-20%") it's an order said as a test: real, or a dry run? Never a real order by surprise.
  if (m.has(/\d\s*(?:[kmbx%]|mc|mcap)(?![a-z])|[+-]\d|\b(?:at|if|when|below|above|under|over|drops? to|dips? to|hits?)\s+\$?\.?\d/)) {
    if (m.has(SELL_W) || m.has(BUY_V) || families(m.s).size) {
      return unknown(
        DEV_TOOLS
          ? 'For real, or a dry run? I can\'t make one order pretend — say "dry run on" first (I go through every step but never press the final button), then send the order. Or leave out the "test" for a real one.'
          : 'Every order I place is real, so leave out the "test" and send it again — I\'ll show you exactly what I\'ll do and wait for your tap.',
      );
    }
    return null;
  }
  const buy = m.has(/\b(?:buy|buys|buying|bought|purchase|bid)\b/);
  const sell = m.has(/\b(?:sell|sells|selling|sold|tp|take profit|sl|stop loss|dump)\b/);
  if (!DEV_TOOLS) return buy || sell ? unknown(ALL_REAL) : null;
  if (buy && sell) return unknown('Practice a buy or a sell? One at a time — "practice a sell".');
  if (!buy && !sell) return unknown('Want me to practice a buy or a sell? Try "practice a sell" or "practice buying $5".');
  let usd: number | null = null;
  if (buy) {
    const vals = takeUsd(m);
    if (vals.length > 1) return unknown(`How much — ${vals.slice(0, 2).map((v) => formatUsd(v)).join(' or ')}? Say one amount.`);
    usd = vals[0] ?? null;
    if (usd != null && !(usd > 0)) return unknown('Pick an amount above $0, like "practice buying $5".');
  }
  m.take(/\b(?:practice|practicing|practise|practising|rehearse|simulate|mock|dummy|demo|test|testing|dry run|fake|pretend|buy|buys|buying|sell|sells|selling)\b/);
  const coin = oneCoin(m, c, 'One coin at a time — try "practice a sell on $TIPPY".');
  if (isHint(coin)) return unknown(coin.hint);
  return { type: 'practice', coin, side: buy ? 'buy' : 'sell', usd };
};

const HOWTO = /\bhow (?:do|can|would|should|to) (?:i|you|we)\b|\bhow to\b|\bcan (?:i|you)\b/;
const show: Handler = (m, c) => {
  const start = /^(?:show|list|status|stats|what|whats|how|hows|where|wheres|check|view|see|display|any|summary|overview|orders|plans|positions|my|which|tell me|give me|report|update me|current|lemme see|let me see)\b|^(?:pos|bids|buys|limits|limit orders|tps|stops|open orders|pending orders|active orders)$/;
  const any = /\b(?:status|orders|plans|positions|summary|overview|dashboard|doing|up to|going on|happening)\b/;
  if (!m.has(start) && !m.has(any)) return null;
  if (m.has(HOWTO)) return null;
  // "stop all orders", "clear my orders": pause or cancel — never a list.
  if (m.has(/^(?:stop|clear|end|halt|abort|close|kill|cancel|nuke|wipe|scrap)\b/)) return null;
  // "what's set on popcat": "set" as in what's there.
  m.s = m.s.replace(/\b(whats|what is|what s|what do i have|what have i got)\s+(?:set|placed|running|live|active|open|pending|going)\b/, '$1');
  if (m.has(/\b(?:add|set|place|put|create|make|move|change|raise|lower|bump|remove|delete|cancel|pause|resume|unpause|freeze|unfreeze|suspend|halt|snooze|guard|protect|apply|use|practice|test|kill|drop|turn|enable|disable|edit|update|unguard)\b/)) return null;
  if (/(?<![a-z$])\d/.test(m.s)) return null;
  if (c.dollars.length === 0 && m.has(/\b(?:buy|sell)\b/) && !m.has(/^(?:show|list|what|whats|where|which|any|check|view|see|display|my)\b/)) return null;
  // "what's my trail", "show my stops": that coin's orders (every coin's when none is open).
  const coin = findCoin(m, c, { all: true, dflt: m.has(/\b(?:trail|trailing|tsl|stop|stops|sl|stop loss|tps?|take ?profits?)\b/) ? 'here' : 'all' });
  if (isHint(coin)) return unknown(coin.hint);
  return { type: 'show', coin };
};

const CANCEL_V = /\b(?:cancel|cancell?ed|cancelling|remove|delete|del|kill|drop|clear|scrap|nuke|ditch|undo|rm|get rid of|stop|pull|withdraw|forget|abort|close)\b/;
const cancelBuy: Handler = (m, c) => {
  const cv = m.s.search(CANCEL_V);
  const bn = m.s.search(BUY_N);
  if (cv < 0 || bn < 0 || cv > bn) return null;
  if (families(m.s.replace(new RegExp(BUY_N.source, 'g'), ' ')).size > 0 || m.has(SELL_W)) return unknown(ONE_THING);
  if (takeUsd(new Msg(m.s)).length) return null;
  const plural = m.has(/\b(?:buys|bids|limit orders|buy orders|limit buys|dip buys|limits)\b/);
  m.take(BUY_N);
  const coin = findCoin(m, c, { all: true });
  if (isHint(coin)) return unknown(coin.hint);
  // "delete my buys": this coin's, or all of them? Asked — never just one of them.
  if (plural && 'here' in coin && !m.has(HERE_W)) return unknown('This coin\'s buys, or all of them? Say "cancel my buy" for the coin on screen, or "cancel all buys".');
  return { type: 'cancel-buy', coin };
};

/** "move tp1 to 2m", "raise my stop to 300k", "set my buy to 400k", "tp2 at 5x". */
function moveCore(m: Msg, c: Ctx, verb: 'move' | 'set' | null): Intent | null {
  const ts = takeTargets(m);
  if (isHint(ts)) return unknown(ts.hint);
  if (ts.length === 0) return verb === 'move' ? unknown('What should I move? Try "move tp1 to 2m" or "move my stop to 250k".') : null;
  if (ts.length > 1) return unknown('One level at a time, please — like "move tp1 to 2m".');
  const t = ts[0];
  if (t.kind === 'trail') return trailCore(m, c);
  if (t.kind === 'sl' && verb !== 'move') return null; // "set my stop at 0.001" → set-sl
  if (t.kind === 'tp?') return verb === 'move' ? unknown('Which take-profit? Say its number, like "move tp1 to 2m".') : null;
  if (t.kind === 'tps') return unknown('One take-profit at a time — like "move tp1 to 2m".');
  const side: Side = t.kind === 'tp' ? 'tp' : t.kind === 'sl' || t.kind === 'stop' ? 'sl' : 'buy';
  const name = t.kind === 'tp' ? `tp${t.index}` : t.kind === 'stop' ? `stop ${t.index}` : t.kind === 'sl' ? 'my stop' : 'my buy';
  const to = (l: string) => `move ${name} to ${l}`;
  const scan = scanLevels(m, side, c.unit, { at: to, drop: (n) => to(`-${n}%`), sized: true });
  if (scan.amb.length) return unknown(scan.amb[0]);
  for (const b of scan.bare) {
    if (side === 'sl') scan.levels.push({ spec: { kind: 'pct', value: -b.n }, rel: false });
    else if (side === 'tp' && b.at && b.n >= 100) return unknown(bigPct(b.n, to));
    else if (side === 'tp' && b.at) scan.levels.push({ spec: { kind: 'pct', value: b.n }, rel: false });
    else return unknown(side === 'buy' ? `A ${b.n}% dip or a ${b.n}% breakout? Say "to -${b.n}%" or "to +${b.n}%".` : `Is ${b.n}% a move up? Say "to +${b.n}%".`);
  }
  const levels = dedupe(scan.levels);
  if (levels.length === 0) return unknown(`Where to? Try "move ${name} to ${side === 'sl' ? '250k' : '2m'}".`);
  if (levels.length > 1) return unknown(twoLevels(levels.map((l) => l.spec)));
  if (levels[0].rel) return unknown(`Tell me where to put it, like "move ${name} to ${side === 'sl' ? '250k' : '2m'}" or "to ${side === 'tp' ? '3x' : '-20%'}".`);
  const coin = oneCoin(m, c, 'One coin at a time, please.');
  if (isHint(coin)) return unknown(coin.hint);
  const target = t.kind === 'tp' || t.kind === 'stop' ? { kind: t.kind, index: t.index } : { kind: t.kind };
  return { type: 'move', coin, target, level: levels[0].spec };
}

const move: Handler = (m, c) => {
  const v = m.s.match(rx(String.raw`\b(${MOVE_V}|${SET_V})\s+${ART}(?:limit\s+)?(?=${TARGET_START})`));
  if (!v) {
    if (m.has(/^(?:move|change|raise|lower|bump|adjust|shift)\b/) && !m.has(BUY_V)) return unknown('What should I move? Try "move tp1 to 2m" or "move my stop to 250k".');
    return null;
  }
  const verb = new RegExp(`^(?:${SET_V})$`).test(v[1]) ? 'set' : 'move';
  // "buy $10 at 400k and set tp 2x": a buy and a sell — the buy's reply says one at a time.
  if (verb === 'set' && m.has(BUY_V) && takeUsd(new Msg(m.s)).length) return null;
  m.take(rx(String.raw`\b(?:${MOVE_V}|${SET_V})\b`));
  return moveCore(m, c, verb);
};

// ("drop" removes only an order: "drop my stop" — never "if we drop 30%" or "on a 20% drop".)
const REMOVE_V =
  /\b(?:remove|removing|delete|del|cancel|kill|clear|scrap|nuke|ditch|undo|rm|get rid of|turn off|switch off|disable|no more|forget)\b|\bdrop(?=\s+(?:(?:the|my|that|this|our|current|all|both)\s+)*(?:tps?\d?|take ?profits?|sl|stops?|stop ?loss|trail|trailing|tsl|partial|buys?|limit|bids?|first|second|third|fourth|fifth|1st|2nd|3rd|4th|5th|last|final|it|that|this|them)\b)|(?<=\b(?:tps?\d?|sl|stop ?loss|trail|trailing stop|tsl)\s)drop$|^no\b|\b(?:off|gone)$|\bstop(?=\s+(?:the\s+|my\s+)?(?:trail|trailing|tsl)\b)/;
const removeLevel: Handler = (m, c) => {
  if (!m.has(REMOVE_V)) return null;
  // "tp 2x take half off": a trailing "off" after a size and a level is a sell, not "tp off".
  if (!m.has(/\b(?:remove|removing|delete|del|cancel|kill|clear|scrap|nuke|ditch|undo|rm|get rid of|turn off|switch off|disable|no more|forget|drop)\b|^no\b/) && (m.has(SELL_W) || /(?<![a-z$])\d/.test(m.s))) return null;
  m.take(REMOVE_V);
  const ts = takeTargets(m);
  if (isHint(ts)) return unknown(ts.hint);
  const levels = ts.filter((t) => t.kind !== 'buy');
  if (levels.length === 0) return null;
  if (ts.length > 1) return unknown('One at a time, please — like "remove tp2".');
  const t = levels[0];
  if (t.kind === 'tp?') return unknown('Which take-profit? Say its number, like "remove tp2".');
  if (t.kind === 'tps') return unknown('One take-profit at a time — like "remove tp2". To drop the whole plan, say "stop guarding".');
  if (m.has(SELL_W) || m.has(BUY_V)) return unknown(ONE_THING);
  // "no stop loss at 500k", "remove my stop at 600k": remove it, or move it there? Asked with the level as said.
  if (/(?<![a-z$])\d/.test(m.s)) {
    if (t.kind === 'trail') return unknown('Remove your trailing stop, or change it? Say "remove my trail" — or "trail 20%" to change it.');
    const name = t.kind === 'tp' ? `tp${t.index}` : t.kind === 'stop' ? `stop ${t.index}` : 'my stop';
    const lv = scanLevels(new Msg(m.s), t.kind === 'tp' ? 'tp' : 'sl', 'mc').levels;
    const to = lv.length === 1 ? typedLevel(lv[0].spec) : t.kind === 'tp' ? '2m' : '-30%';
    return unknown(`Remove it, or move it? Say "remove ${name}" — or "move ${name} to ${to}".`);
  }
  const coin = oneCoin(m, c, 'One coin at a time, please.');
  if (isHint(coin)) return unknown(coin.hint);
  const target = t.kind === 'tp' || t.kind === 'stop' ? { kind: t.kind, index: t.index } : { kind: t.kind };
  return { type: 'remove-level', coin, target };
};

const STOP_PLAN =
  /\b(?:stop|quit|end|cancel|kill|remove|delete|drop|scrap|nuke|ditch|clear|abandon|close)\s+(?:guarding|guard|protecting|protection|watching|tracking|managing|(?:the |my |this |that |all )?(?:plans?|guards?|protection))\b|\bun ?guard\b|\bunprotect\b|\bunwatch\b|\bforget(?: about)?\b|\b(?:dont|do not|no longer|stop) (?:guard|protect|watch)(?:ing)?\b/;
const stopPlan: Handler = (m, c) => {
  if (!m.has(STOP_PLAN)) return null;
  // "stop guarding" itself says "stop" — look for other order words only in what's left.
  if (m.has(BUY_N) || families(m.s.replace(new RegExp(STOP_PLAN.source, 'g'), ' ')).size) return null;
  // "sell half at 2x, don't forget" is a sell, not "forget this coin".
  if (m.has(SELL_W) || /(?<![a-z$])\d/.test(m.s)) return null;
  m.take(STOP_PLAN);
  const coin = oneCoin(m, c, 'I stop plans one coin at a time — try "stop guarding $TIPPY". To pause everything, say "pause everything".');
  if (isHint(coin)) return unknown(coin.hint);
  return { type: 'stop-plan', coin };
};

/** "stop everything", "cancel all orders" — pause or cancel? Buys or plans? */
const vagueCancel: Handler = (m) => {
  if (!m.has(/^(?:stop|cancel|kill|end|abort|halt|close|clear|delete|remove)\b/)) return null;
  if (m.has(/\bstop ?loss\b/) || /(?<![a-z$])\d/.test(m.s)) return null;
  if (!m.has(/\b(?:all|everything|orders?|it)\b/) && m.words().length > 1) return null;
  return unknown('Pause everything, or cancel something? Try "pause everything", "cancel all buys" or "stop guarding $TIPPY".');
};

const pause: Handler = (m, c) => {
  const p = m.has(/\b(?:pause|paused|pausing|freeze|suspend|halt|snooze|kill switch|emergency stop|panic)\b/);
  const r = m.has(/\b(?:resume|resumed|resuming|unpause|unpaused|un pause|continue|restart|unfreeze|wake up|wake|start again|carry on|keep going|go again|reactivate|re enable|reenable|turn back on|back on|unsuspend)\b/);
  if (!p && !r) return null;
  if (p && r) return unknown('Pause or resume? Say "pause $TIPPY" or "resume $TIPPY".');
  // "sell half at 2x then pause": two things — never just the pause.
  if (m.has(SELL_W) || /(?<![a-z$])\d/.test(m.s)) return unknown(ONE_THING);
  if (m.has(BUY_N)) return unknown(`I can't ${p ? 'pause' : 'resume'} a buy — "cancel my buy on $TIPPY" removes it.`);
  const ts = takeTargets(new Msg(m.s));
  if (!isHint(ts) && ts.length) return unknown('I pause whole coins, not single levels — try "pause $TIPPY" (or "remove tp2").');
  m.take(/\b(?:pause|paused|pausing|freeze|suspend|halt|snooze|kill switch|emergency stop|panic|resume|resumed|resuming|unpause|unpaused|un pause|continue|restart|unfreeze|wake up|wake|start again|carry on|keep going|go again|reactivate|re enable|reenable|turn back on|back on|unsuspend)\b/);
  const coin = findCoin(m, c, { all: true, dflt: 'all' });
  if (isHint(coin)) return unknown(coin.hint);
  return { type: 'pause', coin, paused: p };
};

/** A bare buy amount this big ("buy 500 at 500k") is asked about: coins, or dollars? */
const BARE_BUY_MAX = 100;

/** Verbs a buy's amount follows: "buy $10", "ape 25", "bid 10 usd". */
const BUY_AMOUNT_V = String.raw`buy|buying|limit buy|bid|ape(?: in)?|aping|scoop|snipe|grab|accumulate|load up|purchase|dip buy|rebuy|spend|dca|long|top up|topping up`;
/** "0.5 sol", "1m tokens": an amount in coins — Tippy deals in dollars and % of the bag. */
const UNITS = rx(String.raw`(?<![\w.])(${NUM}[kmb]?)\s*(sol|eth|weth|bnb|btc|matic|avax|pol|tokens?|coins?)\b`);

/** "if it dips to 1m" / "when it breaks 1m": the way the user said the buy's level is reached. */
const BUY_DOWN = new RegExp(String.raw`${DOWN_TO.source}|\b(?:if|when|once)\s+${SUBJECT}(?:${DOWN})\b`);
const BUY_UP = new RegExp(String.raw`${UP_TO.source}|\b(?:if|when|once)\s+${SUBJECT}(?:${UP})\b|\bbreaks?\s+(?:above\s+|over\s+|past\s+|through\s+)?(?=\$?[\d.])`);
/** "buy $3 of wif with claudia": paying with another coin — Tippy buys with cash only. */
const SWAP_WITH = /\b(?:with|using)\s+(?:my\s+|some\s+|the\s+)?([a-z][a-z0-9]{1,19})\b/;

/** What a buy's cash is called: "my cash", "my balance", "all my money". */
const CASH_W = String.raw`(?:cash|balance|wallet|funds|money|usd|usdc|dollars|buying power)`;
const SHARE_PCT: Record<string, number> = { half: 50, quarter: 25, third: 33, all: 100, everything: 100, max: 100, maximum: 100 };
/** A share of your cash instead of dollars: "buy 20%", "buy half", "buy max", "with all my cash", "a quarter of my cash". */
const CASH_SHARES: [RegExp, (x: RegExpExecArray) => number][] = [
  [rx(String.raw`\b(?:${BUY_AMOUNT_V})\s+(?:with\s+|another\s+)?${NUM}%`), (x) => +x[1]],
  [rx(String.raw`(?<![\w.%+$-])${NUM}%\s+of\s+(?:my\s+|your\s+|the\s+)?${CASH_W}\b`), (x) => +x[1]],
  [rx(String.raw`\b(?:a\s+|one\s+)?(half|quarter|third|all|everything)\s+(?:of\s+)?(?:my\s+|your\s+|the\s+)?${CASH_W}\b`), (x) => SHARE_PCT[x[1]]],
  [rx(String.raw`\b(?:my\s+)?(?:whole|entire|full)\s+${CASH_W}\b`), () => 100],
  [rx(String.raw`(?<=\b(?:${BUY_AMOUNT_V})\s+(?:with\s+)?)(?:a\s+|one\s+|the\s+)?(half|quarter|third|all|everything|max|maximum)\b`), (x) => SHARE_PCT[x[1]]],
];

/** Where a buy goes, the way you'd say it in an example: "at 600k", "if it dips 20%". (Which side "600k" is, run.ts says on the card.) */
function buyWhere(level: LevelSpec): string {
  if (level.kind === 'pct') return level.value < 0 ? `if it dips ${-level.value}%` : `if it breaks out ${level.value}%`;
  return `at ${typedLevel(level)}`;
}

/** A buy with no dollar amount: asked — run.ts adds your cash and an example amount that fits it. */
function buyAsk(ask: string, where: string | null, pct?: number): Unknown {
  return { type: 'unknown', hint: `${ask} Try "buy $10 ${where ?? 'if it dips 20%'}".`, buy: { ask, where, ...(pct != null ? { pct } : {}) } };
}

const limitBuy: Handler = (m, c) => {
  if (!m.has(BUY_V)) return null;
  // "for 30m": 30 minutes, or a level at $30M MC? Asked before the expiry reader sees it.
  const minutes = m.s.match(/\b(?:for|in|within)\s+(\d+)\s*m\b(?!\s*(?:mc|mcap|market cap|cap|fdv)\b)/);
  if (minutes) return unknown(`Is "${minutes[1]}m" ${minutes[1]} minutes, or $${minutes[1]}M MC? Say "for ${minutes[1]} min" for how long the buy waits.`);
  const exp = takeExpiry(m);
  if (isHint(exp)) return unknown(exp.hint);
  // "buy $5 at 500k tomorrow": a buy is placed now and waits for its level — never at a time.
  if (m.has(BUY_TODAY)) {
    const again = m.s.replace(BUY_TODAY, ' ').replace(/·+/g, ' ').replace(/\s+/g, ' ').trim();
    return unknown(`How long should the buy wait? I count hours, not times of day — say "${again.length <= 50 ? again : 'buy $10 at 500k'} for 12h".`);
  }
  if (m.has(TIMED)) return unknown(`I can't start a buy later — I place it now and it waits for its level (24h unless you say "for 48h" or "never expires").${retry(m.s.replace(TIMED, ' '), ' Say', 'to place it now')}`);
  const preset = takePreset(m);
  if (isHint(preset)) return unknown(preset.hint);
  const f = families(m.s);
  if (f.size > 1 || m.has(/\b(?:sell|sells|selling)\b/)) {
    const amt = m.s.match(/\$\d+(?:\.\d+)?k?(?![\w.%])/)?.[0] ?? '$10';
    const lvl = levelIn(m.s.replace(amt, ' ')) ?? '1m';
    return unknown(`One thing at a time: place the buy, and I can guard it with a preset — say "buy ${amt} at ${lvl} then protect with classic".`);
  }
  // "buy $10 if it dips 30% from the top": I measure a dip from the price now.
  if (m.has(FROM_TOP)) return unknown('I measure a dip from the price now, not from the top — say "buy $10 if it dips 30%" for 30% below where it is now, or a market cap, like "buy $10 at 500k".');
  // Tippy buys with a $ amount: "buy 20%", "buy half", "buy 0.5 sol", "buy 500k" (dollars? a level?) are questions.
  let cashPct: number | null = null;
  for (const [re, pct] of CASH_SHARES) for (const x of m.take(re)) cashPct ??= pct(x);
  const unit = m.s.match(UNITS);
  if (unit) return unknown(`I buy with dollars, not ${unit[3].replace(/s$/, '')}s — how many $? Try "buy $20 at 500k".`);
  const kAmount = m.s.match(rx(String.raw`\b(?:${BUY_AMOUNT_V})\s+(?:another\s+|like\s+|about\s+)?(${NUM}[km])(?![\w.%])${NOT_MC}`));
  if (kAmount) return unknown(`Is "${kAmount[1]}" how much to spend? Say it in dollars, and the level after "at" — like "buy $20 at 500k".`);
  let down = m.has(BUY_DOWN);
  const up = m.has(BUY_UP);
  // "buy 500 at 500k": a bare 500 could be coins (or a slip) — say it in dollars. Small ones ("buy 20 at 500k") are dollars.
  const bare = m.s.match(rx(String.raw`\b(?:${BUY_AMOUNT_V})\s+(?:another\s+|like\s+|about\s+|around\s+|only\s+|just\s+|more\s+)?${NUM}(?![\w.%$])(?!\s*(?:${MCW}|x|usd[ct]?|dollars?|bucks?|bux|worth)(?!\w))`));
  const bareBig = bare && +bare[1] >= BARE_BUY_MAX ? bare[1] : null;
  const usds = takeUsd(m);
  const usd = usds[0] ?? null;
  // "buy the dip" is a figure of speech — but keep the "dip" in "a 20% dip" and "a 2x dip".
  const figure = m.take(/(?<![%x]\s?)\b(?:the dip|a dip|dip|dips|the breakout|a breakout|breakout)\b(?!\s*\d)/).map((x) => (/dip/.test(x[0]) ? 'dip' : 'breakout'));
  // "double down" is buying more, never a 2x level; "average down" buys lower — a dip buy; "top up" buys more.
  if (m.take(/\b(?:average|averaging|avg)\s+down\b/).length) down = true;
  m.take(/\b(?:double|doubling|doubled)\s+down\b|\bgo long\b|\b(?:top|topping) up\b|\bdca(?:ing)?(?:\s+in(?:to)?)?\b/);
  const amount = usd != null ? usdText(usd) : null;
  const scan = scanLevels(m, 'buy', c.unit, egFor('buy', amount));
  if (usds.length > 1) return unknown(scan.levels.length > 1 ? 'One buy at a time, please — say the first one (like "buy $10 at 1m"), then the next.' : `How much — ${usds.slice(0, 2).map(usdText).join(' or ')}? Say one amount.`);
  if (scan.amb.length) return unknown(scan.amb[0]);
  const one = scan.levels.length === 1 ? scan.levels[0] : null;
  const where = one ? buyWhere(one.spec) : null;
  if (scan.bare.length) {
    const n = scan.bare[0].n;
    // "buy at 500k 20%": the level is said — the % is how much (of your cash?).
    if (one && usd == null && cashPct == null && !scan.bare[0].at) return buyAsk('How much in dollars? I buy with a $ amount, not a share of your cash.', where, n);
    const u = amount ?? '$10';
    return unknown(`A ${n}% dip or a ${n}% breakout? Try "buy ${u} if it dips ${n}%" or "buy ${u} if it breaks out ${n}%".`);
  }
  if (cashPct != null) {
    if (usd != null) return unknown(`How much — ${usdText(usd)}, or ${cashPct >= 100 ? 'all' : `${cashPct}%`} of your cash? Say one amount in dollars, like "buy ${usdText(usd)} ${where ?? 'if it dips 20%'}".`);
    if (scan.levels.length <= 1) return buyAsk('How much in dollars? I buy with a $ amount, not a share of your cash.', where, cashPct);
  }
  if (scan.levels.length > 1) {
    if (/\bbetween\b/.test(m.s)) return unknown('I buy at one level, not a range — pick one, like "buy $10 at 500k".');
    // "buy at $10 at 500k": a "$10" read as a price is surely the amount.
    const cash = scan.levels.find((l) => l.spec.kind === 'price' && l.spec.value >= 1);
    const other = scan.levels.find((l) => l !== cash);
    if (cash && other && scan.levels.length === 2 && usd == null) return unknown(`Is ${usdText(cash.spec.value)} how much to spend? Then say "buy ${usdText(cash.spec.value)} ${buyWhere(other.spec)}".`);
    return unknown(twoLevels(scan.levels.map((l) => l.spec)));
  }
  if (scan.levels.length === 0) {
    if (usd == null) return unknown('How much, and where? Try "buy $10 at 1m mcap" or "buy $10 if it dips 20%".');
    if (c.now) return unknown(NOW_BUY);
    if (down && !up) return unknown(`Dips to where? Try "buy ${usdText(usd)} if it dips 20%" or "buy ${usdText(usd)} at 500k".`);
    return unknown(`Where should I buy? Try "buy ${usdText(usd)} at 1m mcap" or "buy ${usdText(usd)} if it dips 20%".`);
  }
  const level = scan.levels[0].spec;
  if (usd == null) {
    // "buy at $3": $3 as a memecoin's price is unlikely — is it the amount?
    if (level.kind === 'price' && level.value >= 1) {
      const u = usdText(level.value);
      return unknown(`Is ${u} how much to spend? Then say where — like "buy ${u} if it dips 20%" or "buy ${u} at 500k". If ${u} is the price, say "buy $10 at ${u}".`);
    }
    return buyAsk(`How much should I buy ${level.kind === 'pct' ? where : `at ${levelWords(level)}`}?`, where);
  }
  if (bareBig) return { type: 'unknown', hint: `Is "${bareBig}" dollars? Say "buy $${bareBig} ${where}" — I buy with a $ amount, never a number of coins.`, askCash: true };
  if (!(usd > 0)) return unknown('Pick an amount above $0 — try "buy $10 at 1m mcap".');
  const both = `A dip or a breakout? Try "buy ${usdText(usd)} if it dips to ${typedLevel(level)}" or "buy ${usdText(usd)} if it breaks out to ${typedLevel(level)}".`;
  if (down && up) return unknown(both);
  const swap = m.s.match(SWAP_WITH);
  if (swap && isTicker(swap[1])) return unknown(`I only buy with cash — I can't swap $${swap[1].toUpperCase()} for another coin. Say "buy ${usdText(usd)} ${where}" to buy with your fomo cash.`);
  const coin = oneCoin(m, c, 'One coin at a time — try "buy $10 of $TIPPY at 1m mcap".');
  if (isHint(coin)) return unknown(coin.hint);
  const left = unread(m, coin);
  const num = left.find((w) => NUMBER_LEFT.test(w) || COMMON.has(w));
  if (num) return unknown(`I didn't catch "${num}" — try "buy ${usdText(usd)} ${where}".`);
  // "a 2x dip", "when it's down 2x": said on the way down.
  if (scan.levels[0].down) down = true;
  if (down && up) return unknown(both);
  // "if it dips +50%", "average down $5 +20%", "when it pumps -20%": the sign says the other side — asked, never placed.
  if (level.kind === 'pct' && ((level.value > 0 && (down || figure.includes('dip'))) || (level.value < 0 && (up || figure.includes('breakout'))))) {
    const n = Math.abs(level.value);
    return unknown(`A dip or a breakout? "${typedLevel(level)}" is ${level.value > 0 ? 'up' : 'down'} from here — say "buy ${usdText(usd)} if it dips ${n}%" or "buy ${usdText(usd)} if it breaks out ${n}%".`);
  }
  // A dip or a breakout said in words: run.ts makes sure the level is on that side of the price.
  const said = level.kind !== 'pct' && (down || up) ? { said: down ? ('dip' as const) : ('breakout' as const) } : {};
  return { type: 'limit-buy', coin, usd, level, preset, expiresInMs: exp, ...said };
};

/** "25% from the top", "50% from ath", "30% below the peak", "25% off the high": measured from the top — a trailing stop. */
const FROM_TOP =
  /\b(?:down\s+)?(?:from|off|below|under|beneath)\s+(?:the\s+|its\s+|my\s+|a\s+|any\s+)?(?:recent\s+|local\s+|last\s+|new\s+)?(?:top|tops|peak|peaks|high|highs|highest(?: point| price| level)?|ath|aths|all time high|max)\b/;

/** "trail 20%", "trailing stop 25% after 2x" — called once the trail words are recognised. */
function trailCore(m: Msg, c: Ctx): Intent {
  const said = m.s;
  m.take(TRAIL_W);
  m.take(FROM_TOP);
  // "trailing sl 20%", "sl 30% trailing": the stop that trails — one order, not a stop and a trail.
  const fam0 = families(m.s);
  if (fam0.size === 1 && fam0.has('sl') && (m.s.match(/\d+(?:\.\d+)?/g) ?? []).length <= 1) m.take(/\b(?:sl|stop ?loss|stop)\b/);
  const fam = families(m.s);
  if (fam.size) return unknown(oneThing(said));
  let afterX: number | null = null;
  const afterVals: number[] = [];
  const AFTER = String.raw`\b(?:after|once|from|starting(?: at| from)?|starts? at|begin(?:ning)? at|when(?: it)?(?: hits| reaches| gets to| is at| does| goes)?|activates? (?:at|after)|activated (?:at|after)|active (?:at|after|from)|kicks? in at|above|past|over|at|if(?: it)?(?: hits| reaches| gets to)?)\s+(?:it\s+)?(?:hits\s+|reaches\s+|does\s+|gets to\s+|is at\s+|goes\s+)?(?:a\s+)?`;
  for (const x of m.take(rx(String.raw`${AFTER}${NUM}x(?:s|es)?(?![\w.])`))) afterVals.push(+x[1]);
  for (const _ of m.take(/\b(?:after|once|when|if)\s+(?:it\s+)?(?:has\s+)?(?:doubles|doubled|2xs)\b/)) afterVals.push(2);
  for (const _ of m.take(/\b(?:after|once|when|if)\s+(?:it\s+)?(?:has\s+)?(?:triples|tripled|3xs)\b/)) afterVals.push(3);
  for (const x of m.take(rx(String.raw`${AFTER}(?:(?:it is |its )?up\s+)?\+${NUM}%`))) afterVals.push(+(1 + +x[1] / 100).toFixed(4));
  if (m.has(rx(String.raw`${AFTER}\$?${NUM}[kmb]?(?:\s*${MCW})?${END}`)) && m.has(/\d[kmb]\b|\bmc|\bmcap|market cap/))
    return unknown('I start a trail at a multiple of your entry — like "trail 20% after 2x".');
  // A stray "2x" with no "after" still reads as when to start.
  for (const x of m.take(rx(String.raw`(?<![\w.$])${NUM}x(?:s|es)?(?![\w.])`))) afterVals.push(+x[1]);
  const au = [...new Set(afterVals)];
  if (au.length > 1) return unknown('When should the trail start? Pick one, like "after 2x".');
  if (au.length === 1) afterX = au[0];
  if (afterX != null && !(afterX > 1)) return unknown('Start the trail above your entry — like "after 2x".');
  m.take(/\b(?:immediately|right away|from now|straight away|now)\b/);
  const size = takeSize(m);
  if (size.pct != null && size.pct !== 100) return unknown('A trailing stop sells whatever is left — try "trail 20%".');
  if (m.has(/\d[kmb]\b/)) return unknown('A trail is a % from the top — like "trail 20%".');
  const nums = m.take(rx(String.raw`(?<![\w.$])[-+]?${NUM}%?${END}`)).map((x) => +x[1]);
  const nu = [...new Set(nums)];
  if (nu.length === 0) return unknown('How far below the top should it sell? Try "trail 20%".');
  if (nu.length > 1) return unknown(`Trail by ${nu.slice(0, 2).map((n) => `${n}%`).join(' or ')}? Pick one, like "trail 20%".`);
  const trailPct = nu[0];
  if (!(trailPct > 0 && trailPct < 100)) return unknown('Pick a trail between 1% and 99% — like "trail 20%".');
  const coin = oneCoin(m, c, 'One coin at a time — try "trail 20% on $TIPPY".');
  if (isHint(coin)) return unknown(coin.hint);
  return { type: 'set-trail', coin, trailPct, afterX };
}

const trail: Handler = (m, c) => (m.has(TRAIL_W) ? trailCore(m, c) : null);

/**
 * "sell everything if it dumps 30% from the top", "sl 25% from the top", "stop 20% below the high":
 * a trailing stop. Part of the bag that way is a question — Tippy's trail sells the rest, and a
 * fixed −25% from here or from the entry is never what was said.
 */
const trailTop: Handler = (m, c) => {
  if (!m.has(FROM_TOP)) return null;
  if (!m.has(SELL_W) && !m.has(SL_W) && !m.has(rx(String.raw`\b(?:${DOWN})\b`))) return null;
  if (m.has(BUY_V) || m.has(TP_W)) return null;
  const probe = new Msg(m.s);
  probe.take(FROM_TOP);
  const size = takeSize(probe);
  const n = probe.s.match(/(?<![\w.$])-?(\d+(?:\.\d+)?)%?(?![\w.])/);
  if (size.pct != null && size.pct < 100) {
    const pct = n ? n[1] : '20';
    return unknown(`My trailing stop sells the rest, not part of it — say "trail ${pct}%" to sell the rest ${pct}% below the top, or "sell ${pctWords(size.pct)} if it drops ${pct}%" for a stop ${pct}% below now.`);
  }
  if (size.pct == null && (size.vals.length || size.of)) return unknown('How much? My trailing stop sells the rest — say "trail 20%".');
  m.take(FROM_TOP);
  takeSize(m);
  m.take(rx(String.raw`${OUT}|\b(?:sell|sells|selling|dump|offload|unload|exit|cash ?out)\b|\b(?:sl|stop ?loss|stop)\b|\b(?:if|when|once)\s+${SUBJECT}(?:${DOWN})\b|\b(?:${DOWN})\b`));
  return trailCore(m, c);
};

type Lead = NonNullable<ReturnType<typeof takeLead>>;
/** One size as said: a % of the bag, dollars, or a plain number after the verb. */
type Said = { pct: number } | { usd: number } | { lead: Lead };

const ONE_ORDER = 'One order at a time, please — say the first one (like "sell 10% at 700k"), then the next.';
const RANGE = 'I sell at one level, not a range — pick one and try "sell half at 700k".';
/** "$20", "$2.50", "$1.5K" — a dollar amount the way you'd type it back. */
const usdText = (n: number) => (n >= 1000 ? formatUsd(n) : Number.isInteger(n) ? `$${n}` : `$${n.toFixed(2)}`);
const saidText = (x: Said) => ('pct' in x ? `${x.pct}%` : 'usd' in x ? usdText(x.usd) : x.lead.verb === 'sell' ? `"${x.lead.raw}"` : `${x.lead.raw}%`);
/** A size the way you'd type it in an example: "all", "25%", "$3". */
const sizeWords = (x: Said) => ('pct' in x && x.pct === 100 ? 'all' : saidText(x));

/**
 * A sell's size from what was said: words or a % ("half", "25%"), dollars
 * ("$20"), or a plain number after the verb — a % after "tp" / "sl" ("tp 50 @
 * 1.2m"), but after "sell" it could be 10% or $10, so Tippy asks. Two different
 * sizes is a question too, never a pick.
 */
function sellSize(said: Said[], level: LevelSpec): { pct: number | null; usd: number | null } | Hint {
  const at = typedLevel(level);
  const plain = said.find((x): x is { lead: Lead } => 'lead' in x && x.lead.verb === 'sell');
  if (plain) return { hint: sizeHint(plain.lead.raw, level) };
  const sizes = said.map((x) => ('lead' in x ? { pct: x.lead.n } : x));
  const kinds = [...new Set(sizes.map(saidText))];
  if (kinds.length > 1) return { hint: `How much should it sell — ${kinds.slice(0, 2).join(' or ')}? Pick one — try "sell ${kinds[0]} at ${at}".` };
  const one = sizes[0];
  if (!one) return { pct: null, usd: null };
  if ('usd' in one) return one.usd > 0 ? { pct: null, usd: one.usd } : { hint: `Pick an amount above $0 — try "sell $5 at ${at}".` };
  if (one.pct > 100) return { hint: `That's more than your whole bag — try up to 100%, like "sell all at ${at}".` };
  if (!(one.pct > 0)) return { hint: `Nothing to sell there — try a size, like "sell 50% at ${at}".` };
  return { pct: one.pct, usd: null };
}

/** The sizes in one message: words / %, dollars, a plain number after the verb, unsigned %s that can only be sizes. */
function sizesSaid(vals: number[], usds: number[], lead: Lead | null, loose: number[]): Said[] {
  return [...vals.map((pct) => ({ pct })), ...usds.map((usd) => ({ usd })), ...(lead ? [{ lead }] : []), ...loose.map((pct) => ({ pct }))];
}

/** Two levels: two orders ("10% at 700k and 25% at 1m"), a range ("between 650k and 700k") or a slip. */
function manyLevels(m: Msg, said: Said[], levels: Found[]): string {
  if (said.length > 1) return ONE_ORDER;
  if (/\bbetween\b/.test(m.s)) return RANGE;
  // "sell $5 at 2x" said as "sell at 2x $5 …": a "$5" read as a price is surely how much.
  const cash = levels.find((l) => l.spec.kind === 'price' && l.spec.value >= 1);
  const other = levels.find((l) => l !== cash);
  if (levels.length === 2 && cash && other && !said.some((x) => 'usd' in x)) {
    const u = usdText(cash.spec.value);
    return `Is ${u} how much to sell? Then say "sell ${u} ${whereWords(other.spec, false)}".`;
  }
  return twoLevels(levels.map((l) => l.spec));
}

/** "sell 20 at 600": neither the size nor the level has its unit — one question, with the level as said. */
function leadAndLevel(raw: string, scan: Scan): string {
  if (!scan.fix) return `${sizeHint(raw, null)} ${scan.amb[0]}`;
  const n = +raw;
  const usd = usdText(n);
  const [a, b = a] = scan.fix.levels;
  const q = scan.fix.q.replace(/^Is\b/, 'is');
  if (n > 100) return `Is "${raw}" dollars — and ${q} Say "sell ${usd} at ${a}", or a % of your bag, like "sell 50% at ${a}".`;
  return `${raw}% of your bag or ${usd} worth — and ${q} Say "sell ${raw}% at ${a}" or "sell ${usd} at ${b}".`;
}

/** The size as said, for an example to copy: "half", "25%", "$3" — null when there's none (or two). */
function sizeEg(vals: number[], usds: number[], lead: Lead | null, s = ''): string | null {
  const pcts = [...new Set(vals)];
  if (pcts.length + usds.length + (lead ? 1 : 0) > 1) return null;
  if (pcts.length) return pctWords(pcts[0]);
  if (usds.length) return usdText(usds[0]);
  if (lead) return lead.verb !== 'sell' ? `${lead.raw}%` : null;
  // "stop 25% at 900": an unsigned % that isn't where ("at 20%") — the size, once there's a level.
  const loose = s.match(/(?<![\w.%+$-])(\d+(?:\.\d+)?)%(?![\w%])/);
  return loose && !rx(String.raw`\b(?:at|to|hits?|reach(?:es)?|around|by|${DOWN}|${UP})\s*$`).test(s.slice(0, loose.index)) ? `${loose[1]}%` : null;
}

/** "At what level should I sell $3?" — what was said, with examples to copy. */
function whereHint(said: Said[], hasTp: boolean, up: boolean, down: boolean): string {
  const one = said.length === 1 && !('lead' in said[0]) ? sizeWords(said[0]) : '25%';
  if (down && !up && !hasTp) return `Down to where? Try "sell ${one} if it drops to 700k" or "sl -30%".`;
  if (up && !down && !hasTp) return `Up to where? Try "sell ${one} if it pumps to 2m" or "sell ${one} at 2x".`;
  if (hasTp) return 'Where should the take-profit go? Try "tp at 500k mcap" or "tp 2x sell half".';
  return `At what level? I sell at a level, not on the spot — try "sell ${one} at 2x" or "sell ${one} if it drops to 700k".`;
}

/** "a sixth", "1/8": a share Tippy doesn't round for you — asked as a %. */
const ODD_SHARE = /\b(?:(a|an|one|two|three|four|five|six|seven|eight)\s+)?(sixths?|sevenths?|eighths?|ninths?)\b/;
function oddShare(m: Msg, where: string): string | null {
  const x = m.s.match(ODD_SHARE);
  if (!x) return null;
  const n = !x[1] || x[1] === 'a' || x[1] === 'an' ? 1 : COUNT_WORDS.indexOf(x[1]);
  const d = { six: 6, sev: 7, eig: 8, nin: 9 }[x[2].slice(0, 3) as 'six' | 'sev' | 'eig' | 'nin'];
  const pct = +((n / d) * 100).toFixed(1);
  return `${x[0]} of your bag is ${pct}% — say it as a %, like "sell ${pct}% ${where}".`.replace(/^./, (ch) => ch.toUpperCase());
}

/** "for 24h", "today only": take-profits and stops wait until they fill or are removed — a time on one is a question. */
const SELL_EXPIRY =
  /\b(?:for|expires?(?: in| after)?|expiring(?: in)?|valid for|good for|within|in|lasts?|until|till|til)\s+(?:the next\s+)?(?:(?:an?|one)\s+|\d+(?:\.\d+)?\s*)(?:h|hr|hrs|hours?|d|days?|w|wk|wks|weeks?|mins?|minutes?|months?|years?|yrs?)\b|\b(?:today only|only today|until tomorrow|till tomorrow|for today|for tonight|by tonight|end of (?:the )?day|eod|today)\b/;
/** "sell half at 1m tomorrow", "tonight", "on friday": a time to act — Tippy acts at levels, never at a time. */
const TIMED =
  /\b(?:(?:til|till|until|by|before|after|from)\s+)?(?:tomorrow|tmrw|tmr|tonight|later today|later tonight|later|this (?:morning|afternoon|evening|weekend|week)|next (?:week|month)|in the (?:morning|afternoon|evening)|overnight|(?:on |by |next )?(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday))\b|\b(?:(?:by|at|before|after|until|till|til|around)\s+)?\d{1,2}(?:\s?\d\d)?\s?(?:am|pm)\b|\b(?:by|before|until|till|til)\s+(?:noon|midnight)\b/g;
/** The message again without a word that couldn't be used — to copy back ("sell half at 1m" from "… tomorrow"). */
function retry(s: string, lead: string, tail = 'to set it now'): string {
  const t = s.replace(/·+/g, ' ').replace(/\s+/g, ' ').replace(/[,;:\s]+$/, '').trim();
  return t && t.length <= 60 ? `${lead} "${t}"${tail ? ` ${tail}` : ''}.` : '';
}
/** "sell half at 2x for 24h": take-profits and stops wait until they sell — the message again without the time. */
function noExpiry(s: string): string {
  const rest = s.replace(new RegExp(SELL_EXPIRY.source, 'g'), ' ');
  // "sell 50% in 2 hours": no level left — the example puts one in.
  if (!/\d[kmbx]\b|[+-]\d|\$\.?\d|(?<!\d)\.\d|\b(?:at|if|when|once|above|below|over|under|to|drops?|dips?|pumps?|hits?|doubles?|triples?)\b/.test(rest.replace(/·+/g, ' '))) {
    const again = retry(`${squash(rest)} at 2x`, ' Say', 'for example');
    return `Take-profits and stops don't expire, and I sell at a level, not at a time — at what level?${again || ' Say it with a level, like "sell half at 2x".'}`;
  }
  const again = retry(rest, ' Say just', '');
  return `Take-profits and stops don't expire — they wait until they sell or you remove them.${again || ' Say it without the time, like "sell half at 2x" (and "remove tp1" later if you change your mind).'}`;
}
/** "buy $5 at 500k today": a buy waits a number of hours, not until a time of day. */
const BUY_TODAY = /\b(?:today only|only today|for today|today|by tonight|until tonight|till tonight|end of (?:the )?day|eod)\b/g;
const timedHint = (s: string) => `I don't do timed orders — I sell when it reaches the level, whenever that is.${retry(s.replace(TIMED, ' '), ' Say')}`;
/** "sell half if it moves 20%": up or down? */
const EITHER_WAY = rx(String.raw`\b(?:moves?|moved|moving|swings?|swung|swinging|changes?|changed|goes|went)\s+(?:by\s+|another\s+|like\s+|about\s+|around\s+)?(\d+(?:\.\d+)?)%`);

/** "dump $10 into claudia": trader talk for buying — never read as a sell. */
const INTO = /\binto\b|\bin to\b/;

/** "most of it", "a lot": a big part — the example says so. */
const MOST = /^(?:most|majority|the bulk|bulk|a lot|lots|a ton|tons|loads|heaps|a good amount|a good chunk)$/;
/** "sell some at 2x", "sell most of my bag at 3m": part of the bag, but how much? Asked with the word that was said. */
function vagueHint(where: string, m: Msg): string {
  const word = m.s.match(VAGUE)?.[0];
  if (!word) return `How much should I sell — what % or $? Try "sell 25% ${where}", "sell $3 ${where}" or "sell half ${where}". I won't guess.`;
  return `How much is "${word}"? Say a % or $ — like "sell ${MOST.test(word) ? '75%' : '25%'} ${where}" or "sell $3 ${where}". I won't guess.`;
}
/** "at 2x", "if it drops to 600k": where a sell goes, the way the user said it — for examples to copy. */
const whereWords = (level: LevelSpec, down: boolean) => (down && !isDown(level) ? `if it drops to ${typedLevel(level)}` : `at ${typedLevel(level)}`);

/**
 * Before a sell becomes an order: anything left unread that could be its size
 * is a question — a slip ("hal", "quart"), a number ("50p"), a stray word
 * when no size was said (that would sell everything). Never skipped.
 */
function unreadSize(m: Msg, c: Ctx, coin: CoinSpec, sized: boolean, where: string, verb: string, size: string | null = null): string | null {
  const left = unread(m, coin);
  // "sell half at 2x good": everyday English left over — what did it mean? Asked, never skipped.
  const common = left.find((w) => COMMON.has(w));
  if (common) return `I didn't catch "${common}" — try "${verb}${size ? ` ${size}` : ''} ${where}".`;
  // "sell hal at 2x": the slip would be read as a coin called HAL — with no size said, that sells all of it. Asked.
  const named = 'symbol' in coin && !c.dollars.length ? coin.symbol.toLowerCase() : null;
  for (const w of named && !sized ? [...left, named] : left) {
    const typo = sizeTypo(w);
    if (typo) {
      const say = typo === 'quarter' || typo === 'third' || typo === 'fifth' || typo === 'tenth' ? `a ${typo}` : typo;
      const coinToo = w === named ? ` (For a coin called ${w.toUpperCase()}, put a $ in front: "$${w.toUpperCase()}".)` : '';
      return `Did you mean "${say}"? Say "${verb} ${say} ${where}" — I won't guess how much to sell.${coinToo}`;
    }
  }
  const num = left.find((w) => NUMBER_LEFT.test(w));
  if (num) return `I didn't catch "${num}" — how much should I sell? Try "${verb} 25% ${where}" or "${verb} $3 ${where}".`;
  if (!sized && left.length) return `I didn't catch "${left[0]}" — how much should I sell? Try "${verb} half ${where}", "${verb} $3 ${where}" or "${verb} all ${where}".`;
  return null;
}

/** "sell 25 of my bag", "30 of the position": a share of the bag, never 25 dollars (or 25 coins). */
function takeBagShare(m: Msg): number[] {
  return m.take(rx(String.raw`(?<![\w.$%+-])${NUM}(?![\w.%$])\s+(?=of\s+(?:my|the|your|this|that)\s+(?:bag|bags|position|stack|holdings?)\b)`)).map((x) => +x[1]);
}

/** "… and keep the rest", "let the rest ride": a part of the bag is sold — the rest is the opposite of a size. */
const KEEP_REST = /\b(?:and\s+|then\s+|but\s+)?(?:keep|hold|leave|let|ride)\s+(?:the\s+)?(?:rest|remainder|remaining)(?:\s+(?:ride|run|riding|running|of it|of my bag|in))?(?:\s+(?:as\s+)?(?:a\s+|my\s+|the\s+)?(?:moon bags?|bag))?\b/;

/**
 * "keep 20%", "leave a moonbag", "sell all but a moonbag": the part of the bag that stays.
 * A number kept comes off what's sold; a moonbag of no size is a question — never all of it.
 */
type Keep = { kept: number; said: string } | { vague: string };
const KEEP_V = String.raw`(?:and\s+|but\s+|then\s+)?(?:keep|keeping|hold|holding|leave|leaving|save|saving|retain|retaining)\s+(?:back\s+|me\s+|like\s+|about\s+|around\s+|only\s+|just\s+)?`;
const KEEP_SMALL = String.raw`(?:(?:a|an|my|some|the|a few|a couple of|a couple)\s+)?(?:small\s+|little\s+|tiny\s+|lil\s+)?(?:moon bags?|bag|bit|little|few|some|couple|tokens|coins|piece|chunk|dust|runner)\b`;
function takeKeep(m: Msg): Keep | null {
  const BAG = String.raw`(?:\s+(?:as\s+)?(?:a\s+|my\s+|the\s+)?(?:moon bags?|bag))?(?:\s+(?:of\s+(?:it|my bag|the bag|the position)|for (?:the )?moon))?`;
  const n = m.take(rx(String.raw`\b${KEEP_V}(?:a\s+)?${SHARE}${BAG}|\b(?:except(?: for)?|minus|apart from|save for|other than|besides)\s+(?:like\s+|about\s+|keep(?:ing)?\s+|leave\s+|leaving\s+)?(?:a\s+)?${SHARE}${BAG}`))[0];
  if (n) return { kept: n[1] != null || n[2] != null || n[3] != null ? shareOf(n, 1) : shareOf(n, 4), said: n[0].trim() };
  const v = m.take(
    rx(String.raw`\b${KEEP_V}${KEEP_SMALL}(?:\s+(?:for (?:the )?moon|to ride|riding|running))?|\b(?:(?:all|everything|it all|the whole bag|my whole bag|my bag|the rest)\s+(?:off\s+)?)?(?:but|except(?: for)?|minus|apart from|save for|other than|bar|besides|without)\s+(?:keep\s+|leave\s+|keeping\s+|leaving\s+)?${KEEP_SMALL}`),
  )[0];
  return v ? { vague: v[0].trim() } : null;
}

/** The size with a kept part: "keep 20%, sell the rest" → 80%; a moonbag of no size → asked. `pct` / `usd`: the size said. */
function keptSize(keep: Keep, pct: number | null, usd: number | null, verb: string, where: string): number | null | Hint {
  if ('vague' in keep) {
    // "sell 80% at 5x and leave a moonbag": the moonbag is what's left.
    if (usd != null || (pct != null && pct < 100)) return pct;
    return { hint: `How big a moonbag? Say how much to sell, like "${verb} 90% ${where}" to keep 10% — I won't guess how much to keep.` };
  }
  const k = keep.kept;
  if (!(k > 0 && k < 100)) return { hint: `How much should I sell, and how much keep? Say one size, like "${verb} 75% ${where}".` };
  const rest = +(100 - k).toFixed(4);
  if (usd != null) return { hint: `${usdText(usd)}, or all but ${k}%? Say "${verb} ${rest}% ${where}" to keep ${k}% — or "${verb} ${usdText(usd)} ${where}".` };
  if (pct == null || pct >= 100 || Math.abs(pct - rest) < 1e-6) return rest;
  return { hint: `Sell ${pct}%, or keep ${k}% and sell ${rest}%? Those don't add up — say "${verb} ${rest}% ${where}" or "${verb} ${pct}% ${where}".` };
}

/** "half of half", "half of what's left", "50% of my profits", "more than half": asked, with the share of the bag where it can be worked out. */
function ofAsk(of: Of, level: LevelSpec, verb: string, where: string, stop: boolean): Unknown {
  const cap = (t: string) => t.replace(/^./, (ch) => ch.toUpperCase());
  switch (of.kind) {
    case 'nested':
      return unknown(`${cap(of.said)} is ${of.pct}% of your bag — say "${verb} ${of.pct}% ${where}".`);
    case 'fuzzy':
      return unknown(`How much exactly is "${of.said}"? Say a %, like "${verb} ${of.eg}% ${where}" — I won't guess.`);
    case 'rest':
      return {
        type: 'unknown',
        hint: `${cap(of.said)} — how much of your whole bag is that? Say it as a % of the bag, like "${verb} 25% ${where}".`,
        ask: { kind: 'part-of-rest', pct: of.pct, level, verb, ...(stop ? { stop: true as const } : {}) },
      };
    case 'profit': {
      const x = level.kind === 'x' ? level.value : level.kind === 'pct' ? 1 + level.value / 100 : null;
      if (x != null && x > 1) {
        const bag = Math.round((of.pct * (x - 1)) / x);
        const what = of.pct >= 100 ? `the profit at ${typedLevel(level)}` : `${of.said} at ${typedLevel(level)}`;
        return unknown(`I sell a share of your bag, not of the profit — ${what} is about ${bag}% of your bag. Say "${verb} ${bag}% ${where}".`);
      }
      return unknown(`I sell a share of your bag, not of the profit — say how much of the bag, like "${verb} 25% ${where}".`);
    }
  }
}

/** A question run.ts makes exact for the coin on screen: kept only when no other coin was named. */
function askHere(u: Unknown, m: Msg, c: Ctx): Unknown {
  if (!u.ask) return u;
  const coin = findCoin(new Msg(m.s), c);
  return !isHint(coin) && 'here' in coin ? u : { type: 'unknown', hint: u.hint };
}

/** "sell .5 of my bag": half the bag, or 0.5% of it? */
function tinyShare(n: number, verb: string, where: string): string {
  const pct = `${+(n * 100).toFixed(2)}%`;
  const word = n === 0.5 ? 'half' : n === 0.25 ? 'a quarter' : n === 0.75 ? 'three quarters' : null;
  return `Is "${n}" ${word ? `${word} of your bag (${pct})` : `${pct} of your bag`}, or ${n}%? Say "${verb} ${word === 'half' ? 'half' : pct} ${where}" or "${verb} ${n}% ${where}".`;
}

/** With "keep the rest" the size has to be part of the bag: none said, or all of it, is a question. */
function keepHint(keepRest: boolean, sized: boolean, pct: number | null, where: string): string | null {
  if (!keepRest) return null;
  if (!sized) return `How much should I sell, keeping the rest? Try "sell half ${where}" or "sell 25% ${where}".`;
  if (pct != null && pct >= 100) return `Sell all of it, or keep the rest? Say "sell all ${where}" — or a part, like "sell half ${where}".`;
  return null;
}

/** "sl at 300k" sells the rest; with a size ("stop 10% at 700k", "sl $2 at 650k", "sl 25% -30%") it's a partial stop. */
const setSl: Handler = (m, c) => {
  if (!m.has(SL_W)) return null;
  if (families(m.s).size > 1) return unknown(oneThing(m.s));
  // "stop 2 at 600k" (no "add") moves a partial stop that's already there, like "tp2 at 5x".
  if (!m.has(ADD_V)) {
    const probe = takeTargets(new Msg(m.s));
    if (!isHint(probe) && probe.some((t) => t.kind === 'stop')) {
      const mv = moveCore(new Msg(m.s), c, null);
      if (mv && mv.type !== 'unknown') return mv;
    }
  }
  if (m.has(EVERY)) return unknown(LADDER);
  if (m.has(UNITS)) return unknown(NOT_COUNTED);
  if (m.has(SELL_EXPIRY)) return unknown(noExpiry(m.s));
  if (m.has(TIMED)) return unknown(timedHint(m.s));
  // "stop loss … if it pumps to 2x": a stop sells on the way down — up or down?
  if (m.has(UP_TO) && !m.has(DOWN_TO)) return unknown('A stop sells on the way down. To sell on the way up, try "sell 25% at 2x" — or for a stop, "sell 25% if it drops to 600k".');
  // "30% below entry": the entry is where the drop is measured from, not a second level.
  m.take(/\b(?:below|under|beneath|from|off)\s+(?:my\s+|the\s+)?(?:entry|buy ?in|cost basis)(?:\s+price)?\b/);
  // "stop loss at 70% of current": 0.7x the price now — never a 70% drop, and never 0.7x the entry.
  const cur = m.s.match(/(?<![\w.%+$-])(\d+(?:\.\d+)?)%\s+of\s+(?:the\s+)?(?:current(?: price| mc| mcap| market cap)?|now|here|the price(?: now)?|price now|where it is(?: now)?)\b/);
  if (cur) {
    const n = +cur[1];
    if (!(n > 0 && n < 100)) return unknown(`A stop goes below the price now — like "sl -30%".`);
    const probe = new Msg(m.s);
    probe.take(SL_W);
    probe.take(rx(String.raw`(?<![\w.%+$-])\d+(?:\.\d+)?%\s+of\s+\S+(?:\s+(?:price|mc|mcap|cap|now))?`));
    return askHere({ type: 'unknown', hint: `Is that a stop ${+(100 - n).toFixed(2)}% below the price now? Say "sl -${+(100 - n).toFixed(2)}%" — I won't read "${n}%" as a ${n}% drop.`, ask: { kind: 'now-x', x: n / 100 } }, probe, c);
  }
  // "sl at 50% of entry", "stop at half my entry": a level, not a size.
  const entry = takeEntryLevels(m);
  const usds = takeSellUsd(m);
  const share = takeBagShare(m);
  let lead = takeLead(m);
  m.take(SL_W);
  const keepRest = m.take(KEEP_REST).length > 0;
  const keep = takeKeep(m);
  const size = takeSize(m);
  size.vals.push(...share.filter((n) => n >= 1));
  if (size.initials) return unknown('How much should the stop sell? Say a %, like "stop 25% at 700k".');
  m.take(/\b(?:sell|sells|selling)\b/);
  m.take(DOWN_TO);
  const egSize = sizeEg(size.vals, usds, lead, m.s);
  const scan = scanLevels(m, 'sl', c.unit, egFor('sl', egSize));
  scan.levels.unshift(...entry);
  if (scan.amb.length) return unknown(lead?.verb === 'sell' ? leadAndLevel(lead.raw, scan) : scan.amb[0]);
  // "sl 50 at 600k": with a level the plain number is the size; alone ("sl 30") it's the level — or a question.
  if (lead && !scan.levels.length && !scan.bare.length) {
    if (lead.verb === 'sell') return unknown(sizeHint(lead.raw, null));
    const l = plainLevel(lead.raw, false, 'sl', c.unit);
    if (typeof l === 'string') return unknown(l);
    scan.levels.push({ spec: l, rel: false });
    lead = null;
  }
  // A bare "10%" is the size when there's a level too ("stop 10% at 700k"), else the drop ("sl 30%").
  const hasLevel = scan.levels.length > 0;
  const sized = size.vals.length > 0 || usds.length > 0 || lead != null;
  const loose: number[] = [];
  for (const b of scan.bare) {
    if (!b.at && !sized && !loose.length && (hasLevel || scan.bare.some((o) => o !== b && o.at))) {
      loose.push(b.n);
      continue;
    }
    if (b.n >= 100) return unknown("A coin can't drop 100% or more — try something like \"sl -30%\".");
    scan.levels.push({ spec: { kind: 'pct', value: -b.n }, rel: false });
  }
  const said = sizesSaid(size.vals, usds, lead, loose);
  const levels = dedupe(scan.levels);
  if (levels.length === 0) return unknown(c.now ? NOW_SELL : 'Where should the stop go? Try "sl at 300k mcap" or "sl -30%".');
  if (levels.length > 1) return unknown(manyLevels(m, said, levels));
  const level = levels[0].spec;
  const where = whereWords(level, true);
  if (size.of) return askHere(ofAsk(size.of, level, 'sell', where, true), m, c);
  const tiny = share.find((n) => n < 1);
  if (tiny != null) return unknown(tinyShare(tiny, 'sell', where));
  const odd = oddShare(m, where);
  if (odd) return unknown(odd);
  if (!said.length && !keep && m.has(VAGUE)) return unknown(vagueHint(where, m));
  const sz = sellSize(said, level);
  if (isHint(sz)) return unknown(sz.hint);
  if (keep) {
    const k = keptSize(keep, sz.pct, sz.usd, 'sell', where);
    if (isHint(k)) return unknown(k.hint);
    sz.pct = k;
  }
  const kept = keepHint(keepRest, said.length > 0, sz.pct, where);
  if (kept) return unknown(kept);
  const coin = oneCoin(m, c, 'One coin at a time — try "sl -30% on $TIPPY".');
  if (isHint(coin)) return unknown(coin.hint);
  // No size here is the stop loss (sells the rest) — never because a size went unread.
  const left = unreadSize(m, c, coin, said.length > 0 || (keep != null && 'kept' in keep), where, 'sell', said.length === 1 ? sizeEg(size.vals, usds, lead) : null);
  if (left) return unknown(left);
  if (sz.usd != null) return { type: 'add-stop', coin, level, sellPct: null, sellUsd: sz.usd };
  if (sz.pct != null && sz.pct < 100) return { type: 'add-stop', coin, level, sellPct: sz.pct };
  return { type: 'set-sl', coin, level };
};

/** "sell 1m": Tippy can't sell a number of coins — a level with no size right after "sell" is a question. */
const COUNTED = rx(String.raw`\b(?:sell|sells|dump|trim|cut|unload|offload|cash ?out)\s+\$?${NUM}[kmb](?![\w.%])${NOT_MC}`);

const addTp: Handler = (m, c) => {
  const hasTp = m.has(TP_W);
  const hasSell = m.has(SELL_W);
  if (!hasTp && !hasSell) return null;
  if (families(m.s).size > 1) return unknown(oneThing(m.s));
  // "tp2 at 5x" (no "add") edits a level that's already there.
  if (!m.has(ADD_V)) {
    const probe = takeTargets(new Msg(m.s));
    if (!isHint(probe) && probe.some((t) => t.kind === 'tp')) {
      // Only a real edit ("tp2 at 5x"); "tp 3 sell half" is a new take-profit at 3x.
      const mv = moveCore(new Msg(m.s), c, null);
      if (mv && mv.type !== 'unknown') return mv;
    }
  }
  if (m.has(EVERY)) return unknown(LADDER);
  if (m.has(UNITS)) return unknown(NOT_COUNTED);
  if (m.has(SELL_EXPIRY)) return unknown(noExpiry(m.s));
  if (m.has(TIMED)) return unknown(timedHint(m.s));
  const counted = m.s.match(COUNTED);
  const allOut = m.has(ALL_OUT);
  const dump = m.has(/\bdump\b/);
  const entry = takeEntryLevels(m);
  const usds = takeSellUsd(m);
  const share = takeBagShare(m);
  let lead = takeLead(m);
  m.take(/\b(?:first|second|third|fourth|fifth|1st|2nd|3rd|4th|5th|another|new|extra|one more)\s+(?=(?:tp|take ?profit))/);
  m.take(rx(String.raw`\b(?:tps?\d?|take ?profits?|profit taking|${LOCK_IN})\b`));
  const keepRest = m.take(KEEP_REST).length > 0;
  const keep = takeKeep(m);
  const size = takeSize(m);
  size.vals.push(...share.filter((n) => n >= 1));
  // ("on a 2x dump", "a 30% dump": the dump is how far it falls — left for the level reader. "2x dump half" is still the verb.)
  m.take(rx(String.raw`${OUT}|\b(?:sell|sells|selling|take|takes|taking|offload|unload|scale out|trim|cut|cash ?out|secure|close|exit|pull out)\b|(?<!\b(?:a|an|the|any|another|on|after|big|huge|double|triple|each|every)\s+(?:\d+(?:\.\d+)?[x%]\s?)?)\bdump\b|\b(?:pull|get|grab|recover)\s+(?:out\s+|back\s+)?(?=(?:my\s+)?initials?\b)`));
  // "if it drops to 700k" / "if it pumps to 2m": which way the level is reached.
  let down = m.take(DOWN_TO).length > 0;
  let up = m.take(UP_TO).length > 0;
  // "dump $10 into claudia at 500k" is buying talk (a "drops into 600k" was read above).
  const dumpInto = dump && m.has(INTO);
  // "if it moves 20%": up or down? (Taken before the level reader, which would read a 20% size.)
  const either = m.take(EITHER_WAY)[0];
  const verb = hasTp && !hasSell ? 'tp' : 'sell';
  const egSize = sizeEg(size.vals, usds, lead, m.s);
  const eg = egFor(verb, egSize);
  // In 'move' units a bare number is a multiple after "tp" only — "sell half at 700" still asks.
  const scan = scanLevels(m, 'tp', hasTp ? c.unit : 'mc', eg);
  scan.levels.unshift(...entry);
  if (scan.amb.length) return unknown(lead?.verb === 'sell' ? leadAndLevel(lead.raw, scan) : scan.amb[0]);
  if (either) {
    const n = either[1];
    const sz = egSize ? ` ${egSize}` : '';
    return unknown(`Up ${n}% or down ${n}%? Say "sell${sz} if it pumps ${n}%" or "sell${sz} if it drops ${n}%".`);
  }
  // "sell 10% at 700k if it drops" / "… if it pumps" / "when it's down 2x": a direction said after the level.
  if (m.take(rx(String.raw`\b(?:if|when|once)\s+${SUBJECT}(?:${DOWN})\b`)).length) down = true;
  if (m.take(rx(String.raw`\b(?:if|when|once)\s+${SUBJECT}(?:${UP})\b`)).length) up = true;
  const levels = scan.levels;
  // "tp 2" alone: the plain number is the level (or a question); "tp 50 @ 1.2m": it's the size.
  if (lead && !levels.length && !scan.bare.length) {
    if (lead.verb === 'sell') return unknown(c.now ? NOW_SELL : sizeHint(lead.raw, null));
    const l = plainLevel(lead.raw, false, 'tp', c.unit, egFor('tp', sizeEg(size.vals, usds, null)));
    if (typeof l === 'string') return unknown(l);
    levels.push({ spec: l, rel: false });
    lead = null;
  }
  // An unsigned "50%": the level when there's none yet ("tp at 50%"), otherwise a size.
  const loose: number[] = [];
  // ("tp 20% at 20%": the one after "at" is where, the other the size — read in that order.)
  for (const b of [...scan.bare].sort((p, q) => +q.at - +p.at)) {
    if (levels.length === 0 && (b.at || up || down)) {
      // "sell 50 at 50%": 50% or $50 — and up or down? One question, the size left open.
      if (lead?.verb === 'sell' && !up && !down)
        return unknown(`Is "${lead.raw}" ${lead.raw}% of your bag or $${lead.raw} — and up ${b.n}% or down ${b.n}%? Say it in full, like "sell ${lead.raw}% at +${b.n}%" or "sell $${lead.raw} if it drops ${b.n}%".`);
      // With a plain "sell", "at 20%" could be either way ("at 200%" only up: 2x, or +200%?).
      if (!hasTp && !up && !down && b.n >= 100) return unknown(bigPct(b.n, eg.at));
      if (!hasTp && !up && !down) return unknown(`Up ${b.n}% or down ${b.n}%? Say "${eg.at(`+${b.n}%`)}" for a take-profit, or "${eg.drop(b.n)}" for a stop.`);
      // "tp at 200%": 2x the price, or up 200% (3x)?
      if (b.n >= 100 && !up && !down) return unknown(bigPct(b.n, eg.at));
      levels.push({ spec: { kind: 'pct', value: down && !up ? -b.n : b.n }, rel: false });
    } else if (b.at && levels.length > 0) {
      const at = typedLevel(levels[0].spec);
      return unknown(`Is ${b.n}% how much to sell, or how far up? Try "sell ${b.n}% at ${at}" or "tp at +${b.n}%".`);
    }
    else if (levels.length > 0 || size.vals.length || usds.length) loose.push(b.n);
    else return unknown(`Is ${b.n}% how much to sell, or how far up? Try "sell ${b.n}% at 2x" or "tp at +${b.n}%".`);
  }
  const said = sizesSaid(size.vals, usds, lead, loose);
  // "dump half into strength" is a sell (a share of the bag); "dump $10 into claudia" could be a buy.
  if (dumpInto && !said.some((x) => 'pct' in x)) {
    const amount = said.length === 1 ? ('lead' in said[0] ? `$${said[0].lead.raw}` : sizeWords(said[0])) : null;
    const at = levels.length === 1 ? ` at ${typedLevel(levels[0].spec)}` : '';
    const how = amount ? `say "buy ${amount}${at}" to buy, or "sell ${amount}${at}" to sell` : `say "buy $10${at}" to buy, or "sell 50%${at}" to sell — with the amount you mean`;
    return unknown(`Buy or sell? "Dumping into" a coin usually means buying it — ${how}. I never guess which.`);
  }
  if (levels.length === 0) return unknown(c.now ? NOW_SELL : whereHint(said, hasTp, up, down));
  if (levels.length > 1) {
    // "sell 5k at 2x": 5k dollars, or 5,000 coins? Never a second level.
    const n = counted && !said.length ? counted[0].match(/\$?\d[\d.]*[kmb]$/)?.[0] : null;
    const other = n ? levels.find((l) => !(l.spec.kind === 'mc' && l.spec.value === +n.replace(/^\$/, '').slice(0, -1) * { k: 1e3, m: 1e6, b: 1e9 }[n.slice(-1) as 'k' | 'm' | 'b'])) : null;
    if (n && other && levels.length === 2) {
      const w = whereWords(other.spec, down);
      return unknown(`Is "${n}" dollars or coins? I sell a % of your bag or a $ amount, not a number of coins — say "sell $${n.replace(/^\$/, '')} ${w}" or "sell 25% ${w}".`);
    }
    return unknown(manyLevels(m, said, levels));
  }
  const level = levels[0].spec;
  const where = whereWords(level, down);
  if (size.of) return askHere(ofAsk(size.of, level, verb, where, down || isDown(level)), m, c);
  const tiny = share.find((n) => n < 1);
  if (tiny != null) return unknown(tinyShare(tiny, verb, where));
  const odd = oddShare(m, where);
  if (odd) return unknown(odd);
  if (!said.length && !size.initials && !keep && m.has(VAGUE)) return unknown(vagueHint(where, m));
  const sz = sellSize(said, level);
  if (isHint(sz)) return unknown(sz.hint);
  if (keep) {
    const k = keptSize(keep, sz.pct, sz.usd, verb, where);
    if (isHint(k)) return unknown(k.hint);
    sz.pct = k;
  }
  const kept = keepHint(keepRest, said.length > 0 || size.initials, sz.pct, where);
  if (kept) return unknown(kept);
  let sellPct = sz.pct;
  const usd = sz.usd;
  if (size.initials) {
    // "take initials at 1.5m": the share worth your entry there depends on the price — asked, with it worked out.
    if (level.kind === 'mc' || level.kind === 'price') {
      if (sellPct != null || usd != null) return unknown(`How much should it sell — your initials or ${sellPct != null ? `${sellPct}%` : usdText(usd!)}? Pick one.`);
      return askHere({ type: 'unknown', hint: `How much of your bag is your initials at ${typedLevel(level)}? Say a %, like "sell 50% at ${typedLevel(level)}" — or the level as a multiple, like "take initials at 2x".`, ask: { kind: 'initials', level } }, m, c);
    }
    // ("take initials at +100%" is 2x.)
    const x = level.kind === 'x' ? level.value : level.kind === 'pct' ? 1 + level.value / 100 : NaN;
    if (!(x > 1)) return unknown('How much should it sell? Say a %, like "sell 50% at 2x".');
    if (sellPct != null || usd != null) return unknown(`How much should it sell — your initials or ${sellPct != null ? `${sellPct}%` : usdText(usd!)}? Pick one.`);
    sellPct = Math.round(100 / x);
  }
  if (sellPct == null && usd == null) {
    // "exit at 2m" / "get me out at 500k" sell it all; "sell 1m" could be a number of coins.
    if (allOut) sellPct = 100;
    else if (counted && !hasTp)
      return unknown(`Sell all of it at ${levelWords(level)}? I sell a % of your bag or a $ amount, not a number of coins — say "sell all at ${typedLevel(level)}" or "sell 50% at ${typedLevel(level)}".`);
  }
  const coin = oneCoin(m, c, 'One coin at a time — try "tp at 2x on $TIPPY".');
  if (isHint(coin)) return unknown(coin.hint);
  // ("exit" sells everything only when nothing else says how much: "exit hal at 2x" may be "exit half".)
  const left = unreadSize(m, c, coin, said.length > 0 || size.initials || (keep != null && 'kept' in keep), where, verb, said.length === 1 ? sizeEg(size.vals, usds, lead) : allOut ? 'all' : null);
  if (left) return unknown(left);
  const inUsd = usd != null ? { sellUsd: usd } : {};
  if (down || isDown(level)) {
    if (up) return unknown(UP_OR_DOWN);
    if (hasTp) return unknown('Take-profits go above the price. To sell some on the way down, try "sell 25% if it drops to 700k" — or "sl -30%" to sell the rest.');
    // "sell everything if it drops 30%" is a stop loss; "sell 10% if it drops to 700k" a partial stop.
    if (usd != null) return { type: 'add-stop', coin, level, sellPct: null, sellUsd: usd };
    if (sellPct == null || sellPct === 100) return { type: 'set-sl', coin, level };
    return { type: 'add-stop', coin, level, sellPct };
  }
  // "sell 10% at 700k": a market cap or price with no direction — above the price now
  // it's a take-profit, below it a stop (run.ts decides against the live price).
  if (!up && !hasTp && (level.kind === 'mc' || level.kind === 'price')) return { type: 'add-tp', coin, level, sellPct, ...inUsd, anySide: true };
  return { type: 'add-tp', coin, level, sellPct, ...inUsd };
};

const applyPreset: Handler = (m, c) => {
  const p = takePreset(m);
  if (isHint(p)) return unknown(p.hint);
  if (p === null) {
    if (!m.has(GUARD_V)) return null;
    // "protect half my bag at 600k": a stop said as protecting — never a preset question about it.
    const probe = new Msg(m.s);
    const size = takeSize(probe);
    const scan = scanLevels(probe, 'sl', c.unit);
    if (scan.levels.length === 1 && !scan.amb.length) {
      const l = scan.levels[0].spec;
      const up = (l.kind === 'x' && l.value > 1) || (l.kind === 'pct' && l.value > 0);
      const where = up ? `at ${typedLevel(l)}` : l.kind === 'pct' ? `if it drops ${Math.abs(l.value)}%` : `if it drops to ${typedLevel(l)}`;
      if (size.pct != null && size.pct < 100) return unknown(`Sell ${pctWords(size.pct)} ${where}? Say "sell ${pctWords(size.pct)} ${where}" — I'll show you the order before anything happens.`);
      return unknown(`${up ? 'Take profit' : 'A stop'} ${where}? Say "sell all ${where}" — or a part, like "sell half ${where}".`);
    }
    return unknown(`Which preset? Try "guard $TIPPY with classic" — ${PRESETS}.`);
  }
  if (p === 'none') return unknown('To stop guarding a coin, say "stop guarding $TIPPY".');
  // "moonbag 10% at 10x": a size and a level — never a preset that replaces your levels.
  if (/\d/.test(m.s)) {
    const name = p === 'moon' ? 'moon bag' : p === 'safe' ? 'play it safe' : p;
    const lvl = levelIn(m.s);
    const pct = m.s.match(/(?<![\w.])(\d+(?:\.\d+)?)%/);
    if (p === 'moon' && lvl && pct && +pct[1] > 0 && +pct[1] < 100) {
      const n = +pct[1];
      return unknown(`Keep ${n}% as a moonbag, or sell ${n}% at ${lvl}? Say "sell ${+(100 - n).toFixed(2)}% at ${lvl}" to keep ${n}%, or "sell ${n}% at ${lvl}" — "guard with moon bag" is the P3 preset.`);
    }
    return unknown(`A preset, or a level of your own? Say "guard with ${name}" for the preset — or the order itself, like "sell half at ${lvl ?? '2x'}".`);
  }
  m.take(/\b(?:guard|guarding|protect|protecting|cover|use|using|apply|applying|put|set|switch|preset|with|on)\b/);
  const coin = oneCoin(m, c, 'One coin at a time — try "guard $TIPPY with classic".');
  if (isHint(coin)) return unknown(coin.hint);
  return { type: 'apply-preset', coin, preset: p };
};

/**
 * "10% at 700k", "$20 at 500k", "half at 2x", "700k": an order with no verb.
 * Buy or sell is the one thing Tippy never guesses — it asks, with what it read.
 */
function noVerb(m: Msg, c: Ctx): Unknown | null {
  // "$20 at 500k", "get $3 at 2m": dollars said before where — an amount, never a $3 price.
  const usd = m.take(rx(String.raw`^\$${NUM}(k)?${END}${NOT_MC}|(?<![\w.])\$${NUM}(k)?${END}${NOT_MC}(?=\s+(?:at|if|when|once|below|above|under|over)\b|\s+${LEVEL_SAID})`), (x) => x.index === 0 || +x[3] >= 1 || !!x[4])[0];
  const usds = [...takeSellUsd(m), ...(usd ? [+(usd[1] ?? usd[3]) * (usd[2] ?? usd[4] ? 1000 : 1)] : [])];
  const size = takeSize(m);
  const scan = scanLevels(m, 'tp', c.unit);
  const pct = size.pct ?? scan.bare.find((b) => !b.at)?.n ?? null;
  const level = scan.levels.length === 1 ? scan.levels[0].spec : null;
  if (!level && pct == null && !usds.length) return null;
  const at = level ? ` at ${typedLevel(level)}` : ' at 2x';
  if (usds.length) return unknown(`Buy or sell ${usdText(usds[0])}${at}? Say "buy ${usdText(usds[0])}${at}" or "sell ${usdText(usds[0])}${at}" — I never guess which.`);
  if (pct != null) return unknown(`Sell ${pct}%${at}? Say "sell ${pct}%${at}" — I never guess buy or sell.`);
  return unknown(`What should happen at ${levelWords(level!)}? Try "sell 25%${at}" or "buy $10${at}".`);
}

/** "don't sell", "never buy", "stop selling": a trade word under a "not". */
const NEGATED = rx(
  String.raw`\b(?:dont|do not|never|no longer|wont|will not)\s+(?:[a-z]+\s+){0,3}?(?:${SELL_VERB}|${BUY_AMOUNT_V}|buys?|bids|exit|out|gtfo|bail|close|get out|get me out|lock in|double down|average down|avg down|go long|(?:add|throw|get me|get)(?=\s+(?:another\s+|in\s+)?[$\d]))\b|\bstop\s+(?:selling|buying|aping|bidding|sniping|dcaing)\b`,
);
/** "don't set a tp at 2x", "never put a stop at 500k" — on a buy, "no tp/sl" is about the guard (takePreset). */
const NEGATED_LEVEL = rx(String.raw`\b(?:dont|do not|never|no longer|wont|will not)\s+(?:[a-z]+\s+){0,3}?(?:${TP_VERB}|${SL_VERB}|tp\d|trail|trailing)\b`);
/** "sell if it doesn't hit 1m": a condition on something not happening. */
const UNLESS = /\b(?:doesnt|does not|didnt|did not|wont|will not|cant|cannot|fails? to|never)\s+(?:hit|hits|reach|reaches|get|gets|go|goes|make|makes|break|breaks|pump|pumps|dip|dips|drop|drops)\b|\bunless\b/;

const SELF_CANCEL =
  /\b(?:cancel that|scratch that|never ?mind|nvm|ignore (?:that|this|me)|disregard(?: that| this)?|jk|just kidding|forget (?:that|it)|dont do (?:that|it)|undo that|actually no|actually nah|actually not|actually dont|no actually|no wait|wait no|nah|nope|on second thoughts?|second thoughts|hold on|hold up)$/;

/** "should i sell half at 2x?", "maybe sell half at 2x": thinking out loud — offer, don't set it up. */
const HEDGE_START =
  /^(?:should i|should we|shall i|shall we|i should|we should|i probably should|maybe i should|would it be (?:smart|wise|good|ok|okay) to|is it (?:smart|wise|worth it|good|a good idea|ok|okay) to|do (?:you|u) think (?:i should )?|maybe|perhaps|i might|i may|might|im thinking (?:of|about)|i m thinking (?:of|about)|thinking (?:of|about)|considering|im considering|wondering if i should|i wonder if i should|what if i|how about i|what (?:happens|would happen|will happen|happens) (?:if|when)(?: i| we)?)\b\s*/;
const HEDGE_END = /\s*\b(?:maybe|perhaps|or not|or nah|wdyt|what do (?:you|u) think|thoughts|good idea|yes or no)$/;
/** "thinking about selling half at 2x" → "sell half at 2x": an instruction to copy. */
const GERUND: Record<string, string> = { selling: 'sell', buying: 'buy', setting: 'set', taking: 'take', dumping: 'dump', trimming: 'trim', adding: 'add', moving: 'move', putting: 'put', placing: 'place', aping: 'ape' };
const asInstruction = (s: string) =>
  s
    .replace(/^(?:i|we|to)\s+/, '')
    .replace(/^[a-z]+ing\b/, (w) => GERUND[w] ?? w)
    .trim();

/** "is 1m a good tp?", "would 2x be a smart exit": asking for a verdict — Tippy doesn't give trading advice. */
const ADVICE =
  /^(?:is|are|was|would|will|does|do|isnt|aint)\b.*\b(?:good|bad|smart|wise|dumb|decent|solid|safe|risky|ok|okay|best|better|worth it|a good idea|too (?:high|low|tight|far|close))\b/;
/** The level a question is about, as an instruction to copy: "is 1m a good tp" → "tp at 1m". */
function adviceExample(text: string): string {
  const lvl = text.match(/(?<![\w.])(?:[+-]\d+(?:\.\d+)?%|\$?\d+(?:\.\d+)?[kmbx]|\$?\.?\d+(?:\.\d+)?(?=\s*(?:mc|mcap)\b))(?![\w.])/)?.[0];
  if (!lvl) return 'tp at 2x';
  if (/\b(?:buy|entry|dip|ape|bid)\b/.test(text)) return /^-/.test(lvl) ? `buy $10 if it dips ${lvl.slice(1)}` : `buy $10 at ${lvl}`;
  const size = text.match(/\b(half|a quarter|a third|all|everything)\b|(?<![\w.%+$-])(\d+(?:\.\d+)?%)(?![\w%])/);
  const part = size ? (size[1] ?? size[2]) : null;
  const where = /^-/.test(lvl) ? `if it drops ${lvl.slice(1)}` : `at ${lvl}`;
  if (/\b(?:sl|stop|stop loss)\b/.test(text)) return part ? `sell ${part} ${/^-/.test(lvl) ? where : `if it drops to ${lvl}`}` : /^-/.test(lvl) ? `sl ${lvl}` : `sl at ${lvl}`;
  if (part) return `sell ${part} ${where}`;
  if (/\b(?:tp|take profit|target|exit)\b/.test(text)) return `tp at ${lvl}`;
  return `sell half at ${lvl}`;
}

/** "short at 1m": Tippy only sells what you hold and buys with your cash. */
const SHORT = /\b(?:short|shorts|shorting|go short|open a short)\b/;
/** "1mk", "2kk": two units on one number — "2kk" is trader slang for 2m; "1mk" is 1m or 1k? */
const DOUBLE_UNIT = /(?<![\w.])\$?(\d+(?:\.\d+)?)([kmb])([kmb])(?![\w.])/;
/** "$1.000", "$2.500": a European thousands dot, or cents? */
const DOT_THOUSANDS = /(?<![\w.])\$([1-9]\d{0,2})\.(\d{3})(?![\w.%])/;

/** "sell half at 2x if btc dumps": a move of another coin (or the market) — Tippy only watches the coin's own price. */
const OTHER_MOVE = new RegExp(
  String.raw`\b(?:if|when|once|after|unless|as soon as)\s+(?:the\s+)?\$?(btc|bitcoin|eth|ether|ethereum|sol|solana|bnb|xrp|doge|market|alts|memes|crypto|nasdaq|spx|stocks)\s+(?:${DOWN}|${UP}|hits|reaches|goes)\b`,
);

/** A level as typed ("2x", "500k", "-20%", "$0.001") — for an example to copy back. */
const LEVEL_TOKEN = /(?<![\w.$%])(?:\$?\d+(?:\.\d+)?[kmbx]|[+-]\d+(?:\.\d+)?%|\$\d*\.\d+)(?![\w.%])/;
const levelIn = (s: string) => s.match(LEVEL_TOKEN)?.[0] ?? null;
const squash = (s: string) => s.replace(/·+/g, ' ').replace(/\s+/g, ' ').replace(/^[\s,;:]+|[\s,;:]+$/g, '').trim();
const isOrder = (i: Intent) => i.type !== 'unknown' && i.type !== 'help';

/** "slippage 15%", "with 20% slippage", "slip 10", "priority fee 0.001", "mev protect": fomo's own settings, never a size, a level or a coin. */
const EXEC = new RegExp(
  String.raw`\b(?:with\s+|and\s+|plus\s+)?(?:(?:max|a|an|some|high|low)\s+)?(?:\d+(?:\.\d+)?%?\s+)?(?:slippage|slipage|slippge|priority fees?|prio fees?|priority|prio|mev protect(?:ion|ed)?|anti mev|mev)(?:\s+(?:of\s+|at\s+|to\s+|is\s+)?\d+(?:\.\d+)?%?(?:\s*sol)?)?(?:\s+(?:on|off))?(?![\w%])` +
    String.raw`|\b(?:with\s+|and\s+)?(?:slip|gas(?: fees?)?|jito(?: tips?)?|bribes?|tips?)\s+(?:of\s+)?\d+(?:\.\d+)?%?(?:\s*sol)?(?![\w%])`,
  'g',
);

/** Sizes as said, for a correction ("instead of half", "… no wait a third"). */
const SIZE_SAID = String.raw`(?:half|a quarter|a third|quarter|third|two thirds|three quarters|all|everything|the rest|\d+(?:\.\d+)?%)`;

// "cancel the sell at 2x", "remove sell half at 2x", "hold off selling at 2x", "stop dumping at 600k", "cancel buying $3 at 500k":
// taking an order back — never a new one.
const CANCEL_W = String.raw`cancel|remove|delete|del|kill|clear|scrap|ditch|undo|rm|get rid of|forget(?: about)?|abort|withdraw|skip|nvm|never ?mind|scratch`;
const NEG_W = String.raw`hold off(?: on)?|quit|no more|no|stop|not|cease|done`;
const SELL_ING = String.raw`selling|dumping|exiting|trimming|unloading|offloading|cashing out|taking profits?`;
const BUY_ING = String.raw`buying|bidding|aping|sniping|dcaing`;
const CANCEL_FILL = String.raw`(?:(?:the|my|that|this|a|an|any|those|these|our|all|both|of|on|with|order|orders|limit|pending|open|[+-]?\$?\d+(?:\.\d+)?[kmbx%]?|half|a quarter|a third|everything)\s+){0,3}`;
const CANCEL_SELL = new RegExp(String.raw`\b(?:${CANCEL_W})\s+${CANCEL_FILL}(?:sell|sells|${SELL_ING}|sale|sales|exit)\b`);
const NEG_SELL = new RegExp(String.raw`\b(?:${NEG_W})\s+(?:more\s+)?(?:${SELL_ING}|sells|sales)\b`);
const CANCEL_BUY = new RegExp(String.raw`\b(?:${CANCEL_W})\s+${CANCEL_FILL}(?:buy|buys|${BUY_ING}|bid|bids|limit buys?|dip buys?)\b`);
const NEG_BUY = new RegExp(String.raw`\b(?:${NEG_W})\s+(?:more\s+)?(?:${BUY_ING}|buys|bids)\b|\b(?:hold off(?: on)?|quit|no more|no|not|cease)\s+buy\b`);

/** "cancel the sell at 2x": which take-profit or stop that is — run.ts names it from the plan. Never an order. */
function removeAsk(text: string, verb: RegExp, negated: boolean): Unknown {
  const m = new Msg(text);
  m.take(verb);
  const dollars = takeDollarCoins(m);
  const scan = scanLevels(m, 'tp', 'mc');
  const level = scan.levels.length === 1 ? scan.levels[0].spec : null;
  const coin = findCoin(m, { unit: 'mc', now: false, dollars });
  const hint = negated
    ? 'I can only place orders, not promise not to sell. To drop a take-profit or a stop, say its number, like "remove tp1" — "show" lists yours. To hold everything, "pause everything".'
    : 'Which order should I remove? Say its number, like "remove tp1" or "remove stop 1" — "show" lists yours (and "cancel my buy" drops a limit buy).';
  if (isHint(coin) || !('here' in coin)) return unknown(hint);
  return { type: 'unknown', hint, ask: { kind: 'remove-sell', level, ...(negated ? { negated: true as const } : {}) } };
}

/**
 * Messages that look like an order but aren't one as said: fomo settings around it, a coin
 * only compared with, a split or a range of sizes, a size taken back, an order taken back.
 * Each is a question with the order to copy — never a card.
 */
function preChecks(raw: string, text: string, opts: ParseOptions): Intent | null {
  const exec = text.match(EXEC);
  if (exec) {
    const rest = squash(text.replace(EXEC, ' '));
    const again = rest ? parse(rest, opts) : null;
    const say = again && isOrder(again) && rest.length <= 60 ? ` Say "${rest}" for the order itself.` : ' Say the order without them, like "sell half at 2x".';
    return unknown(`I don't set slippage, priority fees or MEV protection — fomo's own settings handle those.${say}`);
  }
  // "sell half at 2x like wif did", "buy $3 at 500k like i did on wif": a coin compared with, not the coin.
  const like = text.match(/\blike\s+(?:(?:i|we|you|u)\s+did\s+(?:it\s+)?(?:on|with|for)\s+|(?:on|with|for)\s+)?\$?([a-z][a-z0-9]{1,19})(?:\s+(?:did|does|do))?\b/);
  if (like && isTicker(like[1])) {
    const rest = squash(text.replace(like[0], ' '));
    const sym = like[1].toUpperCase();
    return unknown(`Is $${sym} the coin, or just how it went before? Say "${rest} on ${sym}" for $${sym} — or "${rest}" for the coin on screen.`);
  }
  const isSell = SELL_W.test(text) || TP_W.test(text) || SL_W.test(text);
  // "sell 50/50 at 2x", "sell 60/40": two shares — which one is sold?
  const split = raw.match(/(?<![\d.\/])(\d{1,3})\s*\/\s*(\d{1,3})(?![\d.\/])/);
  if (split && +split[1] + +split[2] === 100 && isSell) {
    const at = ` at ${levelIn(text) ?? '2x'}`;
    const [a, b] = [+split[1], +split[2]];
    return unknown(a === b ? `Is "${a}/${b}" half? Say "sell half${at}" — or the share to sell, like "sell 40%${at}".` : `Sell ${a}% or ${b}%? Say "sell ${a}%${at}" or "sell ${b}%${at}".`);
  }
  // "sell 40-50% at 2x", "sell 90-100% at 5x": one size, not a range.
  const range = text.match(/\b(sell|sells|selling|dump|trim|take|tp|sl|stop|cut|unload|offload|secure|cash out)\s+(?:like\s+|about\s+|around\s+|between\s+)?(\d+(?:\.\d+)?)%?\s*(?:-|to|or)\s*(\d+(?:\.\d+)?)%/);
  if (range) {
    const lvl = levelIn(text.replace(range[0], ' '));
    // "sl 20-30%" with no other level: a range of drops, not of sizes.
    if (/^(?:sl|stop)$/.test(range[1]) && !lvl) return unknown(`I place a stop at one level, not a range — say one, like "sl -${range[2]}%".`);
    return unknown(`I sell one size, not a range — say one, like "sell ${range[2]}% at ${lvl ?? '2x'}".`);
  }
  const buyRange = text.match(rx(String.raw`\b(?:${BUY_AMOUNT_V})\s+(?:like\s+|about\s+|around\s+|between\s+)?\$(\d+(?:\.\d+)?)\s*(?:-|to|or)\s*\$?(\d+(?:\.\d+)?)(?![\w.%$])`));
  if (buyRange) return unknown(`How much — $${buyRange[1]} or $${buyRange[2]}? Say one amount, like "buy $${buyRange[1]} at ${levelIn(text.replace(buyRange[0], ' ')) ?? '500k'}".`);
  // "sell half of $2X at 3x": a $ in front of "2x" reads like a level — is it the coin?
  const dx = text.match(/\b(?:of|on|for)\s+\$(\d+(?:\.\d+)?[kmbx])(?![\w.])/);
  if (dx) {
    const sym = dx[1].toUpperCase();
    return unknown(`Is $${sym} the coin? With a $ in front, "${dx[1]}" reads like a level — open $${sym} on fomo and say "${squash(text.replace(dx[0], ' '))}" there.`);
  }
  // "instead of half sell a third at 2x", "sell half at 2x no wait a third": the size taken back is never sold.
  const instead = text.match(rx(String.raw`\binstead of\s+(?:selling\s+)?(${SIZE_SAID})(?![\w%])\s*`));
  const fix = text.match(rx(String.raw`^(.*?)(?<![\w.])(${SIZE_SAID})(?![\w%])(.*?)\s+(?:no wait|wait no|no|actually|i mean|sorry|make (?:it|that))\s+(${SIZE_SAID})$`));
  if (instead || fix) {
    const corrected = instead ? squash(text.replace(instead[0], ' ')) : squash(`${fix![1]} ${fix![4]} ${fix![3]}`);
    const now = instead ? corrected.match(rx(`(?<![\\w.])${SIZE_SAID}(?![\\w%])`))?.[0] : fix![4];
    const was = instead ? instead[1] : fix![2];
    const again = parse(corrected, opts);
    if (isOrder(again) && now && corrected.length <= 60) return unknown(`${now.replace(/^./, (ch) => ch.toUpperCase())}, not ${was}? Say "${corrected}" and I'll show you the order.`);
    if (!isOrder(again)) return again;
    return unknown(`Which size — ${was} or ${now}? Say the order once, with one size.`);
  }
  const sellC = CANCEL_SELL.test(text);
  const sellN = NEG_SELL.test(text);
  if (sellC || sellN) {
    if (BUY_V.test(text.replace(CANCEL_SELL, ' ').replace(NEG_SELL, ' '))) return unknown(ONE_THING);
    return removeAsk(text, sellC ? CANCEL_SELL : NEG_SELL, sellN);
  }
  // "cancel my order at 2x", "cancel the 50% at 2x": which order? Never the order again.
  if (rx(String.raw`^(?:${CANCEL_W})\b`).test(text) && /\d/.test(text) && !SELL_W.test(text) && !BUY_V.test(text) && !TP_W.test(text) && !SL_W.test(text) && !TRAIL_W.test(text)) return removeAsk(text, rx(String.raw`^(?:${CANCEL_W})\b`), false);
  if (NEG_BUY.test(text)) return unknown('I can only place orders, not promise not to buy. To drop a limit buy, say "cancel my buy" — I\'ll show you which one first. To hold everything, "pause everything".');
  if (CANCEL_BUY.test(text) && /\$\.?\d|\d\s*(?:bucks?|dollars?|usd[ct]?)\b/.test(text)) {
    if (SELL_W.test(text.replace(CANCEL_BUY, ' '))) return unknown(ONE_THING);
    return unknown('To cancel a limit buy, say "cancel my buy" — I\'ll show you which one before anything happens.');
  }
  return null;
}

const HANDLERS: Handler[] = [setting, practice, show, cancelBuy, move, removeLevel, stopPlan, vagueCancel, pause, limitBuy, trail, trailTop, setSl, addTp, applyPreset];

/**
 * Read one chat message. Pure and deterministic: the same text always gives
 * the same intent, and anything unclear comes back as `unknown` with a hint.
 */
export function parse(message: string, opts: ParseOptions = {}): Intent {
  const raw = String(message ?? '');
  if (raw.length > MAX_LEN) return unknown('That\'s a lot to read! One thing at a time, please — like "tp at 2x".');
  const unit: Unit = opts.levelUnit ?? 'mc';
  const tidied = tidy(raw);
  // Before strip(): it trims pleasantries off the end, which would swallow a lone "thanks".
  if (THANKS.test(tidied.replace(/[!.]+$/, '').trim())) return unknown('Anytime! Tell me what to set up next — or say "help".');
  const kind = reword(tidied);
  // Nothing but pleasantries ("thanks a lot", "you rock").
  if (!kind && tidied) return unknown(/thank|appreciat|rock|best|legend|goat|amazing|awesome|star/.test(tidied) ? 'Anytime! Tell me what to set up next — or say "help".' : GENERAL_HINT);
  const { s, greeted } = strip(kind);
  if (!s) return greeted ? { type: 'help' } : unknown(GENERAL_HINT);
  if (/^\?+$/.test(s)) return { type: 'help' };
  const text = s.replace(/\?/g, ' ').replace(/\s+/g, ' ').trim();
  if (!text) return { type: 'help' };
  if (HELP.test(text)) return { type: 'help' };
  if (THANKS.test(text)) return unknown('Anytime! Tell me what to set up next — or say "help".');
  if (ADDRESS.test(raw)) return unknown('I find coins by their ticker — say "$TIPPY", or open the coin on fomo and leave the name out.');
  // "sell 10% at 700k cancel that": taken back in the same breath — do nothing.
  if (SELF_CANCEL.test(text)) return unknown("Okay — I won't do anything. Say what you'd like when you're ready.");
  const order = /\d/.test(text) || SELL_W.test(text) || BUY_V.test(text) || TP_W.test(text) || SL_W.test(text);
  if (order && (HEDGE_START.test(text) || HEDGE_END.test(text))) {
    const plain = asInstruction(text.replace(HEDGE_START, '').replace(HEDGE_END, '').trim());
    if (plain && plain.length <= 60) return unknown(`Want me to set that up? Say "${plain}" and I'll show you exactly what it does — nothing happens until you tap.`);
    return unknown('Want me to set that up? Say it as an instruction, like "sell half at 2x", and I\'ll show you exactly what it does — nothing happens until you tap.');
  }
  if (order && ADVICE.test(text)) return unknown(`That's your call — I don't give trading advice. If you want it, say "${adviceExample(text)}" and I'll show you exactly what it does first.`);
  if (SHORT.test(text) && !SELL_W.test(text) && !BUY_V.test(text) && !TP_W.test(text) && !SL_W.test(text)) {
    const lvl = levelIn(text) ?? text.match(/(?<![\w.])\$?\d+(?:\.\d+)?(?![\w.%])/)?.[0];
    const size = text.match(/(?<![\w.])(\d+(?:\.\d+)?%)(?![\w%])|\b(half|a quarter|a third|all|everything)\b/);
    const part = size ? (size[1] ?? size[2]) : 'all';
    return unknown(`I can't short — I only sell coins you hold and buy with your cash.${lvl ? ` To sell yours at ${lvl}, say "sell ${part} at ${lvl}".` : ''}`);
  }
  // "move tp1 to 2x tomorrow", "remove my stop tonight": a change at a time — never done now instead.
  if (new RegExp(TIMED.source).test(text) && !BUY_V.test(text) && (rx(String.raw`\b(?:${MOVE_V})\b`).test(text) || REMOVE_V.test(text) || TRAIL_W.test(text))) {
    return unknown(`I don't do timed changes — nothing waits for a time.${retry(text.replace(TIMED, ' '), ' Say', 'when you want it done')}`);
  }
  const twice = text.match(DOUBLE_UNIT);
  if (twice) {
    const [tok, n, a, b] = twice;
    const swap = (u: string) => text.replace(tok, `${tok.startsWith('$') ? '$' : ''}${n}${u}`);
    if (a === 'k' && b === 'k') return unknown(`Is "${tok}" ${n}m? Say "${swap('m')}".`);
    return unknown(`Is "${tok}" ${n}${a} or ${n}${b}? Say "${swap(a)}" or "${swap(b)}".`);
  }
  const dotted3 = text.match(DOT_THOUSANDS);
  if (dotted3) {
    const [tok, int, dec] = dotted3;
    const small = `$${+`${int}.${dec}`}`;
    const big = `$${int}${dec}`;
    return unknown(`Is "${tok}" ${small} or ${formatUsd(+`${int}${dec}`)}? Say "${text.replace(tok, small)}" or "${text.replace(tok, big)}".`);
  }
  const other = text.match(OTHER_MOVE);
  if (other) return unknown(`I only watch this coin's own price, not ${other[1] === 'market' ? 'the market' : `$${other[1].toUpperCase()}`}. Pick a level on this coin instead, like "sell half at 2x" or "sl -30%".`);
  // "buy -$10", "sell $20%": an amount that can't be one — ask, never drop the sign or pick one (tidy drops a "-" before "$").
  if (/(?:^|[\s(])[-−–]\s?\$\s?\.?\d|\$\s?[-−–]\s?\.?\d/.test(raw.normalize('NFKC'))) return unknown('An amount or a level can\'t be negative — try "buy $10 at 500k", "sell $5 at 2x" or "sl -30%".');
  const both = text.match(/\$(\d+(?:\.\d+)?)\s?%/);
  if (both) return unknown(`$${both[1]} or ${both[1]}% of your bag? Say "$${both[1]}" for dollars or "${both[1]}%" for a share of the bag.`);
  // "tp at 100000000": a long run of zeros is easy to miscount — say it with k, m or b.
  const long = raw.normalize('NFKC').match(/(?<![\d.,])\$?(\d{8,})(?![\d,])/);
  if (long) {
    const said = formatUsd(+long[1]).replace(/^\$/, '').toLowerCase();
    return unknown(`Is "${long[1]}" ${formatUsd(+long[1])}? Long numbers are easy to miscount — say it with k, m or b, like "${said}".`);
  }
  // "don't sell below 500k" reads like "sell below 500k" with a word in front — the opposite order. Never.
  const pre = preChecks(raw.normalize('NFKC'), text, opts);
  if (pre) return pre;
  if (NEGATED.test(text) || (NEGATED_LEVEL.test(text) && !BUY_V.test(text))) return unknown('I can only place orders, not promise not to trade. To drop one, say "remove my stop" or "cancel my buy" — to hold everything, "pause everything".');
  if (UNLESS.test(text)) return unknown('I act when it reaches a level, not when it doesn\'t — try "sell half at 1m", or a stop like "sl -30%".');
  // Numbers Tippy won't guess at: "5oo k" (letter o for zero), "1.250.000" (dots between thousands).
  const oh = text.match(/(?<![\w.$])(\d[\do]*o[\do]*)(?:\s*([kmb]))?(?![\w.])/);
  if (oh) {
    const fixed = `${oh[1].replace(/o/g, '0')}${oh[2] ?? ''}`;
    return unknown(`Is "${oh[0].trim()}" meant to be ${fixed}? Type it with zeros — try "${fixed}". I won't guess at a number.`);
  }
  const dotted = text.match(/(?<![\d.])\d{1,3}(?:\.\d{3}){2,}(?![\d.])/);
  if (dotted) return unknown(`Is "${dotted[0]}" ${dotted[0].replace(/\./g, ',')}? Say it with k or m, like "${formatUsd(+dotted[0].replace(/\./g, '')).replace(/^\$/, '').toLowerCase()}" — dots between the thousands read like a price.`);

  const base = new Msg(text);
  const dollars = takeDollarCoins(base);
  const c: Ctx = { unit, now: NOW.test(tidied), dollars };
  for (const h of HANDLERS) {
    const r = h(new Msg(base.s), c);
    if (r) return r;
  }
  // Just "$CLAUDIA" → show it.
  if (dollars.length === 1 && new Msg(base.s).words().every((w) => VOCAB.has(w))) return { type: 'show', coin: { symbol: dollars[0] } };
  const bare = noVerb(new Msg(base.s), c);
  if (bare) return bare;
  if (base.has(/\b(?:cancel|remove|delete)\b/)) return unknown('Cancel what? Try "cancel my buy on $TIPPY", "remove tp2" or "stop guarding $TIPPY".');
  return unknown(GENERAL_HINT);
}
