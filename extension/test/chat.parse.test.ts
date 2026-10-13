// The built-in chat parser: how traders actually type → an Intent (or a hint).
import { describe, expect, it } from 'vitest';
import type { Intent, LevelSpec } from '../src/chat/intent';
import { parse } from '../src/chat/parse';

const here = { here: true } as const;
const all = { all: true } as const;
const sym = (symbol: string) => ({ symbol });
const mc = (value: number): LevelSpec => ({ kind: 'mc', value });
const price = (value: number): LevelSpec => ({ kind: 'price', value });
const x = (value: number): LevelSpec => ({ kind: 'x', value });
const pct = (value: number): LevelSpec => ({ kind: 'pct', value });
const H = 3_600_000;
const D = 24 * H;

const tp = (coin: object, level: LevelSpec, sellPct: number | null = null): Intent => ({ type: 'add-tp', coin: coin as never, level, sellPct });
const sl = (coin: object, level: LevelSpec): Intent => ({ type: 'set-sl', coin: coin as never, level });
/** "sell … at <market cap>" with no direction: a take-profit above the price now, a stop below it. */
const sellAt = (coin: object, level: LevelSpec, sellPct: number | null = null): Intent => ({ type: 'add-tp', coin: coin as never, level, sellPct, anySide: true });
const stop = (coin: object, level: LevelSpec, sellPct: number): Intent => ({ type: 'add-stop', coin: coin as never, level, sellPct });
const buy = (coin: object, usd: number, level: LevelSpec, preset: string | null = null, expiresInMs: number | null | 'default' = 'default'): Intent => ({
  type: 'limit-buy',
  coin: coin as never,
  usd,
  level,
  preset,
  expiresInMs,
});

describe('take-profits', () => {
  it.each<[string, Intent]>([
    ['hey tippy add a tp at 500k mcap on CLAUDIA etc', tp(sym('CLAUDIA'), mc(500_000))],
    ['add a tp at 500k mcap on CLAUDIA', tp(sym('CLAUDIA'), mc(500_000))],
    ['tp 2x sell half', tp(here, x(2), 50)],
    ['take profit at $0.004', tp(here, price(0.004))],
    ['sell 25% at 1m mc', sellAt(here, mc(1_000_000), 25)],
    ['set a take profit at 3m', tp(here, mc(3_000_000))],
    ['sell half at 2x on $WIF', tp(sym('WIF'), x(2), 50)],
    ['tp at 500k', tp(here, mc(500_000))],
    ['Take-Profit @ $1.2M, sell a third', tp(here, mc(1_200_000), 33)],
    ['tp at 1,5m sell 25%', tp(here, mc(1_500_000), 25)],
    ['tp at 2,500,000', tp(here, mc(2_500_000))],
    ['tp at $2,500,000 market cap', tp(here, mc(2_500_000))],
    ['sell everything at 5x', tp(here, x(5), 100)],
    ['sell the rest at 10x on bonk', tp(sym('BONK'), x(10), 100)],
    ['when claudia hits 1m sell half', sellAt(sym('CLAUDIA'), mc(1_000_000), 50)],
    ['sell half when it doubles', tp(here, x(2), 50)],
    ['take half at 3x', tp(here, x(3), 50)],
    ['tp at +50%', tp(here, pct(50))],
    ['tp at 50%', tp(here, pct(50))],
    ['tp 50% at 2x', tp(here, x(2), 50)],
    ['tp 2.5x 30%', tp(here, x(2.5), 30)],
    ['take initials at 2x', tp(here, x(2), 50)],
    ['pls can you add a tp at 2 mil mcap for wif thx', tp(sym('WIF'), mc(2_000_000))],
    ['tp at 0.0042', tp(here, price(0.0042))],
    ['tp at .0042', tp(here, price(0.0042))],
    ['sell a quarter at 800k fdv', sellAt(here, mc(800_000), 25)],
    ['tkae proft at 3x', tp(here, x(3))],
    ['tp x2', tp(here, x(2))],
    ['sell 50 % at 2 x', tp(here, x(2), 50)],
    ['TP AT 500K MCAP ON CLAUDIA!!', tp(sym('CLAUDIA'), mc(500_000))],
    ['claudia tp 1m', tp(sym('CLAUDIA'), mc(1_000_000))],
    ['add another tp at 10x sell 25%', tp(here, x(10), 25)],
    ['sell 50% of my bag at 4x', tp(here, x(4), 50)],
    ['tp at 1 million market cap', tp(here, mc(1_000_000))],
    ['take profit 25% at 3x pls', tp(here, x(3), 25)],
    ['sell two thirds at 5x', tp(here, x(5), 67)],
    ['sell 50% when it pumps 100%', tp(here, pct(100), 50)],
    ['tp at 2b', tp(here, mc(2_000_000_000))],
    ['tp at 750000', tp(here, mc(750_000))],
  ])('%s', (msg, want) => expect(parse(msg)).toEqual(want));

  it('a bare "at 2" is 2x when the window takes moves', () => {
    expect(parse('tp at 2', { levelUnit: 'move' })).toEqual(tp(here, x(2)));
    expect(parse('tp 3 sell half', { levelUnit: 'move' })).toEqual(tp(here, x(3), 50));
    expect(parse('tp at 500k', { levelUnit: 'move' })).toEqual(tp(here, mc(500_000)));
  });

  it('"sell everything if it drops" is a stop loss', () => {
    expect(parse('sell all if it drops 30%')).toEqual(sl(here, pct(-30)));
    expect(parse('sell everything if wif dumps 40%')).toEqual(sl(sym('WIF'), pct(-40)));
  });
});

describe('stop losses', () => {
  it.each<[string, Intent]>([
    ['sl at 300k', sl(here, mc(300_000))],
    ['stop loss -30%', sl(here, pct(-30))],
    ['set my stop at 0.001', sl(here, price(0.001))],
    ['set my stop to 0.001', sl(here, price(0.001))],
    ['stop at 250k mcap', sl(here, mc(250_000))],
    ['sl 30%', sl(here, pct(-30))],
    ['stop-loss at 20% loss on $CLAUDIA', sl(sym('CLAUDIA'), pct(-20))],
    ['sl at breakeven', sl(here, x(1))],
    ['cut losses at 0.5x', sl(here, x(0.5))],
    ['stoploss 25 percent', sl(here, pct(-25))],
    ['sl -30% sell all', sl(here, pct(-30))],
    ['stop los if it dips 40%', sl(here, pct(-40))],
    ['put a stop at 200k on bonk', sl(sym('BONK'), mc(200_000))],
    ['sl minus 15%', sl(here, pct(-15))],
  ])('%s', (msg, want) => expect(parse(msg)).toEqual(want));

  it('a bare "sl 30" is −30% when the window takes moves', () => {
    expect(parse('sl 30', { levelUnit: 'move' })).toEqual(sl(here, pct(-30)));
    expect(parse('sl 30').type).toBe('unknown');
  });
});

describe('partial stops: sell part of the bag on the way down', () => {
  it.each<[string, Intent]>([
    // The trader's message: $HIGGS at $719K, "sell 10% at 700k" — run.ts sees it's below the price.
    ['sell 10% at 700k', sellAt(here, mc(700_000), 10)],
    ['sell 10% at $0.0007', sellAt(here, price(0.0007), 10)],
    ['sell at 700k', sellAt(here, mc(700_000))],
    ['sell 10% if it drops to 700k', stop(here, mc(700_000), 10)],
    ['stop 10% at 700k', stop(here, mc(700_000), 10)],
    ['sl 10% at 700k', stop(here, mc(700_000), 10)],
    ['sell a quarter if it dips to 650k', stop(here, mc(650_000), 25)],
    ['sell 10% if it falls below 700k on $HIGGS', stop(sym('HIGGS'), mc(700_000), 10)],
    ['sell 25% below 500k', stop(here, mc(500_000), 25)],
    ['stop loss 25% at 300k', stop(here, mc(300_000), 25)],
    ['sell half at -20%', stop(here, pct(-20), 50)],
    ['sl -30% sell half', stop(here, pct(-30), 50)],
    ['stop 10% at -30%', stop(here, pct(-30), 10)],
    ['sell 20% if it drops 40%', stop(here, pct(-40), 20)],
    ['hey tippy sell a third if higgs dumps to 500k pls', stop(sym('HIGGS'), mc(500_000), 33)],
    // Whole bag on the way down is still the stop loss; on the way up a take-profit.
    ['sell everything if it drops to 600k', sl(here, mc(600_000))],
    ['sl 100% at 300k', sl(here, mc(300_000))],
    ['sell 10% if it pumps to 2m', tp(here, mc(2_000_000), 10)],
    ['sell half above 3m', tp(here, mc(3_000_000), 50)],
    // The direction said after the level.
    ['sell 10% at 700k if it drops', stop(here, mc(700_000), 10)],
    ['sell 10% at 700k when mc dumps', stop(here, mc(700_000), 10)],
    ['sell everything at 700k if it drops', sl(here, mc(700_000))],
    ['sell 10% at 2m if it pumps', tp(here, mc(2_000_000), 10)],
  ])('%s', (msg, want) => expect(parse(msg)).toEqual(want));

  it('moves and removes a partial stop by its number; a plain "stop" is still the stop loss', () => {
    expect(parse('remove stop 1')).toEqual({ type: 'remove-level', coin: here, target: { kind: 'stop', index: 1 } });
    expect(parse('cancel stop #2 on $HIGGS')).toEqual({ type: 'remove-level', coin: sym('HIGGS'), target: { kind: 'stop', index: 2 } });
    expect(parse('delete the second stop')).toEqual({ type: 'remove-level', coin: here, target: { kind: 'stop', index: 2 } });
    expect(parse('move stop 1 to 650k')).toEqual({ type: 'move', coin: here, target: { kind: 'stop', index: 1 }, level: mc(650_000) });
    expect(parse('lower stop 2 to -40%')).toEqual({ type: 'move', coin: here, target: { kind: 'stop', index: 2 }, level: pct(-40) });
    expect(parse('set stop 1 to 600k')).toEqual({ type: 'move', coin: here, target: { kind: 'stop', index: 1 }, level: mc(600_000) });
    expect(parse('move my stop to 250k')).toEqual({ type: 'move', coin: here, target: { kind: 'sl' }, level: mc(250_000) });
    expect(parse('remove my stop')).toEqual({ type: 'remove-level', coin: here, target: { kind: 'sl' } });
    expect(parse('sl at 1.5m')).toEqual(sl(here, mc(1_500_000)));
    // No verb: "stop 2 at 600k" moves stop 2 (like "tp2 at 5x"); a size makes it a new stop.
    expect(parse('stop 2 at 600k')).toEqual({ type: 'move', coin: here, target: { kind: 'stop', index: 2 }, level: mc(600_000) });
    expect(parse('sl 1 to 650k on $HIGGS')).toEqual({ type: 'move', coin: sym('HIGGS'), target: { kind: 'stop', index: 1 }, level: mc(650_000) });
    expect(parse('stop 10% at 700k')).toEqual(stop(here, mc(700_000), 10));
  });
});

describe('sizes: words, dollars, and the plain number after the verb', () => {
  const usdSell = (coin: object, level: LevelSpec, sellUsd: number, anySide = true): Intent => ({ type: 'add-tp', coin: coin as never, level, sellPct: null, sellUsd, ...(anySide ? { anySide: true as const } : {}) });
  it.each<[string, Intent]>([
    ['sell $20 at 1m', usdSell(here, mc(1_000_000), 20)],
    ['take out 50 bucks at 2x', usdSell(here, x(2), 50, false)],
    ['sell 10$ at 3x', usdSell(here, x(3), 10, false)],
    ['sell $3 of $wif at 1m', usdSell(sym('WIF'), mc(1_000_000), 3)],
    ['take $3 out at 1.5m', usdSell(here, mc(1_500_000), 3)],
    ['sell five dollars at 2x', usdSell(here, x(2), 5, false)],
    ['tp $5 at 3x', usdSell(here, x(3), 5, false)],
    ['sell $2 if it drops to 600k', { type: 'add-stop', coin: here, level: mc(600_000), sellPct: null, sellUsd: 2 }],
    ['sl $2 at 650k', { type: 'add-stop', coin: here, level: mc(650_000), sellPct: null, sellUsd: 2 }],
    // After "tp" / "sl" a plain number with its own level is the % (trader shorthand).
    ['tp 50 @ 1.2m', tp(here, mc(1_200_000), 50)],
    ['sl 50 at 600k', stop(here, mc(600_000), 50)],
    // "2/3" is two thirds of the bag — never "stop 2".
    ['stop 2/3 at 500k', stop(here, mc(500_000), 67)],
    ['tp $0.004', tp(here, price(0.004))],
    ['exit at 2m', sellAt(here, mc(2_000_000), 100)],
    ['get me out at 500k', sellAt(here, mc(500_000), 100)],
    ['trim 25% at 2m', sellAt(here, mc(2_000_000), 25)],
    ['sell at 700k 50%', sellAt(here, mc(700_000), 50)],
    ['sl 30% below entry', sl(here, pct(-30))],
    ['partial stop 50% at 600k', stop(here, mc(600_000), 50)],
    ['sell half at 0.0₃65', sellAt(here, price(0.00065), 50)],
    ['sell 50% at 1m mcp', sellAt(here, mc(1_000_000), 50)],
  ])('%s', (msg, want) => expect(parse(msg)).toEqual(want));

  it('a dip or a breakout said in words travels with a limit buy, so run.ts can hold it to that side', () => {
    expect(parse('ape 20 bucks into $wif if it dips to 1m')).toEqual({ ...buy(sym('WIF'), 20, mc(1_000_000)), said: 'dip' });
    expect(parse('buy $10 when it breaks 1m')).toEqual({ ...buy(here, 10, mc(1_000_000)), said: 'breakout' });
    // A move already carries its sign.
    expect(parse('buy $25 if it dips 20%')).toEqual(buy(here, 25, pct(-20)));
  });

  it.each<[string, RegExp]>([
    ['sell 10 at 700k', /10% of your bag, or \$10 worth\?/],
    ['sell 0.5 at 1m', /0\.5% of your bag, \$0\.50 worth, or half\?/],
    ['sell 10 at 700', /10% of your bag, or \$10 worth\?.*"700"/],
    ['sell $3', /At what level\?.*"sell \$3 at 2x"/],
    ['sell 1m', /Sell all of it at \$1M MC\?.*not a number of coins/],
    ['sell half at 20%', /Up 20% or down 20%\?/],
    ['sell 10% every 2x', /one level at a time/],
    ['sell 10% at 700k and 25% at 1m', /One order at a time/],
    ['sell half between 650k and 700k', /not a range/],
    ['sell $3 and 50% at 2x', /How much should it sell — \$3 or 50%\?/],
    ['sell 150% at 2x', /more than your whole bag/],
    ['buy 20% at 500k', /I buy with a \$ amount, not a %/],
    ['buy 0.5 sol at 500k', /I buy with dollars, not sols/],
    ['buy 500k', /Is "500k" how much to spend\?/],
    ['buy $20 at 5oo k', /Is "5oo k" meant to be 500k\?/],
    ['sell 50% at 1.250.000', /Is "1\.250\.000" 1,250,000\?/],
    ['10% at 700k', /Sell 10% at 700k\?.*never guess buy or sell/],
    ['$20 at 500k', /Buy or sell \$20 at 500k\?/],
    ['700k', /What should happen at \$700K MC\?/],
    ['sell 10% at 700k cancel that', /won't do anything/],
  ])('asks: %s', (msg, hint) => {
    const r = parse(msg);
    expect(r.type).toBe('unknown');
    expect(r.type === 'unknown' && r.hint).toMatch(hint);
  });

  it('"buy 20% …" asks with the share, so the card can show what that is of your cash', () => {
    expect(parse('buy 20% at 500k')).toMatchObject({ type: 'unknown', cashPct: 20 });
  });
});

describe('trailing stops', () => {
  it.each<[string, Intent]>([
    ['trail 20%', { type: 'set-trail', coin: here, trailPct: 20, afterX: null }],
    ['trailing stop 25% after 2x', { type: 'set-trail', coin: here, trailPct: 25, afterX: 2 }],
    ['trail by 15 once it doubles', { type: 'set-trail', coin: here, trailPct: 15, afterX: 2 }],
    ['trailing 20% from 3x on wif', { type: 'set-trail', coin: sym('WIF'), trailPct: 20, afterX: 3 }],
    ['trialing stop 30%', { type: 'set-trail', coin: here, trailPct: 30, afterX: null }],
    ['trail the rest 25% starting at 2.5x', { type: 'set-trail', coin: here, trailPct: 25, afterX: 2.5 }],
    ['change my trailing to 30%', { type: 'set-trail', coin: here, trailPct: 30, afterX: null }],
    ['trail 20% when it hits 2x', { type: 'set-trail', coin: here, trailPct: 20, afterX: 2 }],
  ])('%s', (msg, want) => expect(parse(msg)).toEqual(want));
});

describe('moving a level', () => {
  it.each<[string, Intent]>([
    ['move tp1 to 2m', { type: 'move', coin: here, target: { kind: 'tp', index: 1 }, level: mc(2_000_000) }],
    ['move my stop to 250k', { type: 'move', coin: here, target: { kind: 'sl' }, level: mc(250_000) }],
    ['move my buy to 400k mc', { type: 'move', coin: here, target: { kind: 'buy' }, level: mc(400_000) }],
    ['raise my stop loss to 300k on CLAUDIA', { type: 'move', coin: sym('CLAUDIA'), target: { kind: 'sl' }, level: mc(300_000) }],
    ['change the second tp to 5x', { type: 'move', coin: here, target: { kind: 'tp', index: 2 }, level: x(5) }],
    ['tp2 at 5x', { type: 'move', coin: here, target: { kind: 'tp', index: 2 }, level: x(5) }],
    ['set tp1 to 3m', { type: 'move', coin: here, target: { kind: 'tp', index: 1 }, level: mc(3_000_000) }],
    ['move tp 2 to 4x', { type: 'move', coin: here, target: { kind: 'tp', index: 2 }, level: x(4) }],
    ['move my stop to breakeven', { type: 'move', coin: here, target: { kind: 'sl' }, level: x(1) }],
    ['lower my stop to -40%', { type: 'move', coin: here, target: { kind: 'sl' }, level: pct(-40) }],
    ['move my buy on wif to a 30% dip', { type: 'move', coin: sym('WIF'), target: { kind: 'buy' }, level: pct(-30) }],
  ])('%s', (msg, want) => expect(parse(msg)).toEqual(want));
});

describe('removing a level', () => {
  it.each<[string, Intent]>([
    ['remove tp2', { type: 'remove-level', coin: here, target: { kind: 'tp', index: 2 } }],
    ['delete my stop loss', { type: 'remove-level', coin: here, target: { kind: 'sl' } }],
    ['turn off trailing', { type: 'remove-level', coin: here, target: { kind: 'trail' } }],
    ['cancel tp1 on CLAUDIA', { type: 'remove-level', coin: sym('CLAUDIA'), target: { kind: 'tp', index: 1 } }],
    ['no stop loss', { type: 'remove-level', coin: here, target: { kind: 'sl' } }],
    ['trailing off', { type: 'remove-level', coin: here, target: { kind: 'trail' } }],
    ['stop trailing on wif', { type: 'remove-level', coin: sym('WIF'), target: { kind: 'trail' } }],
    ['get rid of the first take profit', { type: 'remove-level', coin: here, target: { kind: 'tp', index: 1 } }],
    ['remvoe tp 3', { type: 'remove-level', coin: here, target: { kind: 'tp', index: 3 } }],
  ])('%s', (msg, want) => expect(parse(msg)).toEqual(want));
});

describe('limit buys', () => {
  it.each<[string, Intent]>([
    ['buy $10 at 1m mcap', buy(here, 10, mc(1_000_000))],
    ['limit buy 25 of CLAUDIA if it dips 20%', buy(sym('CLAUDIA'), 25, pct(-20))],
    ['buy $50 of wif at 400k then protect with classic for 24h', buy(sym('WIF'), 50, mc(400_000), 'classic', D)],
    ['buy 10 bucks when it breaks out 15%', buy(here, 10, pct(15))],
    ['buy 10$ of bonk at 0.00002 no tp/sl', buy(sym('BONK'), 10, price(0.00002), 'none')],
    ['ape $25 into $CLAUDIA at 300k, guard with p3, never expires', buy(sym('CLAUDIA'), 25, mc(300_000), 'moon', null)],
    ['buy the dip: $20 at a 20% dip for a week', buy(here, 20, pct(-20), null, 7 * D)],
    ['buy $1k of wif at 2m for 7d', buy(sym('WIF'), 1000, mc(2_000_000), null, 7 * D)],
    ['buy wif $10 at 1m', buy(sym('WIF'), 10, mc(1_000_000))],
    ['buy $10 at $0.004', buy(here, 10, price(0.004))],
    ['buy 25 usd at -15%', buy(here, 25, pct(-15))],
    ['buy 10 dollars of claudia when it drops 30% and play it safe for an hour', buy(sym('CLAUDIA'), 10, pct(-30), 'safe', H)],
    ['buy $5 at 2x', buy(here, 5, x(2))],
    ['buy $15 if it pumps 25% with p2', buy(here, 15, pct(25), 'classic')],
    ['buy $10 at 1m mcap for a day without guard', buy(here, 10, mc(1_000_000), 'none', D)],
  ])('%s', (msg, want) => expect(parse(msg)).toEqual(want));

  it('cancelling buys', () => {
    expect(parse('cancel my buy on CLAUDIA')).toEqual({ type: 'cancel-buy', coin: sym('CLAUDIA') });
    expect(parse('cancel all buys')).toEqual({ type: 'cancel-buy', coin: all });
    expect(parse('remove my limit buy')).toEqual({ type: 'cancel-buy', coin: here });
    expect(parse('kill all my bids on wif')).toEqual({ type: 'cancel-buy', coin: sym('WIF') });
  });
});

describe('plans, pausing and presets', () => {
  it.each<[string, Intent]>([
    ['stop guarding CLAUDIA', { type: 'stop-plan', coin: sym('CLAUDIA') }],
    ['cancel my plan', { type: 'stop-plan', coin: here }],
    ['unguard $wif', { type: 'stop-plan', coin: sym('WIF') }],
    ['forget about bonk', { type: 'stop-plan', coin: sym('BONK') }],
    ['pause CLAUDIA', { type: 'pause', coin: sym('CLAUDIA'), paused: true }],
    ['pause everything', { type: 'pause', coin: all, paused: true }],
    ['resume', { type: 'pause', coin: all, paused: false }],
    ['unpause wif', { type: 'pause', coin: sym('WIF'), paused: false }],
    ['pause this coin', { type: 'pause', coin: here, paused: true }],
    ['kill switch', { type: 'pause', coin: all, paused: true }],
    ['guard CLAUDIA with classic', { type: 'apply-preset', coin: sym('CLAUDIA'), preset: 'classic' }],
    ['use p1', { type: 'apply-preset', coin: here, preset: 'safe' }],
    ['protect wif with moon bag', { type: 'apply-preset', coin: sym('WIF'), preset: 'moon' }],
    ['play it safe on bonk', { type: 'apply-preset', coin: sym('BONK'), preset: 'safe' }],
    ['classic', { type: 'apply-preset', coin: here, preset: 'classic' }],
    ['guard $MOON with moon', { type: 'apply-preset', coin: sym('MOON'), preset: 'moon' }],
  ])('%s', (msg, want) => expect(parse(msg)).toEqual(want));
});

describe('show, practice, settings, help', () => {
  it.each<[string, Intent]>([
    ['what are my orders', { type: 'show', coin: all }],
    ['show CLAUDIA', { type: 'show', coin: sym('CLAUDIA') }],
    ['status', { type: 'show', coin: all }],
    ["what's tippy doing", { type: 'show', coin: all }],
    ['how is $wif doing?', { type: 'show', coin: sym('WIF') }],
    ["what's my stop on bonk", { type: 'show', coin: sym('BONK') }],
    ['$CLAUDIA', { type: 'show', coin: sym('CLAUDIA') }],
    ['show this', { type: 'show', coin: here }],
    ['my buys', { type: 'show', coin: all }],
    ['practice a buy', { type: 'practice', coin: here, side: 'buy', usd: null }],
    ['test a sell on SOL', { type: 'practice', coin: sym('SOL'), side: 'sell', usd: null }],
    ['practice buying $5', { type: 'practice', coin: here, side: 'buy', usd: 5 }],
    ['dry run a sell', { type: 'practice', coin: here, side: 'sell', usd: null }],
    ['practise a buy of $3 on wif', { type: 'practice', coin: sym('WIF'), side: 'buy', usd: 3 }],
    ['dry run on', { type: 'setting', name: 'dryRun', value: true }],
    ['turn off dry run', { type: 'setting', name: 'dryRun', value: false }],
    ['go live', { type: 'setting', name: 'dryRun', value: false }],
    ['use market cap', { type: 'setting', name: 'levelUnit', value: 'mc' }],
    ['use percent', { type: 'setting', name: 'levelUnit', value: 'move' }],
    ['use %', { type: 'setting', name: 'levelUnit', value: 'move' }],
    ['auto guard on', { type: 'setting', name: 'autoGuard', value: true }],
    ['autoguard off', { type: 'setting', name: 'autoGuard', value: false }],
    ['hide chart lines', { type: 'setting', name: 'chartLines', value: false }],
    ['show chart lines', { type: 'setting', name: 'chartLines', value: true }],
    ['help', { type: 'help' }],
    ['what can you do', { type: 'help' }],
    ['?', { type: 'help' }],
    ['hey tippy', { type: 'help' }],
    ['how do I use this?', { type: 'help' }],
  ])('%s', (msg, want) => expect(parse(msg)).toEqual(want));
});

describe('asks instead of guessing', () => {
  it.each<[string, RegExp]>([
    ['asdf qwerty', /tp at 500k mcap/],
    ['', /tp at 500k mcap/],
    ['tp', /Where should the take-profit go/],
    ['add a tp on CLAUDIA', /Where should the take-profit go/],
    ['sl', /Where should the stop go/],
    ['buy the dip at 1m', /How much should I buy at \$1M MC/],
    ['buy the dip', /How much, and where/],
    ['buy $10', /Where should I buy/],
    ['buy $10 now', /not on the spot/],
    ['sell half now', /not on the spot/],
    ['tp at 2', /"2x" or "2m mcap"/],
    ['tp at 500', /"500k mcap"/],
    ['sl 30', /"-30%"/],
    ['buy $10 at 20%', /20% dip or a 20% breakout/],
    ['buy 10 at 5', /how much to spend or where to buy/],
    ['tp at 2x and 5x', /two levels/],
    ['tp at 2x and sl at -30%', /One thing at a time/],
    ['buy at 1m and sell at 2m', /One thing at a time/],
    ['tp 50%', /how much to sell, or how far up/],
    ['move my tp to 2m', /Which take-profit/],
    ['remove my tp', /Which take-profit/],
    ['move tp1', /Where to/],
    ['move my stop up 10%', /where to put it/],
    ['trail', /How far below the top/],
    ['trail 20% after 1m mcap', /multiple of your entry/],
    ['trail 150%', /between 1% and 99%/],
    ['guard CLAUDIA', /Which preset/],
    ['stop everything', /Pause everything, or cancel/],
    ['cancel all orders', /Pause everything, or cancel/],
    ['cancel', /Pause everything, or cancel|Cancel what/],
    ['tp at 2x on CLAUDIA and WIF', /Which coin/],
    ['tp at 2x on $CLAUDIA and $WIF', /One coin at a time/],
    ['pause my buy', /can't pause a buy/],
    ['pause tp2', /whole coins/],
    ['dry run', /Dry run on or off/],
    ['tp 10% if it drops to 700k', /Take-profits go above.*"sell 25% if it drops to 700k"/],
    ['tp half at -20%', /Take-profits go above/],
    ['sell half if it dips', /Down to where\? Try "sell 50% if it drops to 700k"/],
    ['sell 10% at 700k if it drops or if it pumps', /Up or down/],
    ['remove the last stop', /Which stop\? Say its number/],
    ['stop initials at 700k', /How much should the stop sell/],
    ['stop guarding everything', /one coin at a time/],
    ['tp at 2x on 0x1234567890abcdef1234567890abcdef12345678', /ticker/],
    ['buy $10 at 1m for 30m', /"30m" 30 minutes, or \$30M MC/],
    ['buy $10 at 1m mcap and $25 at 500k', /One buy at a time/],
    ['sl at -150%', /can't drop 100%/],
    ['sell half and a quarter at 2x', /Pick one/],
    ['buy $10 at 1m with classic and moon bag', /Pick one preset/],
    ['thanks', /Anytime/],
    ['resume and pause', /Pause or resume/],
  ])('%s', (msg, hint) => {
    const r = parse(msg);
    expect(r.type).toBe('unknown');
    expect(r.type === 'unknown' && r.hint).toMatch(hint);
  });

  it('never mistakes level words, amounts or keywords for a coin', () => {
    for (const msg of ['buy the dip at 1m mcap with $10', 'sell half at 2x', 'stop loss at break even', 'tp at 500k market cap', 'buy 10 bucks if it dips 20 percent']) {
      const r = parse(msg) as { coin?: unknown };
      expect(r.coin, msg).toEqual(here);
    }
  });

  it('is deterministic and never throws', () => {
    const msgs = ['tp at 2x', '$$$', '%%%', '-', '+5', '1/2', 'x', 'buy buy buy', 'tp tp tp 2x 3x', '🚀🚀 tp 2x', 'a'.repeat(1000), '\u0000', '0.0.0'];
    for (const m of msgs) {
      const a = parse(m);
      expect(parse(m)).toEqual(a);
      expect(a.type).toBeTruthy();
    }
  });
});
