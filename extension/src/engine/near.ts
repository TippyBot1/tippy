// "Getting close" alerts: a heads-up when a coin is part of the way from your
// entry to its next take-profit (50% and 90% of the way by default), or within
// a few % above a stop (20% by default), so a fill is never a surprise. Pure:
// the runtime keeps what was sent on the plan (`plan.near`) and sends the words.
//
// Each milestone goes out once per level: editing the level starts it afresh, a
// price that dips and comes back doesn't repeat it, and there's a cap per coin
// per day so a choppy coin can't spam you.

import { formatUsd, formatX, triggerPrice } from './triggers';
import type { NearState, Plan, Quote, Trigger } from './types';

export type { NearState };

export interface NearSettings {
  /** Milestones on the way from your entry to the next take-profit, in % (50 = halfway). Empty = off. */
  tp: number[];
  /** Warn when the price is within this % above a stop. null = off. */
  sl: number | null;
  /** At most this many per coin per day. */
  maxPerDay: number;
}

export interface NearAlert {
  title: string;
  text: string;
}

const KEEP_MARKS = 60;

const utcDay = (now: number) => new Date(now).toISOString().slice(0, 10);

/** The level and the price now, in the same units the engine fires on (market cap when it can). */
function measure(trigger: Trigger, plan: Plan, quote: Quote): { cur: number; lvl: number; ref: number } {
  if (trigger.kind === 'mc' && quote.mc != null && quote.mc > 0 && plan.entry.mc != null && plan.entry.mc > 0) {
    return { cur: quote.mc, lvl: trigger.value, ref: plan.entry.mc };
  }
  return { cur: quote.priceUSD, lvl: triggerPrice(trigger, plan.entry), ref: plan.entry.priceUSD };
}

function levelText(trigger: Trigger): string {
  if (trigger.kind === 'mc') return `${formatUsd(trigger.value)} MC`;
  if (trigger.kind === 'x') return formatX(trigger.value);
  return formatUsd(trigger.value);
}

const nowText = (quote: Quote) => (quote.mc != null && quote.mc > 0 ? `${formatUsd(quote.mc)} MC now` : `${formatUsd(quote.priceUSD)} now`);
const pctOfBag = (p: number) => `${Math.round(p * 10) / 10}%`;

export function nearAlerts(plan: Plan, quote: Quote, cfg: NearSettings, now: number): { alerts: NearAlert[]; near: NearState | undefined } {
  if (plan.state !== 'armed' || !(quote.priceUSD > 0)) return { alerts: [], near: plan.near };
  const day = utcDay(now);
  const prev = plan.near;
  const state: NearState = prev ? { sent: [...prev.sent], day, n: prev.day === day ? prev.n : 0 } : { sent: [], day, n: 0 };
  const due: { marks: string[]; alert: NearAlert }[] = [];
  const sym = `$${plan.symbol}`;

  // The next take-profit up: how far along the way from your entry is the price?
  const milestones = [...new Set(cfg.tp.filter((m) => m > 0 && m < 100))].sort((a, b) => b - a);
  if (milestones.length) {
    const waiting = plan.tps
      .map((tp, i) => ({ tp, i, m: measure(tp.trigger, plan, quote) }))
      .filter(({ tp, m }) => tp.status === 'waiting' && Number.isFinite(m.lvl) && m.lvl > m.cur && m.lvl > m.ref)
      .sort((a, b) => a.m.lvl - b.m.lvl);
    const next = waiting[0];
    if (next) {
      const progress = ((next.m.cur - next.m.ref) / (next.m.lvl - next.m.ref)) * 100;
      const reached = milestones.find((m) => progress >= m);
      const mark = (m: number) => `tp:${next.tp.id}:${next.tp.trigger.kind}${next.tp.trigger.value}@${m}`;
      if (reached != null && !state.sent.includes(mark(reached))) {
        const label = plan.tps.length > 1 ? `take-profit ${next.i + 1}` : 'your take-profit';
        const way = reached === 50 ? 'halfway' : `${reached}% of the way`;
        due.push({
          // the lower milestones it jumped past go quiet too
          marks: milestones.filter((m) => m <= reached).map(mark),
          alert: {
            title: `📈 ${sym} is ${way} to your take-profit`,
            text: `${nowText(quote)}. ${label[0].toUpperCase()}${label.slice(1)} sells ${pctOfBag(next.tp.sellPct)} of your bag at ${levelText(next.tp.trigger)}.`,
          },
        });
      }
    }
  }

  // The nearest stop below: is the price within the warning distance above it?
  if (cfg.sl != null && cfg.sl > 0) {
    const stops = [
      ...(plan.stops ?? []).filter((s) => s.status === 'waiting').map((s) => ({ id: `st:${s.id}`, trigger: s.trigger, what: `your stop at ${levelText(s.trigger)}, which sells ${pctOfBag(s.sellPct)} of your bag` })),
      ...(plan.sl && plan.sl.status === 'waiting' ? [{ id: 'sl', trigger: plan.sl.trigger, what: `your stop loss at ${levelText(plan.sl.trigger)}, which sells the rest` }] : []),
    ]
      .map((s) => ({ ...s, m: measure(s.trigger, plan, quote) }))
      .filter((s) => Number.isFinite(s.m.lvl) && s.m.lvl > 0 && s.m.lvl < s.m.cur)
      .sort((a, b) => b.m.lvl - a.m.lvl);
    const nearest = stops[0];
    if (nearest) {
      const above = ((nearest.m.cur - nearest.m.lvl) / nearest.m.cur) * 100;
      const mark = `${nearest.id}:${nearest.trigger.kind}${nearest.trigger.value}@${cfg.sl}`;
      if (above <= cfg.sl && !state.sent.includes(mark)) {
        due.push({
          marks: [mark],
          alert: {
            title: `⚠️ ${sym} is getting close to a stop`,
            text: `${nowText(quote)}, ${Math.max(1, Math.round(above))}% above ${nearest.what}.`,
          },
        });
      }
    }
  }

  if (!due.length) return { alerts: [], near: prev && prev.day === day ? prev : prev ? state : undefined };
  const alerts: NearAlert[] = [];
  for (const d of due) {
    // Over today's cap: stay quiet, and don't bring it up tomorrow when it may be stale.
    if (state.n < cfg.maxPerDay) {
      alerts.push(d.alert);
      state.n++;
    }
    for (const m of d.marks) if (!state.sent.includes(m)) state.sent.push(m);
  }
  state.sent = state.sent.slice(-KEEP_MARKS);
  return { alerts, near: state };
}
