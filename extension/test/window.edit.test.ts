// @vitest-environment happy-dom
// Tippy's window with a running plan: there's no separate "running plan" page.
// The order form stays on top, so you can always add another order; every order
// is a row in "Your orders" (✎ loads it into the form and Save changes it in
// place, × removes it); one compact plan line pauses or stops everything, Retry
// and "sell now?" sit right under the order that needs them, and nothing can be
// changed while a sell is in flight. What happened is in a closed Activity list.
import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildPlan, type PlanEdit, pausePlan } from '../src/engine/orders';
import type { LevelRef, Plan, PlanInput } from '../src/engine/types';
import type { CommandResult } from '../src/shared/messages';
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
const edits = () => called('update').map((a) => a[1] as PlanEdit);

/**
 * Entry at $1M MC (half the market cap now): take profits at 3x ($3M) and
 * $10M, a partial stop at $1.5M and the stop loss at −25% of entry ($750K).
 */
function livePlan(mutate?: (p: Plan) => void, over: Partial<PlanInput> = {}): Plan {
  const plan = buildPlan({
    id: 'p1',
    key: token.key,
    networkId: token.networkId,
    address: token.address,
    symbol: 'TST',
    name: 'Test',
    entry: { priceUSD: 0.001, mc: 1_000_000, source: 'armed-at' },
    balance: 100_000,
    tps: [
      { trigger: { kind: 'x', value: 3 }, sellPct: 50 },
      { trigger: { kind: 'mc', value: 10_000_000 }, sellPct: 25 },
    ],
    stops: [{ trigger: { kind: 'mc', value: 1_500_000 }, sellPct: 10 }],
    sl: { trigger: { kind: 'x', value: 0.75 } },
    trailing: null,
    origin: 'manual',
    now: 1,
    ...over,
  });
  mutate?.(plan);
  return plan;
}

type Props = Parameters<typeof TippyWindow>[0];
async function show(over: Partial<Props> = {}) {
  await act(async () => {
    render(h(TippyWindow, { token, plan: livePlan(), buys: [], cash: 50, minBuyUsd: 2, minSellUsd: 2, presets: DEFAULT_PRESETS, defaultPresetId: 'classic', api, intro: false, ...over }), root);
  });
}

const $ = <T extends Element = HTMLElement>(sel: string) => root.querySelector<T>(sel);
const btn = (text: string | RegExp, scope: ParentNode = root) =>
  [...scope.querySelectorAll<HTMLButtonElement>('button')].find((b) => (typeof text === 'string' ? b.textContent!.trim() === text : text.test(b.textContent!)))!;
const byLabel = <T extends HTMLElement = HTMLButtonElement>(label: string | RegExp) =>
  [...root.querySelectorAll<T>('[aria-label]')].find((e) => (typeof label === 'string' ? e.getAttribute('aria-label') === label : label.test(e.getAttribute('aria-label')!)))!;
const level = () => $<HTMLInputElement>('.tw-trig-in')!;
const armBtn = () => $<HTMLButtonElement>('.tw-arm')!;
const say = () => $('.tw-sum')!.textContent;
const warns = () => [...root.querySelectorAll('.tw-body > .tw-warn-line')].map((e) => e.textContent);
const amount = (pct: string) => btn(pct, $('[aria-label="Sell amount"]')!);
const rows = () =>
  [...root.querySelectorAll('.tw-list > .tw-row, .tw-list > .tw-nowline')].map((r) =>
    [...r.children]
      .filter((c) => c.tagName !== 'BUTTON')
      .map((c) => c.textContent!.trim())
      .filter(Boolean)
      .join(' '),
  );
const notice = () => $('.tw-notice-text')?.textContent ?? null;
const planLine = () => $('.tw-planline-txt')!.textContent;

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
async function flush() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
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

describe('one page, with or without a plan', () => {
  it('the form stays on top of a running plan: its orders are rows, then one plan line — no cards, no ladder, no Edit mode', async () => {
    await show();
    expect($('.tw-modes [aria-selected=true]')!.textContent).toMatch(/^Sell/);
    expect(level()).not.toBeNull();
    expect(armBtn().textContent).toBe('Set a level above or below now');
    expect(rows()).toEqual([
      '▲ $10M MC +400% · sell 25%',
      '▲ $3M MC +50% · sell 50%', // 3x of your $1M entry
      'now $2M',
      '▼ $1.5M MC −25% · sell 10%',
      '▼ $750K MC −62.5% · sell the rest',
    ]);
    expect(planLine()).toBe('Guarding · 2x · +100%');
    expect(btn('❚❚ Pause')).toBeDefined();
    expect(btn('■ Stop all')).toBeDefined();
    expect(btn(/Edit/)).toBeUndefined();
    expect($('.t-ladder')).toBeNull();
  });

  it('another order goes straight onto the running plan, keeping every other order as it is', async () => {
    await show();
    await click(amount('25%'));
    await typeInto(level(), '5m');
    expect(armBtn().textContent).toBe('Add take profit · 25% at $5M MC');
    await click(armBtn());
    expect(called('arm')).toEqual([]);
    expect(called('update').map((a) => a[0])).toEqual(['p1']);
    expect(edits()[0]).toEqual({
      tps: [
        { id: 'tp1', trigger: { kind: 'x', value: 3 }, sellPct: 50 },
        { id: 'tp2', trigger: { kind: 'mc', value: 10_000_000 }, sellPct: 25 },
        { id: null, trigger: { kind: 'mc', value: 5_000_000 }, sellPct: 25 },
      ],
      stops: [{ id: 'st1', trigger: { kind: 'mc', value: 1_500_000 }, sellPct: 10 }],
      sl: { trigger: { kind: 'x', value: 0.75 } },
      trailing: null,
    });
    await flush();
    expect(say()).toBe('Done! Tippy will sell 25% of $TST if it rises to $5M MC.');
  });

  it('a new partial stop on a running plan: below the market with less than 100%', async () => {
    await show();
    await click(amount('10%'));
    await typeInto(level(), '1.2m');
    expect(armBtn().textContent).toBe('Add stop loss · 10% at $1.2M MC');
    await click(armBtn());
    expect(edits()[0].stops).toEqual([
      { id: 'st1', trigger: { kind: 'mc', value: 1_500_000 }, sellPct: 10 },
      { id: null, trigger: { kind: 'mc', value: 1_200_000 }, sellPct: 10 },
    ]);
    expect(edits()[0].sl).toEqual({ trigger: { kind: 'x', value: 0.75 } });
  });

  it('stops and take profits each add up to 100% at most (counting what already sold)', async () => {
    await show({ plan: livePlan((p) => (p.tps[0].status = 'filled')) });
    await typeInto($<HTMLInputElement>('.tw-amt-custom input')!, '95');
    await act(async () => {
      $<HTMLFormElement>('.tw-amt-custom')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
    await typeInto(level(), '1.2m');
    expect(warns()).toEqual(['Your stops would add up to 105% of your bag (counting what already sold) — keep it at 100% or less.']);
    expect(armBtn().disabled).toBe(true);
    await typeInto(level(), '20m');
    expect(warns()).toEqual(['Your take-profits would add up to 170% of your bag (counting what already sold) — keep it at 100% or less.']);
  });
});

describe('✎ changes an order in place', () => {
  it('loads it into the form; Save keeps its id and leaves every other order alone', async () => {
    await show();
    await click(byLabel('Change take-profit 3x'));
    expect(level().value).toBe('3M');
    expect($('.tw-means')!.textContent).toBe('+50% from now · +200% vs entry');
    expect(amount('50%').getAttribute('aria-pressed')).toBe('true');
    expect(armBtn().textContent).toBe('Save take profit · 50% at $3M MC');
    expect(btn('Cancel — keep it as it was')).toBeDefined();
    expect($('.tw-row.tw-editing')!.textContent).toMatch(/\$3M MC/);

    await typeInto(level(), '4m');
    expect(armBtn().textContent).toBe('Save take profit · 50% at $4M MC');
    await click(armBtn());
    expect(edits()).toEqual([
      {
        tps: [
          { id: 'tp2', trigger: { kind: 'mc', value: 10_000_000 }, sellPct: 25 },
          { id: 'tp1', trigger: { kind: 'mc', value: 4_000_000 }, sellPct: 50 },
        ],
        stops: [{ id: 'st1', trigger: { kind: 'mc', value: 1_500_000 }, sellPct: 10 }],
        sl: { trigger: { kind: 'x', value: 0.75 } },
        trailing: null,
      },
    ]);
    await flush();
    expect(say()).toBe('Saved! Tippy will sell 50% of $TST if it rises to $4M MC.');
    expect(btn('Cancel — keep it as it was')).toBeUndefined();
    expect(level().value).toBe('');
  });

  it('only the % changed: the level is sent exactly as it was set (3x stays 3x)', async () => {
    await show();
    await click(byLabel('Change take-profit 3x'));
    await click(amount('25%'));
    await click(armBtn());
    expect(edits()[0].tps.find((t) => t.id === 'tp1')).toEqual({ id: 'tp1', trigger: { kind: 'x', value: 3 }, sellPct: 25 });
  });

  it('moved below the market, a take profit becomes a stop', async () => {
    await show();
    await click(byLabel('Change take-profit 3x'));
    await typeInto(level(), '1.8m');
    expect(armBtn().textContent).toBe('Save stop loss · 50% at $1.8M MC');
    expect(armBtn().classList.contains('is-down')).toBe(true);
    await click(armBtn());
    expect(edits()[0].tps.map((t) => t.id)).toEqual(['tp2']);
    expect(edits()[0].stops).toEqual([
      { id: 'st1', trigger: { kind: 'mc', value: 1_500_000 }, sellPct: 10 },
      { id: null, trigger: { kind: 'mc', value: 1_800_000 }, sellPct: 50 },
    ]);
  });

  it('the stop loss sells the rest; less than 100% turns it into a partial stop', async () => {
    await show();
    await click(byLabel(/^Change stop loss/));
    expect(level().value).toBe('750K');
    expect($('.tw-box-r')!.textContent).toBe('all ≈ $200');
    expect(armBtn().textContent).toBe('Save stop loss · 100% at $750K MC');
    await click(amount('25%'));
    expect(armBtn().textContent).toBe('Save stop loss · 25% at $750K MC');
    await click(armBtn());
    expect(edits()[0].sl).toBeNull();
    expect(edits()[0].stops).toEqual([
      { id: 'st1', trigger: { kind: 'mc', value: 1_500_000 }, sellPct: 10 },
      { id: null, trigger: { kind: 'x', value: 0.75 }, sellPct: 25 },
    ]);
  });

  it('a partial stop keeps its id when you change it', async () => {
    await show();
    await click(byLabel(/^Change stop \$1\.5M mc/));
    expect(armBtn().textContent).toBe('Save stop loss · 10% at $1.5M MC');
    await typeInto(level(), '1.4m');
    await click(armBtn());
    expect(edits()[0].stops).toEqual([{ id: 'st1', trigger: { kind: 'mc', value: 1_400_000 }, sellPct: 10 }]);
    expect(edits()[0].sl).toEqual({ trigger: { kind: 'x', value: 0.75 } });
  });

  it('Cancel, or ✎ again, lets go without changing anything', async () => {
    await show();
    await click(byLabel('Change take-profit 3x'));
    await typeInto(level(), '9m');
    await click(btn('Cancel — keep it as it was'));
    expect(level().value).toBe('');
    expect($('.tw-row.tw-editing')).toBeNull();
    await click(byLabel('Change take-profit 3x'));
    await click(byLabel('Change take-profit 3x'));
    expect($('.tw-row.tw-editing')).toBeNull();
    expect(called('update')).toEqual([]);
  });

  it("a 100% stop below the market while there's already a stop loss asks before moving it", async () => {
    await show();
    await click(amount('100%'));
    await typeInto(level(), '600k');
    await click(armBtn());
    expect(notice()).toBe('Move your stop loss from $750K to $600K MC?');
    expect(called('update')).toEqual([]);
    await click(btn('Keep'));
    expect(notice()).toBeNull();
    expect(called('update')).toEqual([]);

    await click(armBtn());
    await click(btn('Move', $('.tw-notice')!));
    await flush();
    expect(edits()[0].sl).toEqual({ trigger: { kind: 'mc', value: 600_000 } });
    expect(edits()[0].tps.map((t) => t.id)).toEqual(['tp1', 'tp2']);
    expect(notice()).toBeNull();
  });

  it('a refused change says why; a stale one clears the form', async () => {
    await show();
    result = () => ({ ok: false, error: 'Tippy is in the middle of a sell on this coin — try again in a moment.', stale: true });
    await click(byLabel('Change take-profit 3x'));
    await typeInto(level(), '4m');
    await click(armBtn());
    await flush();
    expect(warns()).toEqual(['Tippy is in the middle of a sell on this coin — try again in a moment.']);
    expect(btn('Cancel — keep it as it was')).toBeUndefined();
  });
});

describe('× removes an order', () => {
  it('sends the plan without it', async () => {
    await show();
    await click(byLabel(/^Remove stop \$1\.5M mc/));
    expect(edits()).toEqual([
      {
        tps: [
          { id: 'tp1', trigger: { kind: 'x', value: 3 }, sellPct: 50 },
          { id: 'tp2', trigger: { kind: 'mc', value: 10_000_000 }, sellPct: 25 },
        ],
        stops: [],
        sl: { trigger: { kind: 'x', value: 0.75 } },
        trailing: null,
      },
    ]);
  });

  it('the last one out stops guarding', async () => {
    await show({ plan: livePlan(undefined, { tps: [], stops: [] }) });
    expect(rows()).toEqual(['now $2M', '▼ $750K MC −62.5% · sell the rest']);
    await click(byLabel(/^Remove stop loss/));
    expect(called('cancel')).toEqual([['p1']]);
    expect(called('update')).toEqual([]);
  });
});

describe('the plan changes under the window', () => {
  it('sold and finished orders are locked (no ✎ / ×), and edits leave them out', async () => {
    await show({ plan: livePlan((p) => (p.tps[0].status = 'filled')) });
    expect(rows()[1]).toBe('▲ $3M MC +50% · sell 50% sold ✓');
    expect(byLabel('Change take-profit 3x')).toBeUndefined();
    expect(byLabel(/^Remove take-profit 3x/)).toBeUndefined();
    await click(byLabel(/^Change take-profit \$10M/));
    await click(armBtn());
    expect(edits()[0].tps).toEqual([{ id: 'tp2', trigger: { kind: 'mc', value: 10_000_000 }, sellPct: 25 }]);
  });

  it('a new plan from the background shows at once', async () => {
    await show();
    await show({ plan: livePlan(undefined, { tps: [{ trigger: { kind: 'mc', value: 4_000_000 }, sellPct: 100 }] }) });
    expect(rows()[0]).toBe('▲ $4M MC +100% · sell 100%');
  });

  it('an order that starts selling while ✎ has it lets go, and says so', async () => {
    const plan = livePlan();
    await show({ plan });
    await click(byLabel('Change take-profit 3x'));
    await typeInto(level(), '4m');
    const selling = structuredClone(plan);
    selling.tps.find((t) => t.id === 'tp1')!.status = 'queued';
    await show({ plan: selling });
    expect($('.tw-row.tw-editing')).toBeNull();
    expect(level().value).toBe('');
    expect(warns()[0]).toBe('Your plan just changed — that order sold or started selling. Check it again.');
  });

  it('while a sell is in flight nothing can change: the button, ✎, × and the presets wait', async () => {
    await show({ plan: livePlan((p) => (p.tps[0].status = 'executing')) });
    expect(rows()[1]).toBe('▲ $3M MC +50% · sell 50% selling…');
    expect(warns()).toEqual(["Tippy is selling $TST right now — you can change your orders once that's done."]);
    await typeInto(level(), '5m');
    expect(armBtn().disabled).toBe(true);
    const edit = byLabel(/^Change take-profit \$10M/);
    expect(edit.disabled).toBe(true);
    expect(edit.title).toBe("Tippy is selling $TST right now — try again once that's done.");
    expect(byLabel(/^Remove stop loss/).disabled).toBe(true);
    expect([...root.querySelectorAll<HTMLButtonElement>('.tw-quick button')].every((b) => b.disabled)).toBe(true);

    // Done selling: everything's back.
    await show({ plan: livePlan((p) => (p.tps[0].status = 'filled')) });
    expect(byLabel(/^Change take-profit \$10M/).disabled).toBe(false);
    expect(warns()).not.toContain("Tippy is selling $TST right now — you can change your orders once that's done.");
  });
});

describe('the plan line', () => {
  it('Pause and Resume; Stop all asks first (nothing gets sold)', async () => {
    await show();
    await click(btn('❚❚ Pause'));
    expect(called('pause')).toEqual([['p1']]);

    await show({ plan: pausePlan(livePlan(), 2) });
    expect(planLine()).toBe('Paused · 2x · +100%');
    await click(btn('▶ Resume'));
    expect(called('resume')).toEqual([['p1']]);

    await click(btn('■ Stop all'));
    expect(notice()).toBe('Cancel every order on $TST? Nothing gets sold.');
    expect(called('cancel')).toEqual([]);
    await click(btn('Stop all', $('.tw-notice')!));
    await flush();
    expect(called('cancel')).toEqual([['p1']]);
  });

  it('a loss is red, a gain mint', async () => {
    await show({ token: { ...token, priceUSD: 0.0008, mc: 800_000 } });
    expect(planLine()).toBe('Guarding · 0.8x · −20.0%');
    expect($('.tw-planline-txt b')!.classList.contains('down')).toBe(true);
  });

  it('Retry sits right under the order Tippy gave up on', async () => {
    await show({ plan: livePlan((p) => Object.assign(p.tps[0], { status: 'blocked', clickedAt: 5 })) });
    expect(rows()[1]).toBe('▲ $3M MC +50% · sell 50% check fomo');
    const note = $('.tw-row + .tw-row-note')!;
    expect(note.previousElementSibling!.textContent).toMatch(/\$3M MC/);
    expect(note.textContent).toMatch(/^Check fomo: did it sell\? If not:/);
    await click(btn('↻ Retry', note));
    expect(called('retry')).toEqual([['p1', { kind: 'tp', id: 'tp1' } satisfies LevelRef]]);
  });

  it('a stop that hit while the computer slept asks right under it', async () => {
    await show({ plan: livePlan((p) => (p.sl!.status = 'held')) });
    expect(rows().at(-1)).toBe('▼ $750K MC −62.5% · sell the rest needs OK');
    const note = $('.tw-held')!;
    expect(note.previousElementSibling!.textContent).toMatch(/sell the rest/);
    expect(note.textContent).toMatch(/^This hit while your computer slept\. Sell the rest now\?/);
    await click(btn('Keep watching', note));
    await click(btn('Sell now', note));
    expect(called('resolveHeld')).toEqual([
      ['p1', { kind: 'sl' }, false],
      ['p1', { kind: 'sl' }, true],
    ]);
  });

  it('what needs your attention is in the list', async () => {
    await show({ plan: livePlan((p) => (p.attention = 'fomo looks different — Tippy is watching but may not be able to sell.')) });
    expect($('.tw-list .tw-attn-plan')!.textContent).toBe('fomo looks different — Tippy is watching but may not be able to sell.');
  });

  it('Activity is closed until you open it, newest first', async () => {
    const plan = livePlan();
    plan.history.push({ at: 2, kind: 'edited', text: 'You changed the plan: 3x 50%' });
    await show({ plan });
    const details = $<HTMLDetailsElement>('details.tw-activity')!;
    expect(details.open).toBe(false);
    expect(details.querySelector('summary')!.textContent).toBe('Activity');
    const lines = [...details.querySelectorAll('div')].map((d) => d.textContent!.slice(d.querySelector('.tw-dim')!.textContent!.length).trim());
    expect(lines[0]).toBe('You changed the plan: 3x 50%');
    expect(lines[1]).toMatch(/^Tippy is guarding \$TST/);
  });
});

describe('the window', () => {
  it("typing in Tippy never reaches fomo's page shortcuts", async () => {
    await show();
    const seen: string[] = [];
    const spy = (e: KeyboardEvent) => seen.push(e.key);
    document.addEventListener('keydown', spy);
    level().dispatchEvent(new KeyboardEvent('keydown', { key: 'b', bubbles: true }));
    document.removeEventListener('keydown', spy);
    expect(seen).toEqual([]);
  });

  it('dry run is a short badge in the header', async () => {
    await show();
    expect($('.tw-dry')).toBeNull();
    await show({ toggles: { autoGuard: false, dryRun: true, alerts: false }, onToggle: () => {} });
    expect($('.tw-head .tw-dry')!.textContent).toBe('DRY');
  });

  it("opening never takes the keyboard from fomo; picking a tab or ✎ puts it in the level box", async () => {
    await show();
    expect(document.activeElement).not.toBe(level());
    await click(btn(/^Buy/, $('.tw-modes')!));
    expect(document.activeElement).toBe(level());
    await click(btn(/^Sell/, $('.tw-modes')!));
    (document.activeElement as HTMLElement).blur();
    await click(byLabel('Change take-profit 3x'));
    expect(document.activeElement).toBe(level());
  });
});
