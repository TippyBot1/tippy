// @vitest-environment happy-dom
// Executor tests against the REAL fomo trade panel captured on 2026-10-11.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import type { SellAction } from '../src/engine/types';
import { findAmountInput, findConfirm, findMax, findPercentPreset, findTradePanel, isSelected } from '../src/executor/selectors';
import { executeSell, type StepTimeouts } from '../src/executor/steps';
import type { ExecOptions } from '../src/shared/messages';

const FAST: StepTimeouts = { panel: 300, tab: 300, quote: 800, ack: 300, submit: 500, settle: 60, insufficient: 200 };
const html = readFileSync(join(__dirname, 'fixtures/fomo-sell-panel-2026-10-11.html'), 'utf8');

const ACTIVE_SELL = 'bg-red-transparent text-red';
const ACTIVE_BUY = 'bg-green-transparent text-green';
const INACTIVE = 'bg-bg-secondary hover:bg-bg-tertiary text-text-secondary';
const TAB_BASE = 'flex-1 p-2 rounded-lg text-base font-bold transition-colors';

const action = (over: Partial<SellAction> = {}): SellAction => ({
  type: 'sell',
  planId: 'p',
  key: 'k:1399811149',
  level: { kind: 'tp', id: 'tp1' },
  targetRemaining: 50,
  sellAmount: 50,
  sellUsd: 60,
  sellPctOfCurrent: 50,
  reason: 'take-profit 2x',
  gapFill: false,
  priority: 1,
  queuedAt: 0,
  ...over,
});
const opts: ExecOptions = { dryRun: false, acceptRiskWarnings: true, maxImpactPct: 15, failClosedOnUnknownImpact: true, estimatedImpactPct: 0.5, focused: false };

const tabs = () => {
  const [buy, sell] = [...document.querySelectorAll<HTMLButtonElement>('.flex.gap-2 > button')];
  return { buy, sell };
};
const amount = () => document.querySelector<HTMLInputElement>('input[placeholder="0"]')!;
const presets = () => [...document.querySelectorAll<HTMLButtonElement>('.grid-cols-4 > button')];
const confirmBtn = () => document.querySelector<HTMLButtonElement>('button.h-11')!;

/**
 * Behave like fomo with a $120 position: tabs switch by class, presets fill a
 * USD amount, confirm unlocks once there's an amount, submit clears the form.
 * Starts on the Buy tab like a fresh token page.
 */
function wireFomo({ position = 120, symbol = 'DOPE' } = {}) {
  const log: string[] = [];
  const { buy, sell } = tabs();
  const setTab = (side: 'buy' | 'sell') => {
    buy.className = `${TAB_BASE} ${side === 'buy' ? ACTIVE_BUY : INACTIVE}`;
    sell.className = `${TAB_BASE} ${side === 'sell' ? ACTIVE_SELL : INACTIVE}`;
    confirmBtn().firstElementChild!.textContent = `${side === 'buy' ? 'Buy' : 'Sell'} ${symbol}`;
  };
  setTab('buy');
  presets().forEach((p) => p.removeAttribute('disabled'));
  const refresh = () => {
    const v = Number(amount().value || 0);
    const label = confirmBtn().firstElementChild!;
    if (v > position) {
      label.textContent = 'Insufficient balance';
      confirmBtn().setAttribute('disabled', '');
    } else if (v > 0) {
      label.textContent = `Sell ${symbol}`;
      setTimeout(() => confirmBtn().removeAttribute('disabled'), 60); // quote round-trip
    } else {
      label.textContent = `Sell ${symbol}`;
      confirmBtn().setAttribute('disabled', '');
    }
  };
  // fomo's tabs react on click
  sell.addEventListener('click', () => (setTab('sell'), log.push('tab:sell')));
  buy.addEventListener('click', () => (setTab('buy'), log.push('tab:buy')));
  presets().forEach((p) =>
    p.addEventListener('click', () => {
      amount().value = String((position * parseInt(p.textContent!)) / 100);
      log.push(`preset:${p.textContent}`);
      refresh();
    }),
  );
  amount().addEventListener('input', () => (log.push(`typed:${amount().value}`), refresh()));
  confirmBtn().addEventListener('click', () => {
    if (confirmBtn().hasAttribute('disabled')) return;
    log.push('confirm');
    setTimeout(() => ((amount().value = ''), refresh()), 50);
  });
  return log;
}

beforeEach(() => {
  document.body.innerHTML = html;
});

describe('selectors on the real fomo panel', () => {
  it('finds the panel and both tabs', () => {
    const p = findTradePanel(document);
    expect(p).not.toBeNull();
    expect(p!.sellTab.textContent).toBe('Sell');
    expect(p!.buyTab.textContent).toBe('Buy');
  });

  it('reads the active tab from its classes (no aria-selected on fomo)', () => {
    const p = findTradePanel(document)!;
    expect(isSelected(p.sellTab)).toBe(true);
    expect(isSelected(p.buyTab)).toBe(false);
  });

  it("picks the panel's amount box, never the search box", () => {
    const input = findAmountInput(findTradePanel(document)!);
    expect(input?.getAttribute('placeholder')).toBe('0');
  });

  it('finds "Sell DOPE" as the confirm button, % presets, and no Max', () => {
    const p = findTradePanel(document)!;
    expect(findConfirm(p, 'sell')?.textContent).toBe('Sell DOPE');
    expect(findPercentPreset(p, 50)?.textContent).toBe('50%');
    expect(findPercentPreset(p, 100)?.textContent).toBe('100%');
    expect(findMax(p)).toBeNull();
  });
});

describe('executeSell on the real fomo panel', () => {
  it('switches Buy → Sell, taps 50%, confirms', async () => {
    const log = wireFomo();
    const r = await executeSell(action(), opts, document, FAST);
    expect(r.stage).toBe('submitted');
    expect(log).toEqual(['tab:sell', 'preset:50%', 'confirm']);
  });

  it('sells the rest with the 100% preset (fomo has no Max)', async () => {
    const log = wireFomo();
    const r = await executeSell(action({ sellPctOfCurrent: 100, targetRemaining: 0 }), opts, document, FAST);
    expect(r.stage).toBe('submitted');
    expect(log).toContain('preset:100%');
  });

  it('types a USD amount for sizes without a preset', async () => {
    const log = wireFomo();
    const r = await executeSell(action({ sellPctOfCurrent: 33.3, sellUsd: 40.129 }), opts, document, FAST);
    expect(r.stage).toBe('submitted');
    expect(log).toContain('typed:40.12');
  });

  it("hands back to the background (never 'sold elsewhere') when the button stays 'Insufficient balance'", async () => {
    const log = wireFomo({ position: 10 });
    const r = await executeSell(action({ sellPctOfCurrent: 33.3, sellUsd: 40 }), opts, document, FAST);
    expect(r.stage).toBe('insufficient-ui');
    expect(r.clicked).toBe(false);
    expect(log).not.toContain('confirm');
  });

  it("rides out a brief 'Insufficient balance' flash and still sells", async () => {
    const log = wireFomo();
    const r = executeSell(action(), opts, document, FAST);
    // fomo flips the label for a moment (price tick / balance still loading), then recovers
    setTimeout(() => {
      confirmBtn().firstElementChild!.textContent = 'Insufficient balance';
      confirmBtn().setAttribute('disabled', '');
    }, 20);
    setTimeout(() => {
      confirmBtn().firstElementChild!.textContent = 'Sell DOPE';
      confirmBtn().removeAttribute('disabled');
    }, 120);
    expect((await r).stage).toBe('submitted');
    expect(log).toContain('confirm');
  });

  it("ignores 'not enough …' copy elsewhere in the panel", async () => {
    const log = wireFomo();
    document.querySelector('.text-xs.font-bold')!.textContent = 'Not enough liquidity data';
    const r = await executeSell(action(), opts, document, FAST);
    expect(r.stage).toBe('submitted');
    expect(log).toContain('confirm');
  });

  it("reads price impact from fomo's quote drawer (outside the panel) and refuses above the limit", async () => {
    const log = wireFomo();
    const drawer = document.querySelector('.grid-rows-\\[0fr\\]')!;
    drawer.className = 'grid grid-rows-[1fr] mt-2';
    drawer.firstElementChild!.innerHTML = '<span>Price impact</span><span>32.5%</span>';
    const r = await executeSell(action(), opts, document, FAST);
    expect(r.stage).toBe('impact-too-high');
    expect(r.impactPct).toBe(32.5);
    expect(log).not.toContain('confirm');
  });

  it('treats an unreadable impact warning as too high for take-profits (fail closed)', async () => {
    const log = wireFomo();
    const drawer = document.querySelector('.grid-rows-\\[0fr\\]')!;
    drawer.className = 'grid grid-rows-[1fr] mt-2';
    drawer.firstElementChild!.innerHTML = '<span>High price impact — proceed carefully</span>';
    const r = await executeSell(action(), opts, document, FAST);
    expect(r.stage).toBe('impact-too-high');
    expect(log).not.toContain('confirm');
  });

  it("ignores a collapsed drawer's stale quote", async () => {
    wireFomo();
    document.querySelector('.grid-rows-\\[0fr\\]')!.firstElementChild!.innerHTML = '<span>Price impact 80%</span>';
    const r = await executeSell(action(), opts, document, FAST);
    expect(r.stage).toBe('submitted');
  });

  it('never presses confirm if the page guard fails at the last moment', async () => {
    const log = wireFomo();
    const r = await executeSell(action(), opts, document, FAST, () => 'wrong coin page');
    expect(r.stage).toBe('aborted');
    expect(r.clicked).toBe(false);
    expect(log).not.toContain('confirm');
  });

  it('never presses confirm if the Buy tab came back before confirming', async () => {
    const log = wireFomo();
    const r = executeSell(action(), opts, document, FAST);
    // something switches fomo back to Buy right after the quote settles
    setTimeout(() => tabs().buy.click(), 100);
    const res = await r;
    expect(res.clicked).toBe(false);
    expect(log).not.toContain('confirm');
  });

  it('waits for disabled % presets (position still loading) instead of pressing them blind', async () => {
    const log = wireFomo();
    presets().forEach((p) => p.setAttribute('disabled', ''));
    setTimeout(() => presets().forEach((p) => p.removeAttribute('disabled')), 150);
    const r = await executeSell(action(), opts, document, FAST);
    expect(r.stage).toBe('submitted');
    expect(log).toEqual(['tab:sell', 'preset:50%', 'confirm']);
  });

  it('dry run stops before confirm', async () => {
    const log = wireFomo();
    const r = await executeSell(action(), { ...opts, dryRun: true }, document, FAST);
    expect(r.stage).toBe('dry-run');
    expect(log).not.toContain('confirm');
  });
});
