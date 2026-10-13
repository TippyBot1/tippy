// Guarding the coins a limit buy just bought. When the order was placed with a
// preset (P1/P2/P3), Tippy arms that take-profit / stop loss on the new coins —
// unless the coin is already guarded, in which case the existing plan covers
// them (the top-up logic in the tick loop rescales it to the bigger bag).
//
// Pure (no chrome APIs, no clock) like the engine, so every rule is testable.
// Callers run it under the storage lock and save what it returns.

import { blendedEntry, presetToInput } from '../engine/autoguard';
import { protectedBy } from '../engine/buys';
import { buildPlan, cancelPlan, hasInFlight, rescale, summarizePlan } from '../engine/orders';
import type { BuyOrder, Plan } from '../engine/types';
import type { Preset } from '../shared/settings';

/** A Tippy auto-guard plan this young was made for these very coins — swap it for the preset the user picked. */
export const REPLACE_AUTO_GUARD_MS = 10 * 60_000;
/**
 * A cost this far from the live price is suspect (a lagging or partial balance
 * read): measure from the live price instead. Tight on purpose — the safest
 * preset's stop is only 20% below entry, so an inflated cost could otherwise put
 * the stop above the market and sell everything at once.
 */
const MAX_COST_DRIFT = 0.1;

export type Protection =
  /** Nothing to do: no preset picked, a dry run, not bought (yet), or already handled. */
  | { kind: 'none' }
  /** The coin's existing guard covers the new coins. */
  | { kind: 'keep'; plan: Plan }
  /** A fresh auto-guard plan gets swapped for the preset the user picked. */
  | { kind: 'replace'; plan: Plan }
  /** Arm the picked preset on the coins. */
  | { kind: 'new' };

/** The coin's live (armed or paused) plan, newest first. */
function livePlanFor(key: string, plans: Plan[]): Plan | null {
  return plans.filter((p) => p.key === key && (p.state === 'armed' || p.state === 'paused')).sort((a, b) => b.createdAt - a.createdAt)[0] ?? null;
}

export function protection(order: BuyOrder, plans: Plan[], now: number): Protection {
  if (order.state !== 'filled' || order.dryRun || !order.guardPresetId) return { kind: 'none' };
  if (order.history.some((h) => h.kind === 'protected')) return { kind: 'none' }; // once per order
  const live = livePlanFor(order.key, plans);
  if (!live) return { kind: 'new' };
  // Only a plan Tippy made on its own, minutes ago, that isn't mid-sell. Anything
  // the user set up (or paused) themselves stays exactly as it is.
  const swappable = live.origin === 'auto-guard' && live.state === 'armed' && now - live.createdAt < REPLACE_AUTO_GUARD_MS && !hasInFlight(live);
  return swappable ? { kind: 'replace', plan: live } : { kind: 'keep', plan: live };
}

export interface ProtectInput {
  order: BuyOrder;
  plans: Record<string, Plan>;
  presets: Preset[];
  /** Coins held now, after the buy (null = unknown). */
  balance: number | null;
  /** The coin's price / market cap now, if known. */
  quote: { priceUSD: number; mc: number | null } | null;
  /** Auto-guard baseline (last seen balance per coin). */
  baseline: Record<string, number> | null;
  now: number;
  newId: () => string;
}

export interface ProtectResult {
  order: BuyOrder;
  plans: Record<string, Plan>;
  baseline: Record<string, number> | null;
  /** The plan Tippy just armed on the coins (null when it kept one, or couldn't). */
  armed: Plan | null;
  /** One friendly line for the "bought" alert, or null when nothing happened. */
  text: string | null;
}

/**
 * What the new coins cost: the fill, else the price Tippy expected when it
 * pressed Buy — but never far from the live price. A plan whose entry is way
 * below the market would think its take-profits had already hit and sell.
 */
function costBasis(order: BuyOrder, livePrice: number | null): { price: number | null; drifted: boolean } {
  const cost = order.fillPrice != null && order.fillPrice > 0 ? order.fillPrice : order.expectedAmount != null && order.expectedAmount > 0 ? order.usd / order.expectedAmount : null;
  if (cost != null && livePrice != null && livePrice > 0 && Math.abs(cost / livePrice - 1) > MAX_COST_DRIFT) return { price: livePrice, drifted: true };
  return { price: cost, drifted: false };
}

/** Arm the order's preset on the coins it bought (or note that an existing guard covers them). */
export function protectBuy(input: ProtectInput): ProtectResult {
  const { order, now } = input;
  const unchanged: ProtectResult = { order, plans: input.plans, baseline: input.baseline, armed: null, text: null };
  const decision = protection(order, Object.values(input.plans), now);
  if (decision.kind === 'none') return unchanged;

  const livePrice = input.quote && input.quote.priceUSD > 0 ? input.quote.priceUSD : null;
  const balance = input.balance;

  if (decision.kind === 'keep') {
    // Size the existing guard to the bigger bag right away, rather than waiting for the
    // tick loop to notice a top-up (its take-profits would otherwise sell the new coins
    // as if they were the old bag's share).
    const plan = decision.plan;
    const plans = { ...input.plans };
    let baseline = input.baseline;
    const { price: cost } = costBasis(order, livePrice);
    // …unless the tick loop's top-up check already did (it sets the baseline when it rescales).
    const absorbed = (input.baseline?.[order.key] ?? 0) >= (balance ?? Infinity) * 0.98;
    if (balance != null && balance > 0 && order.got != null && order.got > 0 && cost != null && !hasInFlight(plan) && !absorbed) {
      const before = Math.max(0, balance - order.got);
      plans[plan.id] = rescale(plan, balance, now, before > 0 ? blendedEntry(before, plan.entry.priceUSD, order.got, cost) : cost);
      baseline = baseline ? { ...baseline, [order.key]: balance } : null;
    }
    // Partial stops sell some on the way down — but not the rest.
    const someStops = (plan.stops ?? []).some((s) => s.status === 'waiting');
    const weak = plan.state === 'paused' ? 'is paused, so the new coins aren\u2019t protected — resume it in Tippy' : !plan.sl || plan.sl.status === 'cancelled' ? `has no stop loss${someStops ? ' for the rest' : ''}` : null;
    const text = weak ? `Your guard on $${order.symbol} ${weak}.` : `Your existing guard on $${order.symbol} covers the new coins.`;
    const next = protectedBy(order, plan.id, text, now);
    return { ...unchanged, order: weak ? { ...next, attention: text } : next, plans, baseline, text };
  }

  // Couldn't guard: say so on the order (once), so the user sees it in Tippy.
  const giveUp = (text: string): ProtectResult => ({ ...unchanged, order: { ...protectedBy(order, null, text, now), attention: text }, text });

  const preset = input.presets.find((p) => p.id === order.guardPresetId);
  if (!preset) return giveUp(`Your guard preset is gone, so the new $${order.symbol} coins aren't guarded yet — set a plan in Tippy.`);
  if (balance == null || !(balance > 0)) return giveUp(`Tippy couldn't see your new $${order.symbol} coins yet, so they aren't guarded — set a plan in Tippy.`);

  // Price and market cap from the same moment, so market-cap levels line up.
  const { price: cost, drifted } = costBasis(order, livePrice);
  const live = input.quote && input.quote.priceUSD > 0 ? input.quote : order.lastPrice != null && order.lastPrice > 0 ? { priceUSD: order.lastPrice, mc: order.lastMc } : null;
  const priceUSD = live?.priceUSD ?? cost;
  if (priceUSD == null || !(priceUSD > 0)) return giveUp(`Tippy couldn't see $${order.symbol}'s price, so the new coins aren't guarded yet — set a plan in Tippy.`);

  const plans = { ...input.plans };
  let entry = cost ?? undefined;
  if (decision.kind === 'replace') {
    plans[decision.plan.id] = cancelPlan(decision.plan, now);
    // The swapped-out plan guarded coins bought just before: average them in.
    if (cost != null && order.got != null && order.got > 0 && balance > order.got) {
      entry = blendedEntry(balance - order.got, decision.plan.entry.priceUSD, order.got, cost);
    }
  }
  const token = { key: order.key, address: order.address, networkId: order.networkId, symbol: order.symbol, name: order.name, priceUSD, mc: live?.mc ?? null, balance };
  const plan = buildPlan({ ...presetToInput(preset, token, 'manual', entry), id: input.newId(), now });
  plans[plan.id] = plan;
  const text = `Guarding with ${preset.emoji} ${preset.name}: ${summarizePlan(plan)}.${drifted ? ' (Measured from today\u2019s price — fomo\u2019s balance looked off.)' : ''}`;
  // The tick loop must not see these coins as a fresh top-up (or a new bag to auto-guard).
  const baseline = input.baseline ? { ...input.baseline, [order.key]: balance } : null;
  return { order: protectedBy(order, plan.id, text, now), plans, baseline, armed: plan, text };
}
