// @vitest-environment happy-dom
// Against the REAL fomo Sell panel *with a live quote* (captured 2026-10-11
// while holding SOL; nothing was sold) and the real "Sold …" status strip.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import type { SellAction } from '../src/engine/types';
import { findConfirmSlot, findMax, findTradePanel, isSelected, readImpact, readImpactPct } from '../src/executor/selectors';
import { executeSell, healthCheck, type StepTimeouts } from '../src/executor/steps';
import type { ExecOptions } from '../src/shared/messages';

const FAST: StepTimeouts = { panel: 300, tab: 300, quote: 800, ack: 300, submit: 500, settle: 60, insufficient: 200 };
const html = readFileSync(join(__dirname, 'fixtures/fomo-sell-quote-2026-10-11.html'), 'utf8');

const SOLD_STRIP =
  '<div class="bg-bg-primary rounded-xl px-3 pb-3 flex flex-col"><div class="grid grid-rows-[1fr]"><div class="overflow-hidden min-h-0 pt-3"><div class="flex items-center gap-2"><svg class="lucide lucide-check" aria-hidden="true"></svg><div class="flex-1 min-w-0 text-sm"><span class="text-text-secondary">Sold <span class="text-text-primary" translate="no">0.0550 SOL</span></span></div><span class="text-xs" translate="no">Just now</span></div></div></div></div>';

const action = (over: Partial<SellAction> = {}): SellAction => ({
  type: 'sell',
  planId: 'p',
  key: 'So11111111111111111111111111111111111111112:1399811149',
  level: { kind: 'tp', id: 'tp1' },
  targetRemaining: 0.0275,
  sellAmount: 0.0275,
  sellUsd: 3.06,
  sellPctOfCurrent: 50,
  reason: 'take-profit 2x',
  gapFill: false,
  priority: 1,
  queuedAt: 0,
  ...over,
});
const tpOpts: ExecOptions = { dryRun: false, acceptRiskWarnings: true, maxImpactPct: 15, failClosedOnUnknownImpact: true, focused: false };
const stopOpts: ExecOptions = { ...tpOpts, maxImpactPct: 40, failClosedOnUnknownImpact: false };

const impactSpan = () => document.querySelector('span.text-xs.text-text-tertiary span:nth-child(2)')!;
const amount = () => document.querySelector<HTMLInputElement>('input[placeholder="0"]')!;
const drawer = () => document.querySelector('[class*="grid-rows-[0fr]"], [class*="grid-rows-[1fr]"]')!;

/** fomo after pressing Sell: clear the amount and/or open the "Sold" strip. */
function wireSell({ clearsAmount = true, showsStrip = true } = {}) {
  const log: string[] = [];
  const confirm = document.querySelector<HTMLButtonElement>('button.h-11')!;
  confirm.addEventListener('click', () => {
    log.push('confirm');
    setTimeout(() => {
      if (clearsAmount) amount().value = '';
      if (showsStrip) {
        drawer().className = 'grid transition-[grid-template-rows,margin-top] duration-300 ease-out grid-rows-[1fr] mt-4';
        drawer().firstElementChild!.innerHTML = SOLD_STRIP;
      }
    }, 40);
  });
  document.querySelectorAll<HTMLButtonElement>('.grid-cols-4 > button, button').forEach((b) => {
    if (/^(\d+%|Max)$/.test(b.textContent!.trim())) b.addEventListener('click', () => log.push(`preset:${b.textContent!.trim()}`));
  });
  return log;
}

beforeEach(() => {
  document.body.innerHTML = html;
});

describe('quote panel selectors', () => {
  it('reads fomo\'s inline impact: favourable "(+0.03%)" is no impact, "(-12.5%)" is 12.5%', () => {
    const p = findTradePanel(document)!;
    expect(readImpactPct(p)).toBe(0);
    impactSpan().textContent = '-12.5%';
    expect(readImpactPct(p)).toBe(12.5);
    impactSpan().textContent = '−3%'; // unicode minus
    expect(readImpactPct(p)).toBe(3);
  });

  it('finds the real Max button, the Sell confirm, and the active Sell tab', () => {
    const p = findTradePanel(document)!;
    expect(findMax(p)?.textContent).toBe('Max');
    expect(findConfirmSlot(p)?.textContent).toBe('Sell SOL');
    expect(isSelected(p.sellTab)).toBe(true);
    expect(healthCheck(document).ok).toBe(true);
  });
});

describe('selling on the live quote', () => {
  it('sell-all prefers Max', async () => {
    const log = wireSell();
    const r = await executeSell(action({ sellPctOfCurrent: 100, targetRemaining: 0 }), stopOpts, document, FAST);
    expect(r.stage).toBe('submitted');
    expect(log).toEqual(['preset:Max', 'confirm']);
  });

  it('a take-profit refuses fomo\'s inline impact above the limit', async () => {
    const log = wireSell();
    impactSpan().textContent = '-20%';
    const r = await executeSell(action(), tpOpts, document, FAST);
    expect(r.stage).toBe('impact-too-high');
    expect(r.impactPct).toBe(20);
    expect(log).not.toContain('confirm');
  });

  it('a stop loss still sells through 20% impact (its cap is 40%)', async () => {
    const log = wireSell();
    impactSpan().textContent = '-20%';
    const r = await executeSell(action({ level: { kind: 'sl' }, sellPctOfCurrent: 100, targetRemaining: 0 }), stopOpts, document, FAST);
    expect(r.stage).toBe('submitted');
    expect(log).toContain('confirm');
  });

  it('counts fomo\'s "Sold …" strip as success even if the amount box lingers', async () => {
    wireSell({ clearsAmount: false, showsStrip: true });
    const r = await executeSell(action(), tpOpts, document, FAST);
    expect(r.stage).toBe('submitted');
  });

  it('without the amount clearing or a strip it only reports "clicked" (balance decides)', async () => {
    wireSell({ clearsAmount: false, showsStrip: false });
    const r = await executeSell(action(), tpOpts, document, FAST);
    expect(r.stage).toBe('clicked');
    expect(r.clicked).toBe(true);
  });
});

describe('impact reading is structural (review round 3)', () => {
  const openDrawer = (inner: string) => {
    const d = drawer();
    d.className = 'grid transition-[grid-template-rows,margin-top] duration-300 ease-out grid-rows-[1fr] mt-4';
    d.firstElementChild!.innerHTML = inner;
  };

  it("never borrows the 'Lowest fees: 0.05%' row as impact", () => {
    openDrawer('<div class="row"><span>Price impact</span><span>Very high</span></div>');
    impactSpan().textContent = '-35%';
    const p = findTradePanel(document)!;
    expect(readImpactPct(p)).toBe(35); // the readable inline value wins over nothing
  });

  it('a worded warning without its own number makes impact unknown (TP refuses)', async () => {
    const log = wireSell();
    impactSpan().parentElement!.remove(); // no inline value
    openDrawer('<div class="row"><span>Max slippage 1%</span></div><div class="row"><span>Price impact</span><span>—</span></div>');
    const r = await executeSell(action(), tpOpts, document, FAST);
    expect(r.stage).toBe('impact-too-high');
    expect(log).not.toContain('confirm');
  });

  it("reads the inline slot even without brackets ('-45%')", () => {
    impactSpan().parentElement!.innerHTML = '<span>-45%</span>';
    expect(readImpactPct(findTradePanel(document)!)).toBe(45);
  });

  it('a bracketed fee elsewhere is not impact', () => {
    impactSpan().parentElement!.remove();
    document.querySelector('.text-text-primary[translate="no"]')!.textContent = '$0.10 fee (0.5%)';
    expect(readImpactPct(findTradePanel(document)!)).toBeNull();
  });

  it('switches and non-consent checkboxes are never ticked', async () => {
    wireSell();
    openDrawer('<label><input type="checkbox" id="mev"> MEV protection — shields you from sandwich risk</label><button role="switch" aria-checked="false" id="auto">Auto slippage</button>');
    const touched: string[] = [];
    document.getElementById('mev')!.addEventListener('click', () => touched.push('mev'));
    document.getElementById('auto')!.addEventListener('click', () => touched.push('auto'));
    const r = await executeSell(action(), tpOpts, document, FAST);
    expect(touched).toEqual([]);
    expect(['submitted', 'stalled']).toContain(r.stage);
  });

  it('a changed amount is caught even if it changed before the quote settled', async () => {
    const log = wireSell();
    setTimeout(() => {
      amount().value = '120';
    }, 30);
    const r = await executeSell(action({ sellPctOfCurrent: 33.3, sellUsd: 3.06 }), tpOpts, document, FAST);
    expect(log).not.toContain('confirm');
    expect(r.stage).toBe('stalled');
  });
});

describe('review round 4', () => {
  const sym = { ...tpOpts, symbol: 'SOL' };

  it("an unsigned inline '(12%)' is impact, only '+' is favourable", () => {
    impactSpan().textContent = '12%';
    expect(readImpactPct(findTradePanel(document)!)).toBe(12);
    impactSpan().textContent = '+12%';
    expect(readImpactPct(findTradePanel(document)!)).toBe(0);
  });

  it("a take-profit never presses 'Sell anyway' (only 'Sell SOL')", async () => {
    const log = wireSell();
    document.querySelector('button.h-11 > div')!.textContent = 'Sell anyway';
    const r = await executeSell(action(), sym, document, FAST);
    expect(log).not.toContain('confirm');
    expect(r.clicked).toBe(false);
  });

  it('a stop may press it (getting out matters more)', async () => {
    const log = wireSell();
    document.querySelector('button.h-11 > div')!.textContent = 'Sell anyway';
    const r = await executeSell(action({ level: { kind: 'sl' }, sellPctOfCurrent: 100, targetRemaining: 0 }), { ...stopOpts, symbol: 'SOL' }, document, FAST);
    expect(r.stage).toBe('submitted');
    expect(log).toContain('confirm');
  });

  it('a take-profit refuses when no impact is shown and no estimate exists', async () => {
    const log = wireSell();
    impactSpan().parentElement!.remove();
    const r = await executeSell(action(), sym, document, FAST);
    expect(r.stage).toBe('impact-too-high');
    expect(log).not.toContain('confirm');
  });

  it("a 'Price impact > 5%' threshold is not read as 5% impact", () => {
    const d = drawer();
    d.className = 'grid grid-rows-[1fr] mt-4';
    d.firstElementChild!.innerHTML = '<div><span>Price impact &gt; 5%</span></div>';
    expect(readImpact(findTradePanel(document)!).unreadable).toBe(true);
  });

  it("a preset that fills a different amount than Tippy sized is replaced by the exact amount", async () => {
    const log = wireSell();
    // fomo's 50% preset fills from a stale $240 position; Tippy sized $3.06
    document.querySelectorAll<HTMLButtonElement>('.grid-cols-4 > button').forEach((b) =>
      b.addEventListener('click', () => {
        amount().value = '120';
      }),
    );
    const r = await executeSell(action({ sellUsd: 3.06 }), sym, document, FAST);
    expect(r.stage).toBe('submitted');
    expect(amount().value === '' || amount().value === '3.06').toBe(true);
    expect(log).toContain('preset:50%');
  });
});
