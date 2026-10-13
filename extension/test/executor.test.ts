// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import type { SellAction } from '../src/engine/types';
import { executeSell, healthCheck, type StepTimeouts } from '../src/executor/steps';
import { findConfirm, findTradePanel, readImpactPct } from '../src/executor/selectors';
import type { ExecOptions } from '../src/shared/messages';

const FAST: StepTimeouts = { panel: 300, tab: 300, quote: 600, ack: 300, submit: 400, settle: 60, insufficient: 150 };
const html = readFileSync(join(__dirname, 'fixtures/synthetic-trade-panel.html'), 'utf8');

const action = (over: Partial<SellAction> = {}): SellAction => ({
  type: 'sell',
  planId: 'p',
  key: 'k:1',
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

const opts = (over: Partial<ExecOptions> = {}): ExecOptions => ({
  dryRun: false,
  acceptRiskWarnings: true,
  maxImpactPct: 15,
  failClosedOnUnknownImpact: true,
  estimatedImpactPct: 0.5, // the queue always passes a liquidity estimate
  focused: false,
  ...over,
});

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

/** Minimal fake of fomo's behaviour: tabs, presets, quote, confirm, submit. */
function wireFakeFomo({ impact = 2, needsAck = false, submitClears = true, quoteNever = false } = {}) {
  const sellTab = $('tab-sell');
  const buyTab = $('tab-buy');
  const input = $<HTMLInputElement>('amount');
  const confirm = $<HTMLButtonElement>('confirm');
  const quote = $('quote');
  const ackRow = $('ack-row');
  const ack = $<HTMLInputElement>('ack');
  const log: string[] = [];

  const refresh = () => {
    const hasAmount = input.value !== '' && input.value !== '0';
    if (hasAmount && !quoteNever) {
      quote.textContent = `Price impact ${impact}%`;
      if (needsAck) ackRow.style.display = '';
      confirm.disabled = needsAck ? !ack.checked : false;
    } else {
      quote.textContent = '';
      confirm.disabled = true;
    }
  };
  sellTab.addEventListener('mousedown', () => {
    sellTab.setAttribute('aria-selected', 'true');
    sellTab.dataset.state = 'active';
    buyTab.setAttribute('aria-selected', 'false');
    buyTab.dataset.state = 'inactive';
    log.push('tab:sell');
  });
  document.querySelectorAll<HTMLButtonElement>('.preset').forEach((b) =>
    b.addEventListener('click', () => {
      input.value = b.textContent === 'Max' ? '120.50' : String((120.5 * parseInt(b.textContent!)) / 100);
      log.push(`preset:${b.textContent}`);
      refresh();
    }),
  );
  input.addEventListener('input', () => {
    log.push(`typed:${input.value}`);
    refresh();
  });
  ack.addEventListener('click', () => setTimeout(refresh, 0));
  confirm.addEventListener('click', () => {
    if (confirm.disabled) return;
    log.push('confirm');
    if (submitClears) setTimeout(() => ((input.value = ''), refresh()), 50);
  });
  return log;
}

beforeEach(() => {
  document.body.innerHTML = html;
});

describe('selectors', () => {
  it('finds the panel, tabs and confirm (not the Sell tab)', () => {
    const p = findTradePanel(document)!;
    expect(p.sellTab.id).toBe('tab-sell');
    expect(findConfirm(p, 'sell')!.id).toBe('confirm');
  });
  it('reads price impact', () => {
    $('quote').textContent = 'Price impact 12.5%';
    expect(readImpactPct(findTradePanel(document)!)).toBe(12.5);
  });
  it('health check passes on a normal panel and fails without one', () => {
    expect(healthCheck(document).ok).toBe(true);
    document.body.innerHTML = '<button>Log in</button>';
    expect(healthCheck(document).ok).toBe(false);
  });
});

describe('executeSell', () => {
  it('sells 50% with the preset and confirms', async () => {
    const log = wireFakeFomo();
    const r = await executeSell(action(), opts(), document, FAST);
    expect(r.stage).toBe('submitted');
    expect(log).toEqual(['tab:sell', 'preset:50%', 'confirm']);
  });

  it('uses Max for "sell the rest"', async () => {
    const log = wireFakeFomo();
    const r = await executeSell(action({ sellPctOfCurrent: 100, targetRemaining: 0 }), opts(), document, FAST);
    expect(r.stage).toBe('submitted');
    expect(log).toContain('preset:Max');
  });

  it('types a USD amount when no preset matches', async () => {
    const log = wireFakeFomo();
    const r = await executeSell(action({ sellPctOfCurrent: 33.3, sellUsd: 40.129 }), opts(), document, FAST);
    expect(r.stage).toBe('submitted');
    expect(log).toContain('typed:40.12');
  });

  it('dry run stops right before confirm', async () => {
    const log = wireFakeFomo();
    const r = await executeSell(action(), opts({ dryRun: true }), document, FAST);
    expect(r.stage).toBe('dry-run');
    expect(log).not.toContain('confirm');
  });

  it('refuses when price impact is above the limit', async () => {
    const log = wireFakeFomo({ impact: 30 });
    const r = await executeSell(action(), opts({ maxImpactPct: 15 }), document, FAST);
    expect(r.stage).toBe('impact-too-high');
    expect(log).not.toContain('confirm');
  });

  it('ticks a risk acknowledgement when allowed', async () => {
    const log = wireFakeFomo({ needsAck: true });
    const r = await executeSell(action(), opts(), document, FAST);
    expect(r.stage).toBe('submitted');
    expect(log).toContain('confirm');
  });

  it('does not tick risk warnings when the user said no', async () => {
    wireFakeFomo({ needsAck: true });
    const r = await executeSell(action(), opts({ acceptRiskWarnings: false }), document, FAST);
    expect(r.clicked).toBe(false);
  });

  it('reports a stall (for focus escalation) when no quote arrives', async () => {
    wireFakeFomo({ quoteNever: true });
    const r = await executeSell(action(), opts(), document, FAST);
    expect(r.stage).toBe('stalled');
    expect(r.step).toBe('quote');
  });

  it("reports 'clicked' (not success) when the form never resets", async () => {
    wireFakeFomo({ submitClears: false });
    const r = await executeSell(action(), opts(), document, FAST);
    expect(r.stage).toBe('clicked');
    expect(r.clicked).toBe(true);
  });

  it('detects a logged-out page', async () => {
    document.body.innerHTML = '<button>Log in</button>';
    const r = await executeSell(action(), opts(), document, FAST);
    expect(r.stage).toBe('logged-out');
  });
});
