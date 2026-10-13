// Drives fomo's Buy panel for one limit buy (or a practice run). Built like
// executeSell (steps.ts), with stricter rules because a buy spends your cash:
//  - One trade per tab: shares executeSell's lock.
//  - Always types the exact USD amount (to the cent), never fomo's $ presets, and
//    re-checks it on every look. A different amount is never pressed.
//  - Only a button labelled exactly "Buy <SYMBOL>" counts. "Buy anyway", "Buy
//    with high impact"… mean fomo wants a decision Tippy shouldn't make.
//  - Price impact always fails closed: over the cap, unreadable, or not shown at
//    all (with no liquidity estimate either) means no buy.
//  - "Insufficient balance" (not enough cash) and below-minimum labels end the
//    attempt; nothing is re-pressed.
//  - Dry runs and practice runs stop before ticking anything or pressing.
//  - After the press, the amount clearing or fomo's "Bought …" strip counts as
//    submitted; the background still confirms by your balance, never a toast.

import type { BuyAction } from '../engine/types';
import type { ExecOptions, ExecResult } from '../shared/messages';
import { press, setControlledValue, sleep, waitFor } from './dom';
import {
  amountInUsd,
  findAcks,
  findAmountInput,
  findConfirmSlot,
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
import { claimTradeLock, DEFAULT_TIMEOUTS, escapeRe, releaseTradeLock, stalled, STEP_MS, type ConfirmGuard, type StepTimeouts } from './steps';

/** How long to keep watching for fomo's "Bought …" strip once the amount box has cleared. */
const STRIP_MS = 1_500;

const fmtPct = (n: number) => `${+n.toFixed(2)}%`;

/**
 * Buy `action.usd` of cash worth of the coin on this page. `guard` runs right
 * before the press (right page, not paused, order still executing) and is
 * required: a buy never goes ahead without one.
 */
export async function executeBuy(
  action: BuyAction,
  options: ExecOptions,
  doc: Document = document,
  t: StepTimeouts = DEFAULT_TIMEOUTS,
  guard: ConfirmGuard,
): Promise<ExecResult> {
  if (!claimTradeLock()) return { stage: 'busy', clicked: false, detail: 'Another trade is already running in this tab.' };
  const progress = { clicked: false };
  try {
    return await run(action, options, doc, t, guard, progress);
  } catch (e) {
    // If anything threw after the press, the buy may have happened.
    return { stage: 'error', clicked: progress.clicked, detail: e instanceof Error ? e.message : String(e) };
  } finally {
    releaseTradeLock();
  }
}

async function run(action: BuyAction, options: ExecOptions, doc: Document, t: StepTimeouts, guard: ConfirmGuard, progress: { clicked: boolean }): Promise<ExecResult> {
  const fresh = (prev: TradePanel) => findTradePanel(doc) ?? prev;
  // A practice run is always a dry run, whatever else the caller says.
  const dryRun = options.dryRun || options.practice === true;
  const cap = options.maxImpactPct;
  const estimate = Number.isFinite(options.estimatedImpactPct) ? (options.estimatedImpactPct as number) : null;

  const symbol = options.symbol?.trim();
  if (!symbol) return { stage: 'error', clicked: false, detail: "Tippy doesn't know this coin's symbol, so it won't press Buy." };
  // Buys only ever press "Buy <SYMBOL>" exactly.
  const READY = new RegExp(`^buy\\s+\\$?${escapeRe(symbol)}$`, 'i');
  const button = `“Buy ${symbol}”`;

  // The exact amount, floored to the cent (toFixed first so 10.1 stays $10.10).
  const cents = Math.floor(Number((action.usd * 100).toFixed(6)));
  if (!Number.isFinite(cents) || cents < 1) return { stage: 'error', clicked: false, detail: 'Unknown buy size.' };
  if (!(cap >= 0)) return { stage: 'impact-too-high', clicked: false, detail: "Tippy has no price-impact limit for buys, so it won't buy.", impactPct: null };
  const typed = (cents / 100).toFixed(2);
  const money = `$${typed}`;
  // What Tippy typed. Anything else at any later look means someone or something
  // changed it — never press on a different amount.
  const sameAmount = (q: TradePanel) => {
    const v = (findAmountInput(q)?.value ?? '').replace(/[$,\s]/g, '');
    return v !== '' && Math.abs(Number(v) - cents / 100) < 0.005;
  };
  const amountChanged = () => stalled('amount', 'The amount changed after Tippy typed it.');

  // 1. Panel
  const panel = await waitFor(() => findTradePanel(doc), t.panel);
  if (!panel) {
    if (looksLoggedOut(doc)) return { stage: 'logged-out', clicked: false, detail: 'You look logged out of fomo.' };
    return { stage: 'no-panel', clicked: false, detail: "Tippy can't find fomo's trade panel." };
  }

  // 2. Buy tab (fomo may disable it while the page loads)
  if (isDisabled(panel.buyTab) && !(await waitFor(() => !isDisabled(fresh(panel).buyTab), t.tab))) {
    return stalled('buy-tab', "fomo's Buy tab stayed disabled — buying may be switched off for this coin.");
  }
  if (!isSelected(fresh(panel).buyTab)) {
    press(fresh(panel).buyTab);
    if (!(await waitFor(() => isSelected(fresh(panel).buyTab), t.tab))) return stalled('buy-tab', 'The Buy tab did not open.');
  }
  let p = fresh(panel);

  // 3. Amount: always typed in dollars, never a preset.
  const input = findAmountInput(p);
  if (!input) return { stage: 'no-panel', clicked: false, detail: "Tippy can't find the amount box." };
  if (!amountInUsd(p)) return { stage: 'error', clicked: false, detail: "fomo's amount box isn't in dollars, so Tippy didn't type anything." };
  setControlledValue(input, typed);
  await sleep(250);

  // 4. Quote: the Buy button has to be enabled, say exactly "Buy <SYMBOL>", and stay that way.
  let insufficientSince: number | null = null;
  let belowSince: number | null = null;
  let readySince: number | null = null;
  const quoteEnd = Date.now() + t.quote;
  let ready = false;
  while (Date.now() < quoteEnd) {
    p = fresh(p);
    if (!isSelected(p.buyTab)) return stalled('buy-tab', 'The Buy tab closed while Tippy waited for a quote.');
    if (!sameAmount(p)) return amountChanged();
    const slot = findConfirmSlot(p);
    const label = textOf(slot);
    const now = Date.now();
    if (TEXT.insufficient.test(label)) {
      readySince = belowSince = null;
      insufficientSince ??= now;
      if (now - insufficientSince >= t.insufficient) {
        return { stage: 'insufficient-ui', clicked: false, detail: `fomo says your cash (USDC) is too low for this ${money} buy.` };
      }
    } else if (TEXT.belowMinimum.test(label)) {
      readySince = insufficientSince = null;
      belowSince ??= now;
      if (now - belowSince >= t.insufficient) return { stage: 'below-minimum', clicked: false, detail: `${money} is under fomo's minimum buy.` };
    } else {
      insufficientSince = belowSince = null;
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
  //    liquidity estimate. For buys every doubt is a no.
  const impactProblem = (): ExecResult | null => {
    const read = readImpact(fresh(p));
    const pct = Math.max(read.pct ?? -1, estimate ?? -1);
    if (pct > cap) return { stage: 'impact-too-high', clicked: false, detail: `Buying now would move the price about ${fmtPct(pct)} (your limit is ${cap}%).`, impactPct: pct };
    if (read.unreadable) return { stage: 'impact-too-high', clicked: false, detail: "fomo shows a price-impact warning Tippy couldn't read, so it didn't buy.", impactPct: read.pct };
    if (read.pct == null && estimate == null) return { stage: 'impact-too-high', clicked: false, detail: "Tippy couldn't see this buy's price impact, so it didn't buy.", impactPct: null };
    return null;
  };
  const impactBefore = impactProblem();
  if (impactBefore) return impactBefore;
  const shown = readImpact(p).pct; // fomo's own number, when it shows one
  const impactPct = shown ?? estimate;
  const impactText = shown != null ? `impact ${fmtPct(shown)}` : `about ${fmtPct(estimate ?? 0)} impact, estimated`;
  const readyText = (warnings: number) =>
    options.practice
      ? `Practice went fine: Tippy typed ${money}, fomo quoted it (${impactText}), and Tippy stopped right before pressing ${button}${warnings ? ` (it would also tick ${warnings} warning box${warnings > 1 ? 'es' : ''})` : ''}. Nothing was bought.`
      : `Ready to buy ${money} of ${symbol} (${impactText})${warnings ? ` after accepting ${warnings} warning(s)` : ''}. Dry run — ${warnings ? 'nothing ticked or pressed' : 'not pressed'}.`;

  // 6. Acknowledgements: tick only what the user allows (never in a dry run).
  if (!ready) {
    const acks = findAcks(p).filter((a) => !a.checked);
    if (acks.length === 0) {
      if (TEXT.belowMinimum.test(textOf(findConfirmSlot(p)))) return { stage: 'below-minimum', clicked: false, detail: `${money} is under fomo's minimum buy.` };
      return stalled('quote', `fomo didn't get ${button} ready in time.`);
    }
    for (const a of acks) {
      // An impact box only when fomo shows a number Tippy can check against your limit.
      const allowed = a.kind === 'impact' ? shown != null && shown <= cap : options.acceptRiskWarnings;
      if (!allowed) {
        const detail = a.kind === 'impact' ? "fomo asked to accept a price-impact warning Tippy couldn't check, so it didn't buy." : `fomo asked to accept a ${a.kind} warning and your settings say no.`;
        return { stage: 'impact-too-high', clicked: false, detail, impactPct };
      }
    }
    if (dryRun) return { stage: 'dry-run', clicked: false, detail: readyText(acks.length), impactPct };
    for (const a of acks) {
      press(a.el);
      await sleep(STEP_MS);
    }
    const unlocked = await waitFor(() => {
      const slot = findConfirmSlot(fresh(p));
      return slot && READY.test(textOf(slot)) && !isDisabled(slot) ? slot : null;
    }, t.ack);
    if (!unlocked) return stalled('ack', 'The Buy button stayed locked after accepting warnings.');
    await sleep(t.settle);
    p = fresh(p);
    // Accepting warnings can reveal more: re-apply every impact rule.
    const impactAfter = impactProblem();
    if (impactAfter) return impactAfter;
  }

  // 7. Dry runs and practice runs stop here.
  if (dryRun) return { stage: 'dry-run', clicked: false, detail: readyText(0), impactPct };

  // 8. Last look, immediately before pressing.
  const notReady = (q: TradePanel): ExecResult | null => {
    const confirm = findConfirmSlot(q);
    if (!isSelected(q.buyTab)) return stalled('confirm', 'The Buy tab is no longer active.');
    if (!confirm || !READY.test(textOf(confirm)) || isDisabled(confirm)) return stalled('confirm', `fomo's ${button} button changed at the last moment.`);
    if (!sameAmount(q)) return amountChanged();
    return impactProblem();
  };
  p = fresh(p);
  const before = notReady(p);
  if (before) return before;
  const guardProblem = await guard();
  if (guardProblem) return { stage: 'aborted', clicked: false, detail: guardProblem };
  // the guard may have taken a moment — re-check everything one last time
  const last = fresh(p);
  const after = notReady(last);
  if (after) return after;
  const final = findConfirmSlot(last)!;
  // A "Bought …" strip already open (an earlier buy) proves nothing about this one.
  const stripBefore = panelSays(last, TEXT.bought);

  progress.clicked = true;
  press(final);

  // 9. fomo clears the amount and opens a "Buying …" → "Bought …" strip (recon
  //    2026-10-11). Either counts as submitted; the balance still has the final say.
  const bought = (q: TradePanel | null) => !!q && !stripBefore && panelSays(q, TEXT.bought);
  const outcome = await waitFor(() => {
    const q = findTradePanel(doc);
    if (!q) return 'gone';
    if (bought(q)) return 'bought';
    const v = findAmountInput(q)?.value ?? '';
    return v === '' || v === '0' ? 'cleared' : null;
  }, t.submit);
  if (outcome === 'bought' || outcome === 'cleared') {
    // The box clears first; the strip follows a moment later.
    const strip = outcome === 'bought' || !!(await waitFor(() => bought(findTradePanel(doc)), Math.min(t.submit, STRIP_MS)));
    return { stage: 'submitted', clicked: true, bought: strip, detail: `Buy sent: ${money} of ${symbol} — checking your balance.`, impactPct };
  }
  return { stage: 'clicked', clicked: true, detail: `${button} pressed — checking your balance.`, impactPct };
}
