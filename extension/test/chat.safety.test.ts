// The chat's money rules, fuzzed: thousands of sells and buys put together from
// the pieces traders type (verb, size, level, the order they come in, a coin)
// must never come out as the other side, never with a different amount, and a
// "don't …" must never come out as an order at all.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { Intent } from '../src/chat/intent';
import { parse } from '../src/chat/parse';
import { type ChatCoin, type ChatCtx, planIntent } from '../src/chat/run';
import { withDefaults } from '../src/shared/settings';

/** A size as typed, and what it must come out as. */
type Size = { text: string; pct?: number; usd?: number };

const pctSize = fc.integer({ min: 1, max: 99 }).map((n): Size => ({ text: fc.sample(fc.constantFrom(`${n}%`, `${n} %`, `${n} percent`, `${n}pc`, `${n} pct`, `%${n}`, `${n} percnet`), 1)[0], pct: n }));
const wordSize = fc.constantFrom<Size>(
  { text: 'one third', pct: 33 }, { text: 'three quarters', pct: 75 }, { text: 'everything', pct: 100 }, { text: '3/4', pct: 75 }, { text: '1/2', pct: 50 }, { text: 'ten percent', pct: 10 }, { text: 'half', pct: 50 }, { text: 'a quarter', pct: 25 }, { text: 'a third', pct: 33 }, { text: '2/3', pct: 67 }, { text: 'all', pct: 100 }, { text: 'the rest', pct: 100 },
  // Slips, fractions and number words: read as the size they are — never dropped (a dropped size sold everything).
  { text: 'hlf', pct: 50 }, { text: 'haf', pct: 50 }, { text: 'halfe', pct: 50 }, { text: 'thrid', pct: 33 }, { text: 'quartr', pct: 25 }, { text: '½', pct: 50 },
  { text: 'a fifth', pct: 20 }, { text: '1/5', pct: 20 }, { text: 'two fifths', pct: 40 }, { text: '3/10', pct: 30 }, { text: 'a tenth', pct: 10 }, { text: 'a 3rd', pct: 33 }, { text: '2/3rds', pct: 67 },
  { text: 'twenty five percent', pct: 25 }, { text: 'seventy-five percent', pct: 75 }, { text: 'fifteen percent', pct: 15 }, { text: 'sixty %', pct: 60 },
);
const usdSize = fc.integer({ min: 2, max: 500 }).chain((n) => fc.constantFrom<Size>({ text: `$${n}`, usd: n }, { text: `${n} bucks`, usd: n }, { text: `${n} usd`, usd: n }, { text: `${n}$`, usd: n }));
const sellSize = fc.oneof(pctSize, wordSize, usdSize);

/** A level as typed. */
const level = fc.oneof(
  fc.integer({ min: 100, max: 999 }).map((n) => `$${n}k`),
  fc.integer({ min: 100, max: 999 }).map((n) => `${n},000`),
  fc.integer({ min: 100, max: 999 }).map((n) => `${n}k mcap`),
  fc.integer({ min: 11, max: 90 }).map((n) => `${n / 10} mil`),
  fc.integer({ min: 2, max: 99 }).map((n) => `$0.000${n}`),
  fc.integer({ min: 100, max: 999 }).map((n) => `${n}k`),
  fc.integer({ min: 11, max: 90 }).map((n) => `${n / 10}m`),
  fc.integer({ min: 2, max: 20 }).map((n) => `${n}x`),
  fc.integer({ min: 5, max: 90 }).map((n) => `-${n}%`),
  fc.integer({ min: 5, max: 300 }).map((n) => `+${n}%`),
  fc.integer({ min: 2, max: 99 }).map((n) => `0.000${n}`),
);

const sellVerb = fc.constantFrom('sell', 'dump', 'trim', 'cash out', 'scale out', 'tp', 'take profit', 'sl', 'stop', 'stop loss', 'hey tippy sell', 'pls sell', 'can you sell', 'slel', 'sel', 'take', 'take out', 'secure', 'cut', 'exit', 'partial stop', 'set a tp', 'add a tp', 'put a stop', 'out', 'im out', 'gtfo', 'bail', 'get out', 'close', 'lock in profits');
const buyVerb = fc.constantFrom('buy', 'ape', 'bid', 'limit buy', 'snipe', 'grab', 'scoop', 'dca', 'spend', 'long', 'double down with', 'average down', 'throw', 'get me');
const prep = fc.constantFrom('at', '@', 'if it drops to', 'when it hits', 'if it pumps to', 'below', 'above', 'once it reaches', 'when mcap hits', 'if mc drops below', 'if it dips to', 'when it gets to', 'under', 'over', 'at a', 'if price drops to', 'if it falls below', 'if it goes above', '');
const coin = fc.constantFrom('', ' on $WIF', ' on claudia', ' for $BONK', ' pls', ' lfg', ' ser', ' thx', ' 🚀');

const SELL_TYPES: Intent['type'][] = ['add-tp', 'add-stop', 'set-sl', 'move', 'unknown'];
const DOWN = /drops to|below|dips to|falls below|drops below|under/;
const UP = /pumps to|above|goes above|over/;

/** The size the intent will sell, as the corpus would write it. */
function soldSize(i: Intent): Size | null {
  if (i.type === 'add-tp' || i.type === 'add-stop') return i.sellUsd != null ? { text: '', usd: i.sellUsd } : i.sellPct != null ? { text: '', pct: i.sellPct } : null;
  if (i.type === 'set-sl') return { text: '', pct: 100 };
  return null;
}

describe('the chat never trades the wrong side or the wrong amount', () => {
  it('a sell is a sell — with exactly the size that was said, or a question', () => {
    fc.assert(
      fc.property(sellVerb, sellSize, prep, level, coin, fc.integer({ min: 0, max: 2 }), (verb, size, p, lv, c, order) => {
        const parts = [`${verb} ${size.text} ${p} ${lv}`, `${p} ${lv} ${verb} ${size.text}`, `${verb} ${p} ${lv} ${size.text}`];
        const text = `${parts[order]}${c}`;
        const i = parse(text);
        expect(SELL_TYPES, `${text} → ${JSON.stringify(i)}`).toContain(i.type);
        if (i.type === 'unknown' || i.type === 'move') return;
        // Said down → never a take-profit; said up → never a stop.
        if (DOWN.test(p)) expect(['add-stop', 'set-sl'], `${text} → ${JSON.stringify(i)}`).toContain(i.type);
        if (UP.test(p)) expect(i.type, `${text} → ${JSON.stringify(i)}`).toBe('add-tp');
        // A stop said on the way up is a question, never a take-profit by another name.
        if (UP.test(p) && /^(?:sl|stop|stop loss)$/.test(verb)) throw new Error(`${text}: a stop on the way up became ${i.type}`);
        const sold = soldSize(i);
        if (size.usd != null) expect(sold?.usd, `${text} → ${JSON.stringify(i)}`).toBe(size.usd);
        else if (sold?.usd != null) throw new Error(`${text}: a % became dollars`);
        if (size.pct != null && i.type !== 'set-sl') expect(sold?.pct, `${text} → ${JSON.stringify(i)}`).toBe(size.pct);
        // The stop loss sells the rest: only when the whole bag was said (or a stop with no size).
        if (i.type === 'set-sl' && size.pct != null) expect(size.pct).toBe(100);
        if (i.type === 'set-sl') expect(size.usd).toBeUndefined();
      }),
      { numRuns: 3000 },
    );
  });

  it('a buy is a buy — with exactly the dollars that were said, or a question', () => {
    fc.assert(
      fc.property(buyVerb, usdSize, prep, level, coin, fc.boolean(), (verb, size, p, lv, c, first) => {
        const text = first ? `${verb} ${size.text} ${p} ${lv}${c}` : `${p} ${lv} ${verb} ${size.text}${c}`;
        const i = parse(text);
        expect(['limit-buy', 'unknown'], `${text} → ${JSON.stringify(i)}`).toContain(i.type);
        if (i.type !== 'limit-buy') return;
        expect(i.usd, text).toBe(size.usd);
        if (DOWN.test(p) && i.level.kind !== 'pct') expect(i.said, text).toBe('dip');
        if (UP.test(p) && i.level.kind !== 'pct') expect(i.said, text).toBe('breakout');
      }),
      { numRuns: 2000 },
    );
  });

  it('"don\'t …" / "never …" is never an order', () => {
    fc.assert(
      fc.property(fc.constantFrom("don't", 'dont', 'do not', 'never'), fc.oneof(sellVerb, buyVerb), sellSize, prep, level, (no, verb, size, p, lv) => {
        if (/^(?:tp|take profit|sl|stop|stop loss)$/.test(verb)) return; // "don't tp" isn't something people type
        const text = `${no} ${verb} ${size.text} ${p} ${lv}`;
        expect(parse(text).type, text).toBe('unknown');
      }),
      { numRuns: 1000 },
    );
  });

  it('a size Tippy can\'t read is a question — never the whole bag, never a guessed 50%', () => {
    const unreadable = fc.constantFrom('hal', 'quart', 'thir', 'alll', 'some', 'most', 'a little bit', 'a bit', '50p', 'a sixth', 'an eighth', '1/8', 'part');
    const sellOnly = fc.constantFrom('sell', 'dump', 'trim', 'cash out', 'tp', 'take profit', 'sl', 'stop', 'stop loss', 'secure', 'exit', 'take out');
    const named = fc.constantFrom((t: string) => t, (t: string) => `$CLAUDIA ${t}`, (t: string) => `${t} on claudia`, (t: string) => `${t} of $wif`);
    fc.assert(
      fc.property(sellOnly, unreadable, prep, level, named, fc.integer({ min: 0, max: 2 }), (verb, size, p, lv, coin, order) => {
        const parts = [`${verb} ${size} ${p} ${lv}`, `${p} ${lv} ${verb} ${size}`, `${verb} ${p} ${lv} ${size}`];
        const text = coin(parts[order]);
        const i = parse(text);
        expect(i.type, `${text} → ${JSON.stringify(i)}`).toBe('unknown');
      }),
      { numRuns: 2000 },
    );
  });

  it('a level said on the way down ("down 2x", "a 3x dip") is never above the price; "-2x" is a question', () => {
    const downSaid = fc.integer({ min: 2, max: 10 }).chain((n) => fc.constantFrom(`when it's down ${n}x`, `if its down ${n}x`, `at ${n}x down`, `on a ${n}x dip`, `if it drops ${n}x`, `when it dumps ${n}x`));
    fc.assert(
      fc.property(fc.oneof(sellVerb, buyVerb), fc.oneof(sellSize, usdSize), downSaid, (verb, size, where) => {
        const text = `${verb} ${size.text} ${where}`;
        const i = parse(text);
        if (i.type === 'add-tp') throw new Error(`${text}: a take-profit (${JSON.stringify(i.level)})`);
        if ('level' in i && i.type !== 'move') expect(i.level.kind === 'x' && i.level.value < 1, `${text} → ${JSON.stringify(i)}`).toBe(true);
        if (i.type === 'limit-buy') expect(i.said, text).toBe('dip');
      }),
      { numRuns: 1000 },
    );
    fc.assert(
      fc.property(fc.oneof(sellVerb, buyVerb), fc.oneof(sellSize, usdSize), fc.integer({ min: 2, max: 10 }), (verb, size, n) => {
        const text = `${verb} ${size.text} at -${n}x`;
        expect(parse(text).type, text).toBe('unknown');
      }),
      { numRuns: 300 },
    );
  });

  it('a market cap more than 50x below the coin\'s (a missing k or m) never gets a card', async () => {
    const higgs: ChatCoin = { key: 'H:1', address: 'H', networkId: 1, symbol: 'HIGGS', name: 'Higgs', priceUSD: 0.000719, mc: 719_000, balance: 1_000_000 };
    const state = { plans: [], buys: [], settings: withDefaults(undefined) };
    const ctx: ChatCtx = { coin: higgs, ...state, minBuyUsd: () => 2, minSellUsd: () => 2, cash: 50, resolveCoin: async () => higgs, fetchCoin: async () => higgs, api: {} as never };
    const tooLow = fc.oneof(
      fc.integer({ min: 1000, max: 14_000 }).map(String),
      fc.integer({ min: 1, max: 14 }).map((n) => `${n}k`),
      fc.integer({ min: 1, max: 14 }).map((n) => `${n},000`),
      fc.integer({ min: 1, max: 999 }).map((n) => `${n} mcap`),
    );
    await fc.assert(
      fc.asyncProperty(fc.constantFrom('sell half at', 'sell all at', 'sl at', 'stop loss', 'sell 25% if it drops to', 'buy $5 at', 'buy $5 if it dips to', 'sell everything below'), tooLow, async (said, lv) => {
        const text = `${said} ${lv}`;
        const card = await planIntent(parse(text), ctx);
        expect(card.confirm, `${text}: ${card.say}`).toBeUndefined();
      }),
      { numRuns: 500 },
    );
  });

  it('pleasantries and filler, wherever they sit, never change what a message means — and are never a coin', () => {
    const filler = fc.constantFrom('thanks a lot', 'thank you so much', 'you rock', 'if possible', 'no matter what', 'pretty please', 'lmk', 'i guess', 'appreciate it', 'when u get a chance', 'if u dont mind', 'before it rugs lol', 'honestly', 'ur the best', 'but keep my stop loss');
    const opener = fc.constantFrom('heyy', 'hiii tippy', 'yooo', 'hey tippy hope ur good,', 'honestly just', 'i think i wanna', 'thanks so much,');
    fc.assert(
      fc.property(fc.oneof(sellVerb, buyVerb), fc.oneof(sellSize, usdSize), prep, level, coin, filler, opener, fc.boolean(), (verb, size, p, lv, c, f, o, front) => {
        const plain = `${verb} ${size.text} ${p} ${lv}${c}`;
        const said = front ? `${o} ${plain}` : `${plain}, ${f}`;
        expect(parse(said), said).toEqual(parse(plain));
      }),
      { numRuns: 2000 },
    );
  });

  it('"tp <level> <n>" / "sl <level> <n>": the number after the level is how much — after a plain "sell" it is asked', () => {
    fc.assert(
      fc.property(fc.constantFrom('tp', 'sl', 'stop', 'stop loss', 'sell'), fc.constantFrom('2x', '3x', '1.5m', '2m', '500k', '600k', '-20%', '+50%', '1.2m mcap'), fc.integer({ min: 1, max: 100 }), (verb, lv, n) => {
        const text = `${verb} ${lv} ${n}`;
        const i = parse(text);
        if (verb === 'sell' || i.type === 'unknown') {
          expect(i.type, text).toBe('unknown');
          return;
        }
        expect(['add-tp', 'add-stop', 'set-sl'], `${text} → ${JSON.stringify(i)}`).toContain(i.type);
        expect(soldSize(i)?.pct, `${text} → ${JSON.stringify(i)}`).toBe(n);
      }),
      { numRuns: 500 },
    );
  });

  it('a bare number after "sell" (10% or $10?) is always a question', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 100 }), prep, level, (n, p, lv) => {
        const text = `sell ${n} ${p} ${lv}`;
        expect(parse(text).type, text).toBe('unknown');
      }),
      { numRuns: 500 },
    );
  });

  it('everyday English left in an order ("tomorrow", "good", "not") is never the coin and never skipped — a question', () => {
    const word = fc.constantFrom('tomorrow', 'tonight', 'on friday', 'next week', 'good', 'not', 'because', 'idea', 'risky', 'happens', 'smart', 'monday');
    fc.assert(
      fc.property(fc.oneof(sellVerb, buyVerb), fc.oneof(sellSize, usdSize), prep, level, word, (verb, size, p, lv, w) => {
        const text = `${verb} ${size.text} ${p} ${lv} ${w}`;
        const i = parse(text);
        expect(i.type, `${text} → ${JSON.stringify(i)}`).toBe('unknown');
      }),
      { numRuns: 2000 },
    );
  });

  it('every example a question offers ("Say "sell 20% at 600k"") is a whole message Tippy reads — never a fragment like "600k"', async () => {
    const higgs: ChatCoin = { key: 'H:1', address: 'H', networkId: 1, symbol: 'HIGGS', name: 'Higgs', priceUSD: 0.000719, mc: 719_000, balance: 1_000_000 };
    const state = { plans: [], buys: [], settings: withDefaults(undefined) };
    const ctx: ChatCtx = { coin: higgs, ...state, minBuyUsd: () => 2, minSellUsd: () => 2, cash: 50, resolveCoin: async () => higgs, fetchCoin: async () => higgs, api: {} as never };
    const bare = fc.integer({ min: 1, max: 999 }).map(String);
    const asked = fc.oneof(
      fc.tuple(fc.integer({ min: 1, max: 99 }), bare).map(([n, m]) => `sell ${n} at ${m}`),
      fc.tuple(fc.constantFrom('sell half at', 'tp at', 'tp 25%', 'sl at', 'stop 25% at', 'dump half', 'buy $5 at', 'buy at', 'sell all at', 'move tp1 to'), bare).map(([v, m]) => `${v} ${m}`),
      fc.tuple(fc.constantFrom('tp', 'sell half at', 'sl at', 'buy $5 at', 'sell all at'), fc.constantFrom('1k', '2k', '3k', '1500', '2000', '5000', '700m', '900m', '2b')).map(([v, m]) => `${v} ${m}`),
      fc.tuple(fc.constantFrom('buy half', 'buy all', 'buy 20%', 'buy a quarter of my cash', 'buy max', 'buy with all my cash', 'buy'), fc.constantFrom('at 500k', 'if it dips to 600k', 'if it dips 20%', '')).map(([v, w]) => `${v} ${w}`.trim()),
      fc.tuple(fc.constantFrom('sell half', 'sell 25%', 'sell all', 'sell'), fc.constantFrom('if it moves 20%', 'at 2kk', 'at 1mk', 'at 2x tomorrow', 'at 20%', 'at -2x', 'at 200%')).map(([v, w]) => `${v} ${w}`),
    );
    const VERB = /^(?:sell|buy|tp|sl|move|remove|trail)\b/;
    await fc.assert(
      fc.asyncProperty(asked, async (text) => {
        const card = await planIntent(parse(text), ctx);
        if (card.confirm) return;
        for (const [, eg] of card.say.matchAll(/"([^"]+)"/g)) {
          if (!VERB.test(eg)) continue;
          expect(parse(eg).type, `${text} → ${card.say}\n  offers "${eg}" → ${JSON.stringify(parse(eg))}`).not.toBe('unknown');
        }
      }),
      { numRuns: 1500 },
    );
  });

  it('planning never throws and never offers a card for a question', async () => {
    const higgs: ChatCoin = { key: 'H:1', address: 'H', networkId: 1, symbol: 'HIGGS', name: 'Higgs', priceUSD: 0.000719, mc: 719_000, balance: 1_000_000 };
    const state = { plans: [], buys: [], settings: withDefaults(undefined) };
    const ctx: ChatCtx = { coin: higgs, ...state, minBuyUsd: () => 2, minSellUsd: () => 2, cash: 50, resolveCoin: async (s) => ({ ...higgs, key: `${s}:1`, symbol: s.toUpperCase() }), fetchCoin: async () => higgs, api: {} as never };
    await fc.assert(
      fc.asyncProperty(fc.oneof(sellVerb, buyVerb), fc.oneof(sellSize, usdSize), prep, level, async (verb, size, p, lv) => {
        const i = parse(`${verb} ${size.text} ${p} ${lv}`);
        const card = await planIntent(i, ctx);
        expect(typeof card.say).toBe('string');
        if (i.type === 'unknown') expect(card.confirm).toBeUndefined();
      }),
      { numRuns: 300 },
    );
  });
});
