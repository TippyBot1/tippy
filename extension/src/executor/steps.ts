// Drives fomo's Sell panel for one order. Each step has its own timeout; when a
// step stalls (common in background tabs: paused animations, slowed polling) we
// return 'stalled' so the background can bring the tab forward and retry. The
// machine reads the panel from scratch every time, so a retry is safe.
//
// Safety rules (from the 2026-10-11 review):
//  - Only the Sell button's own label counts as "Insufficient balance", and only
//    if it stays that way for a moment; the background re-checks the real
//    balance before concluding anything (stage 'insufficient-ui').
//  - Price impact is read from the panel *and* fomo's quote drawer. An impact
//    warning Tippy can't read is treated as too high when the caller asks to
//    fail closed (take-profits), never as 0%.
//  - Right before pressing: Sell tab still active, button still says "Sell…",
//    amount unchanged, and the caller's guard (right coin page) still passes.

import type { SellAction } from '../engine/types';
import type { ExecOptions, ExecResult } from '../shared/messages';
import { press, setControlledValue, sleep, waitFor } from './dom';
import {
  findAcks,
  findAmountInput,
  findConfirmSlot,
  findMax,
  findPercentPreset,
  findTradePanel,
  isDisabled,
  isSelected,
  looksLoggedOut,
  panelSays,
  readImpact,
  TEXT,
  textOf,
  type TradePanel,
} from './selectors';

export interface StepTimeouts {
  panel: number;
  tab: number;
  quote: number;
  ack: number;
  submit: number;
  /** The Sell button must stay ready this long before Tippy trusts the quote. */
  settle: number;
  /** "Insufficient balance" must persist this long before Tippy gives up. */
  insufficient: number;
}

export const DEFAULT_TIMEOUTS: StepTimeouts = { panel: 20_000, tab: 5_000, quote: 10_000, ack: 3_000, submit: 15_000, settle: 700, insufficient: 1_500 };

/** Returns an error message to abort right before pressing confirm, or null to go ahead. */
export type ConfirmGuard = () => string | null | Promise<string | null>;

export const STEP_MS = 150;
const SELL_LABEL = /^sell\b/i;
export const escapeRe = (x: string) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

let busy = false;

/**
 * One trade per tab at a time. Sells and buys (executor/buy.ts) share this lock,
 * so Tippy never has two hands on fomo's panel at once.
 */
export function claimTradeLock(): boolean {
  if (busy) return false;
  busy = true;
  return true;
}

export function releaseTradeLock() {
  busy = false;
}

export async function executeSell(
  action: SellAction,
  options: ExecOptions,
  doc: Document = document,
  t: StepTimeouts = DEFAULT_TIMEOUTS,
  guard: ConfirmGuard = () => null,
): Promise<ExecResult> {
  if (!claimTradeLock()) return { stage: 'busy', clicked: false, detail: 'Another trade is already running in this tab.' };
  const progress = { clicked: false };
  try {
    return await run(action, options, doc, t, guard, progress);
  } catch (e) {
    // If anything threw after the press, the sell may have happened.
    return { stage: 'error', clicked: progress.clicked, detail: e instanceof Error ? e.message : String(e) };
  } finally {
    releaseTradeLock();
  }
}

async function run(action: SellAction, options: ExecOptions, doc: Document, t: StepTimeouts, guard: ConfirmGuard, progress: { clicked: boolean }): Promise<ExecResult> {
  const fresh = (prev: TradePanel) => findTradePanel(doc) ?? prev;
  // Take-profits only press "Sell <SYMBOL>" exactly; anything else ("Sell anyway",
  // "Sell with high impact"…) means fomo wants a decision Tippy shouldn't make.
  const READY = options.failClosedOnUnknownImpact && options.symbol ? new RegExp(`^sell\\s+\\$?${escapeRe(options.symbol)}$`, 'i') : SELL_LABEL;

  // 1. Panel
  const panel = await waitFor(() => findTradePanel(doc), t.panel);
  if (!panel) {
    if (looksLoggedOut(doc)) return { stage: 'logged-out', clicked: false, detail: 'You look logged out of fomo.' };
    return { stage: 'no-panel', clicked: false, detail: "Tippy can't find fomo's trade panel." };
  }

  // 2. Sell tab (fomo may disable it until your position loads)
  if (isDisabled(panel.sellTab) && !(await waitFor(() => !isDisabled(fresh(panel).sellTab), t.tab))) {
    return { stage: 'insufficient-ui', clicked: false, detail: "fomo's Sell tab stayed disabled." };
  }
  if (!isSelected(fresh(panel).sellTab)) {
    press(fresh(panel).sellTab);
    if (!(await waitFor(() => isSelected(fresh(panel).sellTab), t.tab))) return stalled('sell-tab', 'The Sell tab did not open.');
  }
  let p = fresh(panel);

  // 3. Amount: the 100% preset for "sell the rest", a matching % preset, or typed USD.
  const pct = action.sellPctOfCurrent;
  const sellAll = pct >= 99.5;
  const pickPreset = (q: TradePanel) => (sellAll ? (findMax(q) ?? findPercentPreset(q, 100)) : Math.abs(Math.round(pct) - pct) < 0.5 ? findPercentPreset(q, pct) : null);
  let typed: string | null = null; // what Tippy typed, when it typed (vs. a preset)
  const setAmount = async (): Promise<ExecResult | null> => {
    const q = fresh(p);
    if (pickPreset(q)) {
      // Presets stay disabled until fomo has loaded your position.
      const ready = await waitFor(() => {
        const b = pickPreset(fresh(p));
        return b && !isDisabled(b) ? b : null;
      }, t.quote);
      if (!ready) return stalled('preset', "fomo's % buttons didn't become available.");
      press(ready);
      return null;
    }
    if (sellAll) return stalled('preset', "fomo's 100% button is missing.");
    const input = findAmountInput(q);
    if (!input) return { stage: 'no-panel', clicked: false, detail: "Tippy can't find the amount box." };
    if (action.sellUsd == null) return { stage: 'error', clicked: false, detail: 'Unknown sell size.' };
    typed = (Math.floor(action.sellUsd * 100) / 100).toFixed(2);
    setControlledValue(input, typed);
    return null;
  };
  const amountProblem = await setAmount();
  if (amountProblem) return amountProblem;
  // What Tippy put in the box. Anything else at the last moment means someone or
  // something changed it — never press on a different amount.
  await sleep(250);
  // A preset fills from fomo's idea of your position, which can be stale. If it
  // doesn't match what Tippy sized (±10%), type the exact amount instead.
  if (typed == null && !sellAll && action.sellUsd != null && action.sellUsd > 0) {
    const filled = Number(findAmountInput(fresh(p))?.value ?? NaN);
    if (!(Math.abs(filled - action.sellUsd) <= action.sellUsd * 0.1)) {
      const input = findAmountInput(fresh(p));
      if (!input) return { stage: 'no-panel', clicked: false, detail: "Tippy can't find the amount box." };
      typed = (Math.floor(action.sellUsd * 100) / 100).toFixed(2);
      setControlledValue(input, typed);
      await sleep(250);
    }
  }
  // Typed: we know exactly what it must be. Preset: whatever fomo filled in.
  let expected = typed ?? findAmountInput(fresh(p))?.value ?? '';
  const sameAmount = (v: string) => (v === expected ? true : Math.abs(Number(v) - Number(expected)) <= Math.max(0.005 * Math.abs(Number(expected)), 0.01));

  // 4. Quote: the Sell button has to be enabled, say "Sell…", and stay that way.
  let insufficientSince: number | null = null;
  let readySince: number | null = null;
  let repressed = false;
  const quoteEnd = Date.now() + t.quote;
  let ready = false;
  while (Date.now() < quoteEnd) {
    p = fresh(p);
    const slot = findConfirmSlot(p);
    const label = textOf(slot);
    const now = Date.now();
    if (!sameAmount(findAmountInput(p)?.value ?? '')) return stalled('amount', 'The amount changed after Tippy set it.');
    if (TEXT.insufficient.test(label)) {
      readySince = null;
      insufficientSince ??= now;
      if (now - insufficientSince >= t.insufficient) {
        // A USD amount fixed by the 100% preset goes stale as the price moves: refresh it once.
        if (sellAll && !repressed) {
          repressed = true;
          insufficientSince = null;
          const again = await setAmount();
          if (again) return again;
          await sleep(250);
          expected = typed ?? findAmountInput(fresh(p))?.value ?? '';
        } else {
          return { stage: 'insufficient-ui', clicked: false, detail: 'fomo says there is not enough to sell.' };
        }
      }
    } else {
      insufficientSince = null;
      if (slot && READY.test(label) && !isDisabled(slot)) {
        readySince ??= now;
        if (now - readySince >= t.settle) {
          ready = true;
          break;
        }
      } else {
        readySince = null;
      }
    }
    await sleep(STEP_MS);
  }
  p = fresh(p);

  // 5. Price impact — fomo's inline quote, worded warnings, and the background's
  //    liquidity estimate. Unreadable warnings fail closed for take-profits.
  const impactProblem = (): ExecResult | null => {
    const read = readImpact(fresh(p));
    const pct = Math.max(read.pct ?? -1, options.estimatedImpactPct ?? -1);
    if (pct > options.maxImpactPct) return { stage: 'impact-too-high', clicked: false, detail: `Price impact is about ${+pct.toFixed(2)}% (your limit is ${options.maxImpactPct}%).`, impactPct: pct };
    if (read.unreadable && options.failClosedOnUnknownImpact) return { stage: 'impact-too-high', clicked: false, detail: "fomo shows a price-impact warning Tippy couldn't read, so it didn't sell.", impactPct: read.pct };
    if (read.pct == null && options.estimatedImpactPct == null && options.failClosedOnUnknownImpact) return { stage: 'impact-too-high', clicked: false, detail: "Tippy couldn't see this sell's price impact, so it didn't take profit.", impactPct: null };
    return null;
  };
  const impactBefore = impactProblem();
  if (impactBefore) return impactBefore;
  const impactPct = readImpact(p).pct;

  // 6. Acknowledgements: tick only what the user allows (never in a dry run).
  if (!ready) {
    const acks = findAcks(p).filter((a) => !a.checked);
    if (acks.length === 0) {
      if (TEXT.belowMinimum.test(textOf(findConfirmSlot(p)))) return { stage: 'below-minimum', clicked: false, detail: "This sell is under fomo's minimum." };
      return stalled('quote', 'fomo did not return a quote in time.');
    }
    for (const a of acks) {
      const allowed =
        a.kind === 'impact'
          ? impactPct != null
            ? impactPct <= options.maxImpactPct
            : !options.failClosedOnUnknownImpact // stops may OK an unreadable impact; take-profits never
          : options.acceptRiskWarnings;
      if (!allowed) return { stage: 'impact-too-high', clicked: false, detail: `fomo asked to confirm a ${a.kind} warning and your settings say no.`, impactPct };
    }
    if (options.dryRun) return { stage: 'dry-run', clicked: false, detail: `Ready to sell (${Math.round(pct)}%) after accepting ${acks.length} warning(s). Dry run — nothing ticked or clicked.`, impactPct };
    for (const a of acks) {
      press(a.el);
      await sleep(STEP_MS);
    }
    const unlocked = await waitFor(() => {
      const slot = findConfirmSlot(fresh(p));
      return slot && READY.test(textOf(slot)) && !isDisabled(slot) ? slot : null;
    }, t.ack);
    if (!unlocked) return stalled('ack', 'The sell button stayed locked after confirming warnings.');
    await sleep(t.settle);
    p = fresh(p);
    // Accepting warnings can reveal more: re-apply every impact rule.
    const impactAfter = impactProblem();
    if (impactAfter) return impactAfter;
  }

  // 7. Dry run stops here.
  if (options.dryRun) return { stage: 'dry-run', clicked: false, detail: `Ready to sell (${Math.round(pct)}%). Dry run — not clicked.`, impactPct };

  // 8. Last look, immediately before pressing.
  p = fresh(p);
  const confirm = findConfirmSlot(p);
  if (!isSelected(p.sellTab)) return stalled('confirm', 'The Sell tab is no longer active.');
  if (!confirm || !READY.test(textOf(confirm)) || isDisabled(confirm)) return stalled('confirm', 'The sell button is not ready.');
  if (!sameAmount(findAmountInput(p)?.value ?? '')) return stalled('amount', 'The amount changed after Tippy set it.');
  const guardProblem = await guard();
  if (guardProblem) return { stage: 'aborted', clicked: false, detail: guardProblem };
  // the guard may have taken a moment — re-check everything one last time
  const last = fresh(p);
  const final = findConfirmSlot(last);
  if (!final || !READY.test(textOf(final)) || isDisabled(final) || !isSelected(last.sellTab)) return stalled('confirm', 'The sell button changed at the last moment.');
  if (!sameAmount(findAmountInput(last)?.value ?? '')) return stalled('amount', 'The amount changed after Tippy set it.');

  progress.clicked = true;
  press(final);

  // 9. fomo clears the amount and opens a "Selling …" → "Sold …" strip (captured
  //    2026-10-11). Either counts as submitted; the balance still has the final say.
  const cleared = await waitFor(() => {
    const q = findTradePanel(doc);
    if (!q) return 'gone';
    if (panelSays(q, /(^|\s)Sold\s/)) return 'sold';
    const v = findAmountInput(q)?.value ?? '';
    return v === '' || v === '0' ? 'cleared' : null;
  }, t.submit);
  return cleared
    ? { stage: 'submitted', clicked: true, sold: cleared === 'sold', detail: 'Sell submitted.', impactPct }
    : { stage: 'clicked', clicked: true, detail: 'Sell clicked — confirming with your balance.', impactPct };
}

export function stalled(step: string, detail: string): ExecResult {
  return { stage: 'stalled', clicked: false, detail, step };
}

/** Quick self-check used by the options page and after each fomo update. */
export function healthCheck(doc: Document = document): { ok: boolean; missing: string[] } {
  const panel = findTradePanel(doc);
  if (!panel) return { ok: false, missing: ['trade panel'] };
  const missing: string[] = [];
  if (!findAmountInput(panel)) missing.push('amount box');
  if (!findConfirmSlot(panel)) missing.push('sell button');
  return { ok: missing.length === 0, missing };
}
