// Tippy's levels drawn on fomo's own chart (TradingView) as dashed lines:
// limit buys green, take-profits blue, stops red (the stop loss and partial
// stops alike), a running trailing stop amber.
// The content script (isolated world) works out the lines; a tiny main-world
// script (entrypoints/fomo-chart.content.ts) draws them, because TradingView's
// drawing API lives in the page. Lines go over as JSON in a DOM event — nothing
// else crosses, and a "line moved" event coming back is only ever a *proposal*
// the user confirms in Tippy's own window.

import { isLiveBuy } from '../engine/buys';
import { formatUsd, triggerPrice } from '../engine/triggers';
import type { BuyOrder, Entry, Plan, Trigger } from '../engine/types';

export { LINES_EVENT, MOVED_EVENT, MOVED_SOURCE } from './chartProtocol';
export type { ChartLine, ChartLineKind, ChartMove, ChartPayload, MovedMessage } from './chartProtocol';
import type { ChartLine, ChartMove } from './chartProtocol';

/** A trigger as a price and a market cap, measured from `ref` (entry for plans, the placed-at price for buys). */
function place(trigger: Trigger, ref: Entry): { price: number; mc: number | null } | null {
  const price = triggerPrice(trigger, ref);
  if (!Number.isFinite(price) || price <= 0) return null;
  const mc = trigger.kind === 'mc' ? trigger.value : ref.mc && ref.priceUSD > 0 ? (price / ref.priceUSD) * ref.mc : null;
  return { price, mc };
}

/** Every line for one coin: its running plan's open levels and its live limit buys. */
export function chartLinesFor(key: string, plans: Plan[], buys: BuyOrder[]): ChartLine[] {
  const lines: ChartLine[] = [];
  const plan = plans.find((p) => p.key === key && (p.state === 'armed' || p.state === 'paused'));
  if (plan) {
    const muted = plan.state === 'paused';
    plan.tps.forEach((t, i) => {
      if (t.status !== 'waiting' && t.status !== 'queued' && t.status !== 'held') return;
      const at = place(t.trigger, plan.entry);
      if (at) lines.push({ id: `tp:${plan.id}:${t.id}`, kind: 'tp', ...at, label: `Tippy · TP${i + 1} · ${t.sellPct}%`, draggable: t.status === 'waiting', muted });
    });
    // Partial stops ("sell 10% if it drops to $700K"): red like the stop loss, labelled with their size.
    (plan.stops ?? []).forEach((st) => {
      if (st.status !== 'waiting' && st.status !== 'queued' && st.status !== 'held') return;
      const at = place(st.trigger, plan.entry);
      if (at) lines.push({ id: `stop:${plan.id}:${st.id}`, kind: 'sl', ...at, label: `Tippy · SL · ${+st.sellPct.toFixed(1)}%`, draggable: st.status === 'waiting', muted });
    });
    if (plan.sl && (plan.sl.status === 'waiting' || plan.sl.status === 'queued' || plan.sl.status === 'held')) {
      const at = place(plan.sl.trigger, plan.entry);
      if (at) lines.push({ id: `sl:${plan.id}`, kind: 'sl', ...at, label: 'Tippy · SL · sell rest', draggable: plan.sl.status === 'waiting', muted });
    }
    const tr = plan.trailing;
    if (tr?.active && tr.peakPrice && tr.status === 'waiting') {
      const price = tr.peakPrice * (1 - tr.trailPct / 100);
      const mc = plan.entry.mc && plan.entry.priceUSD > 0 ? (price / plan.entry.priceUSD) * plan.entry.mc : null;
      lines.push({ id: `trail:${plan.id}`, kind: 'trail', price, mc, label: `Tippy · trail ${tr.trailPct}%`, draggable: false, muted });
    }
  }
  for (const o of buys) {
    if (o.key !== key || !isLiveBuy(o) || (o.state !== 'armed' && o.state !== 'queued')) continue;
    const at = place(o.trigger, o.ref);
    if (at) lines.push({ id: `buy:${o.id}`, kind: 'buy', ...at, label: `Tippy · BUY ${formatUsd(o.usd)}`, draggable: o.state === 'armed' });
  }
  return lines;
}

/** "Move your stop loss to $2.9M MC?" / "Move your 10% stop to $650K MC?" — what a dragged line would change, in words. */
export function describeMove(line: ChartLine, move: ChartMove): string {
  const where = move.axis === 'mc' ? `${formatUsd(move.value)} MC` : formatUsd(move.value);
  const parts = line.label.replace(/^Tippy · /, '').split(' · ');
  const what =
    line.kind === 'buy'
      ? 'limit buy'
      : line.id.startsWith('stop:')
        ? `${parts[1] ? `${parts[1]} ` : ''}stop` // a partial stop: "Tippy · SL · 10%"
        : line.kind === 'sl'
          ? 'stop loss'
          : parts[0];
  return `Move your ${what} to ${where}?`;
}

/** "$0.48", "$2", "$12.50". */
const usdText = (n: number) => (n > 0 && n < 1 ? `$${n.toFixed(2)}` : formatUsd(n).replace(/\.00$/, ''));

/**
 * A partial stop dragged so low that its slice would be under fomo's minimum
 * sell there: Tippy would skip it when it hits, so say so before moving it.
 */
export function stopTooSmall(plan: Plan, stopId: string, trigger: Trigger, minSellUsd: number): string | null {
  const st = (plan.stops ?? []).find((s) => s.id === stopId);
  const price = triggerPrice(trigger, plan.entry);
  if (!st || !(minSellUsd > 0) || !(price > 0) || !Number.isFinite(price)) return null;
  const usd = ((plan.origBalance * st.sellPct) / 100) * price;
  if (usd >= minSellUsd) return null;
  const where = trigger.kind === 'mc' ? `${formatUsd(trigger.value)} MC` : formatUsd(price);
  return `At ${where} your ${+st.sellPct.toFixed(1)}% stop would sell ${usdText(usd)} — under fomo's ${usdText(minSellUsd)} minimum sell, so Tippy would skip it. Keep it higher, or make it bigger.`;
}

/** The trigger a drop means: the axis's own units (market cap or price), so it stays exactly where it was dropped. */
export function triggerFromMove(move: ChartMove): Trigger {
  return move.axis === 'mc' ? { kind: 'mc', value: move.value } : { kind: 'price', value: move.value };
}
