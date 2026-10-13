// @vitest-environment happy-dom
// Limit buys against the REAL fomo trade panel (the 2026-10-11 SOL capture),
// switched to its Buy state the way fomo draws it: active Buy tab
// "bg-green-transparent text-green", inactive Sell "… text-text-secondary",
// confirm "Buy SOL". Nothing here touches the network or real fomo.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import type { BuyAction, SellAction } from '../src/engine/types';
import { executeBuy } from '../src/executor/buy';
import { findConfirmSlot, findTradePanel, isSelected } from '../src/executor/selectors';
import { executeSell, type ConfirmGuard, type StepTimeouts } from '../src/executor/steps';
import type { ExecOptions } from '../src/shared/messages';

const FAST: StepTimeouts = { panel: 300, tab: 300, quote: 800, ack: 300, submit: 500, settle: 60, insufficient: 200 };
const html = readFileSync(join(__dirname, 'fixtures/fomo-sell-quote-2026-10-11.html'), 'utf8');

const TAB_BASE = 'flex-1 p-2 rounded-lg text-base font-bold transition-colors';
const ACTIVE_BUY = 'bg-green-transparent text-green';
const ACTIVE_SELL = 'bg-red-transparent text-red';
const INACTIVE = 'bg-bg-secondary hover:bg-bg-tertiary text-text-secondary';

const BOUGHT_STRIP =
  '<div class="bg-bg-primary rounded-xl px-3 pb-3 flex flex-col"><div class="grid grid-rows-[1fr]"><div class="overflow-hidden min-h-0 pt-3"><div class="flex items-center gap-2"><svg class="lucide lucide-check" aria-hidden="true"></svg><div class="flex-1 min-w-0 text-sm"><span class="text-text-secondary">Bought <span class="text-text-primary" translate="no">0.0450 SOL</span></span></div><span class="text-xs" translate="no">Just now</span></div></div></div></div>';

const KEY = 'So11111111111111111111111111111111111111112:1399811149';
const action = (over: Partial<BuyAction> = {}): BuyAction => ({ type: 'buy', orderId: 'b1', key: KEY, usd: 5, priority: 2, queuedAt: 0, reason: 'buy the dip', ...over });
const opts = (over: Partial<ExecOptions> = {}): ExecOptions => ({
  dryRun: false,
  acceptRiskWarnings: true,
  maxImpactPct: 10,
  failClosedOnUnknownImpact: true,
  symbol: 'SOL',
  focused: false,
  ...over,
});
const ok: ConfirmGuard = () => null;

const tabs = () => {
  const [buy, sell] = [...document.querySelectorAll<HTMLButtonElement>('.flex.gap-2 > button')];
  return { buy, sell };
};
const amount = () => document.querySelector<HTMLInputElement>('input[placeholder="0"]')!;
const confirmBtn = () => document.querySelector<HTMLButtonElement>('button.h-11')!;
const label = () => confirmBtn().firstElementChild!;
const impactSpan = () => document.querySelector('span.text-xs.text-text-tertiary span:nth-child(2)')!;
const drawer = () => document.querySelector('[class*="grid-rows-[0fr]"], [class*="grid-rows-[1fr]"]')!;
const openDrawer = (inner: string, d = drawer()) => {
  d.className = 'grid transition-[grid-template-rows,margin-top] duration-300 ease-out grid-rows-[1fr] mt-4';
  d.firstElementChild!.innerHTML = inner;
};

const ACK_LABEL = {
  impact: 'I accept the 3.2% price impact',
  slippage: 'I understand the slippage on this trade',
  risk: 'I understand the risks of this token',
};

interface FakeBuy {
  /** Cash (USDC) available; more than this shows "Insufficient balance". */
  cash?: number;
  /** Which tab the page opens on. */
  startOn?: 'buy' | 'sell';
  /** What the confirm says once quoted (fomo's warning variants). */
  readyLabel?: string;
  clearsAmount?: boolean;
  showsStrip?: boolean;
  /** A consent box that locks the button until ticked. */
  needsAck?: keyof typeof ACK_LABEL | null;
}

/**
 * Behave like fomo's Buy side: tabs switch by class, typing quotes after a
 * "Fetching quote..." beat, the button unlocks, pressing clears the box and
 * opens the "Bought …" strip. Buy presets ($10, $25…) replace the % ones.
 * Timers only touch the elements wired here, so nothing leaks into the next test.
 */
function wireBuy({ cash = 100, startOn = 'buy', readyLabel = 'Buy SOL', clearsAmount = true, showsStrip = true, needsAck = null }: FakeBuy = {}) {
  const log: string[] = [];
  const { buy, sell } = tabs();
  const [box, btn, lbl, dr] = [amount(), confirmBtn(), label(), drawer()];
  let side: 'buy' | 'sell' = startOn;
  let ack: HTMLInputElement | null = null;
  const refresh = () => {
    const v = Number(box.value || 0);
    if (side === 'sell') {
      lbl.textContent = 'Sell SOL';
      return;
    }
    btn.setAttribute('disabled', '');
    if (v > cash) {
      lbl.textContent = 'Insufficient balance';
    } else if (v > 0) {
      lbl.textContent = 'Fetching quote...';
      setTimeout(() => {
        if (side !== 'buy' || Number(box.value || 0) !== v) return;
        lbl.textContent = readyLabel;
        if (!ack || ack.checked) btn.removeAttribute('disabled');
      }, 40);
    } else {
      lbl.textContent = 'Buy SOL';
    }
  };
  const setTab = (s: 'buy' | 'sell') => {
    side = s;
    buy.className = `${TAB_BASE} ${s === 'buy' ? ACTIVE_BUY : INACTIVE}`;
    sell.className = `${TAB_BASE} ${s === 'sell' ? ACTIVE_SELL : INACTIVE}`;
    box.value = '';
    refresh();
  };
  setTab(startOn);
  buy.addEventListener('click', () => (log.push('tab:buy'), setTab('buy')));
  sell.addEventListener('click', () => (log.push('tab:sell'), setTab('sell')));
  // fomo's Buy side shows $ presets; Tippy must never use them.
  document.querySelectorAll<HTMLButtonElement>('.grid-cols-4 > button').forEach((b, i) => {
    b.textContent = ['$10', '$25', '$50', '$100'][i];
    b.addEventListener('click', () => log.push(`preset:${b.textContent}`));
  });
  if (needsAck) {
    openDrawer(`<label><input type="checkbox" id="ack"> ${ACK_LABEL[needsAck]}</label>`, dr);
    ack = document.querySelector<HTMLInputElement>('#ack')!;
    ack.addEventListener('click', () => {
      log.push('ack');
      setTimeout(refresh, 0);
    });
  }
  box.addEventListener('input', () => (log.push(`typed:${box.value}`), refresh()));
  btn.addEventListener('click', () => {
    if (btn.hasAttribute('disabled')) return;
    log.push('confirm');
    setTimeout(() => {
      if (clearsAmount) box.value = '';
      if (showsStrip) openDrawer(BOUGHT_STRIP, dr);
    }, 40);
  });
  return log;
}

beforeEach(() => {
  document.body.innerHTML = html;
});

describe('the Buy state of the real panel', () => {
  it('finds the active Buy tab and the "Buy SOL" confirm', () => {
    wireBuy();
    const p = findTradePanel(document)!;
    expect(isSelected(p.buyTab)).toBe(true);
    expect(isSelected(p.sellTab)).toBe(false);
    expect(findConfirmSlot(p)?.textContent).toBe('Buy SOL');
  });
});

describe('executeBuy', () => {
  it('types the exact amount and presses Buy once', async () => {
    const log = wireBuy();
    const r = await executeBuy(action(), opts(), document, FAST, ok);
    expect(r.stage).toBe('submitted');
    expect(r.clicked).toBe(true);
    expect(log).toEqual(['typed:5.00', 'confirm']);
  });

  it('floors to the cent without float surprises ($10.10 stays $10.10, $7.239 → $7.23)', async () => {
    let log = wireBuy();
    expect((await executeBuy(action({ usd: 10.1 }), opts(), document, FAST, ok)).stage).toBe('submitted');
    expect(log).toContain('typed:10.10');
    document.body.innerHTML = html;
    log = wireBuy();
    expect((await executeBuy(action({ usd: 7.239 }), opts(), document, FAST, ok)).stage).toBe('submitted');
    expect(log).toContain('typed:7.23');
  });

  it('switches from Sell to Buy before typing', async () => {
    const log = wireBuy({ startOn: 'sell' });
    const r = await executeBuy(action(), opts(), document, FAST, ok);
    expect(r.stage).toBe('submitted');
    expect(log).toEqual(['tab:buy', 'typed:5.00', 'confirm']);
  });

  it('never uses fomo\'s $ presets, even when one matches', async () => {
    const log = wireBuy();
    const r = await executeBuy(action({ usd: 10 }), opts(), document, FAST, ok);
    expect(r.stage).toBe('submitted');
    expect(log.filter((l) => l.startsWith('preset:'))).toEqual([]);
    expect(log).toContain('typed:10.00');
  });

  it.each(['Buy anyway', 'Buy with high impact', 'Buy BONK'])('never presses "%s" (only "Buy SOL")', async (readyLabel) => {
    const log = wireBuy({ readyLabel });
    const r = await executeBuy(action(), opts(), document, FAST, ok);
    expect(r.clicked).toBe(false);
    expect(log).not.toContain('confirm');
  });

  it('refuses without a symbol to match the button against', async () => {
    const log = wireBuy();
    const r = await executeBuy(action(), opts({ symbol: undefined }), document, FAST, ok);
    expect(r.stage).toBe('error');
    expect(log).toEqual([]);
  });

  it("stops at 'Insufficient balance' (not enough cash) without pressing", async () => {
    const log = wireBuy({ cash: 2 });
    const r = await executeBuy(action(), opts(), document, FAST, ok);
    expect(r.stage).toBe('insufficient-ui');
    expect(r.clicked).toBe(false);
    expect(r.detail).toMatch(/cash/);
    expect(log).not.toContain('confirm');
  });

  it("stops at fomo's below-minimum label", async () => {
    const log = wireBuy({ readyLabel: 'Minimum buy is $1' });
    const r = await executeBuy(action({ usd: 0.5 }), opts(), document, FAST, ok);
    expect(r.stage).toBe('below-minimum');
    expect(log).not.toContain('confirm');
  });

  it('refuses when fomo\'s quoted impact is above the cap', async () => {
    const log = wireBuy();
    impactSpan().textContent = '-12%';
    const r = await executeBuy(action(), opts({ maxImpactPct: 10 }), document, FAST, ok);
    expect(r.stage).toBe('impact-too-high');
    expect(r.impactPct).toBe(12);
    expect(log).not.toContain('confirm');
  });

  it('refuses when the liquidity estimate is above the cap, even if the page looks fine', async () => {
    const log = wireBuy();
    const r = await executeBuy(action(), opts({ estimatedImpactPct: 14 }), document, FAST, ok);
    expect(r.stage).toBe('impact-too-high');
    expect(log).not.toContain('confirm');
  });

  it('refuses when no impact is shown and there is no estimate', async () => {
    const log = wireBuy();
    impactSpan().parentElement!.remove();
    const r = await executeBuy(action(), opts(), document, FAST, ok);
    expect(r.stage).toBe('impact-too-high');
    expect(log).not.toContain('confirm');
  });

  it('…but goes ahead on a liquidity estimate within the cap', async () => {
    const log = wireBuy();
    impactSpan().parentElement!.remove();
    const r = await executeBuy(action(), opts({ estimatedImpactPct: 0.5 }), document, FAST, ok);
    expect(r.stage).toBe('submitted');
    expect(log).toContain('confirm');
  });

  it("refuses a worded impact warning it can't read", async () => {
    const log = wireBuy();
    openDrawer('<div class="row"><span>Price impact</span><span>Very high</span></div>');
    const r = await executeBuy(action(), opts({ estimatedImpactPct: 0.5 }), document, FAST, ok);
    expect(r.stage).toBe('impact-too-high');
    expect(log).not.toContain('confirm');
  });

  it('a dry run stops before pressing, with a helpful note', async () => {
    const log = wireBuy();
    const r = await executeBuy(action(), opts({ dryRun: true }), document, FAST, ok);
    expect(r.stage).toBe('dry-run');
    expect(r.clicked).toBe(false);
    expect(r.detail).toBe('Ready to buy $5.00 of SOL (impact 0%). Dry run — not pressed.');
    expect(log).not.toContain('confirm');
  });

  it('a practice run is always a dry run and never reaches the guard', async () => {
    const log = wireBuy();
    let guarded = false;
    const r = await executeBuy(action(), opts({ dryRun: false, practice: true }), document, FAST, () => ((guarded = true), null));
    expect(r.stage).toBe('dry-run');
    expect(r.detail).toMatch(/stopped right before pressing “Buy SOL”.*Nothing was bought/);
    expect(guarded).toBe(false);
    expect(log).not.toContain('confirm');
  });

  it('dry runs and practice runs never tick acknowledgement boxes', async () => {
    for (const o of [opts({ dryRun: true }), opts({ practice: true })]) {
      document.body.innerHTML = html;
      const log = wireBuy({ needsAck: 'impact' });
      const r = await executeBuy(action(), o, document, FAST, ok);
      expect(r.stage).toBe('dry-run');
      expect(document.querySelector<HTMLInputElement>('#ack')!.checked).toBe(false);
      expect(log).not.toContain('ack');
      expect(log).not.toContain('confirm');
    }
  });

  it('ticks an impact acknowledgement only when the impact is shown and within the cap', async () => {
    let log = wireBuy({ needsAck: 'impact' });
    expect((await executeBuy(action(), opts(), document, FAST, ok)).stage).toBe('submitted');
    expect(log).toEqual(['typed:5.00', 'ack', 'confirm']);

    // No number on the page (only an estimate): Tippy can't vouch for the box.
    document.body.innerHTML = html;
    log = wireBuy({ needsAck: 'slippage' });
    impactSpan().parentElement!.remove();
    const r = await executeBuy(action(), opts({ estimatedImpactPct: 0.5 }), document, FAST, ok);
    expect(r.stage).toBe('impact-too-high');
    expect(log).not.toContain('ack');
    expect(log).not.toContain('confirm');
  });

  it('leaves risk boxes alone when the user said no', async () => {
    const log = wireBuy({ needsAck: 'risk' });
    const r = await executeBuy(action(), opts({ acceptRiskWarnings: false }), document, FAST, ok);
    expect(r.clicked).toBe(false);
    expect(log).not.toContain('ack');
    expect(log).not.toContain('confirm');
  });

  it('never presses on an amount someone else changed', async () => {
    const log = wireBuy();
    setTimeout(() => {
      amount().value = '50';
    }, 300);
    const r = await executeBuy(action(), opts(), document, FAST, ok);
    expect(r.stage).toBe('stalled');
    expect(r.step).toBe('amount');
    expect(log).not.toContain('confirm');
  });

  it('re-checks the amount after the guard', async () => {
    const log = wireBuy();
    const r = await executeBuy(action(), opts(), document, FAST, async () => {
      amount().value = '500';
      return null;
    });
    expect(r.stage).toBe('stalled');
    expect(log).not.toContain('confirm');
  });

  it('re-checks the tab and the impact after the guard', async () => {
    let log = wireBuy();
    let r = await executeBuy(action(), opts(), document, FAST, async () => (tabs().sell.click(), null));
    expect(r.stage).toBe('stalled');
    expect(log).not.toContain('confirm');

    document.body.innerHTML = html;
    log = wireBuy();
    r = await executeBuy(action(), opts(), document, FAST, async () => ((impactSpan().textContent = '-30%'), null));
    expect(r).toMatchObject({ stage: 'impact-too-high', impactPct: 30, clicked: false });
    expect(log).not.toContain('confirm');
  });

  it('never presses if the guard says no at the last moment', async () => {
    const log = wireBuy();
    const r = await executeBuy(action(), opts(), document, FAST, () => 'The buy was cancelled or changed.');
    expect(r.stage).toBe('aborted');
    expect(r.clicked).toBe(false);
    expect(r.detail).toBe('The buy was cancelled or changed.');
    expect(log).not.toContain('confirm');
  });

  it('never presses if the Sell tab came back', async () => {
    const log = wireBuy();
    setTimeout(() => tabs().sell.click(), 320);
    const r = await executeBuy(action(), opts(), document, FAST, ok);
    expect(r.clicked).toBe(false);
    expect(log).not.toContain('confirm');
  });

  it("waits out a briefly disabled Buy tab, gives up if it stays disabled", async () => {
    let log = wireBuy({ startOn: 'sell' });
    tabs().buy.setAttribute('disabled', '');
    setTimeout(() => tabs().buy.removeAttribute('disabled'), 120);
    expect((await executeBuy(action(), opts(), document, FAST, ok)).stage).toBe('submitted');
    expect(log[0]).toBe('tab:buy');

    document.body.innerHTML = html;
    log = wireBuy({ startOn: 'sell' });
    tabs().buy.setAttribute('disabled', '');
    const r = await executeBuy(action(), opts(), document, FAST, ok);
    expect(r).toMatchObject({ stage: 'stalled', step: 'buy-tab', clicked: false });
    expect(log).toEqual([]);
  });

  it("won't type into an amount box that isn't in dollars", async () => {
    const log = wireBuy();
    amount().previousElementSibling!.textContent = 'SOL';
    const r = await executeBuy(action(), opts(), document, FAST, ok);
    expect(r.clicked).toBe(false);
    expect(log).toEqual([]);
  });

  it("counts fomo's \"Bought …\" strip as submitted (and says so)", async () => {
    wireBuy({ clearsAmount: false, showsStrip: true });
    const r = await executeBuy(action(), opts(), document, FAST, ok);
    expect(r).toMatchObject({ stage: 'submitted', clicked: true, bought: true });
  });

  it('notices the strip that follows a cleared box', async () => {
    wireBuy({ clearsAmount: true, showsStrip: true });
    const r = await executeBuy(action(), opts(), document, FAST, ok);
    expect(r).toMatchObject({ stage: 'submitted', bought: true });
  });

  it("an earlier buy's strip still on screen proves nothing", async () => {
    const log = wireBuy({ clearsAmount: false, showsStrip: false });
    openDrawer(BOUGHT_STRIP);
    const r = await executeBuy(action(), opts(), document, FAST, ok);
    expect(r.stage).toBe('clicked');
    expect(r.clicked).toBe(true);
    expect(r.bought).toBeFalsy();
    expect(log.filter((l) => l === 'confirm')).toHaveLength(1);
  });

  it("reports 'clicked' (balance decides) when nothing visibly changes, and presses only once", async () => {
    const log = wireBuy({ clearsAmount: false, showsStrip: false });
    const r = await executeBuy(action(), opts(), document, FAST, ok);
    expect(r).toMatchObject({ stage: 'clicked', clicked: true });
    expect(log.filter((l) => l === 'confirm')).toHaveLength(1);
  });

  it('a throw after the press still reports clicked', async () => {
    wireBuy();
    confirmBtn().addEventListener('click', () => {
      Object.defineProperty(amount(), 'value', {
        get() {
          throw new Error('page fell over');
        },
        set() {},
      });
    });
    const r = await executeBuy(action(), opts(), document, FAST, ok);
    expect(r).toMatchObject({ stage: 'error', clicked: true });
  });
});

describe('one trade at a time', () => {
  const sell = (over: Partial<SellAction> = {}): SellAction => ({
    type: 'sell',
    planId: 'p',
    key: KEY,
    level: { kind: 'tp', id: 'tp1' },
    targetRemaining: 0,
    sellAmount: 0.05,
    sellUsd: 3,
    sellPctOfCurrent: 33.3,
    reason: 'take-profit 2x',
    gapFill: false,
    priority: 1,
    queuedAt: 0,
    ...over,
  });

  it('a sell waits its turn while a buy is running', async () => {
    const log = wireBuy();
    const buying = executeBuy(action(), opts(), document, FAST, ok);
    const s = await executeSell(sell(), { ...opts(), dryRun: true }, document, FAST);
    expect(s.stage).toBe('busy');
    expect((await buying).stage).toBe('submitted');
    expect(log).toEqual(['typed:5.00', 'confirm']);
  });

  it('a buy waits its turn while a sell is running, and the lock is freed after', async () => {
    const log = wireBuy();
    const selling = executeSell(sell(), { ...opts(), dryRun: true }, document, FAST);
    const b = await executeBuy(action(), opts(), document, FAST, ok);
    expect(b.stage).toBe('busy');
    expect(b.clicked).toBe(false);
    await selling;
    expect(log).not.toContain('confirm');

    document.body.innerHTML = html;
    wireBuy();
    expect((await executeBuy(action(), opts(), document, FAST, ok)).stage).toBe('submitted');
  });
});
