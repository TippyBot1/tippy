// @vitest-environment happy-dom
// Tippy's window, Buy tab: the same order form as the Sell tab — an amount ($
// chips + ✎ other), an exact market cap (or ⇄ price) with the % slider, one
// plain sentence and one big green button — then "Protect with" and "Expires".
// It arms exactly the order the trader picked; cash is checked (warn, not
// block), fomo's minimum is enforced, orders are listed in the same row style
// as sell orders and can be cancelled or resolved (never cancelled once Tippy
// may have bought), a running guard on the coin covers the new coins, and 🧪
// practice runs report back. Also the popup's list of orders.
import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { applyBuyOutcome, buildBuy, markBuyExecuting } from '../src/engine/buys';
import { buildPlan, pausePlan } from '../src/engine/orders';
import type { BuyInput, BuyOrder, Plan, PlanInput } from '../src/engine/types';
import type { CommandResult, PracticeResult } from '../src/shared/messages';
import { DEFAULT_PRESETS } from '../src/shared/settings';
import { PlanList } from '../src/ui/PlanList';
import { TippyWindow, type WindowApi, type WindowToken } from '../src/ui/TippyWindow';

const token: WindowToken = {
  key: 'Mint111:1399811149',
  address: 'Mint111',
  networkId: 1399811149,
  chainName: 'Solana',
  symbol: 'TST',
  name: 'Test',
  priceUSD: 0.002,
  mc: 2_000_000,
  balance: 0, // not held
};
const DAY = 24 * 3_600_000;

let root: HTMLElement;
let calls: { fn: string; args: unknown[] }[];
let practiceResult: CommandResult;

const ok = async (): Promise<CommandResult> => ({ ok: true });
const rec =
  (fn: string, res: () => CommandResult = () => ({ ok: true })) =>
  async (...args: unknown[]) => (calls.push({ fn, args }), res());
const api: WindowApi = {
  arm: rec('arm'),
  pause: ok,
  resume: ok,
  cancel: ok,
  resolveHeld: ok,
  retry: ok,
  update: ok,
  armBuy: rec('armBuy'),
  cancelBuy: rec('cancelBuy'),
  resolveBuy: rec('resolveBuy'),
  practice: rec('practice', () => practiceResult),
};
const called = (fn: string) => calls.filter((c) => c.fn === fn).map((c) => c.args);

const $ = <T extends Element = HTMLElement>(sel: string) => root.querySelector<T>(sel);
const btn = (text: string | RegExp, scope: ParentNode = root) =>
  [...scope.querySelectorAll<HTMLButtonElement>('button')].find((b) => (typeof text === 'string' ? b.textContent!.trim() === text : text.test(b.textContent!)))!;
const byLabel = (label: RegExp) => [...root.querySelectorAll<HTMLElement>('[aria-label]')].find((e) => label.test(e.getAttribute('aria-label')!))!;
const modeTab = (name: 'Buy' | 'Sell') => btn(new RegExp(`^${name}`), $('.tw-modes')!);
const selectedMode = () => $('.tw-modes [aria-selected=true]')!.textContent!.replace(/\d+$/, '').trim();
const placeBtn = () => $<HTMLButtonElement>('.tw-arm')!;
const level = () => $<HTMLInputElement>('.tw-trig-in')!;
const say = () => $('.tw-sum')!.textContent;
const warns = () => [...root.querySelectorAll('.tw-body > .tw-warn-line')].map((e) => e.textContent);
const usd = (label: string) => btn(label, $('[aria-label="Buy amount"]')!);
const customBox = () => $<HTMLInputElement>('.tw-amt-custom input')!;
const guardRow = () => $('[aria-label="Protect the new coins with"]');
/** "▼ $1.6M MC −20% · buy $10 · 24h left [status]" — each buy row's text (its × left out). */
const buyRows = () =>
  [...root.querySelectorAll('.tw-buys > .tw-row')].map((r) =>
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
async function slide(v: number) {
  const s = $<HTMLInputElement>('.tw-slider input')!;
  await act(async () => {
    s.value = String(v);
    s.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
/** Let pending command promises settle and re-render. */
async function flush() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
}
async function submit(form: HTMLFormElement) {
  await act(async () => {
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });
}
/** Type a custom dollar amount and press Enter. */
async function customUsd(text: string) {
  await typeInto(customBox(), text);
  await submit($<HTMLFormElement>('.tw-amt-custom')!);
}

type Props = Parameters<typeof TippyWindow>[0];
async function show(over: Partial<Props> = {}) {
  await act(async () => {
    render(h(TippyWindow, { token, plan: null, buys: [], cash: 30, minBuyUsd: 2, practice: null, presets: DEFAULT_PRESETS, defaultPresetId: 'safe', api, intro: false, ...over }), root);
  });
}

function order(over: Partial<BuyInput> = {}, now = Date.now()): BuyOrder {
  return buildBuy({
    id: 'b1',
    key: token.key,
    networkId: token.networkId,
    address: token.address,
    symbol: 'TST',
    name: 'Test',
    trigger: { kind: 'mc', value: 1_600_000 },
    ref: { priceUSD: 0.002, mc: 2_000_000, source: 'armed-at' },
    usd: 10,
    guardPresetId: 'classic',
    expiresInMs: DAY,
    now,
    ...over,
  });
}

/** Tippy pressed Buy at `at` and the coins haven't shown up. */
function unsureOrder(at = 3, over: Partial<BuyInput> = {}): BuyOrder {
  return applyBuyOutcome(markBuyExecuting({ ...order(over, at), state: 'queued' }, at), { status: 'unknown' }, at);
}

/** A running TP / SL plan on this coin. */
function guardPlan(over: Partial<PlanInput> = {}): Plan {
  return buildPlan({
    id: 'p1',
    key: token.key,
    networkId: token.networkId,
    address: token.address,
    symbol: 'TST',
    name: 'Test',
    entry: { priceUSD: 0.002, mc: 2_000_000, source: 'armed-at' },
    balance: 1000,
    tps: [{ trigger: { kind: 'x', value: 3 }, sellPct: 50 }],
    sl: { trigger: { kind: 'x', value: 0.75 } },
    trailing: null,
    origin: 'manual',
    now: 1,
    ...over,
  });
}

beforeEach(async () => {
  calls = [];
  practiceResult = { ok: true };
  api.practice = rec('practice', () => practiceResult);
  root = document.createElement('div');
  document.body.append(root);
  await show();
});
afterEach(() => {
  render(null, root);
  root.remove();
});

describe('Buy tab', () => {
  it('opens on Buy for a coin you don’t hold — the −20% dip as a market cap — and on Sell for one you do', async () => {
    expect(selectedMode()).toBe('Buy');
    expect(level().value).toBe('1.6M');
    expect($('.tw-means')!.textContent).toBe('−20% from now');
    expect(usd('$10').getAttribute('aria-pressed')).toBe('true');
    expect(say()).toBe('Buy $10 of $TST if it drops 20% to $1.6M MC');
    expect(placeBtn().textContent).toBe('Place limit buy · $10 at $1.6M MC');
    expect(placeBtn().classList.contains('is-buy')).toBe(true);

    await act(async () => render(null, root));
    await show({ token: { ...token, balance: 1000 } });
    expect(selectedMode()).toBe('Sell');
  });

  it('the slider + $25 + P2 + 24h arms exactly that order', async () => {
    await slide(-30);
    await click(usd('$25'));
    await click(btn('P2', guardRow()!));
    await click(btn('1h'));
    await click(btn('24h'));
    expect($('.tw-sub')!.textContent).toBe('⭐ Classic: 2x 50% · 5x 25% · SL −30%');
    expect(placeBtn().textContent).toBe('Place limit buy · $25 at $1.4M MC');

    await click(placeBtn());
    expect(called('armBuy')).toHaveLength(1);
    const input = called('armBuy')[0][0] as Omit<BuyInput, 'id' | 'now'>;
    expect(input).toMatchObject({
      key: token.key,
      networkId: token.networkId,
      address: 'Mint111',
      symbol: 'TST',
      name: 'Test',
      ref: { priceUSD: 0.002, mc: 2_000_000, source: 'armed-at' },
      usd: 25,
      guardPresetId: 'classic',
      expiresInMs: DAY,
    });
    expect(input.trigger.kind).toBe('mc');
    expect(input.trigger.value).toBeCloseTo(1_400_000);
    await flush();
    expect(say()).toBe("Done! I'm watching $TST — $25 at $1.4M MC, then Classic.");
  });

  it('None protects nothing, Never never expires, and a custom amount is used on Enter', async () => {
    await click(btn('None', guardRow()!));
    await click(btn('Never'));
    await customUsd('12.5');
    expect(placeBtn().textContent).toBe('Place limit buy · $12.50 at $1.6M MC');
    expect($('.tw-sub')!.textContent).toBe("Tippy won't set a take profit or stop loss on these coins.");
    await click(placeBtn());
    expect(called('armBuy')[0][0]).toMatchObject({ usd: 12.5, guardPresetId: null, expiresInMs: null, trigger: { kind: 'mc', value: 1_600_000 } });
  });

  it('an exact market cap typed in the box is what gets armed', async () => {
    await typeInto(level(), '1.5M');
    expect($('.tw-means')!.textContent).toBe('−25% from now');
    expect(placeBtn().textContent).toBe('Place limit buy · $10 at $1.5M MC');
    await click(placeBtn());
    expect(called('armBuy')[0][0]).toMatchObject({ trigger: { kind: 'mc', value: 1_500_000 } });
  });

  it('expiry is one small chip row; the fine print is behind ⓘ', async () => {
    const expiry = $('[aria-label="Expires after"]')!;
    expect([...expiry.querySelectorAll('button')].map((b) => b.textContent)).toEqual(['1h', '24h', '7d', 'Never']);
    expect($('.tw-info')!.title).toMatch(/won't chase a pump or catch a falling knife/);
    expect(root.textContent).not.toMatch(/catch a falling knife/);
    expect([...guardRow()!.querySelectorAll('button')].map((b) => b.textContent)).toEqual(['None', 'P1', 'P2', 'P3']);
  });

  it('warns — but still lets you place — when the amount is more than your cash', async () => {
    expect($('.tw-cash')!.textContent).toBe('Cash $30.00');
    expect(warns()).toEqual([]);
    await click(usd('$50'));
    expect(warns()).toEqual(["You have $30.00 cash on fomo — top up, or Tippy can't buy $50 when it hits."]);
    expect($('.tw-cash')!.classList.contains('warn')).toBe(true);
    expect(placeBtn().disabled).toBe(false);
    await click(placeBtn());
    expect(called('armBuy')).toHaveLength(1);
  });

  it("won't place a buy below fomo's minimum", async () => {
    await act(async () => render(null, root));
    await show({ minBuyUsd: 5 });
    await customUsd('3');
    expect(warns()).toEqual(["fomo's minimum buy here is $5.00."]);
    expect(placeBtn().disabled).toBe(true);
    await click(placeBtn());
    expect(called('armBuy')).toHaveLength(0);
  });

  it('a decimal comma in the amount means cents, not thousands', async () => {
    await customUsd('2,50');
    expect(placeBtn().textContent).toBe('Place limit buy · $2.50 at $1.6M MC');

    // Neither thousands nor cents: ask instead of guessing.
    await customUsd('1.000,50');
    expect(warns()).toEqual(["I'm not sure what that comma means — use a dot for cents, like 2.50."]);
    expect(placeBtn().textContent).toBe('Place limit buy · $2.50 at $1.6M MC');

    await customUsd('1,000');
    await click(placeBtn());
    expect(called('armBuy')[0][0]).toMatchObject({ usd: 1000 });
  });

  it("lists this coin's orders in the sell orders' row style; × cancels a live one", async () => {
    const live = order();
    const done = applyBuyOutcome(markBuyExecuting({ ...order({ id: 'b2', usd: 25 }), state: 'queued' }, 2), { status: 'filled', got: 1, price: 0.002 }, 3);
    await show({ buys: [done, live, { ...order({ id: 'other' }), key: 'Other:1' }] });
    const rows = buyRows();
    expect(rows).toHaveLength(2); // the other coin's order isn't here
    expect(rows[0]).toBe('▼ $1.6M MC −20% · buy $10 · 24h left');
    expect(rows[1]).toMatch(/^▼ \$1\.6M MC −20% · buy \$25 · \d+[mhd] ago bought ✓$/);
    expect($('.tw-buys .tw-row')!.classList.contains('is-buy')).toBe(true);
    expect(modeTab('Buy').textContent).toBe('Buy1');

    await click(byLabel(/^Cancel buy \$10 at \$1\.6M MC/));
    expect(called('cancelBuy')).toEqual([['b1']]);
  });

  it('a % order shows the market cap it means', async () => {
    await show({ buys: [order({ trigger: { kind: 'x', value: 0.7 } })] });
    expect(buyRows()).toEqual(['▼ $1.4M MC −30% · buy $10 · 24h left']);
  });

  it('an order Tippy isn’t sure about asks: It bought / It didn’t buy — and can’t be cancelled', async () => {
    await show({ buys: [unsureOrder()] });
    expect($('.tw-attn')!.textContent).toMatch(/Tippy pressed Buy for \$10\.00 of \$TST/);
    expect(root.querySelector('.tw-buys .tw-status')!.textContent).toBe('needs you');
    // × would drop the take-profit / stop loss if the coins land later.
    expect(byLabel(/^Cancel buy/)).toBeUndefined();
    expect(btn(/Try again/)).toBeUndefined();
    expect($('.tw-resolve-hint')).toBeNull(); // pressed long ago: no wait
    await click(btn('It bought'));
    await click(btn("It didn't buy"));
    expect(called('resolveBuy')).toEqual([
      ['b1', true],
      ['b1', false],
    ]);
    expect(called('cancelBuy')).toEqual([]);
  });

  it('“It didn’t buy” waits two minutes after Tippy pressed Buy (fomo can be slow to show coins), with a live countdown', async () => {
    vi.useFakeTimers({ now: 1_800_000_000_000, toFake: ['Date', 'setInterval', 'clearInterval'] });
    try {
      await show({ buys: [unsureOrder(Date.now() - 40_000)] });
      const didnt = () => btn(/^It didn't buy/);
      expect(didnt().disabled).toBe(true);
      expect(didnt().textContent).toBe("It didn't buy (wait 1:20)");
      expect($('.tw-resolve-hint')!.textContent).toBe('fomo can take a minute or two to show new coins');
      expect(btn('It bought').disabled).toBe(false); // always available

      await act(async () => {
        vi.advanceTimersByTime(30_000);
      });
      expect(didnt().textContent).toBe("It didn't buy (wait 0:50)");
      await click(didnt());
      expect(called('resolveBuy')).toEqual([]);

      await act(async () => {
        vi.advanceTimersByTime(50_000);
      });
      expect(didnt().disabled).toBe(false);
      expect(didnt().textContent).toBe("It didn't buy");
      expect($('.tw-resolve-hint')).toBeNull();
      await click(didnt());
      expect(called('resolveBuy')).toEqual([['b1', false]]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('a failed order keeps ↻ Try again', async () => {
    const failed = applyBuyOutcome(markBuyExecuting({ ...order(), state: 'queued' }, 2), { status: 'failed', detail: 'fomo said no.', retryable: false }, 3);
    await show({ buys: [failed] });
    expect(btn(/It didn't buy/)).toBeUndefined();
    await click(btn('↻ Try again'));
    expect(called('resolveBuy')).toEqual([['b1', false]]);
  });
});

describe('Limit buy on a coin you already guard or hold', () => {
  it('a running guard covers the new coins: no preset chips, and the default preset still goes along as a fallback', async () => {
    await click(btn('None', guardRow()!)); // picked before the plan existed
    await show({ plan: guardPlan() });
    expect(selectedMode()).toBe('Buy');
    expect(guardRow()).toBeNull();
    expect($('.tw-covered')!.textContent).toBe('🛡 Your current guard on $TST will cover the new coins: 3x 50% · SL −25%');
    expect(warns()).toEqual([]);
    await click(placeBtn());
    expect(called('armBuy')[0][0]).toMatchObject({ guardPresetId: 'safe' });
    await flush();
    expect(say()).toBe("Done! I'm watching $TST — $10 at $1.6M MC, covered by your guard.");
  });

  it('warns when that guard is paused, or has no stop loss', async () => {
    await show({ plan: pausePlan(guardPlan(), 2) });
    expect(warns()).toEqual(["…but it's paused — resume it, or the new coins won't be protected."]);

    await show({ plan: guardPlan({ sl: null }) });
    expect(warns()).toEqual(['…but it has no stop loss.']);

    // A partial stop sells some on the way down, not the rest.
    await show({ plan: guardPlan({ sl: null, stops: [{ trigger: { kind: 'mc', value: 1_500_000 }, sellPct: 50 }] }) });
    expect(warns()).toEqual(['…but it has no stop loss for the rest.']);
    expect($('.tw-covered')!.textContent).toBe('🛡 Your current guard on $TST will cover the new coins: 3x 50% · stop $1.5M mc 50%');

    const stopGone = guardPlan();
    stopGone.sl!.status = 'cancelled';
    await show({ plan: pausePlan(stopGone, 2) });
    expect(warns()).toEqual(["…but it's paused — resume it, or the new coins won't be protected.", '…and it has no stop loss.']);
  });

  it('holding the coin with no guard: the preset covers your whole bag (and says so)', async () => {
    expect($('.tw-guard-note')).toBeNull(); // nothing held
    await act(async () => render(null, root));
    await show({ token: { ...token, balance: 1000 } });
    await click(modeTab('Buy'));
    expect($('.tw-guard-note')!.textContent).toBe('Your current $TST bag is included in the guard.');
    await click(btn('None', guardRow()!));
    expect($('.tw-guard-note')).toBeNull();
  });
});

describe('Popup list', () => {
  const noop = () => {};
  async function list(buys: BuyOrder[], resolved: [string, boolean][] = [], cancelled: string[] = []) {
    await act(async () => {
      render(
        h(PlanList, {
          plans: [],
          buys,
          onPause: noop,
          onResume: noop,
          onCancel: noop,
          onCancelBuy: (id: string) => void cancelled.push(id),
          onResolveBuy: (id: string, bought: boolean) => void resolved.push([id, bought]),
        }),
        root,
      );
    });
  }

  it('an order Tippy isn’t sure about has no ✕ — It bought / It didn’t buy instead', async () => {
    const resolved: [string, boolean][] = [];
    const cancelled: string[] = [];
    await list([unsureOrder(), order({ id: 'b2', symbol: 'TWO' })], resolved, cancelled);
    expect(byLabel(/^Cancel limit buy of \$TST/)).toBeUndefined();
    expect($('.t-meta')!.textContent).toMatch(/Tippy pressed Buy for \$10\.00 of \$TST/);
    await click(btn('It bought'));
    await click(btn("It didn't buy"));
    expect(resolved).toEqual([
      ['b1', true],
      ['b1', false],
    ]);
    // A buy that's just watching can still be cancelled.
    await click(byLabel(/^Cancel limit buy of \$TWO/));
    expect(cancelled).toEqual(['b2']);
  });

  it('“It didn’t buy” waits there too', async () => {
    await list([unsureOrder(Date.now() - 10_000)]);
    expect(btn(/^It didn't buy/).disabled).toBe(true);
    expect(btn(/^It didn't buy/).textContent).toMatch(/^It didn't buy \(wait 1:5\d\)$/);
    expect($('.t-hint')!.textContent).toBe('fomo can take a minute or two to show new coins');
    expect(btn('It bought').disabled).toBe(false);
  });
});

describe('🧪 Practice runs', () => {
  const result = (over: Partial<PracticeResult> = {}): PracticeResult => ({
    key: token.key,
    symbol: 'TST',
    side: 'buy',
    at: Date.now(),
    ok: true,
    stage: 'dry-run',
    detail: 'Stopped right before "Buy TST".',
    ...over,
  });

  it('practises a buy with the chosen amount and shows how it went', async () => {
    let finish!: (r: CommandResult) => void;
    api.practice = async (...args) => (calls.push({ fn: 'practice', args }), new Promise((r) => (finish = r)));
    await click(usd('$25'));
    await click(btn(/Practice a buy/));
    expect(called('practice')).toEqual([[token.key, 'buy', 25]]);
    expect($('.tw-practice-msg')!.textContent).toMatch(/won't press the final button/);
    expect(btn(/Practising/).disabled).toBe(true);

    finish({ ok: true, practice: result({ impactPct: 1.23 }) });
    await flush();
    expect($('.tw-practice-msg')!.textContent).toBe('✅ Practice worked — Stopped right before "Buy TST". (price impact ≈1.2%)');
    await click(byLabel(/^Hide the practice result/)); // one line, closed with ✕
    expect($('.tw-practice-msg')).toBeNull();
  });

  it('shows a problem from the command', async () => {
    practiceResult = { ok: false, error: 'No fomo tab is open.' };
    await click(btn(/Practice a buy/));
    await flush();
    expect($('.tw-practice-msg.warn')!.textContent).toBe('⚠️ Practice hit a snag — No fomo tab is open.');
  });

  it('a run that reports through storage finishes when its result arrives', async () => {
    await click(btn(/Practice a buy/)); // { ok: true } with no result: still running
    await flush();
    expect($('.tw-practice-msg')!.textContent).toMatch(/^Practising…/);
    await show({ practice: result({ ok: false, stage: 'impact-too-high', detail: 'Price impact was 14% — over your 10% limit.', at: Date.now() + 1 }) });
    expect($('.tw-practice-msg.warn')!.textContent).toMatch(/over your 10% limit/);
  });

  it("practising a sell needs coins; it's on the Sell tab", async () => {
    await click(modeTab('Sell'));
    const practise = btn(/Practice a sell/);
    expect(practise.disabled).toBe(true);
    expect(practise.title).toMatch(/You don't hold \$TST/);

    await act(async () => render(null, root));
    await show({ token: { ...token, balance: 1000 } });
    await click(btn(/Practice a sell/));
    expect(called('practice')).toEqual([[token.key, 'sell', undefined]]);
  });
});
