// The pretend coin page's chart: candles in market cap, and Tippy's order lines
// drawn the way the extension draws them on fomo's chart (same colours, same
// labels, same "drag a line to move it"). One log scale, so a 5x take profit and
// a −30% stop both fit.

import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { ChartLine, ChartMove } from '@ext/shared/chartLines';
import { formatUsd } from '@ext/engine/triggers';

/** The extension's line colours (entrypoints/fomo-chart.content.ts). */
const COLORS: Record<ChartLine['kind'], string> = { buy: '#2fe0a0', tp: '#5b9cff', sl: '#ff5d73', trail: '#ffb547' };
const MUTED = '#7e8994';
const UP = '#2ebd85';
const DOWN = '#f6465d';
const AXIS = 78;

/** A deterministic wick size per candle, so the chart looks the same on every visit. */
const wick = (i: number) => 0.004 + (((i * 2654435761) >>> 0) % 1000) / 1000 * 0.014;

export function CandleChart({
  history,
  supply,
  lines,
  preview,
  onDrop,
}: {
  history: number[];
  supply: number;
  lines: ChartLine[];
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
    const read = () => setSize({ w: Math.max(260, Math.round(el.clientWidth)), h: Math.max(200, Math.round(el.clientHeight)) });
    const ro = new ResizeObserver(read);
    ro.observe(el);
    read();
    return () => ro.disconnect();
  }, []);

  const { w: W, h: H } = size;
  const plotW = W - AXIS;
  const pad = 16;
  const mcs = history.map((p) => p * supply);
  const levelMc = (l: ChartLine) => (l.mc ?? l.price * supply);
  const placed = lines.map((l) => (preview && preview.id === l.id ? { ...l, mc: preview.value } : l));
  const visible = [...mcs, ...placed.map(levelMc)].filter((v) => v > 0 && Number.isFinite(v));
  const lo = Math.log(Math.min(...visible) * 0.9);
  const hi = Math.log(Math.max(...visible) * 1.1);
  const y = (mc: number) => pad + ((hi - Math.log(mc)) / (hi - lo || 1)) * (H - pad * 2);
  const mcAt = (py: number) => Math.exp(hi - ((py - pad) / (H - pad * 2)) * (hi - lo));

  const n = mcs.length;
  const step = plotW / n;
  const body = Math.max(1, step * 0.62);
  const candles = useMemo(
    () =>
      mcs.map((c, i) => {
        const o = i ? mcs[i - 1] : c;
        const w = wick(i);
        return { o, c, h: Math.max(o, c) * (1 + w), l: Math.min(o, c) * (1 - w) };
      }),
    [history],
  );
  const last = mcs[n - 1];
  const ticks = [0.12, 0.32, 0.52, 0.72, 0.92].map((f) => pad + f * (H - pad * 2));

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
    setDrag({ id: drag.id, y: Math.min(H - pad, Math.max(pad, e.clientY - rect.top)) });
  };
  const up = () => {
    if (!drag) return;
    const l = lines.find((x) => x.id === drag.id);
    const mc = mcAt(drag.y);
    setDrag(null);
    if (l && Math.abs(Math.log(mc / levelMc(l))) > 0.005) onDrop(l, { id: l.id, value: Math.round(mc), axis: 'mc' });
  };

  return (
    <div class={`cc${drag ? ' is-dragging' : ''}`} ref={box} onPointerMove={move} onPointerUp={up} onPointerCancel={() => setDrag(null)}>
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Market cap chart, now ${formatUsd(last)}${lines.length ? `, with ${lines.length} Tippy order line${lines.length === 1 ? '' : 's'}` : ''}`}>
        {ticks.map((ty) => (
          <g key={ty}>
            <line x1="0" x2={plotW} y1={ty} y2={ty} class="cc-grid" />
            <text x={W - 8} y={ty + 3.5} class="cc-axis" text-anchor="end">
              {formatUsd(mcAt(ty))}
            </text>
          </g>
        ))}
        <line x1={plotW} x2={plotW} y1="0" y2={H} class="cc-grid" />
        {candles.map((k, i) => {
          const x = i * step + step / 2;
          const col = k.c >= k.o ? UP : DOWN;
          const top = y(Math.max(k.o, k.c));
          return (
            <g key={i}>
              <line x1={x} x2={x} y1={y(k.h)} y2={y(k.l)} stroke={col} stroke-width="1" />
              <rect x={x - body / 2} y={top} width={body} height={Math.max(1, y(Math.min(k.o, k.c)) - top)} fill={col} />
            </g>
          );
        })}
        <line x1="0" x2={plotW} y1={y(last)} y2={y(last)} class="cc-now" />
        <g class="cc-tag">
          <rect x={plotW + 2} y={y(last) - 9} width={AXIS - 4} height="18" rx="3" fill={candles[n - 1].c >= candles[n - 1].o ? UP : DOWN} />
          <text x={W - 8} y={y(last) + 4} text-anchor="end">
            {formatUsd(last)}
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
