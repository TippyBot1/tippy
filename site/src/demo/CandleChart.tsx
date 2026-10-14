// The pretend coin page's chart, after fomo's: one-minute candles in market cap
// with an OHLC legend, volume along the bottom, a time axis, and a marker on
// every swap (yours, or Tippy's for you). Tippy's order lines are drawn the way
// the extension draws them on fomo's chart: same colours, same labels, and you
// can drag one to move it (Tippy asks first). One log scale, so a 5x take
// profit and a −30% stop both fit.

import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { ChartLine, ChartMove } from '@ext/shared/chartLines';
import { formatUsd } from '@ext/engine/triggers';
import type { Swap } from '../market';

/** The extension's line colours (entrypoints/fomo-chart.content.ts). */
const COLORS: Record<ChartLine['kind'], string> = { buy: '#2fe0a0', tp: '#5b9cff', sl: '#ff5d73', trail: '#ffb547' };
const MUTED = '#7e8994';
const UP = '#2ec27e';
const DOWN = '#f0524b';
const AXIS = 76;
const TIME = 24;

/** Deterministic noise per candle, so the chart looks the same on every visit. */
const noise = (i: number) => (((i * 2654435761) >>> 0) % 1000) / 1000;

export function CandleChart({
  history,
  tick,
  supply,
  name,
  lines,
  swaps,
  preview,
  onDrop,
}: {
  history: number[];
  /** The latest price tick: the last candle. */
  tick: number;
  supply: number;
  name: string;
  lines: ChartLine[];
  swaps: Swap[];
  /** A dropped line waiting for Move / Keep in Tippy's window: drawn where it was dropped. */
  preview: ChartMove | null;
  onDrop: (line: ChartLine, move: ChartMove) => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 720, h: 380 });
  const [drag, setDrag] = useState<{ id: string; y: number } | null>(null);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const read = () => setSize({ w: Math.max(260, Math.round(el.clientWidth)), h: Math.max(180, Math.round(el.clientHeight)) });
    const ro = new ResizeObserver(read);
    ro.observe(el);
    read();
    return () => ro.disconnect();
  }, []);

  const { w: W, h: H } = size;
  const plotW = W - AXIS;
  const plotH = H - TIME;
  const top = 44;
  const volH = Math.min(70, plotH * 0.16);
  const bottom = plotH - volH - 6;
  const mcs = history.map((p) => p * supply);
  const levelMc = (l: ChartLine) => l.mc ?? l.price * supply;
  const placed = lines.map((l) => (preview && preview.id === l.id ? { ...l, mc: preview.value } : l));
  const visible = [...mcs, ...placed.map(levelMc)].filter((v) => v > 0 && Number.isFinite(v));
  const lo = Math.log(Math.min(...visible) * 0.92);
  const hi = Math.log(Math.max(...visible) * 1.08);
  const y = (mc: number) => top + ((hi - Math.log(mc)) / (hi - lo || 1)) * (bottom - top);
  const mcAt = (py: number) => Math.exp(hi - ((py - top) / (bottom - top)) * (hi - lo));

  const n = mcs.length;
  const step = plotW / n;
  const body = Math.max(1, step * 0.6);
  const candles = useMemo(
    () =>
      mcs.map((c, i) => {
        const o = i ? mcs[i - 1] : c;
        const w = 0.004 + noise(tick - (n - 1 - i)) * 0.014;
        const v = 40 + noise(tick - (n - 1 - i) + 7) * 160 + Math.abs(c / o - 1) * 6000;
        return { o, c, h: Math.max(o, c) * (1 + w), l: Math.min(o, c) * (1 - w), v };
      }),
    [history],
  );
  const vmax = Math.max(...candles.map((k) => k.v));
  const last = candles[n - 1];
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => top + f * (bottom - top));
  const minuteAt = (i: number) => {
    const m = (9 * 60 + tick - (n - 1 - i)) % (24 * 60);
    return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
  };
  const every = Math.max(10, Math.round(n / Math.max(2, Math.floor(plotW / 110))));
  const marks = swaps.map((s) => ({ ...s, i: n - 1 - (tick - s.tick) })).filter((s) => s.i >= 0 && s.i < n);

  /** Drag a line by its edge, like on fomo's chart: Tippy asks before moving anything. */
  const down = (l: ChartLine) => (e: PointerEvent) => {
    if (!l.draggable) return;
    e.preventDefault();
    const rect = box.current!.getBoundingClientRect();
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    setDrag({ id: l.id, y: e.clientY - rect.top });
  };
  const move = (e: PointerEvent) => {
    if (!drag) return;
    const rect = box.current!.getBoundingClientRect();
    setDrag({ id: drag.id, y: Math.min(bottom, Math.max(top, e.clientY - rect.top)) });
  };
  const up = () => {
    if (!drag) return;
    const l = lines.find((x) => x.id === drag.id);
    const mc = mcAt(drag.y);
    setDrag(null);
    if (l && Math.abs(Math.log(mc / levelMc(l))) > 0.005) onDrop(l, { id: l.id, value: Math.round(mc), axis: 'mc' });
  };

  const chg = last.c - last.o;
  return (
    <div class={`cc${drag ? ' is-dragging' : ''}`} ref={box} onPointerMove={move} onPointerUp={up} onPointerCancel={() => setDrag(null)}>
      <div class="cc-legend" aria-hidden="true">
        <p>
          {name} · 1 · pretend <i>O</i>
          <b class={chg >= 0 ? 'up' : 'down'}>{formatUsd(last.o)}</b> <i>H</i>
          <b class={chg >= 0 ? 'up' : 'down'}>{formatUsd(last.h)}</b> <i>L</i>
          <b class={chg >= 0 ? 'up' : 'down'}>{formatUsd(last.l)}</b> <i>C</i>
          <b class={chg >= 0 ? 'up' : 'down'}>{formatUsd(last.c)}</b>{' '}
          <b class={chg >= 0 ? 'up' : 'down'}>
            {chg >= 0 ? '+' : '−'}
            {formatUsd(Math.abs(chg))} ({chg >= 0 ? '+' : '−'}
            {Math.abs((chg / last.o) * 100).toFixed(2)}%)
          </b>
        </p>
        <p>
          Volume <b class={chg >= 0 ? 'up' : 'down'}>{last.v.toFixed(2)}</b>
        </p>
      </div>
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Market cap chart, now ${formatUsd(last.c)}${lines.length ? `, with ${lines.length} Tippy order line${lines.length === 1 ? '' : 's'}` : ''}`}>
        {ticks.map((ty) => (
          <g key={ty}>
            <line x1="0" x2={plotW} y1={ty} y2={ty} class="cc-grid" />
            <text x={W - 8} y={ty + 4} class="cc-axis" text-anchor="end">
              {formatUsd(mcAt(ty))}
            </text>
          </g>
        ))}
        {candles.map((_, i) =>
          i % every === every - 1 ? (
            <g key={`t${i}`}>
              <line x1={i * step + step / 2} x2={i * step + step / 2} y1="0" y2={plotH} class="cc-grid" />
              <text x={i * step + step / 2} y={H - 7} class="cc-axis" text-anchor="middle">
                {minuteAt(i)}
              </text>
            </g>
          ) : null,
        )}
        {candles.map((k, i) => {
          const x = i * step + step / 2;
          const col = k.c >= k.o ? UP : DOWN;
          const vh = (k.v / vmax) * volH;
          return <rect key={`v${i}`} x={x - body / 2} y={plotH - vh} width={body} height={vh} fill={col} opacity="0.32" />;
        })}
        {candles.map((k, i) => {
          const x = i * step + step / 2;
          const col = k.c >= k.o ? UP : DOWN;
          const t = y(Math.max(k.o, k.c));
          return (
            <g key={i}>
              <line x1={x} x2={x} y1={y(k.h)} y2={y(k.l)} stroke={col} stroke-width="1" />
              <rect x={x - body / 2} y={t} width={body} height={Math.max(1, y(Math.min(k.o, k.c)) - t)} fill={col} />
            </g>
          );
        })}
        <line x1="0" x2={plotW} y1={y(last.c)} y2={y(last.c)} class="cc-now" stroke={chg >= 0 ? UP : DOWN} />
        {marks.map((s) => (
          <g key={s.id} class={`cc-mark${s.by === 'tippy' ? ' is-tippy' : ''}`} transform={`translate(${s.i * step + step / 2},${y(s.mc)})`}>
            <title>{`${s.by === 'tippy' ? 'Tippy' : 'You'} ${s.side === 'buy' ? 'bought' : 'sold'} ${formatUsd(s.usd)} at ${formatUsd(s.mc)} MC`}</title>
            <circle r="9" fill={s.side === 'buy' ? UP : DOWN} />
            <text y="3.5" text-anchor="middle">
              {s.side === 'buy' ? 'B' : 'S'}
            </text>
          </g>
        ))}
        <g class="cc-tag">
          <rect x={plotW + 2} y={y(last.c) - 9} width={AXIS - 4} height="18" rx="3" fill={chg >= 0 ? UP : DOWN} />
          <text x={W - 8} y={y(last.c) + 4} text-anchor="end">
            {formatUsd(last.c)}
          </text>
        </g>
        {placed.map((l) => {
          const ly = drag && drag.id === l.id ? drag.y : y(levelMc(l));
          const col = l.muted ? MUTED : COLORS[l.kind];
          return (
            <g key={l.id} class={`cc-line${l.draggable ? ' is-draggable' : ''}`} onPointerDown={down(l) as never}>
              <line x1="0" x2={plotW} y1={ly} y2={ly} stroke={col} stroke-width="2" stroke-dasharray="6 5" />
              <line x1="0" x2={plotW} y1={ly} y2={ly} class="cc-hit" />
              <text x={plotW - 8} y={ly - 6} text-anchor="end" fill={col} class="cc-label">
                {l.label}
              </text>
              <rect x={plotW + 2} y={ly - 9} width={AXIS - 4} height="18" rx="3" fill={col} />
              <text x={W - 8} y={ly + 4} text-anchor="end" class="cc-tagtext">
                {formatUsd(drag && drag.id === l.id ? mcAt(drag.y) : levelMc(l))}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
