// @vitest-environment happy-dom
// Tippy's window takes every level as an exact market cap by default ("sell at
// $700K MC", "buy at $1.6M MC"); ⇄ shows the same level as a price on both tabs
// and never changes what's set. Right under the box Tippy says what the level
// means: the move from now and, on a sell, the gain or loss against your entry.
// No market cap → prices, and no ⇄. Levels on a running plan that were set as a
// multiple ("3x") are measured from your entry, and stay a multiple.
import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildPlan, type PlanEdit } from '../src/engine/orders';
import type { BuyInput, Plan, PlanInput } from '../src/engine/types';
import { DEFAULT_PRESETS } from '../src/shared/settings';
import { TippyWindow, type WindowApi, type WindowToken } from '../src/ui/TippyWindow';

/** $TST at $2M MC; a $200 bag. */
const token: WindowToken = {
  key: 'Mint111:1399811149',
  address: 'Mint111',
  networkId: 1399811149,
  chainName: 'Solana',
  symbol: 'TST',
  name: 'Test',
  priceUSD: 0.002,
  mc: 2_000_000,
  balance: 100_000,
};

let root: HTMLElement;
let armed: Omit<PlanInput, 'id' | 'now'>[];
let bought: Omit<BuyInput, 'id' | 'now'>[];
let updated: { planId: string; edit: PlanEdit }[];

const ok = async () => ({ ok: true as const });
const api: WindowApi = {
  arm: async (input) => (armed.push(input), { ok: true }),
  pause: ok,
  resume: ok,
  cancel: ok,
  resolveHeld: ok,
  retry: ok,
  update: async (planId, edit) => (updated.push({ planId, edit }), { ok: true }),
  armBuy: async (input) => (bought.push(input), { ok: true }),
  cancelBuy: ok,
  resolveBuy: ok,
  practice: ok,
};

type Props = Parameters<typeof TippyWindow>[0];
async function show(over: Partial<Props> = {}) {
  await act(async () => {
    render(h(TippyWindow, { token, plan: null, buys: [], cash: 100, minBuyUsd: 2, minSellUsd: 2, presets: DEFAULT_PRESETS, defaultPresetId: 'classic', api, intro: false, ...over }), root);
  });
}

function livePlan(over: Partial<PlanInput> = {}): Plan {
  return buildPlan({
    id: 'p1',
    key: token.key,
    networkId: token.networkId,
    address: token.address,
    symbol: 'TST',
    name: 'Test',
    entry: { priceUSD: 0.001, mc: 1_000_000, source: 'armed-at' }, // entry was half the price now
    balance: 100_000,
    tps: [
      { trigger: { kind: 'x', value: 3 }, sellPct: 50 },
      { trigger: { kind: 'mc', value: 10_000_000 }, sellPct: 25 },
    ],
    sl: { trigger: { kind: 'x', value: 0.75 } },
    trailing: null,
    origin: 'manual',
    now: 1,
    ...over,
  });
}

const $ = <T extends Element = HTMLElement>(sel: string) => root.querySelector<T>(sel);
const btn = (text: string | RegExp, scope: ParentNode = root) =>
  [...scope.querySelectorAll<HTMLButtonElement>('button')].find((b) => (typeof text === 'string' ? b.textContent!.trim() === text : text.test(b.textContent!)))!;
const byLabel = (label: string | RegExp) =>
  [...root.querySelectorAll<HTMLButtonElement>('[aria-label]')].find((e) => (typeof label === 'string' ? e.getAttribute('aria-label') === label : label.test(e.getAttribute('aria-label')!)))!;
const level = () => $<HTMLInputElement>('.tw-trig-in')!;
const pctBox = () => $<HTMLInputElement>('.tw-pctbox input')!;
const flip = () => $<HTMLButtonElement>('button.tw-flip');
const means = () => $('.tw-means')?.textContent ?? null;
/** Each part of the "means" line with its colour: ['−5% from now', 'down']. */
const meansParts = () => [...root.querySelectorAll('.tw-means > span')].map((s) => [s.textContent, s.className]);
const armBtn = () => $<HTMLButtonElement>('.tw-arm')!;
const say = () => $('.tw-sum')!.textContent;
const tab = (name: 'Buy' | 'Sell') => btn(new RegExp(`^${name}`), $('.tw-modes')!);
const rows = () =>
  [...root.querySelectorAll('.tw-list > .tw-row, .tw-list > .tw-nowline')].map((r) =>
    [...r.children]
      .filter((c) => c.tagName !== 'BUTTON')
      .map((c) => c.textContent!.trim())
      .filter(Boolean)
      .join(' '),
  );

async function click(el: Element) {
  await act(async () => {
    (el as HTMLElement).click();
  });
}
async function typeInto(input: HTMLInputElement, text: string) {
  await act(async () => {
    input.value = text;
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
async function blur(input: HTMLInputElement) {
  await act(async () => {
    input.dispatchEvent(new Event('blur'));
  });
}
async function enter(input: HTMLInputElement) {
  await act(async () => {
    input.form!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });
}

beforeEach(() => {
  armed = [];
  bought = [];
  updated = [];
  root = document.createElement('div');
  document.body.append(root);
});
afterEach(() => {
  render(null, root);
  root.remove();
});

describe('a market cap by default; ⇄ shows the same level as a price', () => {
  it('Sell: ⇄ changes how the level reads, never the level — and a typed price is armed as one', async () => {
    await show();
    expect(flip()!.textContent).toBe('MC ⇄');
    await typeInto(level(), '3m');
    await click(flip()!);
    expect(flip()!.textContent).toBe('Price ⇄');
    expect(level().value).toBe('0.003');
    expect($('.tw-trig-now')!.textContent).toBe('now $0.002');
    expect(pctBox().value).toBe('+50');
    expect(armBtn().textContent).toBe('Add take profit · 50% at $0.003');
    await click(armBtn());
    expect(armed[0].tps).toEqual([{ trigger: { kind: 'mc', value: 3_000_000 }, sellPct: 50 }]); // as it was set

    await typeInto(level(), '0.0025');
    await click(armBtn());
    expect(armed[1].tps).toEqual([{ trigger: { kind: 'price', value: 0.0025 }, sellPct: 50 }]);
  });

  it('the other tab follows ⇄, and flips back', async () => {
    await show();
    await click(flip()!);
    await click(tab('Buy'));
    expect(flip()!.textContent).toBe('Price ⇄');
    expect(level().value).toBe('0.0016'); // the −20% default dip
    await click(flip()!);
    expect(level().value).toBe('1.6M');
    await click(armBtn());
    expect(bought[0].trigger).toEqual({ kind: 'mc', value: 1_600_000 });
  });

  it('reads 750k, 1.2m, 2,500,000, $5m and 5000000 — and tidies them when you leave the box', async () => {
    await show();
    for (const [typed, tidy] of [
      ['750k', '750K'],
      ['1.2m', '1.2M'],
      ['2,500,000', '2.5M'],
      ['$5m', '5M'],
      ['5000000', '5M'],
    ]) {
      await typeInto(level(), typed);
      await blur(level());
      expect(level().value).toBe(tidy);
    }
    await click(armBtn());
    expect(armed[0].tps).toEqual([{ trigger: { kind: 'mc', value: 5_000_000 }, sellPct: 50 }]);
  });
});

describe('what the level means, right under the box', () => {
  it('with no plan yet, the move from now is your gain or loss (Tippy enters at the price now)', async () => {
    await show();
    expect(means()).toBeNull(); // nothing typed yet
    await typeInto(level(), '1.9m');
    expect(meansParts()).toEqual([['−5% from now', 'down']]);
    await typeInto(level(), '2.2m');
    expect(meansParts()).toEqual([['+10% from now', 'up']]);
  });

  it('"sell 10% at 700k" on $HIGGS: −2.6% from now, −2.2% against an entry at $716K', async () => {
    const higgs = { ...token, symbol: 'HIGGS', priceUSD: 0.000719, mc: 719_000 };
    const plan = livePlan({ symbol: 'HIGGS', entry: { priceUSD: 0.000716, mc: 716_000, source: 'armed-at' }, tps: [], sl: { trigger: { kind: 'mc', value: 600_000 } } });
    await show({ token: higgs, plan });
    await typeInto(level(), '700k');
    expect(means()).toBe('−2.6% from now · −2.2% vs your entry ($716K MC)');
    expect(meansParts().map((p) => p[1])).toEqual(['', 'down']);
    await typeInto(level(), '800k');
    expect(means()).toBe('+11.3% from now · +11.7% vs your entry ($716K MC)');
    expect(meansParts().map((p) => p[1])).toEqual(['', 'up']);
  });

  it('above the market can still be a loss against your entry — and in prices, the entry is a price', async () => {
    const plan = livePlan({ entry: { priceUSD: 0.0021, mc: 2_100_000, source: 'armed-at' }, tps: [], sl: null, trailing: { trailPct: 20, activateX: null } });
    await show({ plan });
    await typeInto(level(), '2.05m');
    expect(means()).toBe('+2.5% from now · −2.4% vs your entry ($2.1M MC)');
    expect(meansParts().map((p) => p[1])).toEqual(['', 'down']);
    await click(flip()!);
    expect(means()).toBe('+2.5% from now · −2.4% vs your entry ($0.0021)');
  });

  it('a limit buy shows the move from now', async () => {
    await show({ token: { ...token, balance: 0 } });
    expect(meansParts()).toEqual([['−20% from now', '']]);
    await typeInto(level(), '2.5m');
    expect(means()).toBe('+25% from now');
  });
});

describe('no market cap → prices, no ⇄', () => {
  it('a coin fomo shows no market cap for: both tabs take a price; the default dip stays a move', async () => {
    await show({ token: { ...token, mc: null } });
    expect(flip()).toBeNull();
    expect($('.tw-flip.off')!.textContent).toBe('Price');
    await typeInto(level(), '0.003');
    expect(armBtn().textContent).toBe('Add take profit · 50% at $0.003');
    await click(tab('Buy'));
    expect($('.tw-flip.off')!.textContent).toBe('Price');
    expect(level().value).toBe('0.0016');
    await click(armBtn());
    expect(bought[0].trigger).toEqual({ kind: 'x', value: 0.8 });
  });

  it('a running plan armed without a market cap is set in prices; its limit buy still uses the market cap', async () => {
    await show({ plan: livePlan({ entry: { priceUSD: 0.001, mc: null, source: 'armed-at' }, tps: [{ trigger: { kind: 'x', value: 3 }, sellPct: 50 }] }) });
    expect(flip()).toBeNull();
    expect(rows()).toEqual(['▲ $0.003 +50% · sell 50%', 'now $0.002', '▼ $0.00075 −62.5% · sell the rest']);
    await typeInto(level(), '0.0018');
    await click(armBtn());
    expect(updated[0].edit.stops).toEqual([{ id: null, trigger: { kind: 'price', value: 0.0018 }, sellPct: 50 }]);
    await click(tab('Buy'));
    expect(flip()!.textContent).toBe('MC ⇄');
    expect(level().value).toBe('1.6M');
  });
});

describe('a running plan keeps each level the way it was set', () => {
  it('"3x" is measured from your entry, and ✎ + ⇄ + Save still sends 3x', async () => {
    await show({ plan: livePlan() });
    expect(rows()[1]).toBe('▲ $3M MC +50% · sell 50%'); // 3x of a $1M entry, not of the $2M now
    await click(byLabel('Change take-profit 3x'));
    expect(level().value).toBe('3M');
    await click(flip()!);
    expect(level().value).toBe('0.003');
    await click(armBtn());
    expect(updated[0].edit.tps.find((t) => t.id === 'tp1')).toEqual({ id: 'tp1', trigger: { kind: 'x', value: 3 }, sellPct: 50 });
  });

  it('a take profit the price already reached still saves as a take profit (it is the same level)', async () => {
    // 2x of entry = the price now.
    await show({ plan: livePlan({ tps: [{ trigger: { kind: 'x', value: 2 }, sellPct: 50 }] }) });
    await click(byLabel('Change take-profit 2x'));
    await click(flip()!);
    expect(armBtn().textContent).toBe('Save take profit · 50% at $0.002');
    expect(armBtn().disabled).toBe(false);
    await click(armBtn());
    expect(updated[0].edit.tps).toEqual([{ id: 'tp1', trigger: { kind: 'x', value: 2 }, sellPct: 50 }]);
  });

  it('quick presets on a coin with a market cap are set as market caps from now', async () => {
    await show();
    await click(btn(/^P3/, $('.tw-quick')!));
    expect($('.tw-notice-text')!.textContent).toBe('Add P3 Moon bag: 3x 33% · 10x 33% · SL −40% · trail 25% after 2x?');
    await click(btn('Add'));
    expect(armed[0]).toMatchObject({
      tps: [
        { trigger: { kind: 'mc', value: 6_000_000 }, sellPct: 33 },
        { trigger: { kind: 'mc', value: 20_000_000 }, sellPct: 33 },
      ],
      sl: { trigger: { kind: 'mc', value: 1_200_000 } },
      trailing: { trailPct: 25, activateX: 2 },
    });
  });
});

describe('the limit buy level', () => {
  beforeEach(() => show({ token: { ...token, balance: 0 } }));

  it('"1M" + Enter arms a buy at $1M MC', async () => {
    await typeInto(level(), '1M');
    await enter(level());
    expect(level().value).toBe('1M');
    expect(pctBox().value).toBe('-50');
    expect(say()).toBe('Buy $10 of $TST if it drops 50% to $1M MC');
    expect(armBtn().textContent).toBe('Place limit buy · $10 at $1M MC');
    await click(armBtn());
    expect(bought[0].trigger).toEqual({ kind: 'mc', value: 1_000_000 });
  });

  it('above the market is a breakout', async () => {
    await typeInto(pctBox(), '+25');
    expect(level().value).toBe('2.5M');
    expect(say()).toBe('Buy $10 of $TST if it rises 25% to $2.5M MC');
    await click(armBtn());
    expect(bought[0].trigger).toEqual({ kind: 'mc', value: 2_500_000 });
  });

  it('something it can’t read, or the market cap now, holds Place back', async () => {
    await typeInto(level(), 'lots');
    expect($('.tw-trig-row')!.classList.contains('bad')).toBe(true);
    expect(armBtn().disabled).toBe(true);
    expect(armBtn().textContent).toBe('Set a buy level first');
    await click(armBtn());
    expect(bought).toHaveLength(0);

    await typeInto(level(), '2M');
    expect([...root.querySelectorAll('.tw-warn-line')].map((e) => e.textContent)).toEqual(["That's where it is now — pick a dip below or a breakout above."]);
    expect(armBtn().disabled).toBe(true);
  });
});

describe('the untouched default limit buy follows the price', () => {
  const moved = (mc: number) => ({ ...token, priceUSD: mc / 1e9, mc, balance: 0 });

  it('the −20% dip follows; what you type (or are typing) stays', async () => {
    await show({ token: moved(2_000_000) });
    await show({ token: moved(3_000_000) });
    expect(level().value).toBe('2.4M');
    expect(means()).toBe('−20% from now');
    await typeInto(level(), '2M');
    await show({ token: moved(3_200_000) });
    expect(level().value).toBe('2M'); // not wiped mid-typing
    await blur(level());
    await show({ token: moved(1_500_000) });
    expect(level().value).toBe('2M');
    expect(means()).toBe('+33.3% from now');
    await click(armBtn());
    expect(bought[0].trigger).toEqual({ kind: 'mc', value: 2_000_000 });
  });
});
