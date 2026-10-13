// Auto-guard: spot new buys (including ones made on the phone) by comparing
// balances against a baseline, and turn presets into plans.

import type { Preset } from '../shared/settings';
import type { PlanInput } from './types';

export interface GuardHolding {
  key: string;
  amount: number;
  priceUSD: number | null;
  mc: number | null;
  symbol: string;
  name: string;
}

export interface Increase {
  holding: GuardHolding;
  prev: number;
}

/** Ignore tiny bags (airdrop dust, spam) and growth under 2% (rounding). */
const MIN_VALUE_USD = 2;
const GROWTH = 1.02;

export function diffHoldings(
  baseline: Record<string, number> | null,
  holdings: GuardHolding[],
  opts: { includeExisting: boolean; isIgnored: (key: string) => boolean },
): { baseline: Record<string, number>; increases: Increase[] } {
  const next: Record<string, number> = {};
  for (const h of holdings) next[h.key] = h.amount;

  // First look: remember what's already there and do nothing (unless the user
  // explicitly asked to guard existing bags too).
  const prevMap = baseline ?? (opts.includeExisting ? {} : next);

  const increases: Increase[] = [];
  for (const h of holdings) {
    if (opts.isIgnored(h.key)) continue;
    if (!h.priceUSD || h.amount * h.priceUSD < MIN_VALUE_USD) continue;
    const prev = prevMap[h.key] ?? 0;
    if (h.amount > prev * GROWTH && h.amount - prev > 0) increases.push({ holding: h, prev });
  }
  return { baseline: next, increases };
}

/** Weighted-average entry after topping up a bag. */
export function blendedEntry(prevAmount: number, prevEntry: number, addedAmount: number, addedPrice: number): number {
  const total = prevAmount + addedAmount;
  return total > 0 ? (prevAmount * prevEntry + addedAmount * addedPrice) / total : addedPrice;
}

export function presetToInput(
  preset: Preset,
  token: { key: string; address: string; networkId: number; symbol: string; name: string; priceUSD: number; mc: number | null; balance: number },
  origin: 'manual' | 'auto-guard',
  entryPrice?: number,
): Omit<PlanInput, 'id' | 'now'> {
  const entry = entryPrice ?? token.priceUSD;
  return {
    key: token.key,
    networkId: token.networkId,
    address: token.address,
    symbol: token.symbol,
    name: token.name,
    entry: { priceUSD: entry, mc: token.mc != null && token.priceUSD > 0 ? (token.mc * entry) / token.priceUSD : null, source: entryPrice ? 'manual' : 'armed-at' },
    balance: token.balance,
    tps: preset.tps.map((t) => ({ trigger: { kind: 'x', value: t.x }, sellPct: t.pct })),
    sl: preset.slX != null ? { trigger: { kind: 'x', value: preset.slX } } : null,
    trailing: preset.trail ? { trailPct: preset.trail.pct, activateX: preset.trail.activateX } : null,
    origin,
  };
}
