// @vitest-environment happy-dom
// Tippy's window, Sell tab: take profits and stops look the same. Pick how much
// to sell and a level — above the market it's a take profit, below it's a stop
// (100% below is the stop loss that sells the rest) — and the button puts it
// live at once. The level box, the slider and the % box stay in step; fomo's
// minimum sell is explained up front; the trailing stop hides until wanted.
//
// The user's own case: "sell 10% at 700k" while $HIGGS sat at $719K MC.
import fc from 'fast-check';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildPlan, type PlanEdit } from '../src/engine/orders';
import type { Plan, PlanInput } from '../src/engine/types';
import type { CommandResult } from '../src/shared/messages';
import { DEFAULT_PRESETS } from '../src/shared/settings';
import { TippyWindow, type WindowApi, type WindowToken } from '../src/ui/TippyWindow';

/** $HIGGS at $719K MC; a $4.98 bag. */
const higgs: WindowToken = {
  key: 'Higgs111:1399811149',
  address: 'Higgs111',
  networkId: 1399811149,
  chainName: 'Solana',
  symbol: 'HIGGS',
  name: 'Higgs',
  priceUSD: 0.000719,
  mc: 719_000,
  balance: 6926.3,
};
/** The same coin with a $71.90 bag. */
const bigBag = { ...higgs, balance: 100_000 };

let root: HTMLElement;
let calls: { fn: string; args: unknown[] }[];
let result: () => CommandResult;

const rec =
  (fn: string) =>
  async (...args: unknown[]) => (calls.push({ fn, args }), result());
const api: WindowApi = {
  arm: rec('arm'),
  pause: rec('pause'),
  resume: rec('resume'),
  cancel: rec('cancel'),
  resolveHeld: rec('resolveHeld'),
  retry: rec('retry'),
  update: rec('update'),
  armBuy: rec('armBuy'),
  cancelBuy: rec('cancelBuy'),
  resolveBuy: rec('resolveBuy'),
  practice: rec('practice'),
};
const called = (fn: string) => calls.filter((c) => c.fn === fn).map((c) => c.args);
const armed = () => called('arm').map((a) => a[0] as Omit<PlanInput, 'id' | 'now'>);
const edits = () => called('update').map((a) => a[1] as PlanEdit);

type Props = Parameters<typeof TippyWindow>[0];
async function show(over: Partial<Props> = {}) {
  await act(async () => {
    render(h(TippyWindow, { token: bigBag, plan: null, buys: [], cash: 50, minBuyUsd: 2, minSellUsd: 2, presets: DEFAULT_PRESETS, defaultPresetId: 'classic', api, intro: false, ...over }), root);
  });
}

const $ = <T extends Element = HTMLElement>(sel: string) => root.querySelector<T>(sel);
const btn = (text: string | RegExp, scope: ParentNode = root) =>
  [...scope.querySelectorAll<HTMLButtonElement>('button')].find((b) => (typeof text === 'string' ? b.textContent!.trim() === text : text.test(b.textContent!)))!;
const byLabel = (label: RegExp) => [...root.querySelectorAll<HTMLElement>('[aria-label]')].find((e) => label.test(e.getAttribute('aria-label')!))!;
const level = () => $<HTMLInputElement>('.tw-trig-in')!;
const pctBox = () => $<HTMLInputElement>('.tw-pctbox input')!;
const slider = () => $<HTMLInputElement>('.tw-slider input')!;
const armBtn = () => $<HTMLButtonElement>('.tw-arm')!;
const say = () => $('.tw-sum')!.textContent;
const warns = () => [...root.querySelectorAll('.tw-body .tw-warn-line')].map((e) => e.textContent);
const amount = (pct: string) => btn(pct, $('[aria-label="Sell amount"]')!);
/** "▲ $790K MC +9.9% · sell 25% [status]" — each row's text (its ✎ / × buttons left out), and the "now" line. */
const rows = () =>
  [...root.querySelectorAll('.tw-list > .tw-row, .tw-list > .tw-nowline')].map((r) =>
    [...r.children]
      .filter((c) => c.tagName !== 'BUTTON')
      .map((c) => c.textContent!.trim())
      .filter(Boolean)
      .join(' '),
  );
const notice = () => $('.tw-notice-text')?.textContent ?? null;
/** The heads-up line that doesn't stop the button. */
const headsUp = () => $('.tw-body .tw-heads')?.textContent ?? null;

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
async function slide(v: number) {
  await act(async () => {
    slider().value = String(v);
    slider().dispatchEvent(new Event('input', { bubbles: true }));
  });
}
async function blur(input: HTMLInputElement) {
  await act(async () => {
    input.dispatchEvent(new Event('blur'));
  });
}
async function flush() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
}
/** Type a % of the bag into ✎ other and press Enter. */
async function customPct(text: string) {
  await typeInto($<HTMLInputElement>('.tw-amt-custom input')!, text);
  await act(async () => {
    $<HTMLFormElement>('.tw-amt-custom')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });
}

function livePlan(over: Partial<PlanInput> = {}): Plan {
  return buildPlan({
    id: 'p1',
    key: higgs.key,
    networkId: higgs.networkId,
    address: higgs.address,
    symbol: 'HIGGS',
    name: 'Higgs',
    entry: { priceUSD: 0.0006, mc: 600_000, source: 'armed-at' },
    balance: 100_000,
    tps: [{ trigger: { kind: 'mc', value: 1_000_000 }, sellPct: 50 }],
    sl: { trigger: { kind: 'mc', value: 620_000 } },
    trailing: null,
    origin: 'manual',
    now: 1,
    ...over,
  });
}

beforeEach(() => {
  calls = [];
  result = () => ({ ok: true });
  root = document.createElement('div');
  document.body.append(root);
});
afterEach(() => {
  render(null, root);
  root.remove();
});

describe('one form for take profits and stops', () => {
  it('opens on Sell with nothing set: the slider at 0% and the button waiting for a level', async () => {
    await show();
    expect($('.tw-modes [aria-selected=true]')!.textContent).toMatch(/^Sell/);
    expect(level().value).toBe('');
    expect(level().placeholder).toBe('719K');
    expect($('.tw-trig-now')!.textContent).toBe('now $719K');
    expect(slider().value).toBe('0');
    expect(say()).toBe('Type a market cap or drag: up to take profit, down for a stop.');
    expect(armBtn().disabled).toBe(true);
    expect(armBtn().textContent).toBe('Set a level above or below now');
    expect($('.tw-box-r')!.textContent).toBe('50% ≈ $35.95'); // half the $71.90 bag
  });

  it('"sell 10% at 700k" below the market is a stop: it arms a plan with that partial stop', async () => {
    await show();
    await click(amount('10%'));
    await typeInto(level(), '700k');
    expect(say()).toBe('Sell 10% of $HIGGS if it drops 2.6% to $700K MC');
    expect(armBtn().textContent).toBe('Add stop loss · 10% at $700K MC');
    expect(armBtn().classList.contains('is-down')).toBe(true);
    expect($('.tw-trig')!.classList.contains('is-down')).toBe(true);
    expect(warns()).toEqual([]);
    await click(armBtn());
    expect(armed()).toHaveLength(1);
    expect(armed()[0]).toMatchObject({ key: higgs.key, tps: [], stops: [{ trigger: { kind: 'mc', value: 700_000 }, sellPct: 10 }], sl: null, trailing: null, balance: 100_000 });
    expect(armed()[0].entry).toEqual({ priceUSD: 0.000719, mc: 719_000, source: 'armed-at' });
    await flush();
    expect(say()).toBe('Done! Tippy will sell 10% of $HIGGS if it drops to $700K MC.');
    expect(level().value).toBe(''); // ready for the next order
  });

  it('above the market the same form is a take profit', async () => {
    await show();
    await typeInto(level(), '790K');
    expect(say()).toBe('Sell 50% of $HIGGS if it rises 9.9% to $790K MC');
    expect(armBtn().textContent).toBe('Add take profit · 50% at $790K MC');
    expect(armBtn().classList.contains('is-up')).toBe(true);
    await click(armBtn());
    expect(armed()[0]).toMatchObject({ tps: [{ trigger: { kind: 'mc', value: 790_000 }, sellPct: 50 }], sl: null });
    expect(armed()[0].stops).toBeUndefined();
  });

  it('100% below the market is the stop loss that sells the rest', async () => {
    await show();
    await click(amount('100%'));
    await typeInto(level(), '620k');
    expect(say()).toBe('Sell the rest of $HIGGS if it drops 13.8% to $620K MC');
    expect(armBtn().textContent).toBe('Add stop loss · 100% at $620K MC');
    expect($('.tw-box-r')!.textContent).toBe('all ≈ $71.90');
    await click(armBtn());
    expect(armed()[0]).toMatchObject({ tps: [], sl: { trigger: { kind: 'mc', value: 620_000 } } });
    expect(armed()[0].stops).toBeUndefined();
  });

  it('at the market (0%) the button waits, with a hint', async () => {
    await show();
    await typeInto(level(), '719k');
    expect(say()).toBe("That's where it is now — drag up for a take profit, or down for a stop.");
    expect(armBtn().disabled).toBe(true);
    await slide(0);
    expect(level().value).toBe('');
    expect(armBtn().textContent).toBe('Set a level above or below now');
  });

  it('a custom % from ✎ other', async () => {
    await show();
    await typeInto($<HTMLInputElement>('.tw-amt-custom input')!, '33');
    await act(async () => {
      $<HTMLFormElement>('.tw-amt-custom')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
    await typeInto(level(), '1m');
    expect(armBtn().textContent).toBe('Add take profit · 33% at $1M MC');
    expect($('.tw-amt-custom')!.classList.contains('on')).toBe(true);
    await typeInto($<HTMLInputElement>('.tw-amt-custom input')!, '140');
    await blur($<HTMLInputElement>('.tw-amt-custom input')!);
    expect(warns()).toEqual(['Type how much of your bag to sell, from 1 to 100%.']);
  });
});

describe('the level box, the slider and the % box stay in step', () => {
  beforeEach(() => show());

  it('dragging the slider sets the market cap and the %', async () => {
    await slide(-10);
    expect(level().value).toBe('647.1K');
    expect(pctBox().value).toBe('-10');
    expect(armBtn().textContent).toBe('Add stop loss · 50% at $647K MC');
    await slide(25);
    expect(level().value).toBe('898.8K');
    expect(pctBox().value).toBe('+25');
    expect(armBtn().textContent).toBe('Add take profit · 50% at $899K MC');
  });

  it('typing a market cap moves the slider and the %; "1.2m", "$2,500,000" and "650k" all read', async () => {
    await typeInto(level(), '1.2m');
    expect(pctBox().value).toBe('+66.9');
    expect(slider().value).toBe('67');
    await typeInto(level(), '$2,500,000');
    expect(pctBox().value).toBe('+248');
    expect(slider().value).toBe('100'); // the slider stops at +100%
    await typeInto(level(), '650k');
    expect(pctBox().value).toBe('-9.6');
    expect(slider().value).toBe('-10');
    await blur(level());
    expect(level().value).toBe('650K');
    await click(armBtn());
    expect(armed()[0].stops).toEqual([{ trigger: { kind: 'mc', value: 650_000 }, sellPct: 50 }]);
  });

  it('typing a % sets the market cap — past +100% too (+400% = 5x)', async () => {
    await typeInto(pctBox(), '+400');
    expect(level().value).toBe('3.6M');
    expect(slider().value).toBe('100');
    expect(say()).toBe('Sell 50% of $HIGGS if it rises 400% to $3.6M MC');
    await typeInto(pctBox(), '-2.6');
    expect(level().value).toBe('700.3K');
    expect(slider().value).toBe('-3');
    await typeInto(pctBox(), '−20'); // a real minus sign
    expect(level().value).toBe('575.2K');
    await click(armBtn());
    expect(armed()[0].stops![0].trigger.kind).toBe('mc');
    expect(armed()[0].stops![0].trigger.value).toBeCloseTo(575_200);
  });

  it("something it can't read holds the button back", async () => {
    await typeInto(level(), 'lots');
    expect($('.tw-trig-row')!.classList.contains('bad')).toBe(true);
    expect(armBtn().disabled).toBe(true);
    await blur(level());
    expect(level().value).toBe('lots'); // left as typed, so you can fix it
    await typeInto(pctBox(), '-');
    expect(armBtn().disabled).toBe(true);
  });
});

describe('market cap ⇄ price', () => {
  it('⇄ shows the same level as a price, and a typed price is armed as one', async () => {
    await show();
    await typeInto(level(), '700k');
    await click(btn(/^MC/, $('.tw-trig')!));
    expect(btn(/^Price/, $('.tw-trig')!)).toBeDefined();
    expect(level().value).toBe('0.0007');
    expect($('.tw-trig-now')!.textContent).toBe('now $0.000719');
    expect(pctBox().value).toBe('-2.6'); // same level
    await typeInto(level(), '$0.0008');
    expect(armBtn().textContent).toBe('Add take profit · 50% at $0.0008');
    await click(armBtn());
    expect(armed()[0].tps).toEqual([{ trigger: { kind: 'price', value: 0.0008 }, sellPct: 50 }]);
  });

  it('no market cap: prices, and no ⇄', async () => {
    await show({ token: { ...bigBag, mc: null } });
    expect($('.tw-flip.off')!.textContent).toBe('Price');
    await slide(-20);
    expect(level().value).toBe('0.0005752');
    await click(armBtn());
    expect(armed()[0].stops![0].trigger.kind).toBe('price');
    expect(armed()[0].stops![0].trigger.value).toBeCloseTo(0.0005752);
  });
});

describe("fomo's minimum sell", () => {
  it('on a $4.98 bag, 10% at $700K is too small — the button says how much would work', async () => {
    await show({ token: higgs });
    await click(amount('10%'));
    await typeInto(level(), '700k');
    // A stop sells at its level, not at today's price.
    expect(warns()).toEqual(["10% of your $4.98 bag is $0.48 at $700K MC — fomo's minimum sell is $2. Pick at least 44% (a stop can fill a bit lower)."]);
    expect(armBtn().disabled).toBe(true);
    await click(armBtn());
    expect(armed()).toHaveLength(0);
    await click(amount('50%'));
    expect(warns()).toEqual([]);
    expect(armBtn().disabled).toBe(false);
  });

  it('a stop only just over the minimum at its level is still too small: it can fill a bit lower', async () => {
    // 42% of the $4.98 bag is $2.04 at $700K — over $2, but a stop that fills 2% lower would be skipped.
    await show({ token: higgs });
    await customPct('42');
    await typeInto(level(), '700k');
    expect(warns()).toEqual(["42% of your $4.98 bag is $2.04 at $700K MC — only just over fomo's $2 minimum sell, and a stop can fill a bit lower. Pick at least 44%."]);
    expect(armBtn().disabled).toBe(true);
    await click(armBtn());
    expect(armed()).toHaveLength(0);
    await customPct('43');
    expect(warns()).toEqual(["43% of your $4.98 bag is $2.08 at $700K MC — only just over fomo's $2 minimum sell, and a stop can fill a bit lower. Pick at least 44%."]);
    expect(armBtn().disabled).toBe(true);
    // The % the tip names is enough.
    await customPct('44');
    expect(warns()).toEqual([]);
    expect(armBtn().disabled).toBe(false);
    await click(armBtn());
    expect(armed()[0].stops).toEqual([{ trigger: { kind: 'mc', value: 700_000 }, sellPct: 44 }]);
  });

  it('a take profit needs no room: 42% at today’s price clears the minimum', async () => {
    await show({ token: higgs });
    await customPct('42');
    await typeInto(level(), '1m');
    expect(warns()).toEqual([]);
    expect(armBtn().disabled).toBe(false);
  });

  it('the warning and its "Pick at least N%" always agree: N% goes through, N−1% doesn’t', async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 2_000, max: 60_000 }), fc.constantFrom('700k', '650k', '500k', '300k'), async (balance, lvl) => {
        render(null, root);
        await show({ token: { ...higgs, balance } });
        await click(amount('10%'));
        await typeInto(level(), lvl);
        const w = warns()[0];
        if (!w) return; // 10% is already enough
        const need = w.match(/Pick at least (\d+)%/)?.[1];
        if (!need) {
          expect(w).toMatch(/Only selling all of it would work there\.|couldn't sell it\./);
          return;
        }
        await customPct(need);
        expect(warns()).toEqual([]);
        expect(armBtn().disabled).toBe(false);
        await customPct(String(+need - 1));
        expect(warns()).toHaveLength(1);
        expect(warns()[0]).toContain(`Pick at least ${need}%`);
        expect(armBtn().disabled).toBe(true);
      }),
      { numRuns: 40 },
    );
  });

  it('a take profit is checked at today’s price', async () => {
    await show({ token: higgs });
    await click(amount('25%'));
    await typeInto(level(), '1m');
    expect(warns()).toEqual(["25% of your $4.98 bag is $1.25 — fomo's minimum sell is $2. Pick at least 41%."]);
  });

  it('a whole bag under the minimum can’t be sold at all', async () => {
    await show({ token: { ...higgs, balance: 1500 }, minSellUsd: 2 }); // $1.08
    await click(amount('100%'));
    await typeInto(level(), '600k');
    expect(warns()).toEqual(["Your $1.08 bag would be $0.90 at $600K MC — below fomo's $2 minimum sell, so Tippy couldn't sell it."]);
    expect(armBtn().disabled).toBe(true);
  });

  it("not holding the coin points to a limit buy", async () => {
    await show({ token: { ...higgs, balance: 0 } });
    await click(btn(/^Sell/, $('.tw-modes')!));
    expect(warns()).toEqual(["You don't hold $HIGGS yet — set a limit buy and I'll guard what I buy."]);
    await click(btn('Set a limit buy instead →'));
    expect($('.tw-modes [aria-selected=true]')!.textContent).toMatch(/^Buy/);
  });
});

describe('a partial stop under the stop loss never fires', () => {
  // livePlan(): the stop loss sells the rest at $620K MC; $HIGGS is at $719K.
  it('a partial stop at or under the stop loss gets a heads-up — but the button still works', async () => {
    await show({ plan: livePlan() });
    await click(amount('10%'));
    await typeInto(level(), '600k');
    expect(headsUp()).toBe('Heads up: your stop loss at $620K MC is higher, so it would sell everything first.');
    expect(warns()).toEqual(['Heads up: your stop loss at $620K MC is higher, so it would sell everything first.']);
    expect(armBtn().disabled).toBe(false);
    // Right at the stop loss: it still sells everything first.
    await typeInto(level(), '620k');
    expect(headsUp()).toBe('Heads up: your stop loss at $620K MC is higher, so it would sell everything first.');
    // Above it: fine.
    await typeInto(level(), '650k');
    expect(headsUp()).toBeNull();
    expect(warns()).toEqual([]);
    // Not a block: it can still be added.
    await typeInto(level(), '600k');
    await click(armBtn());
    expect(edits()[0].stops).toEqual([{ id: null, trigger: { kind: 'mc', value: 600_000 }, sellPct: 10 }]);
    await flush();
    expect(headsUp()).toBeNull();
  });

  it('in price, the heads-up names the stop loss as a price', async () => {
    await show({ plan: livePlan() });
    await click(amount('10%'));
    await click(byLabel(/^Switch to price/));
    await typeInto(level(), '0.0006');
    expect(headsUp()).toBe('Heads up: your stop loss at $0.00062 is higher, so it would sell everything first.');
  });

  it('the mirror: a stop loss at or over partial stops says those would never fire', async () => {
    const plan = livePlan({
      stops: [
        { trigger: { kind: 'mc', value: 700_000 }, sellPct: 10 },
        { trigger: { kind: 'mc', value: 650_000 }, sellPct: 25 },
      ],
      sl: { trigger: { kind: 'mc', value: 600_000 } },
    });
    await show({ plan });
    await click(amount('100%'));
    await typeInto(level(), '640k');
    expect(headsUp()).toBeNull();
    await typeInto(level(), '650k');
    expect(headsUp()).toBe('Heads up: your 25% stop at $650K MC is lower, so it would never fire — the stop loss sells everything first.');
    await typeInto(level(), '710k');
    expect(headsUp()).toBe('Heads up: your stops at $700K MC and $650K MC are lower, so they would never fire — the stop loss sells everything first.');
    expect(armBtn().disabled).toBe(false);
    await click(armBtn());
    expect(notice()).toBe('Move your stop loss from $600K to $710K MC?');
  });

  it('only waiting stops count: a sold one is left out', async () => {
    const plan = livePlan({
      stops: [
        { trigger: { kind: 'mc', value: 700_000 }, sellPct: 10 },
        { trigger: { kind: 'mc', value: 650_000 }, sellPct: 25 },
      ],
      sl: { trigger: { kind: 'mc', value: 600_000 } },
    });
    plan.stops[1].status = 'filled';
    await show({ plan });
    await click(amount('100%'));
    await typeInto(level(), '710k');
    expect(headsUp()).toBe('Heads up: your 10% stop at $700K MC is lower, so it would never fire — the stop loss sells everything first.');
  });

  it('✎ a partial stop that sits under the stop loss shows the heads-up; moving it above clears it', async () => {
    await show({ plan: livePlan({ stops: [{ trigger: { kind: 'mc', value: 600_000 }, sellPct: 10 }] }) });
    await click(byLabel(/^Change stop \$600K/i));
    expect(headsUp()).toBe('Heads up: your stop loss at $620K MC is higher, so it would sell everything first.');
    await typeInto(level(), '660k');
    expect(headsUp()).toBeNull();
  });

  it('✎ the stop loss into a partial stop: the stop loss goes, so there is nothing to warn about', async () => {
    await show({ plan: livePlan() });
    await click(byLabel(/^Change stop loss/));
    await click(amount('25%'));
    expect(armBtn().textContent).toBe('Save stop loss · 25% at $620K MC');
    expect(headsUp()).toBeNull();
  });

  it('a new plan has no stop loss yet: no heads-up', async () => {
    await show();
    await click(amount('10%'));
    await typeInto(level(), '600k');
    expect(headsUp()).toBeNull();
  });
});

describe('Your orders', () => {
  it('every order in one row style, highest first, with a "now" line between take profits and stops', async () => {
    const plan = livePlan({
      tps: [
        { trigger: { kind: 'mc', value: 1_000_000 }, sellPct: 50 },
        { trigger: { kind: 'mc', value: 790_000 }, sellPct: 25 },
      ],
      stops: [{ trigger: { kind: 'mc', value: 700_000 }, sellPct: 10 }],
      trailing: { trailPct: 25, activateX: 2 },
    });
    await show({ plan });
    expect(rows()).toEqual([
      '▲ $1M MC +39.1% · sell 50%',
      '▲ $790K MC +9.9% · sell 25%',
      'now $719K',
      '▼ $700K MC −2.6% · sell 10%',
      '▼ $620K MC −13.8% · sell the rest',
      '▼ trailing 25% from the top · sell the rest · starts at 2x',
    ]);
    expect($('.tw-modes .tw-mode-sell .tw-count')!.textContent).toBe('5');
    // ▲ mint, ▼ red
    expect($('.tw-list .tw-row')!.classList.contains('is-up')).toBe(true);
    expect([...root.querySelectorAll('.tw-list .tw-row')].at(-1)!.classList.contains('is-down')).toBe(true);
  });

  it('done and in-flight orders get a status chip and no ✎ / ×', async () => {
    const plan = livePlan({ stops: [{ trigger: { kind: 'mc', value: 700_000 }, sellPct: 10 }] });
    plan.tps[0].status = 'filled';
    plan.stops[0].status = 'cancelled';
    await show({ plan });
    expect(rows()).toEqual(['▲ $1M MC +39.1% · sell 50% sold ✓', 'now $719K', '▼ $700K MC −2.6% · sell 10% skipped', '▼ $620K MC −13.8% · sell the rest']);
    expect(byLabel(/^Change take-profit/)).toBeUndefined();
    expect(byLabel(/^Remove stop \$700K/)).toBeUndefined();
    expect(byLabel(/^Remove stop loss/)).toBeDefined();
  });

  it('a plan saved before partial stops existed (no `stops` list) still shows and takes a stop', async () => {
    const plan = livePlan() as Partial<Plan>;
    delete plan.stops;
    await show({ plan: plan as Plan });
    expect(rows()).toEqual(['▲ $1M MC +39.1% · sell 50%', 'now $719K', '▼ $620K MC −13.8% · sell the rest']);
    await click(amount('10%'));
    await typeInto(level(), '700k');
    await click(armBtn());
    expect(edits()).toEqual([
      {
        tps: [{ id: 'tp1', trigger: { kind: 'mc', value: 1_000_000 }, sellPct: 50 }],
        stops: [{ id: null, trigger: { kind: 'mc', value: 700_000 }, sellPct: 10 }],
        sl: { trigger: { kind: 'mc', value: 620_000 } },
        trailing: null,
      },
    ]);
  });
});

describe('the trailing stop', () => {
  it('is hidden by default, shown with the setting, and shown when the plan has one', async () => {
    await show();
    expect($('[aria-label="Trailing stop"]')).toBeNull();
    await show({ showTrailing: true });
    expect([...root.querySelectorAll('[aria-label="Trailing stop"] button')].map((b) => b.textContent)).toEqual(['10%', '20%', '30%']);
    await act(async () => render(null, root));
    await show({ plan: livePlan({ trailing: { trailPct: 25, activateX: 2 } }) });
    const chips = [...root.querySelectorAll<HTMLButtonElement>('[aria-label="Trailing stop"] button')];
    expect(chips.map((b) => b.textContent)).toEqual(['10%', '20%', '25%', '30%']);
    expect(chips.find((b) => b.getAttribute('aria-pressed') === 'true')!.textContent).toBe('25%');
  });

  it('a chip asks first, then sets it (keeping when it starts)', async () => {
    await show({ plan: livePlan({ trailing: { trailPct: 25, activateX: 2 } }) });
    await click(btn('20%', $('[aria-label="Trailing stop"]')!));
    expect(notice()).toBe('Change your trailing stop to 20% from the top?');
    expect(called('update')).toHaveLength(0);
    await click(btn('Change'));
    await flush();
    expect(edits()[0].trailing).toEqual({ trailPct: 20, activateX: 2 });
    expect(notice()).toBeNull();
  });

  it('with no plan yet, adding one arms a plan with just the trailing stop', async () => {
    await show({ showTrailing: true });
    await click(btn('10%', $('[aria-label="Trailing stop"]')!));
    expect(notice()).toBe('Add a 10% trailing stop on $HIGGS? It sells the rest if it falls 10% from its top.');
    await click(btn('Add'));
    expect(armed()[0]).toMatchObject({ tps: [], sl: null, trailing: { trailPct: 10, activateX: null } });
  });
});

describe('quick presets', () => {
  it('P2 asks in the notice bar, then arms its orders as market caps from now', async () => {
    await show();
    expect([...root.querySelectorAll('.tw-quick button')].map((b) => b.textContent)).toEqual(['P1 Play it safe', 'P2 Classic', 'P3 Moon bag']);
    await click(btn(/^P2/, $('.tw-quick')!));
    expect(notice()).toBe('Add P2 Classic: 2x 50% · 5x 25% · SL −30%?');
    expect(armed()).toHaveLength(0);
    await click(btn('Add'));
    await flush();
    expect(armed()[0]).toMatchObject({
      tps: [
        { trigger: { kind: 'mc', value: 1_440_000 }, sellPct: 50 },
        { trigger: { kind: 'mc', value: 3_600_000 }, sellPct: 25 },
      ],
      sl: { trigger: { kind: 'mc', value: 500_000 } },
      trailing: null,
    });
    expect(say()).toBe('Done! P2 Classic is set on $HIGGS.');
  });

  it('Cancel leaves everything as it was; on a running plan the preset replaces the open orders', async () => {
    await show();
    await click(btn(/^P1/, $('.tw-quick')!));
    await click(btn('Cancel'));
    expect(notice()).toBeNull();
    expect(calls).toEqual([]);

    await show({ plan: livePlan() });
    await click(btn(/^P1/, $('.tw-quick')!));
    expect(notice()).toBe('Use P1 Play it safe on $HIGGS from now: 2x 100% · SL −20%? It replaces your open orders.');
    await click(btn('Use'));
    expect(edits()[0]).toEqual({ tps: [{ id: null, trigger: { kind: 'mc', value: 1_440_000 }, sellPct: 100 }], stops: [], sl: { trigger: { kind: 'mc', value: 580_000 } }, trailing: null }); // −20% of $719K, the way traders say it
  });
});

describe('keeping the computer awake (orders only fire while it is on)', () => {
  const toggles = (stayAwake: boolean) => ({ autoGuard: false, dryRun: false, alerts: false, stayAwake });
  let toggled: [string, boolean][] = [];
  const onToggle = (name: string, v: boolean) => void toggled.push([name, v]);
  beforeEach(() => {
    toggled = [];
  });

  it('shows ☀ while it keeps the computer awake; tapping it lets it sleep', async () => {
    await show({ plan: livePlan(), toggles: toggles(true), onToggle });
    expect($('.tw-awake-off')).toBeNull();
    await click(btn('☀'));
    expect(toggled).toEqual([['stayAwake', false]]);
  });

  it('with orders on and keep-awake off, it says orders can’t fire and offers one tap to fix it', async () => {
    await show({ plan: livePlan(), toggles: toggles(false), onToggle });
    expect($('.tw-awake-off')!.textContent).toContain("your orders can't fire while it's off");
    await click(btn('Keep it awake'));
    expect(toggled).toEqual([['stayAwake', true]]);
  });

  it('no orders, no warning', async () => {
    await show({ plan: null, toggles: toggles(false), onToggle });
    expect($('.tw-awake-off')).toBeNull();
    expect(btn('💤')).toBeTruthy();
  });
});

describe('typing a level key by key', () => {
  it('keeps half-typed decimals like "2." while you type "2.5m" (it used to wipe the box)', async () => {
    await show();
    let typed = '';
    for (const ch of '2.5m') {
      typed += ch;
      await typeInto(level(), typed);
      expect(level().value).toBe(typed);
    }
    await click(btn(/^Add take profit/));
    expect(armed()[0].tps[0].trigger).toEqual({ kind: 'mc', value: 2_500_000 });
  });

  it('a tiny price typed key by key survives too: "0.0004"', async () => {
    await show();
    await click(byLabel(/^Switch to price|^Show price|price/i));
    let typed = '';
    for (const ch of '0.0004') {
      typed += ch;
      await typeInto(level(), typed);
      expect(level().value).toBe(typed);
    }
  });
});
