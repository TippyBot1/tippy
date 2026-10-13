// A horizontal ladder: stop loss on the left, take-profits to the right, and a
// white dot for where the price is now. Log scale so 2x and 10x both fit.

import { formatX } from '../engine/triggers';

export interface LadderMark {
  x: number; // multiple of entry
  label: string;
  color: string;
  done?: boolean;
}

export function Ladder({ marks, nowX }: { marks: LadderMark[]; nowX: number | null }) {
  const xs = [...marks.map((m) => m.x), 1, nowX ?? 1].filter((v) => v > 0);
  const lo = Math.log(Math.min(...xs) * 0.85);
  const hi = Math.log(Math.max(...xs) * 1.15);
  const pos = (x: number) => `${(((Math.log(x) - lo) / (hi - lo || 1)) * 100).toFixed(2)}%`;
  return (
    <div class="t-ladder" aria-hidden="true">
      <div class="t-track" />
      <div class="t-mark" style={{ left: pos(1) }}>
        entry
        <i style={{ background: 'var(--t-muted)' }} />
      </div>
      {marks.map((m) => (
        <div class={`t-mark${m.done ? ' t-done' : ''}`} style={{ left: pos(m.x) }} key={`${m.label}-${m.x}`}>
          {m.label}
          <i style={{ background: m.color }} />
        </div>
      ))}
      {nowX != null && (
        <div class="t-mark t-now" style={{ left: pos(nowX) }}>
          <i />
          {formatX(nowX)}
        </div>
      )}
    </div>
  );
}
