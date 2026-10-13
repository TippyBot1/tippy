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

const pctSize = fc.integer({ min: 1, max: 99 }).map((n): Size => ({ text: fc.sample(fc.constantFrom(`${n}%`, `${n} %`, `${n} percent`), 1)[0], pct: n }));
const wordSize = fc.constantFrom<Size>({ text: 'one third', pct: 33 }, { text: 'three quarters', pct: 75 }, { text: 'everything', pct: 100 }, { text: '3/4', pct: 75 }, { text: '1/2', pct: 50 }, { text: 'ten percent', pct: 10 }, { text: 'half', pct: 50 }, { text: 'a quarter', pct: 25 }, { text: 'a third', pct: 33 }, { text: '2/3', pct: 67 }, { text: 'all', pct: 100 }, { text: 'the rest', pct: 100 });
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

const sellVerb = fc.constantFrom('sell', 'dump', 'trim', 'cash out', 'scale out', 'tp', 'take profit', 'sl', 'stop', 'stop loss', 'hey tippy sell', 'pls sell', 'can you sell', 'slel', 'sel', 'take', 'take out', 'secure', 'cut', 'exit', 'partial stop', 'set a tp', 'add a tp', 'put a stop');
const buyVerb = fc.constantFrom('buy', 'ape', 'bid', 'limit buy', 'snipe', 'grab', 'scoop');
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

  it('a bare number after "sell" (10% or $10?) is always a question', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 100 }), prep, level, (n, p, lv) => {
        const text = `sell ${n} ${p} ${lv}`;
        expect(parse(text).type, text).toBe('unknown');
      }),
      { numRuns: 500 },
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
