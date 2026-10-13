import type { Entry, PlanInput, Quote, Trigger } from './types';

/**
 * The price a trigger corresponds to. Market-cap triggers are converted with the
 * entry's price/mc ratio, which is only used for ordering and validation; live
 * evaluation of mc triggers compares against the quoted market cap directly.
 */
export function triggerPrice(trigger: Trigger, entry: Entry): number {
  switch (trigger.kind) {
    case 'x':
      return entry.priceUSD * trigger.value;
    case 'price':
      return trigger.value;
    case 'mc':
      return entry.mc && entry.mc > 0 ? (trigger.value / entry.mc) * entry.priceUSD : NaN;
  }
}

/** Has the quote reached the trigger? `up` for take-profits, `down` for stops. */
export function isHit(trigger: Trigger, quote: Quote, entry: Entry, direction: 'up' | 'down'): boolean {
  let current: number;
  let threshold: number;
  if (trigger.kind === 'mc' && quote.mc != null && quote.mc > 0) {
    current = quote.mc;
    threshold = trigger.value;
  } else {
    current = quote.priceUSD;
    threshold = triggerPrice(trigger, entry);
  }
  if (!Number.isFinite(current) || !Number.isFinite(threshold) || current <= 0) return false;
  return direction === 'up' ? current >= threshold : current <= threshold;
}

export function formatUsd(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—';
  const abs = Math.abs(n);
  if (abs >= 1e9) return `$${trim(n / 1e9)}B`;
  if (abs >= 1e6) return `$${trim(n / 1e6)}M`;
  if (abs >= 1e3) return `$${trim(n / 1e3)}K`;
  if (abs >= 1) return `$${n.toFixed(2)}`;
  if (abs === 0) return '$0';
  // Tiny memecoin prices: 3 significant digits, plain decimals ("$0.004", never "$4.00e-3").
  const digits = Math.min(20, 2 - Math.floor(Math.log10(abs)));
  return `$${n.toFixed(digits).replace(/0+$/, '').replace(/\.$/, '')}`;
}

function trim(n: number): string {
  return n >= 100 ? n.toFixed(0) : n >= 10 ? n.toFixed(1).replace(/\.0$/, '') : n.toFixed(2).replace(/\.?0+$/, '');
}

export function formatX(x: number): string {
  if (!Number.isFinite(x)) return '—';
  return x >= 10 ? `${+x.toFixed(1)}x` : `${x.toFixed(2).replace(/\.?0+$/, '')}x`;
}

/** Human description, e.g. "2x", "−30%", "$2M mc", "$0.0041". */
export function describeTrigger(trigger: Trigger): string {
  switch (trigger.kind) {
    case 'x':
      if (trigger.value < 1) return `−${+((1 - trigger.value) * 100).toFixed(1)}%`;
      return formatX(trigger.value);
    case 'mc':
      return `${formatUsd(trigger.value)} mc`;
    case 'price':
      return formatUsd(trigger.value);
  }
}

export interface ValidationIssue {
  field: string;
  message: string;
}

/** Friendly validation used by the Tippy card before arming. */
export function validatePlanInput(input: Omit<PlanInput, 'id' | 'now'>): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const { entry } = input;
  if (!(entry.priceUSD > 0)) issues.push({ field: 'entry', message: "Tippy can't see this coin's price yet." });
  if (!(input.balance > 0)) issues.push({ field: 'balance', message: "You don't hold this coin yet — buy some first." });
  const stops = input.stops ?? [];
  if (input.tps.length === 0 && stops.length === 0 && !input.sl && !input.trailing) {
    issues.push({ field: 'plan', message: 'Add at least one take-profit or a stop loss.' });
  }

  let total = 0;
  let lastPrice = 0;
  input.tps.forEach((tp, i) => {
    const field = `tp.${i}`;
    if (!(tp.sellPct > 0) || tp.sellPct > 100) issues.push({ field, message: 'Sell amount must be between 1% and 100%.' });
    total += tp.sellPct;
    const p = triggerPrice(tp.trigger, entry);
    if (!Number.isFinite(p)) issues.push({ field, message: "Tippy can't see this coin's market cap yet — set it as a price or multiple." });
    else {
      if (p <= entry.priceUSD) issues.push({ field, message: 'A take-profit has to be above your entry.' });
      if (p <= lastPrice) issues.push({ field, message: 'Take-profits should go from lowest to highest.' });
      lastPrice = p;
    }
  });
  if (total > 100.0001) issues.push({ field: 'tp', message: `Your take-profits add up to ${Math.round(total)}% — keep it at 100% or less.` });

  // Partial stops: any level, any order. Whether a level is a take-profit or a
  // stop is decided against the price now (by the card), so no "below entry" rule.
  let stopTotal = 0;
  stops.forEach((st, i) => {
    const field = `stop.${i}`;
    if (!(st.sellPct > 0) || st.sellPct > 100) issues.push({ field, message: 'Sell amount must be between 1% and 100%.' });
    stopTotal += st.sellPct;
    if (!(Number.isFinite(st.trigger.value) && st.trigger.value > 0)) issues.push({ field, message: 'A stop has to be above zero.' });
    else if (!Number.isFinite(triggerPrice(st.trigger, entry))) issues.push({ field, message: "Tippy can't see this coin's market cap yet — set the stop as a price or %." });
  });
  if (stopTotal > 100.0001) issues.push({ field: 'stop', message: `Your stops add up to ${Math.round(stopTotal)}% — keep it at 100% or less.` });

  if (input.sl) {
    const p = triggerPrice(input.sl.trigger, entry);
    if (!Number.isFinite(p)) issues.push({ field: 'sl', message: "Tippy can't see this coin's market cap yet — set the stop as a price or %." });
    if (Number.isFinite(p) && p >= entry.priceUSD) issues.push({ field: 'sl', message: 'The stop loss has to be below your entry.' });
    if (Number.isFinite(p) && p <= 0) issues.push({ field: 'sl', message: 'The stop loss has to be above zero.' });
  }
  if (input.trailing) {
    const { trailPct, activateX } = input.trailing;
    if (!(trailPct > 0 && trailPct < 100)) issues.push({ field: 'trailing', message: 'Trailing distance must be between 1% and 99%.' });
    if (activateX != null && !(activateX > 1)) issues.push({ field: 'trailing', message: 'Start trailing at a multiple above 1x.' });
  }
  return issues;
}
