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
  evrything: 'everything', everythin: 'everything', everyting: 'everything', erything: 'everything',
  autoguard: 'auto guard', autoprotect: 'auto protect', dryrun: 'dry run', unguard: 'unguard',
};

const NUMBER_WORDS: Record<string, string> = {
  one: '1', two: '2', three: '3', four: '4', five: '5', six: '6', seven: '7', eight: '8', nine: '9', ten: '10',
  twenty: '20', thirty: '30', forty: '40', fifty: '50', hundred: '100',
};

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
  s = s.replace(/[’‘`´]/g, "'").replace(/[“”"]/g, ' ').replace(/[−–—]/g, '-').replace(/ /g, ' ');
  s = s.replace(/'/g, '').replace(/@/g, ' at ');
  s = s
    .replace(/\bw\/o\b/g, ' without ')
    .replace(/\bw\//g, ' with ')
    .replace(/\btp\s*\/\s*sl\b/g, ' tpsl ')
    .replace(/\bs\/l\b/g, ' sl ')
    .replace(/\bt\/p\b/g, ' tp ')
    .replace(/\bb\/e\b/g, ' breakeven ');
  s = s
    .replace(/(?<![\d.])1\/2(?![\d.])/g, ' half ')
    .replace(/(?<![\d.])1\/3(?![\d.])/g, ' third ')
    .replace(/(?<![\d.])1\/4(?![\d.])/g, ' quarter ')
    .replace(/(?<![\d.])2\/3(?![\d.])/g, ' two thirds ')
    .replace(/(?<![\d.])3\/4(?![\d.])/g, ' three quarters ');
  // Thousands commas ("2,500,000"), then decimal commas ("1,5m").
  s = s.replace(/(?<![\d.,])\d{1,3}(?:,\d{3})+(?:\.\d+)?(?![\d,])/g, (m) => m.replace(/,/g, ''));
  s = s.replace(/(\d),(\d)/g, '$1.$2');
  s = s.replace(/\b(one|two|three|four|five|six|seven|eight|nine|ten|twenty|thirty|forty|fifty|hundred)\s+(?=(?:bucks?|dollars?|usd|x|times|percent|k|thousand|million|mil|m)\b)/g, (_, w: string) => `${NUMBER_WORDS[w]} `);
  s = s.replace(/\ba hundred\s+(?=(?:bucks?|dollars?|usd)\b)/g, '100 ');
  s = s.replace(/\b(?:minus|negative)\s*(?=[\d.])/g, '-').replace(/\bplus\s*(?=[\d.])/g, '+');
  s = s.replace(/\$\s+(?=[\d.])/g, '$');
  s = s.replace(/(?<![\w.$])(\d+(?:\.\d+)?)\s*\$(?!\w)/g, ' $$$1 '); // "10$" → "$10"
  s = s
    .replace(/(\d)\s*(?:thousand|grand|thou)\b/g, '$1k')
    .replace(/(\d)\s*(?:millions?|mill?|mm|mln)\b/g, '$1m')
    .replace(/(\d)\s*(?:billions?|bil|bn|bln)\b/g, '$1b')
    .replace(/(\d)\s+([kmb])\b/g, '$1$2')
    .replace(/(\d)\s+x\b/g, '$1x')
    .replace(/(\d)\s*times\b/g, '$1x')
    .replace(/(\d)\s*(?:percent|per cent|pct|prct|perc|percnt|prcnt|precent|percet|pecent|pecrent|percentage)\b/g, '$1%')
    .replace(/(\d)\s+%/g, '$1%');
  s = s.replace(/\btrial(?=\s+(?:stop|by|of|at|[+-]?\d))/g, 'trail');
  s = s.replace(/([a-z])-(?=[a-z])/g, '$1 '); // stop-loss, take-profit, auto-guard
  s = s.replace(/[^a-z0-9$.%+\-?\s]/g, ' ');
  s = s.replace(/\.(?![\d])/g, ' ').replace(/([+-])(?![\d.])/g, ' ');
  s = s.replace(/(?<!\$)\b[a-z]+\b/g, (w) => TYPOS[w] ?? w);
  return s.replace(/\s+/g, ' ').trim();
}

const GREETING = /^(?:(?:hey|hi|hello|yo|oi|ayo|gm|sup|dear|hiya|howdy)\b\s*)+(?:@?(?:tippy|tipy|tippie|tippi)\b)?\s*|^@?(?:tippy|tipy|tippie|tippi)\b\s*/;
const LEAD =
  /^(?:(?:ok|okay|alright|right|so|um|uh|hmm|pls|please|plz|pleas|kindly|just|quickly|quick|also|now|then|can you|could you|would you|will you|can u|could u|would u|will u|go ahead and|i want to|i wanna|i want you to|i would like to|i d like to|id like to|i need to|i need you to|i need|lets|let s|help me|dont forget to|do not forget to|remember to|make sure to|tippy|tipy)\b\s*|[,:;!.\-]+\s*)/;
const TAIL =
  /\s*(?:\b(?:pls|please|plz|thanks|thank you|thx|ty|tysm|tippy|bro|ser|sir|fren|mate|man|dude|lol|lmao|lfg|asap|etc|kthx|cheers|for me|ok|okay|rn|right now|now|boss|chief|my friend)|[,:;!.\-]+)\s*$/;
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

const TP_W = /\b(?:tps?|take ?profits?|profit taking|tp\d)\b/;
const SELL_W =
  /\b(?:sell|sells|selling|offload|unload|scale out|dump|trim|cut|cash ?out|exit|pull out|get me out)\b|\bsecure\s+(?=[\d$]|half|a\s|all|some|the rest|everything|my initials|initials)|\btake\s+(?:off\s+|out\s+)?(?:my\s+)?(?:half|a quarter|a third|quarter|third|some|initials?|all|everything|the rest|profits?|\d|\$)/;
const SL_W = /\b(?:sl|stop ?loss|stop|stops|stop out|partial stops?|cut (?:my )?loss(?:es)?|loss limit|max loss)\b/;
/** "exit at 2m", "get me out at 500k": sell all of it unless a size is said. */
const ALL_OUT = /\b(?:exit|get me out|get out)\b/;
/** "sell 10% every 2x" — a ladder; Tippy places one level at a time. */
const EVERY = /\b(?:every|each)\s+(?:[+-]?\d|\.\d|time|other)/;
const LADDER = 'I place one level at a time — try "sell 10% at 2x" first, then "sell 10% at 4x".';
const NOT_COUNTED = 'I sell a % of your bag or a $ amount, not a number of coins — try "sell 50% at 2x" or "sell $5 at 2x".';

/** Verbs a sell's size can follow: "sell 10 at 700k", "tp 50 @ 1.2m", "sl $2 at 650k", "take out my $5". */
const TP_VERB = String.raw`tps?|take ?profits?`;
const SL_VERB = String.raw`sl|stop ?loss|stop|partial stop`;
const SELL_VERB = String.raw`sell|sells|selling|dump|trim|cut|cash ?out|secure|exit|unload|offload|scale out|take out|take off|take|pull out`;
const SIZE_FILL = String.raw`(?:out\s+|off\s+)?(?:my\s+|another\s+|like\s+|about\s+|around\s+|only\s+|just\s+)?`;
const TRAIL_W = /\b(?:trailing ?stop(?: ?loss)?|trail ?stop|trailing|trails|trail|tsl)\b/;
const BUY_V =
  /\b(?:buy|buying|limit buy|bid|ape|aping|ape in|scoop|snipe|grab|accumulate|load up|purchase|dip buy|rebuy|buy back)\b/;
const BUY_N = /\b(?:limit )?(?:buy|buys|buying|bid|bids|buy orders?|limit orders?|limit buys?|dip buys?)\b/;
const ADD_V = /\b(?:add|another|new|extra|create|one more)\b/;
const GUARD_V = /\b(?:guard|protect|cover)\b/;

const DOWN =
  'dips?|dipped|dipping|drops?|dropped|dropping|dumps?|dumped|dumping|falls?|fell|falling|down|crash(?:es|ed)?|crashing|tanks?|tanked|tanking|bleeds?|bleeding|sinks?|sank|sinking|corrects?|correcting|pulls? back|pulling back|pullback|retraces?|retraced|retracing|loses|lost|declines?|declining|slides?|sliding|goes down|is down|lower by|red by';
const UP =
  'up|pumps?|pumped|pumping|rises?|rose|rising|breaks? ?out|broke ?out|breaking ?out|breakout|goes up|gains?|gained|rally|rallies|rallying|moons?|mooning|climbs?|climbing|jumps?|jumped|jumping|rips?|ripping|spikes?|spiking|is up|higher by|green by|runs? up|ran up|surges?|surging|sends?';

/** "if it drops to", "dips below", "falls under", "below 700k" — a level reached on the way down. */
const DOWN_TO = new RegExp(String.raw`\b(?:${DOWN})\s+(?:back\s+)?(?:to|below|under|beneath|toward|towards|into|at)\b|\b(?:below|under|beneath)\b(?=\s*[+-]?\$?[\d.])`);
/** "if it pumps to", "breaks out above", "above 2m" — a level reached on the way up. */
const UP_TO = new RegExp(String.raw`\b(?:${UP})\s+(?:back\s+)?(?:to|above|over|past|at)\b|\b(?:above|past)\b(?=\s*[+-]?\$?[\d.])|(?<!\b(?:${DOWN}|${UP})\s+)\bover\b(?=\s*[+-]?\$?[\d.])`);

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
  live real money paper trading simulation sim fake pretend sell-off everyone every coin`.split(/\s+/),
);

const PREPS = new Set(['on', 'for', 'of', 'in', 'into', 'from']);
const FILLER = new Set(['my', 'the', 'our', 'this', 'coin', 'token', 'bag']);
const HERE_W = /\b(?:this|here|current|this coin|this one|this token)\b/;
const ALL_W = /\b(?:all|everything|every coin|all coins|everyone|every plan|tippy|yourself|globally|all of them)\b/;

const isTicker = (w: string) =>
  /^[a-z][a-z0-9]{1,19}$/.test(w) && !VOCAB.has(w) && !/^(?:tps?|sl|p|x)\d+$/.test(w);

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
  if (c.dollars.length === 1) return { symbol: c.dollars[0] };
  const ws = m.words();
  const cands: { w: string; prep: boolean }[] = [];
  ws.forEach((w, i) => {
    if (!isTicker(w)) return;
    const prep = PREPS.has(ws[i - 1] ?? '') || (FILLER.has(ws[i - 1] ?? '') && PREPS.has(ws[i - 2] ?? ''));
    cands.push({ w, prep });
  });
  const uniq = [...new Set(cands.map((x) => x.w))];
  if (uniq.length === 1) return { symbol: uniq[0].toUpperCase() };
  if (uniq.length > 1 && /\b(?:and|&|plus|n)\b|,|\//.test(m.s)) {
    // "on CLAUDIA and WIF": two coins on purpose — ask, never pick one.
    return { hint: `One coin at a time — ${uniq.slice(0, 3).map((w) => `$${w.toUpperCase()}`).join(' or ')}? Which coin first?` };
  }
  if (uniq.length > 1) {
    const prepped = [...new Set(cands.filter((x) => x.prep).map((x) => x.w))];
    if (prepped.length === 1) return { symbol: prepped[0].toUpperCase() };
    const names = uniq.slice(0, 3).map((w) => `$${w.toUpperCase()}`);
    return { hint: `Which coin — ${names.join(' or ')}? Put a $ in front of it, like $CLAUDIA.` };
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
}
interface Scan {
  levels: Found[];
  amb: string[];
  /** Unsigned "50%" — the caller decides (a sell size, a drop, a rise…). */
  bare: { n: number; at: boolean }[];
}

function bareHint(n: number, side: Side): string {
  if (side === 'buy')
    return `Is "${n}" how much to spend or where to buy? Say "$${n}" for the amount, or "${n}k mcap" / "if it dips ${Math.min(n, 50)}%" for the level.`;
  if (side === 'sl' && n < 100) return `Is "${n}" a drop or a market cap? Say "-${n}%" or "${n}k mcap".`;
  const mc = n < 50 ? `${n}m mcap` : `${n}k mcap`;
  if (side === 'tp' && n >= 50) return `Is "${n}" a market cap? Say "${mc}" — or "${n}x" if you mean a multiple.`;
  return side === 'tp' ? `Is "${n}" a multiple or a market cap? Say "${n}x" or "${mc}".` : `Is "${n}" a market cap? Say "${mc}".`;
}

/**
 * A number with no k/m/b, no "x", no "%" — "1000000", "0.0007", "$0.0012", "700".
 * Big ones are market caps (memecoin prices are tiny) and small decimals are
 * prices; run.ts still checks a price is anywhere near the coin's before using
 * it. A plain "2" or "700" could be a multiple, a drop, a market cap or a price,
 * so Tippy asks — unless the chat reads bare numbers as moves.
 */
function plainLevel(raw: string, dollar: boolean, side: Side, unit: Unit): LevelSpec | string {
  const n = +raw;
  if (n >= 1000) return { kind: 'mc', value: n };
  if (dollar || (n < 1 && raw.includes('.'))) return { kind: 'price', value: n };
  if (unit === 'move' && side === 'tp') return { kind: 'x', value: n };
  if (unit === 'move' && side === 'sl' && n > 0 && n < 100) return { kind: 'pct', value: -n };
  return bareHint(n, side);
}

const dedupe = (fs: Found[]) => fs.filter((f, i) => fs.findIndex((g) => g.spec.kind === f.spec.kind && g.spec.value === f.spec.value) === i);

/** Find every level in the message (taking them out), read for a take-profit, a stop or a buy. */
function scanLevels(m: Msg, side: Side, unit: Unit): Scan {
  const out: Scan = { levels: [], amb: [], bare: [] };
  const lv = (spec: LevelSpec, rel = false) => {
    if (!(spec.value !== 0 && Number.isFinite(spec.value)) || (spec.kind !== 'pct' && spec.value < 0)) out.amb.push("That level doesn't look right — try something like \"500k mcap\" or \"2x\".");
    else out.levels.push({ spec, rel });
  };
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
  for (const x of m.take(rx(String.raw`(?<![\w.$+-])${NUM}%\s*(?:dip|drop|dump|down|lower|below|pullback|pull back|retracement|retrace|correction|red|loss|decline|under)\b`)))
    pct(+x[1], -1);
  for (const x of m.take(rx(String.raw`\b(?:${UP})\s+(?:by\s+|another\s+|over\s+|more than\s+|like\s+|about\s+|around\s+)?\+?${NUM}%?${END}${NOT_MC}`)))
    pct(+x[1], 1, nudge(x[0]));
  for (const x of m.take(rx(String.raw`(?<![\w.$+-])\+?${NUM}%\s*(?:up|higher|above|breakout|break out|pump|green|gains?|profits?|rise|in profit)\b`)))
    pct(+x[1], 1);
  for (const x of m.take(rx(String.raw`(?<![\w.$%])([+-])${NUM}%?${END}${NOT_MC}`))) pct(+x[2], x[1] === '-' ? -1 : 1);

  // Market caps and prices.
  for (const x of m.take(rx(String.raw`\bprice\s+(?:of\s+|at\s+|is\s+|hits\s+|target\s+|reaches\s+)?\$?${NUM}${END}`))) lv({ kind: 'price', value: +x[1] });
  for (const x of m.take(rx(String.raw`(?<![\w.])\$?${NUM}([kmb])(?![\w.%])(?:\s*${MCW}(?!\w))?`)))
    lv({ kind: 'mc', value: +x[1] * { k: 1e3, m: 1e6, b: 1e9 }[x[2] as 'k' | 'm' | 'b'] });
  for (const x of m.take(rx(String.raw`(?<![\w.])\$?${NUM}\s*${MCW}(?!\w)`))) lv({ kind: 'mc', value: +x[1] });
  for (const x of m.take(rx(String.raw`\b${MCW}\s+(?:of\s+|at\s+|is\s+|hits\s+|around\s+|reaches\s+)?\$?${NUM}${END}`))) lv({ kind: 'mc', value: +x[1] });
  for (const x of m.take(rx(String.raw`(?<![\w.%+$-])(\$)?${NUM}${END}`))) {
    const l = plainLevel(x[2], !!x[1], side, unit);
    if (typeof l === 'string') out.amb.push(l);
    else lv(l);
  }
  for (const x of m.take(rx(String.raw`(?<![\w.%+$-])${NUM}%`))) {
    const before = x.input.slice(0, x.index);
    out.bare.push({ n: +x[1], at: /\b(?:at|to|hits?|reach(?:es)?|around)\s*$/.test(before) });
  }
  out.levels = dedupe(out.levels);
  return out;
}

const isDown = (l: LevelSpec) => (l.kind === 'pct' && l.value < 0) || (l.kind === 'x' && l.value < 1);

/** "sell half", "25%", "a third", "the rest", "initials". */
function takeSize(m: Msg): { pct: number | null; vals: number[]; initials: boolean; hint?: string } {
  const vals: number[] = [];
  for (const x of m.take(rx(String.raw`\b(?:sell|sells|selling|take|takes|taking|dump|offload|unload|scale out|close|trim|cut|cash ?out|secure|exit|pull out)\s+(?:off\s+|out\s+|another\s+|like\s+|about\s+)?${NUM}%`))) vals.push(+x[1]);
  for (const x of m.take(rx(String.raw`(?<![\w.%+$-])${NUM}%\s+(?=(?:of|off|out)\b)`))) vals.push(+x[1]);
  for (const _ of m.take(/\b(?:two|2) thirds\b/)) vals.push(67);
  for (const _ of m.take(/\b(?:three|3) quarters\b/)) vals.push(75);
  for (const _ of m.take(/\b(?:a |one )?half\b/)) vals.push(50);
  for (const _ of m.take(/\b(?:a |one )?quarter\b/)) vals.push(25);
  for (const _ of m.take(/\b(?:a |one )?third\b/)) vals.push(33);
  for (const _ of m.take(/\b(?:all of it|it all|all|everything left|everything|the rest|rest|whole bag|entire bag|full bag|whole thing|remaining|whole position|full position|entire position)\b/)) vals.push(100);
  const initials = m.take(/\b(?:my )?initials?(?: investment)?\b|\binitial investment\b/).length > 0;
  const uniq = [...new Set(vals)];
  if (uniq.length > 1) return { pct: null, vals, initials, hint: `How much should it sell — ${uniq.slice(0, 2).map((v) => `${v}%`).join(' or ')}? Pick one.` };
  return { pct: uniq[0] ?? null, vals, initials };
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
  for (const x of m.take(rx(String.raw`(?<![\w.])\$${NUM}(k)?(?:\s+worth\b|\s+(?=(?:of|out|off)\b))`))) add(x[1], x[2]);
  // Right after the verb. After "tp" / "sl" a "$0.004" is still a price level ("tp $0.004" = "tp at $0.004").
  // "sell $20 at 1m" / "sell $20 if …" / "sell $3": followed by how the level is said, or nothing ("sell $100k $372" is a question).
  const after = rx(String.raw`(?<=\b(${SELL_VERB}|${TP_VERB}|${SL_VERB})\s+${SIZE_FILL})\$${NUM}(k)?${END}${NOT_MC}(?=[\s·]*$|\s+(?:at|if|when|whenever|once|below|above|under|over|on|for|of|worth|out|off|by|and|or|plus)\b)`);
  for (const x of m.take(after, (x) => !!x[3] || +x[2] >= 1 || !rx(`^(?:${TP_VERB}|${SL_VERB})$`).test(x[1]))) add(x[2], x[3]);
  return [...new Set(vals)];
}

/**
 * A plain number right after the verb: "tp 50 @ 1.2m", "sl 50 at 600k", "sell 10 at 700k".
 * Taken out so the caller can decide, once it knows whether there's a level too.
 */
function takeLead(m: Msg): { n: number; raw: string; verb: 'tp' | 'sl' | 'sell' } | null {
  const re = rx(String.raw`(?<=\b(${TP_VERB}|${SL_VERB}|${SELL_VERB})\s+(?:another\s+|like\s+|about\s+|around\s+|only\s+|just\s+)?)${NUM}(?![\w.%$])${NOT_MC}`);
  // After "tp" / "sl" a small decimal is a price ("sl 0.0005"), not a size — leave it for the level reader.
  const x = m.take(re, (x) => +x[2] >= 1 || !rx(`^(?:${TP_VERB}|${SL_VERB})$`).test(x[1]))[0];
  if (!x) return null;
  const verb = rx(`^(?:${TP_VERB})$`).test(x[1]) ? 'tp' : rx(`^(?:${SL_VERB})$`).test(x[1]) ? 'sl' : 'sell';
  return { n: +x[2], raw: x[2], verb };
}

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
    /\b(?:(?:for|expires?(?: in| after)?|expiring(?: in)?|valid for|good for|within|in|over|lasts?|keep it for|keep for)\s+)?(?:the next\s+)?(?:(an?|one)\s+|(\d+(?:\.\d+)?)\s*)(h|hr|hrs|hours?|d|days?|w|wk|wks|weeks?|mins?|minutes?)(?!\w)/;
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
    /\b(?:no|without|dont|do not|skip(?: the)?|zero)\s+(?:guard(?:ing)?|protection|protecting|protect(?: it)?|tpsl|tp\s*(?:or|and|&)?\s*sl|sl|tps|preset|plan|stops?|take profits?)\b|\b(?:protect|guard)(?:ed)?(?: it)? with (?:none|nothing|no preset)\b|\bpreset none\b|\bunguarded\b|\bunprotected\b|\bnaked\b/;
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
    rx(String.raw`\b(?:buy|buying|limit buy|ape(?: in(?:to)?)?|aping|spend(?:ing)?|put(?: in)?|bid|grab|scoop|snipe|purchase|get(?: me)?|with|using|for|worth)\s+(?:me\s+|in\s+|another\s+|like\s+|about\s+|around\s+|only\s+|just\s+)?\$${NUM}(k)?${END}${NOT_MC}`),
  ))
    add(x[1], x[2]);
  for (const x of m.take(rx(String.raw`(?<![\w.])\$${NUM}(k)?\s+(?=(?:of|worth|in|into)\b)`))) add(x[1], x[2]);
  for (const x of m.take(rx(String.raw`\b(?:buy|buying|limit buy|ape(?: in)?|bid|spend|purchase|grab|scoop)\s+${NUM}(k)?(?![\w.%$])(?!\s*(?:${MCW}|x)(?!\w))`))) add(x[1], x[2]);
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

const ORD: Record<string, number> = { first: 1, '1st': 1, second: 2, '2nd': 2, third: 3, '3rd': 3, fourth: 4, '4th': 4, fifth: 5, '5th': 5, one: 1, two: 2, three: 3, four: 4, five: 5 };

function takeTargets(m: Msg): Target[] | Hint {
  const ts: Target[] = [];
  for (const _ of m.take(TRAIL_W)) ts.push({ kind: 'trail' });
  for (const x of m.take(/\b(first|second|third|fourth|fifth|1st|2nd|3rd|4th|5th)\s+(?:tp|take ?profit)\b/)) ts.push({ kind: 'tp', index: ORD[x[1]] });
  if (m.take(/\b(?:last|final|top|highest|lowest|bottom|biggest|smallest)\s+(?:tp|take ?profit)\b/).length)
    return { hint: 'Which take-profit? Say its number, like "tp2".' };
  for (const x of m.take(/\b(?:tp|take ?profit)\s*(?:number\s+|no\s+|num\s+)?([1-9])(?![\w.%])/)) ts.push({ kind: 'tp', index: +x[1] });
  // ("tp two" is TP2; "stop two thirds at 500k" is a size, never stop 2.)
  for (const x of m.take(/\b(?:tp|take ?profit)\s+(one|two|three|four|five)\b(?!\s+(?:thirds?|quarters?|halves|half|fifths?)\b)/)) ts.push({ kind: 'tp', index: ORD[x[1]] });
  for (const _ of m.take(/\b(?:tps|take ?profits|all (?:my |the )?(?:tps|take ?profits))\b/)) ts.push({ kind: 'tps' });
  for (const _ of m.take(/\b(?:tp|take ?profit)\b/)) ts.push({ kind: 'tp?' });
  // Partial stops by number ("stop 1", "the second stop"); a plain "stop" is the stop loss.
  for (const x of m.take(/\b(first|second|third|fourth|fifth|1st|2nd|3rd|4th|5th)\s+(?:partial\s+)?(?:stop|sl)\b(?!\s*loss)/)) ts.push({ kind: 'stop', index: ORD[x[1]] });
  if (m.take(/\b(?:last|final|top|highest|lowest|bottom|biggest|smallest)\s+(?:partial\s+)?stop\b(?!\s*loss)/).length)
    return { hint: 'Which stop? Say its number, like "stop 2".' };
  for (const x of m.take(/\b(?:partial\s+)?(?:stop|sl)\s*(?:number\s+|no\s+|num\s+)?([1-9])(?![\w.%])/)) ts.push({ kind: 'stop', index: +x[1] });
  for (const x of m.take(/\b(?:partial\s+)?stop\s+(one|two|three|four|five)\b(?!\s+(?:thirds?|quarters?|halves|half|fifths?)\b)/)) ts.push({ kind: 'stop', index: ORD[x[1]] });
  if (m.take(/\bpartial\s+stops?\b/).length) return { hint: 'Which stop? Say its number, like "stop 2".' };
  for (const _ of m.take(/\b(?:sl|stop ?loss|stoploss|stops?)\b/)) ts.push({ kind: 'sl' });
  for (const _ of m.take(/\b(?:limit )?(?:buy|bid)s?(?: orders?)?\b/)) ts.push({ kind: 'buy' });
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

  if (/\b(?:go live|live mode|real mode|real trading|real money|for real|live trading)\b/.test(s)) found.push({ type: 'setting', name: 'dryRun', value: off });
  else if (/\b(?:dry ?run(?:s|ning)?|paper(?: trading| trade| mode)?|(?:practice|test|testing|sim|simulation|demo|fake) mode)\b/.test(s)) {
    // "dry run a sell on CLAUDIA" is a practice run — its "on" is the coin's, not the setting's.
    if (/\b(?:buy|sell|buying|selling|tp|sl)\b/.test(s)) return null;
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
  const UNIT_V = String.raw`\b(?:use|show|switch to|change to|set to|go to|display|prefer|levels? (?:in|as)|in|by)\s+(?:the\s+)?`;
  if (rx(`${UNIT_V}(?:market ?caps?|mcaps?|mc|market caps|fdv)(?!\\w)|\\b(?:market ?cap|mcap|mc) (?:mode|view|units?)\\b`).test(s))
    found.push({ type: 'setting', name: 'levelUnit', value: 'mc' });
  if (rx(`${UNIT_V}(?:percent(?:age)?s?|%|moves?|multiples?|multipliers?|x|xs|x and %|% and x)(?![\\w%])|\\b(?:percent|percentage|%|move|x|multiple) (?:mode|view|units?)\\b`).test(s))
    found.push({ type: 'setting', name: 'levelUnit', value: 'move' });
  if (found.length > 1) return unknown('One setting at a time, please — like "dry run on".');
  return found[0] ?? null;
};

const practice: Handler = (m, c) => {
  if (!m.has(/\b(?:practice|practicing|practise|practising|rehearse|rehearsal|simulate|simulated|mock|dummy|demo|test|testing|dry run|fake|pretend)\b/)) return null;
  // A level ("… at 2x", "500k", "-20%") makes it an order, not a practice run.
  if (m.has(/\d\s*(?:[kmbx%]|mc|mcap)(?![a-z])|[+-]\d/)) return null;
  const buy = m.has(/\b(?:buy|buys|buying|bought|purchase|bid)\b/);
  const sell = m.has(/\b(?:sell|sells|selling|sold|tp|take profit|sl|stop loss|dump)\b/);
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
  const coin = oneCoin(m, c, 'One coin at a time — try "practice a sell on CLAUDIA".');
  if (isHint(coin)) return unknown(coin.hint);
  return { type: 'practice', coin, side: buy ? 'buy' : 'sell', usd };
};

const HOWTO = /\bhow (?:do|can|would|should|to) (?:i|you|we)\b|\bhow to\b|\bcan (?:i|you)\b/;
const show: Handler = (m, c) => {
  const start = /^(?:show|list|status|stats|what|whats|how|hows|where|wheres|check|view|see|display|any|summary|overview|orders|plans|positions|my|which|tell me|give me|report|update me|current|lemme see|let me see)\b/;
  const any = /\b(?:status|orders|plans|positions|summary|overview|dashboard|doing|up to|going on|happening)\b/;
  if (!m.has(start) && !m.has(any)) return null;
  if (m.has(HOWTO)) return null;
  if (m.has(/\b(?:add|set|place|put|create|make|move|change|raise|lower|bump|remove|delete|cancel|pause|resume|unpause|freeze|unfreeze|suspend|halt|snooze|guard|protect|apply|use|practice|test|kill|drop|turn|enable|disable|edit|update|unguard|trail)\b/)) return null;
  if (/(?<![a-z$])\d/.test(m.s)) return null;
  if (c.dollars.length === 0 && m.has(/\b(?:buy|sell)\b/) && !m.has(/^(?:show|list|what|whats|where|which|any|check|view|see|display|my)\b/)) return null;
  const coin = findCoin(m, c, { all: true, dflt: 'all' });
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
  m.take(BUY_N);
  const coin = findCoin(m, c, { all: true });
  if (isHint(coin)) return unknown(coin.hint);
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
  const scan = scanLevels(m, side, c.unit);
  if (scan.amb.length) return unknown(scan.amb[0]);
  for (const b of scan.bare) {
    if (side === 'sl') scan.levels.push({ spec: { kind: 'pct', value: -b.n }, rel: false });
    else if (side === 'tp' && b.at) scan.levels.push({ spec: { kind: 'pct', value: b.n }, rel: false });
    else return unknown(side === 'buy' ? `A ${b.n}% dip or a ${b.n}% breakout? Say "to -${b.n}%" or "to +${b.n}%".` : `Is ${b.n}% a move up? Say "to +${b.n}%".`);
  }
  const levels = dedupe(scan.levels);
  const name = t.kind === 'tp' ? `tp${t.index}` : t.kind === 'stop' ? `stop ${t.index}` : t.kind === 'sl' ? 'my stop' : 'my buy';
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
  m.take(rx(String.raw`\b(?:${MOVE_V}|${SET_V})\b`));
  return moveCore(m, c, verb);
};

const REMOVE_V =
  /\b(?:remove|removing|delete|del|cancel|kill|drop|clear|scrap|nuke|ditch|undo|rm|get rid of|turn off|switch off|disable|no more|forget)\b|^no\b|\b(?:off|gone)$|\bstop(?=\s+(?:the\s+|my\s+)?(?:trail|trailing|tsl)\b)/;
const removeLevel: Handler = (m, c) => {
  if (!m.has(REMOVE_V)) return null;
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
  if (/(?<![a-z$])\d/.test(m.s)) return unknown(`Want to move it instead? Try "move ${t.kind === 'tp' ? `tp${t.index}` : t.kind === 'stop' ? `stop ${t.index}` : 'my stop'} to 2m".`);
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
  const coin = oneCoin(m, c, 'I stop plans one coin at a time — try "stop guarding CLAUDIA". To pause everything, say "pause everything".');
  if (isHint(coin)) return unknown(coin.hint);
  return { type: 'stop-plan', coin };
};

/** "stop everything", "cancel all orders" — pause or cancel? Buys or plans? */
const vagueCancel: Handler = (m) => {
  if (!m.has(/^(?:stop|cancel|kill|end|abort|halt|close|clear|delete|remove)\b/)) return null;
  if (m.has(/\bstop ?loss\b/) || /(?<![a-z$])\d/.test(m.s)) return null;
  if (!m.has(/\b(?:all|everything|orders?|it)\b/) && m.words().length > 1) return null;
  return unknown('Pause everything, or cancel something? Try "pause everything", "cancel all buys" or "stop guarding CLAUDIA".');
};

const pause: Handler = (m, c) => {
  const p = m.has(/\b(?:pause|paused|pausing|freeze|suspend|halt|snooze|kill switch|emergency stop|panic)\b/);
  const r = m.has(/\b(?:resume|resumed|resuming|unpause|unpaused|un pause|continue|restart|unfreeze|wake up|wake|start again|carry on|keep going|go again|reactivate|re enable|reenable|turn back on|back on|unsuspend)\b/);
  if (!p && !r) return null;
  if (p && r) return unknown('Pause or resume? Say "pause CLAUDIA" or "resume CLAUDIA".');
  // "sell half at 2x then pause": two things — never just the pause.
  if (m.has(SELL_W) || /(?<![a-z$])\d/.test(m.s)) return unknown(ONE_THING);
  if (m.has(BUY_N)) return unknown(`I can't ${p ? 'pause' : 'resume'} a buy — "cancel my buy on CLAUDIA" removes it.`);
  const ts = takeTargets(new Msg(m.s));
  if (!isHint(ts) && ts.length) return unknown('I pause whole coins, not single levels — try "pause CLAUDIA" (or "remove tp2").');
  m.take(/\b(?:pause|paused|pausing|freeze|suspend|halt|snooze|kill switch|emergency stop|panic|resume|resumed|resuming|unpause|unpaused|un pause|continue|restart|unfreeze|wake up|wake|start again|carry on|keep going|go again|reactivate|re enable|reenable|turn back on|back on|unsuspend)\b/);
  const coin = findCoin(m, c, { all: true, dflt: 'all' });
  if (isHint(coin)) return unknown(coin.hint);
  return { type: 'pause', coin, paused: p };
};

/** Verbs a buy's amount follows: "buy $10", "ape 25", "bid 10 usd". */
const BUY_AMOUNT_V = String.raw`buy|buying|limit buy|bid|ape(?: in)?|aping|scoop|snipe|grab|accumulate|load up|purchase|dip buy|rebuy|spend`;
/** "0.5 sol", "1m tokens": an amount in coins — Tippy deals in dollars and % of the bag. */
const UNITS = rx(String.raw`(?<![\w.])(${NUM}[kmb]?)\s*(sol|eth|weth|bnb|btc|matic|avax|pol|tokens?|coins?)\b`);

/** "if it dips to 1m" / "when it breaks 1m": the way the user said the buy's level is reached. */
const BUY_DOWN = new RegExp(String.raw`${DOWN_TO.source}|\b(?:if|when|once)\s+(?:it\s+|the price\s+|price\s+|mc\s+)?(?:${DOWN})\b`);
const BUY_UP = new RegExp(String.raw`${UP_TO.source}|\b(?:if|when|once)\s+(?:it\s+|the price\s+|price\s+|mc\s+)?(?:${UP})\b|\bbreaks?\s+(?:above\s+|over\s+|past\s+|through\s+)?(?=\$?[\d.])`);

const limitBuy: Handler = (m, c) => {
  if (!m.has(BUY_V)) return null;
  // "for 30m": 30 minutes, or a level at $30M MC? Asked before the expiry reader sees it.
  const minutes = m.s.match(/\b(?:for|in|within)\s+(\d+)\s*m\b(?!\s*(?:mc|mcap|market cap|cap|fdv)\b)/);
  if (minutes) return unknown(`Is "${minutes[1]}m" ${minutes[1]} minutes, or $${minutes[1]}M MC? Say "for ${minutes[1]} min" for how long the buy waits.`);
  const exp = takeExpiry(m);
  if (isHint(exp)) return unknown(exp.hint);
  const preset = takePreset(m);
  if (isHint(preset)) return unknown(preset.hint);
  const f = families(m.s);
  if (f.size > 1 || m.has(/\b(?:sell|sells|selling)\b/)) return unknown('One thing at a time: place the buy, and I can guard it with a preset — like "buy $10 at 1m then protect with classic".');
  // Tippy buys with a $ amount: "buy 20%", "buy 0.5 sol", "buy 500k" (dollars? a level?) are questions.
  const share = m.s.match(rx(String.raw`\b(?:${BUY_AMOUNT_V})\s+(?:with\s+|another\s+)?${NUM}%|(?<![\w.%+$-])${NUM}%\s+of\s+(?:my\s+|your\s+)?(?:cash|balance|wallet|funds|money|usd|usdc|dollars)\b`));
  if (share) return { type: 'unknown', hint: 'How much in dollars? I buy with a $ amount, not a % — try "buy $10 at 500k".', cashPct: +(share[1] ?? share[2]) };
  const unit = m.s.match(UNITS);
  if (unit) return unknown(`I buy with dollars, not ${unit[3].replace(/s$/, '')}s — how many $? Try "buy $20 at 500k".`);
  const kAmount = m.s.match(rx(String.raw`\b(?:${BUY_AMOUNT_V})\s+(?:another\s+|like\s+|about\s+)?(${NUM}[km])(?![\w.%])${NOT_MC}`));
  if (kAmount) return unknown(`Is "${kAmount[1]}" how much to spend? Say it in dollars, like "$20" — and the level after "at", like "buy $20 at 500k".`);
  const down = m.has(BUY_DOWN);
  const up = m.has(BUY_UP);
  const usds = takeUsd(m);
  const usd = usds[0] ?? null;
  // "buy the dip" is a figure of speech — but keep the "dip" in "a 20% dip".
  m.take(/(?<!%\s?)\b(?:the dip|a dip|dip|dips|the breakout|a breakout|breakout)\b(?!\s*\d)/);
  const scan = scanLevels(m, 'buy', c.unit);
  if (usds.length > 1) return unknown(scan.levels.length > 1 ? 'One buy at a time, please — say the first one (like "buy $10 at 1m"), then the next.' : `How much — ${usds.slice(0, 2).map(usdText).join(' or ')}? Say one amount.`);
  if (scan.amb.length) return unknown(scan.amb[0]);
  if (scan.bare.length) {
    const n = scan.bare[0].n;
    return unknown(`A ${n}% dip or a ${n}% breakout? Try "if it dips ${n}%" or "when it breaks out ${n}%".`);
  }
  if (scan.levels.length > 1) return unknown(/\bbetween\b/.test(m.s) ? 'I buy at one level, not a range — pick one, like "buy $10 at 500k".' : twoLevels(scan.levels.map((l) => l.spec)));
  if (scan.levels.length === 0) {
    if (usd == null) return unknown('How much, and where? Try "buy $10 at 1m mcap" or "buy $10 if it dips 20%".');
    if (c.now) return unknown(NOW_BUY);
    if (down && !up) return unknown(`Dips to where? Try "buy ${usdText(usd)} if it dips 20%" or "buy ${usdText(usd)} at 500k".`);
    return unknown(`Where should I buy? Try "buy ${usdText(usd)} at 1m mcap" or "buy ${usdText(usd)} if it dips 20%".`);
  }
  const level = scan.levels[0].spec;
  if (usd == null) return unknown(`How much should I buy at ${levelWords(level)}? Try "buy $10 at ${typedLevel(level)}".`);
  if (!(usd > 0)) return unknown('Pick an amount above $0 — try "buy $10 at 1m mcap".');
  if (down && up) return unknown(`A dip or a breakout? Try "buy ${usdText(usd)} if it dips to ${typedLevel(level)}" or "… if it breaks out to ${typedLevel(level)}".`);
  const coin = oneCoin(m, c, 'One coin at a time — try "buy $10 of CLAUDIA at 1m mcap".');
  if (isHint(coin)) return unknown(coin.hint);
  // A dip or a breakout said in words: run.ts makes sure the level is on that side of the price.
  const said = level.kind !== 'pct' && (down || up) ? { said: down ? ('dip' as const) : ('breakout' as const) } : {};
  return { type: 'limit-buy', coin, usd, level, preset, expiresInMs: exp, ...said };
};

/** "trail 20%", "trailing stop 25% after 2x" — called once the trail words are recognised. */
function trailCore(m: Msg, c: Ctx): Intent {
  m.take(TRAIL_W);
  const fam = families(m.s);
  if (fam.size) return unknown(ONE_THING);
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
  const coin = oneCoin(m, c, 'One coin at a time — try "trail 20% on CLAUDIA".');
  if (isHint(coin)) return unknown(coin.hint);
  return { type: 'set-trail', coin, trailPct, afterX };
}

const trail: Handler = (m, c) => (m.has(TRAIL_W) ? trailCore(m, c) : null);

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
  return twoLevels(levels.map((l) => l.spec));
}

/** "At what level should I sell $3?" — what was said, with examples to copy. */
function whereHint(said: Said[], hasTp: boolean, up: boolean, down: boolean): string {
  const one = said.length === 1 && !('lead' in said[0]) ? sizeWords(said[0]) : '25%';
  if (down && !up && !hasTp) return `Down to where? Try "sell ${one} if it drops to 700k" or "sl -30%".`;
  if (up && !down && !hasTp) return `Up to where? Try "sell ${one} if it pumps to 2m" or "sell ${one} at 2x".`;
  if (hasTp) return 'Where should the take-profit go? Try "tp at 500k mcap" or "tp 2x sell half".';
  return `At what level? I sell at a level, not on the spot — try "sell ${one} at 2x" or "sell ${one} if it drops to 700k".`;
}

/** "sl at 300k" sells the rest; with a size ("stop 10% at 700k", "sl $2 at 650k", "sl 25% -30%") it's a partial stop. */
const setSl: Handler = (m, c) => {
  if (!m.has(SL_W)) return null;
  if (families(m.s).size > 1) return unknown(ONE_THING);
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
  // "stop loss … if it pumps to 2x": a stop sells on the way down — up or down?
  if (m.has(UP_TO) && !m.has(DOWN_TO)) return unknown('A stop sells on the way down. To sell on the way up, try "sell 25% at 2x" — or for a stop, "sell 25% if it drops to 600k".');
  // "30% below entry": the entry is where the drop is measured from, not a second level.
  m.take(/\b(?:below|under|beneath|from|off)\s+(?:my\s+|the\s+)?(?:entry|buy ?in|cost basis)(?:\s+price)?\b/);
  const usds = takeSellUsd(m);
  let lead = takeLead(m);
  m.take(SL_W);
  const size = takeSize(m);
  if (size.initials) return unknown('How much should the stop sell? Say a %, like "stop 25% at 700k".');
  m.take(/\b(?:sell|sells|selling)\b/);
  m.take(DOWN_TO);
  const scan = scanLevels(m, 'sl', c.unit);
  if (scan.amb.length) return unknown(lead?.verb === 'sell' ? `${sizeHint(lead.raw, null)} ${scan.amb[0]}` : scan.amb[0]);
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
  const sz = sellSize(said, level);
  if (isHint(sz)) return unknown(sz.hint);
  const coin = oneCoin(m, c, 'One coin at a time — try "sl -30% on CLAUDIA".');
  if (isHint(coin)) return unknown(coin.hint);
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
  if (families(m.s).size > 1) return unknown(ONE_THING);
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
  const counted = m.has(COUNTED);
  const allOut = m.has(ALL_OUT);
  const usds = takeSellUsd(m);
  let lead = takeLead(m);
  m.take(/\b(?:first|second|third|fourth|fifth|1st|2nd|3rd|4th|5th|another|new|extra|one more)\s+(?=(?:tp|take ?profit))/);
  m.take(/\b(?:tps?\d?|take ?profits?|profit taking)\b/);
  const size = takeSize(m);
  m.take(/\b(?:sell|sells|selling|take|takes|taking|offload|unload|scale out|dump|trim|cut|cash ?out|secure|exit|pull out|get me out|get out)\b/);
  // "if it drops to 700k" / "if it pumps to 2m": which way the level is reached.
  let down = m.take(DOWN_TO).length > 0;
  let up = m.take(UP_TO).length > 0;
  const scan = scanLevels(m, 'tp', c.unit);
  if (scan.amb.length) return unknown(lead?.verb === 'sell' ? `${sizeHint(lead.raw, null)} ${scan.amb[0]}` : scan.amb[0]);
  // "sell 10% at 700k if it drops" / "… if it pumps": a direction said after the level.
  if (m.take(rx(String.raw`\b(?:if|when|once)\s+(?:it\s+|the price\s+|price\s+|mc\s+)?(?:${DOWN})\b`)).length) down = true;
  if (m.take(rx(String.raw`\b(?:if|when|once)\s+(?:it\s+|the price\s+|price\s+|mc\s+)?(?:${UP})\b`)).length) up = true;
  const levels = scan.levels;
  // "tp 2" alone: the plain number is the level (or a question); "tp 50 @ 1.2m": it's the size.
  if (lead && !levels.length && !scan.bare.length) {
    if (lead.verb === 'sell') return unknown(c.now ? NOW_SELL : sizeHint(lead.raw, null));
    const l = plainLevel(lead.raw, false, 'tp', c.unit);
    if (typeof l === 'string') return unknown(l);
    levels.push({ spec: l, rel: false });
    lead = null;
  }
  // An unsigned "50%": the level when there's none yet ("tp at 50%"), otherwise a size.
  const loose: number[] = [];
  for (const b of scan.bare) {
    if (levels.length === 0 && (b.at || up || down)) {
      // With a plain "sell", "at 20%" could be either way.
      if (!hasTp && !up && !down) return unknown(`Up ${b.n}% or down ${b.n}%? Say "at +${b.n}%" for a take-profit, or "if it drops ${b.n}%" for a stop.`);
      levels.push({ spec: { kind: 'pct', value: down && !up ? -b.n : b.n }, rel: false });
    } else if (b.at && levels.length > 0) return unknown(`Is ${b.n}% how much to sell, or how far up? Try "sell ${b.n}% at 2x" or "tp at +${b.n}%".`);
    else if (levels.length > 0 || size.vals.length || usds.length) loose.push(b.n);
    else return unknown(`Is ${b.n}% how much to sell, or how far up? Try "sell ${b.n}% at 2x" or "tp at +${b.n}%".`);
  }
  const said = sizesSaid(size.vals, usds, lead, loose);
  if (levels.length === 0) return unknown(c.now ? NOW_SELL : whereHint(said, hasTp, up, down));
  if (levels.length > 1) return unknown(manyLevels(m, said, levels));
  const level = levels[0].spec;
  const sz = sellSize(said, level);
  if (isHint(sz)) return unknown(sz.hint);
  let sellPct = sz.pct;
  const usd = sz.usd;
  if (size.initials) {
    if (level.kind !== 'x' || !(level.value > 1)) return unknown('How much should it sell? Say a %, like "sell 50% at 2x".');
    if (sellPct != null || usd != null) return unknown(`How much should it sell — your initials or ${sellPct != null ? `${sellPct}%` : usdText(usd!)}? Pick one.`);
    sellPct = Math.round(100 / level.value);
  }
  if (sellPct == null && usd == null) {
    // "exit at 2m" / "get me out at 500k" sell it all; "sell 1m" could be a number of coins.
    if (allOut) sellPct = 100;
    else if (counted && !hasTp)
      return unknown(`Sell all of it at ${levelWords(level)}? I sell a % of your bag or a $ amount, not a number of coins — say "sell all at ${typedLevel(level)}" or "sell 50% at ${typedLevel(level)}".`);
  }
  const coin = oneCoin(m, c, 'One coin at a time — try "tp at 2x on CLAUDIA".');
  if (isHint(coin)) return unknown(coin.hint);
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
  if (p === null) return m.has(GUARD_V) ? unknown(`Which preset? Try "guard CLAUDIA with classic" — ${PRESETS}.`) : null;
  if (p === 'none') return unknown('To stop guarding a coin, say "stop guarding CLAUDIA".');
  m.take(/\b(?:guard|guarding|protect|protecting|cover|use|using|apply|applying|put|set|switch|preset|with|on)\b/);
  const coin = oneCoin(m, c, 'One coin at a time — try "guard CLAUDIA with classic".');
  if (isHint(coin)) return unknown(coin.hint);
  return { type: 'apply-preset', coin, preset: p };
};

/**
 * "10% at 700k", "$20 at 500k", "half at 2x", "700k": an order with no verb.
 * Buy or sell is the one thing Tippy never guesses — it asks, with what it read.
 */
function noVerb(m: Msg, c: Ctx): Unknown | null {
  const usd = m.take(rx(String.raw`^\$${NUM}(k)?${END}${NOT_MC}`))[0];
  const usds = [...takeSellUsd(m), ...(usd ? [+usd[1] * (usd[2] ? 1000 : 1)] : [])];
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
const NEGATED = rx(String.raw`\b(?:dont|do not|never|no longer|wont|will not)\s+(?:[a-z]+\s+){0,3}?(?:${SELL_VERB}|${BUY_AMOUNT_V}|buys?|bids|exit)\b|\bstop\s+(?:selling|buying|aping|bidding|sniping)\b`);
/** "don't set a tp at 2x", "never put a stop at 500k" — on a buy, "no tp/sl" is about the guard (takePreset). */
const NEGATED_LEVEL = rx(String.raw`\b(?:dont|do not|never|no longer|wont|will not)\s+(?:[a-z]+\s+){0,3}?(?:${TP_VERB}|${SL_VERB}|tp\d|trail|trailing)\b`);
/** "sell if it doesn't hit 1m": a condition on something not happening. */
const UNLESS = /\b(?:doesnt|does not|didnt|did not|wont|will not|cant|cannot|fails? to|never)\s+(?:hit|hits|reach|reaches|get|gets|go|goes|make|makes|break|breaks|pump|pumps|dip|dips|drop|drops)\b|\bunless\b/;

const SELF_CANCEL = /\b(?:cancel that|scratch that|never ?mind|nvm|ignore (?:that|this|me)|disregard(?: that| this)?|jk|just kidding|forget (?:that|it)|dont do (?:that|it)|undo that)$/;

const HANDLERS: Handler[] = [setting, practice, show, cancelBuy, move, removeLevel, stopPlan, vagueCancel, pause, limitBuy, trail, setSl, addTp, applyPreset];

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
  const { s, greeted } = strip(tidied);
  if (!s) return greeted ? { type: 'help' } : unknown(GENERAL_HINT);
  if (/^\?+$/.test(s)) return { type: 'help' };
  const text = s.replace(/\?/g, ' ').replace(/\s+/g, ' ').trim();
  if (!text) return { type: 'help' };
  if (HELP.test(text)) return { type: 'help' };
  if (THANKS.test(text)) return unknown('Anytime! Tell me what to set up next — or say "help".');
  if (ADDRESS.test(raw)) return unknown('I find coins by their ticker — say "$CLAUDIA", or open the coin on fomo and leave the name out.');
  // "sell 10% at 700k cancel that": taken back in the same breath — do nothing.
  if (SELF_CANCEL.test(text)) return unknown("Okay — I won't do anything. Say what you'd like when you're ready.");
  // "don't sell below 500k" reads like "sell below 500k" with a word in front — the opposite order. Never.
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
  if (base.has(/\b(?:cancel|remove|delete)\b/)) return unknown('Cancel what? Try "cancel my buy on CLAUDIA", "remove tp2" or "stop guarding CLAUDIA".');
  return unknown(GENERAL_HINT);
}
