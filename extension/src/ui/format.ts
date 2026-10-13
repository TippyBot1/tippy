import { formatUsd } from '../engine/triggers';
import type { Plan } from '../engine/types';
import type { Health } from '../shared/messages';
import type { Mood } from './Mascot';

/** "2.5M" → 2_500_000, "$800k" → 800_000 */
export function parseMoney(s: string): number | null {
  const m = s.trim().replace(/[$,\s]/g, '').match(/^(\d*\.?\d+)([kmb])?$/i);
  if (!m) return null;
  const n = Number(m[1]);
  const mult = { k: 1e3, m: 1e6, b: 1e9 }[(m[2] ?? '').toLowerCase() as 'k' | 'm' | 'b'] ?? 1;
  return n * mult;
}

/** A cash amount in a sentence: "$2", "$4.98", "$0.48", "$1.5K" (cents below $1, never "$0.5"). */
export function cash(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—';
  if (n >= 1000) return formatUsd(n);
  if (Number.isInteger(n)) return `$${n}`;
  if (n > 0 && n < 0.01) return '<$0.01';
  return `$${n.toFixed(2)}`;
}

export function moneyInput(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '';
  if (n >= 1e9) return `${+(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `${+(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `${+(n / 1e3).toFixed(1)}K`;
  return String(+n.toFixed(2));
}

export function moodFor(health: Health, plans: Plan[] = []): Mood {
  if (plans.some((p) => p.attention)) return 'worried';
  switch (health) {
    case 'watching':
      return plans.some((p) => p.state === 'armed') ? 'watching' : 'idle';
    case 'paused':
    case 'killed':
      return 'sleeping';
    case 'blind':
    case 'no-desk':
    case 'logged-out':
      return 'worried';
    case 'ui-changed':
      return 'confused';
    default:
      return 'idle';
  }
}

export function healthText(health: Health, message: string, liveCount: number): string {
  if (health === 'watching') return liveCount ? `Watching ${liveCount} coin${liveCount === 1 ? '' : 's'} for you` : 'Ready when you are';
  if (health === 'idle') return liveCount ? 'Starting up…' : 'Ready when you are';
  return message;
}

/** "+1.0%", "−12.5%", "+340%", "0.0%" (a real minus sign; never "−0.0%"). */
export function pctFmt(n: number): string {
  const digits = Math.abs(n) >= 100 ? 0 : 1;
  const r = Number(n.toFixed(digits));
  return `${r > 0 ? '+' : r < 0 ? '−' : ''}${Math.abs(r).toFixed(digits)}%`;
}
