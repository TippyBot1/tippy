// A take-profit, stop-loss or limit-buy level in the three ways traders think
// about it: a move ("2x", "−30%"), an exact price, or a market cap. The order
// form and the chat convert between them; the engine stores whichever was picked.
//
// Two reference points:
//  - `base` is what "x" / "%" levels are measured from — your entry on a running
//    plan, the price now for a new one.
//  - `now` is where the coin is right now — take-profits must be above it,
//    stops below it.

import { formatUsd, formatX, triggerPrice } from '../engine/triggers';
import type { LevelRef, StopLevel, StopLoss, Trigger, TriggerKind } from '../engine/types';
import { moneyInput, parseMoney } from './format';

/** tp = take-profit (above), sl = stop loss (below), buy = limit buy (either side). */
export type Side = 'tp' | 'sl' | 'buy';

export interface Now {
  priceUSD: number | null;
  mc: number | null;
}

/** The level as a multiple of `base` (NaN if it can't be worked out). */
export function levelX(t: Trigger, base: Now): number {
  if (t.kind === 'x') return t.value;
  if (!base.priceUSD) return NaN;
  return triggerPrice(t, { priceUSD: base.priceUSD, mc: base.mc, source: 'armed-at' }) / base.priceUSD;
}

/** "−30%" below (or "+5%" above). */
export function dropText(x: number): string {
  const pct = +(Math.abs(1 - x) * 100).toFixed(1);
  return `${x < 1 ? '−' : '+'}${pct}%`;
}

/** Row label: "2x", "−30%", "$0.0041", "$2M MC". Buy levels in x are always a ± move. */
export function levelText(t: Trigger, side: Side = 'tp'): string {
  if (t.kind === 'x') return t.value < 1 || side === 'buy' ? dropText(t.value) : formatX(t.value);
  return t.kind === 'mc' ? `${formatUsd(t.value)} MC` : formatUsd(t.value);
}

const relText = (x: number, side: Side) => (side === 'tp' ? formatX(x) : dropText(x));

/** Row hint: what the level means in other units ("≈$4.28M" for 2x, "≈2.3x" for a price). */
export function rowHint(t: Trigger, side: Side, base: Now): string {
  const x = levelX(t, base);
  if (!Number.isFinite(x)) return '';
  if (t.kind !== 'x') return `≈${relText(x, side)}`;
  if (base.mc) return `≈${formatUsd(base.mc * x)}`;
  return base.priceUSD ? `≈${formatUsd(base.priceUSD * x)}` : '';
}

/** The level in the units it isn't typed in, e.g. ["2.34x", "$4.28M MC"] for a price. */
export function equivalents(t: Trigger, side: Side, base: Now): string[] {
  const x = levelX(t, base);
  if (!Number.isFinite(x)) return [];
  const out: string[] = [];
  if (t.kind !== 'x') out.push(relText(x, side));
  if (t.kind !== 'price' && base.priceUSD) out.push(formatUsd(base.priceUSD * x));
  if (t.kind !== 'mc' && base.mc) out.push(`${formatUsd(base.mc * x)} MC`);
  return out;
}

/** A price as plain digits with ~4 significant figures — never "1.2e-7". */
export function priceText(p: number): string {
  if (!(p > 0) || !Number.isFinite(p)) return '';
  const digits = Math.max(0, Math.min(18, 3 - Math.floor(Math.log10(p))));
  const s = p.toFixed(digits);
  return s.includes('.') ? s.replace(/0+$/, '').replace(/\.$/, '') : s;
}

/** What the editor box shows for a level in `kind` units ('' if it can't convert). */
export function toText(t: Trigger, kind: TriggerKind, side: Side, base: Now): string {
  const x = t.kind === kind ? null : levelX(t, base);
  if (x != null && !Number.isFinite(x)) return '';
  switch (kind) {
    case 'x': {
      const v = x ?? t.value;
      if (side === 'tp') return String(+v.toFixed(2));
      if (side === 'sl') return v >= 1 ? '' : String(+((1 - v) * 100).toFixed(1)); // a stop above the price has no "drop"
      const pct = +(Math.abs(1 - v) * 100).toFixed(1);
      return v > 1 ? `+${pct}` : String(pct);
    }
    case 'price':
      return x == null ? priceText(t.value) : base.priceUSD ? priceText(base.priceUSD * x) : '';
    case 'mc':
      return x == null ? moneyInput(t.value) : base.mc ? moneyInput(base.mc * x) : '';
  }
}

/**
 * "1,500" (thousands) → "1500"; "1,5" / "0,0045" (decimal comma) → "1.5" / "0.0045".
 */
export function normalizeNumber(s: string): string {
  const t = s.trim().replace(/\s/g, '');
  if (/^[+\-−$]*\d{1,3}(,\d{3})+(\.\d*)?[kmbx%]?$/i.test(t)) return t.replace(/,/g, '');
  if ((t.match(/,/g) ?? []).length === 1 && !t.includes('.')) return t.replace(',', '.');
  return t;
}

/**
 * Read the editor box. In the "x" tab: take-profits type a multiple ("2.5"),
 * stops a drop in % ("30"), limit buys a move in % ("20" or "−20" = dip, "+20" = breakout).
 */
export function parseLevel(text: string, kind: TriggerKind, side: Side): Trigger | null {
  const s = normalizeNumber(text);
  if (!s) return null;
  if (kind === 'mc') {
    const n = parseMoney(s);
    return n != null && n > 0 ? { kind: 'mc', value: n } : null;
  }
  if (kind === 'price') {
    const n = Number(s.replace(/^\$/, ''));
    return /^\$?\d*\.?\d+$/.test(s) && Number.isFinite(n) && n > 0 ? { kind: 'price', value: n } : null;
  }
  const sign = s[0] === '+' ? '+' : /^[-−]/.test(s) ? '-' : '';
  const body = s.replace(/^[+\-−]/, '').replace(/[x%]$/i, '');
  if (!/^\d*\.?\d+$/.test(body)) return null;
  const n = Number(body);
  if (!Number.isFinite(n) || n <= 0) return null;
  if (side === 'tp') return sign === '-' ? null : { kind: 'x', value: n };
  if (side === 'sl') return sign === '+' || n >= 100 ? null : { kind: 'x', value: +(1 - n / 100).toFixed(6) };
  if (sign === '+') return { kind: 'x', value: +(1 + n / 100).toFixed(6) };
  return n < 100 ? { kind: 'x', value: +(1 - n / 100).toFixed(6) } : null;
}

/**
 * Where the level is compared with the coin now: 1.1 = 10% above, 0.9 = 10%
 * below (NaN if it can't be worked out). Market-cap levels compare with the
 * live market cap when fomo shows one; "x" levels are measured from `base`.
 */
export function relToNow(t: Trigger, now: Now, base: Now = now): number {
  if (t.kind === 'mc' && now.mc) return t.value / now.mc;
  const x = levelX(t, base);
  return base.priceUSD && now.priceUSD ? (x * base.priceUSD) / now.priceUSD : NaN;
}

/** Why a level can't be used right now, or null if it's fine. 'stop' = a partial stop ("sell 10% if it drops to …"). */
export function levelProblem(t: Trigger, side: Side | 'stop', now: Now, base: Now = now): string | null {
  const rel = relToNow(t, now, base);
  if (!Number.isFinite(rel)) return t.kind === 'mc' ? "I can't see this coin's market cap yet." : "I can't see this coin's price yet.";
  if (side === 'tp' && rel <= 1) return 'A take-profit has to be above where it is now.';
  if (side === 'sl' && rel >= 1) return 'A stop loss has to be below where it is now.';
  if (side === 'stop' && rel >= 1) return 'A stop has to be below where it is now.';
  if (side === 'buy' && Math.abs(rel - 1) < 0.005) return "That's where it is now — pick a dip below or a breakout above.";
  return null;
}

/** Levels sorted lowest first (levels that can't be placed go last). */
export function sortByLevel<T extends { trigger: Trigger }>(levels: T[], base: Now): T[] {
  const key = (t: T) => {
    const x = levelX(t.trigger, base);
    return Number.isFinite(x) ? x : Infinity;
  };
  return [...levels].sort((a, b) => key(a) - key(b));
}

// ---- The order form: a market cap (or price) and the % move from now ----
// The window's order form takes a level as a market cap ("700K") or an exact
// price ("$0.0007"), always shown next to the % move from where the coin is now.

/** How the order form's level box reads: a market cap, or a price. */
export type FieldUnit = 'mc' | 'price';

/** Price per $1 of market cap (1 / supply): from the coin now, else from `base`. */
function pricePerMc(now: Now, base: Now): number {
  if (now.mc && now.priceUSD) return now.priceUSD / now.mc;
  if (base.mc && base.priceUSD) return base.priceUSD / base.mc;
  return NaN;
}

/** The level as a price (NaN if unknown). "x" levels are measured from `base` (your entry on a running plan). */
export function levelPriceAt(t: Trigger, base: Now, now: Now = base): number {
  if (t.kind === 'price') return t.value;
  if (t.kind === 'x') return base.priceUSD ? base.priceUSD * t.value : NaN;
  return t.value * pricePerMc(now, base);
}

/** The level as a market cap (NaN if unknown). */
export function levelMcAt(t: Trigger, base: Now, now: Now = base): number {
  if (t.kind === 'mc') return t.value;
  return levelPriceAt(t, base, now) / pricePerMc(now, base);
}

/** The level in a few characters, in the form's unit: "$700K MC" or "$0.0007". */
export function levelShort(t: Trigger, unit: FieldUnit, base: Now, now: Now = base): string {
  if (unit === 'mc') {
    const mc = levelMcAt(t, base, now);
    if (Number.isFinite(mc) && mc > 0) return `${formatUsd(mc)} MC`;
  }
  const p = levelPriceAt(t, base, now);
  return Number.isFinite(p) && p > 0 ? formatUsd(p) : levelText(t);
}

/** What the level box shows: "700K" (a market cap) or "0.0007" (a price); '' if unknown. */
export function fieldText(t: Trigger | null, unit: FieldUnit, base: Now, now: Now = base): string {
  if (!t) return '';
  if (unit === 'mc') {
    const mc = levelMcAt(t, base, now);
    return Number.isFinite(mc) && mc > 0 ? moneyInput(mc) : '';
  }
  return priceText(levelPriceAt(t, base, now));
}

/** Read the level box: "700k", "1.2m", "$2,500,000" (a market cap) or "$0.0004" (a price). */
export function parseField(text: string, unit: FieldUnit): Trigger | null {
  return parseLevel(text, unit, 'tp');
}

/** The % move a level is from now: 10 = 10% above, −2.6 = 2.6% below (NaN if unknown). */
export const pctFromRel = (rel: number) => (rel - 1) * 100;

/** A % move in the % box: "+10", "-2.6", "+400" (one decimal at most; '' for none). */
export function pctBoxText(pct: number): string {
  if (!Number.isFinite(pct)) return '';
  const r = Math.round(pct * 10) / 10;
  return r > 0 ? `+${r}` : r < 0 ? String(r) : '0';
}

/** Read the % box: "10", "+10", "-2.6", "−2.6%" — null if it isn't a number. */
export function parsePct(text: string): number | null {
  const s = normalizeNumber(text).replace(/%$/, '').replace(/^−/, '-');
  if (!/^[+-]?\d*\.?\d+$/.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** "10", "2.6", "400" — the size of a move, for sentences ("if it drops 2.6% to …"). */
export function movePct(rel: number): string {
  const p = Math.abs(pctFromRel(rel));
  return String(p >= 100 ? Math.round(p) : +p.toFixed(1));
}

/**
 * The level `pct`% from the coin now, in the form's unit (null if it can't be
 * placed). Never at or below zero: −100% is read as −99%.
 */
export function levelFromPct(pct: number, unit: FieldUnit, now: Now): Trigger | null {
  const p = Math.max(-99, pct);
  if (unit === 'mc') return now.mc ? { kind: 'mc', value: now.mc * (1 + p / 100) } : null;
  return now.priceUSD ? { kind: 'price', value: now.priceUSD * (1 + p / 100) } : null;
}

/**
 * The level against your entry: 1.1 = 10% above what you paid (NaN if unknown).
 * A market-cap level on a plan armed without one is converted at today's price.
 */
export function vsEntry(t: Trigger, entry: Now, now: Now): number {
  const x = levelX(t, entry);
  if (Number.isFinite(x)) return x;
  const p = levelPriceAt(t, entry, now);
  return entry.priceUSD ? p / entry.priceUSD : NaN;
}

/** Same level, same way of setting it. */
export const sameTrigger = (a: Trigger | null | undefined, b: Trigger | null | undefined) => !!a && !!b && a.kind === b.kind && a.value === b.value;

// ---- Partial stops and the stop loss: which one fires first ----
// Tippy checks exits first: when the price falls to the stop loss, it sells
// everything. So a partial stop at or under the stop loss can never fire.

/** `a` at or under `b` (both from relToNow); a hair of rounding counts as the same level. */
const atOrUnder = (a: number, b: number) => a <= b * (1 + 1e-9);

/** "$700K MC", "$700K MC and $650K MC", "$700K MC, $650K MC and $600K MC". */
function andList(xs: string[]): string {
  return xs.length < 2 ? (xs[0] ?? '') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`;
}

/**
 * A heads-up when a partial stop and the stop loss are in the wrong order (null
 * when they aren't) — worth knowing, never a block:
 *  - a partial stop ('stop') at or under the waiting stop loss: "Heads up: your
 *    stop loss at $650K MC is higher, so it would sell everything first." (the
 *    chat's words);
 *  - a stop loss ('sl') at or over waiting partial stops: those never fire.
 * `skip` is the order being changed (✎ in the window, or a dragged chart line):
 * it's left out, since it's the one moving.
 */
export function stopOrderNote(
  plan: { sl: StopLoss | null; stops?: StopLevel[] },
  kind: 'stop' | 'sl',
  trigger: Trigger,
  now: Now,
  base: Now,
  unit: FieldUnit,
  skip: LevelRef | null = null,
): string | null {
  const at = relToNow(trigger, now, base);
  if (!Number.isFinite(at)) return null;
  const short = (t: Trigger) => levelShort(t, unit, base, now);
  if (kind === 'stop') {
    const sl = plan.sl?.status === 'waiting' && skip?.kind !== 'sl' ? plan.sl : null;
    const slAt = sl ? relToNow(sl.trigger, now, base) : NaN;
    if (!sl || !Number.isFinite(slAt) || !atOrUnder(at, slAt)) return null;
    return `Heads up: your stop loss at ${short(sl.trigger)} is higher, so it would sell everything first.`;
  }
  const under = (plan.stops ?? [])
    .filter((s) => s.status === 'waiting' && !(skip?.kind === 'stop' && skip.id === s.id))
    .map((s) => ({ s, rel: relToNow(s.trigger, now, base) }))
    .filter((x) => Number.isFinite(x.rel) && atOrUnder(x.rel, at))
    .sort((a, b) => b.rel - a.rel);
  if (!under.length) return null;
  if (under.length === 1) {
    const s = under[0].s;
    return `Heads up: your ${+s.sellPct.toFixed(1)}% stop at ${short(s.trigger)} is lower, so it would never fire — the stop loss sells everything first.`;
  }
  return `Heads up: your stops at ${andList(under.map((x) => short(x.s.trigger)))} are lower, so they would never fire — the stop loss sells everything first.`;
}

// ---- Market cap or % move: how the window shows and takes levels ----

/** 'mc' = levels as a market cap ($1M), 'move' = as a move (2x / −20%). */
export type LevelUnit = 'mc' | 'move';

/** The unit the window can actually use: a move whenever the reference has no market cap. */
export function effectiveUnit(unit: LevelUnit, ref: Now): LevelUnit {
  return unit === 'mc' && ref.mc ? 'mc' : 'move';
}

/** Can levels be converted between market cap and a move (needs the reference's market cap and price)? */
export const canConvert = (ref: Now) => !!ref.mc && !!ref.priceUSD;

/** `n` rounded to `sig` significant figures (2_876_543 → 2_880_000). */
export function roundSig(n: number, sig = 3): number {
  return Number.isFinite(n) && n !== 0 ? Number(n.toPrecision(sig)) : n;
}

/** A market cap the way traders say it: 2 significant figures when that's within 1%, else 3 ($2.9M, $1.05M, $10.8M). */
export function niceMc(n: number): number {
  const r2 = roundSig(n, 2);
  return Math.abs(r2 / n - 1) <= 0.01 ? r2 : roundSig(n, 3);
}

/** Is the level within `tol` (relative) of `x` times `base`? */
export function isNear(t: Trigger | null | undefined, x: number, base: Now, tol = 0.012): boolean {
  if (!t) return false;
  if (t.kind === 'x') return Math.abs(t.value - x) < 1e-6;
  const lx = levelX(t, base);
  return Number.isFinite(lx) && Math.abs(lx / x - 1) < tol;
}

/**
 * The same level as a market cap ('mc') or a move ('x'), measured from `base`.
 * Market caps are rounded to 3 significant figures, multiples to 2 decimals. A
 * level that's exactly a chip in `snap` (a multiple) converts to what that chip
 * shows in the other unit — `niceMc(base.mc × chip)` — and back, so flipping
 * units doesn't turn 2x into 1.99x. Exact prices, and levels that can't be
 * converted (no market cap or price), come back unchanged.
 */
export function toKind(t: Trigger, kind: 'mc' | 'x', base: Now, snap: number[] = []): Trigger {
  if (t.kind === kind || t.kind === 'price' || !canConvert(base)) return t;
  const mc = base.mc!;
  if (kind === 'mc') {
    if (snap.some((c) => Math.abs(c - t.value) < 1e-9)) return { kind: 'mc', value: niceMc(mc * t.value) };
    const v = roundSig(mc * t.value);
    return v > 0 ? { kind: 'mc', value: v } : t;
  }
  const chip = snap.find((c) => niceMc(mc * c) === t.value);
  if (chip != null) return { kind: 'x', value: chip };
  const x = levelX(t, base);
  if (!Number.isFinite(x) || x <= 0) return t;
  const r = +x.toFixed(2);
  return { kind: 'x', value: r > 0 ? r : roundSig(x, 2) };
}
