// Promo-video stage (harness/demo.html?demo): a pretend coin whose price only
// moves when the script says so, a candlestick chart with Tippy's orders drawn
// on it, and a stand-in for the background worker that runs Tippy's real order
// engine and "fills" sells on the pretend coin. Nothing here talks to fomo.
import { triggerPrice } from '../src/engine/triggers';
import { applyOutcome, evaluate, markExecuting } from '../src/engine/orders';
import type { LevelRef, Plan, SellAction } from '../src/engine/types';
import type { Notice } from '../src/shared/messages';
import { sellFilledNotice } from '../src/shared/notices';
import { browser } from './mock-browser';
import tippyIcon from '../assets/tippy-icon.svg?url';
import { COIN, demoCtl, HARNESS_KEY } from './mock-fomo';

const SUPPLY = demoCtl.supply;
const ENTRY_MC = 300_000;
const START_BAG = demoCtl.bag;
const $ = (id: string) => document.getElementById(id)!;

// The promo films on $TIPPY (?coin=tippy): Tippy's own avatar, and the pill says the prices are pretend.
if (COIN.symbol === 'TIPPY') {
  document.title = 'Tippy · demo';
  document.querySelector('header .name')!.innerHTML = '<b>Tippy</b><span>$TIPPY</span>';
  document.querySelector('header .pill')!.textContent = 'Demo · pretend prices';
  const av = document.querySelector('header svg.avatar')!;
  av.outerHTML = `<img class="avatar" src="${tippyIcon}" alt="" style="background:#143b31;object-fit:contain;padding:3px;box-sizing:border-box" />`;
}

// ---------- the price ----------
/** A seeded random so every take moves the same way. */
let seed = 7;
const rnd = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;

let mc = 420_000;
let target = mc;
let tween: { from: number; to: number; t0: number; ms: number; ease: (t: number) => number } | null = null;
let wiggle = 0.0032;
const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
const easeIn = (t: number) => t * t * (1.2 * t - 0.2 + 0.0001);

interface Candle {
  o: number;
  h: number;
  l: number;
  c: number;
}
const candles: Candle[] = [];
/** Slow candles while nothing happens, fast ones in a move, so the take isn't a flat line. */
let candleMs = 2200;
let path: { mc: number; ms: number }[] = [];
let idleTarget = 420_000;
let wanderAt = 0;

// A believable run-up to $420K before the video starts.
(function history() {
  let v = 118_000;
  for (let i = 0; i < 120; i++) {
    const drift = i < 40 ? 0.012 : i < 70 ? 0.022 : i < 95 ? -0.006 : 0.012;
    const o = v;
    v = Math.max(60_000, v * (1 + drift + (rnd() - 0.5) * 0.07));
    const c = v;
    candles.push({ o, c, h: Math.max(o, c) * (1 + rnd() * 0.025), l: Math.min(o, c) * (1 - rnd() * 0.025) });
  }
  const last = candles[candles.length - 1];
  const k = 420_000 / last.c;
  for (const c of candles.slice(-25)) {
    c.o *= k ** 0.5;
    c.h *= k ** 0.5;
    c.l *= k ** 0.5;
    c.c *= k ** 0.5;
  }
  last.c = 420_000;
  last.h = Math.max(last.h, last.c);
  mc = 420_000;
})();
candles.push({ o: mc, h: mc, l: mc, c: mc });
let candleAt = performance.now();

function step(now: number) {
  if (!tween && path.length) {
    const next = path.shift()!;
    tween = { from: target, to: next.mc, t0: now, ms: next.ms, ease: easeInOut };
  }
  if (tween) {
    const t = Math.min(1, (now - tween.t0) / tween.ms);
    target = tween.from + (tween.to - tween.from) * tween.ease(t);
    if (t >= 1) {
      tween = null;
      idleTarget = target;
      if (!path.length) {
        candleMs = 2200;
        wiggle = 0.0032;
      }
    }
  } else if (now - wanderAt > 1600) {
    // drift around the last level so an idle chart still breathes
    wanderAt = now;
    target = idleTarget * (1 + (rnd() - 0.5) * 0.035);
  }
  const noise = (rnd() - 0.5) * 2 * wiggle * mc;
  mc += (target - mc) * 0.22 + noise;
  demoCtl.price = mc / SUPPLY;
  const c = candles[candles.length - 1];
  c.c = mc;
  c.h = Math.max(c.h, mc);
  c.l = Math.min(c.l, mc);
  if (now - candleAt >= candleMs) {
    candleAt = now;
    candles.push({ o: mc, h: mc, l: mc, c: mc });
    if (candles.length > 400) candles.shift();
  }
}

// ---------- header + bag ----------
const sig = (n: number) => Number(n.toPrecision(3));
const usd = (v: number) => {
  const n = v >= 1000 ? sig(v) : v;
  return n >= 1e6 ? `$${(n / 1e6).toFixed(n >= 1e7 ? 1 : 2)}M` : n >= 1e3 ? `$${(n / 1e3).toFixed(n >= 1e5 ? 0 : 1)}K` : `$${n.toFixed(2)}`;
};
const amt = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}K` : n.toFixed(0));
let realised = 0;
let soldTokens = 0;
function header() {
  $('s-mc').textContent = usd(mc);
  $('s-price').textContent = `$${(mc / SUPPLY).toFixed(mc >= 1e6 ? 5 : 6).replace(/0+$/, '')}`;
  const day = (mc / 148_000 - 1) * 100;
  $('s-24h').textContent = `+${day.toFixed(0)}%`;
  const bag = demoCtl.bag;
  $('b-usd').textContent = `$${((bag * mc) / SUPPLY).toFixed(2)}`;
  const pnl = (mc / ENTRY_MC - 1) * 100;
  const el = $('b-pnl');
  el.textContent = `${pnl >= 0 ? '+' : ''}${pnl.toFixed(1)}%`;
  el.className = pnl >= 0 ? 'up' : 'down';
  if (realised > 0) {
    $('b-sold').textContent = `+$${realised.toFixed(2)}`;
    $('b-soldbox').classList.add('on');
  }
}

// ---------- the chart ----------
interface LineSpec {
  mc: number;
  color: string;
  label: string;
  filledAt?: number;
}
let lines: LineSpec[] = [];
const fills: { idx: number; mc: number; at: number }[] = [];

const levelMc = (plan: Plan, t: Plan['sl'] extends infer _ ? Parameters<typeof triggerPrice>[0] : never) => triggerPrice(t, plan.entry) * SUPPLY;
const pctLabel = (p: number) => `${Math.round(p)}%`;

async function readLines() {
  const { plans = {}, buys = {} } = (await browser.storage.local.get(['plans', 'buys'])) as { plans?: Record<string, Plan>; buys?: Record<string, { state: string; trigger: Parameters<typeof triggerPrice>[0]; ref: { priceUSD: number; mc: number | null }; usd: number }> };
  const out: LineSpec[] = [];
  for (const plan of Object.values(plans)) {
    if (plan.key !== HARNESS_KEY || plan.state === 'cancelled') continue;
    for (const tp of plan.tps) {
      if (tp.status === 'cancelled') continue;
      out.push({ mc: levelMc(plan, tp.trigger), color: '#21c95e', label: `Tippy · TP ${pctLabel(tp.sellPct)}`, filledAt: tp.status === 'filled' ? 1 : undefined });
    }
    for (const s of plan.stops ?? []) {
      if (s.status === 'cancelled') continue;
      out.push({ mc: levelMc(plan, s.trigger), color: '#ff7a45', label: `Tippy · STOP ${pctLabel(s.sellPct)}`, filledAt: s.status === 'filled' ? 1 : undefined });
    }
    if (plan.sl && plan.sl.status !== 'cancelled') out.push({ mc: levelMc(plan, plan.sl.trigger), color: '#ff5a36', label: 'Tippy · STOP LOSS', filledAt: plan.sl.status === 'filled' ? 1 : undefined });
  }
  for (const b of Object.values(buys)) {
    if (b.state !== 'armed') continue;
    const entry = { priceUSD: b.ref.priceUSD, mc: b.ref.mc, source: 'armed-at' as const };
    out.push({ mc: triggerPrice(b.trigger, entry) * SUPPLY, color: '#5b6cff', label: `Tippy · BUY $${b.usd}` });
  }
  lines = out.filter((l) => Number.isFinite(l.mc) && l.mc > 0);
}
browser.storage.onChanged.addListener(() => void readLines());

const canvas = $('chart') as HTMLCanvasElement;
const g = canvas.getContext('2d')!;
let lo = 300_000;
let hi = 520_000;
const SPACING = 11;
const AXIS = 86;
const TOP = 52;
const BOTTOM = 26;

function draw() {
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  if (canvas.width !== Math.round(w * dpr)) {
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
  }
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, w, h);
  const plotW = w - AXIS - 12;
  const n = Math.floor(plotW / SPACING);
  const vis = candles.slice(-n);
  // Fit the candles and every Tippy line, easing so the axis never jumps.
  let a = Infinity;
  let b = -Infinity;
  for (const c of vis.slice(-70)) {
    a = Math.min(a, c.l);
    b = Math.max(b, c.h);
  }
  for (const l of lines) {
    if (l.filledAt) continue;
    a = Math.min(a, l.mc);
    b = Math.max(b, l.mc);
  }
  // Log scale, like a memecoin chart: a 3x move looks like one, and far-off orders don't flatten the candles.
  const pad = Math.log(b / a) * 0.1 + 0.02;
  lo = Math.exp(Math.log(lo) + (Math.log(a) - pad - Math.log(lo)) * 0.08);
  hi = Math.exp(Math.log(hi) + (Math.log(b) + pad - Math.log(hi)) * 0.08);
  const L0 = Math.log(lo);
  const L1 = Math.log(hi);
  const y = (v: number) => TOP + (1 - (Math.log(v) - L0) / (L1 - L0)) * (h - TOP - BOTTOM);

  // grid + axis
  g.font = '500 11px "Martian Mono", monospace';
  g.textBaseline = 'middle';
  let lastY = Infinity;
  for (const v of TICKS) {
    if (v <= lo || v >= hi) continue;
    const yy = Math.round(y(v)) + 0.5;
    if (lastY - yy < 54) continue;
    lastY = yy;
    g.strokeStyle = 'rgba(203,208,235,0.05)';
    g.beginPath();
    g.moveTo(0, yy);
    g.lineTo(plotW, yy);
    g.stroke();
    g.fillStyle = '#6f7080';
    g.fillText(usd(v), plotW + 14, yy);
  }

  // candles (clipped to the plot, so ones far below the range don't leak into the edge)
  g.save();
  g.beginPath();
  g.rect(0, TOP - 8, plotW, h - TOP - BOTTOM + 16);
  g.clip();
  const x0 = plotW - vis.length * SPACING;
  vis.forEach((c, i) => {
    const x = x0 + i * SPACING + SPACING / 2;
    const up = c.c >= c.o;
    g.strokeStyle = g.fillStyle = up ? '#21c95e' : '#ff5a36';
    g.beginPath();
    g.moveTo(Math.round(x) + 0.5, y(c.h));
    g.lineTo(Math.round(x) + 0.5, y(c.l));
    g.stroke();
    const top = y(Math.max(c.o, c.c));
    const bh = Math.max(1.5, y(Math.min(c.o, c.c)) - top);
    g.fillRect(Math.round(x - 3.5), top, 7, bh);
  });

  g.restore();

  // Tippy's order lines
  for (const l of lines) {
    const yy = Math.round(y(l.mc)) + 0.5;
    if (yy < TOP - 4 || yy > h - BOTTOM + 4) continue;
    g.globalAlpha = l.filledAt ? 0.3 : 1;
    g.strokeStyle = l.color;
    g.setLineDash([6, 5]);
    g.lineWidth = 1.4;
    g.beginPath();
    g.moveTo(0, yy);
    g.lineTo(plotW, yy);
    g.stroke();
    g.setLineDash([]);
    g.lineWidth = 1;
    g.globalAlpha = 1;
    const text = `${l.label}  ${usd(l.mc)}${l.filledAt ? '  ✓ SOLD' : ''}`;
    g.font = '600 11.5px "Onest", sans-serif';
    const tw = g.measureText(text).width;
    pillAt(16, yy, tw + 18, 22, l.color);
    g.fillStyle = '#07060f';
    g.fillText(text, 25, yy + 0.5);
    g.font = '500 11px "Martian Mono", monospace';
    g.globalAlpha = 1;
  }

  // fill markers
  for (const f of fills) {
    const i = candles.length - 1 - f.idx;
    const x = x0 + (vis.length - 1 - i) * SPACING + SPACING / 2;
    if (x < 0) continue;
    const age = Math.min(1, (performance.now() - f.at) / 400);
    const r = 11 * (0.6 + 0.4 * age);
    g.fillStyle = '#21c95e';
    g.beginPath();
    g.arc(x, y(f.mc) - 24, r, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#07060f';
    g.font = '800 11px "Onest", sans-serif';
    g.textAlign = 'center';
    g.fillText('S', x, y(f.mc) - 23.5);
    g.textAlign = 'left';
  }

  // the price now
  const yy = Math.round(y(mc)) + 0.5;
  const last = candles[candles.length - 1];
  const col = last.c >= last.o ? '#21c95e' : '#ff5a36';
  g.strokeStyle = col;
  g.globalAlpha = 0.6;
  g.setLineDash([2, 3]);
  g.beginPath();
  g.moveTo(0, yy);
  g.lineTo(plotW, yy);
  g.stroke();
  g.setLineDash([]);
  g.globalAlpha = 1;
  pillAt(plotW + 6, yy, AXIS - 10, 22, col);
  g.fillStyle = '#07060f';
  g.font = '700 11.5px "Martian Mono", monospace';
  g.fillText(usd(mc), plotW + 13, yy + 0.5);
}

function pillAt(x: number, yMid: number, w: number, h: number, color: string) {
  g.fillStyle = color;
  g.beginPath();
  g.roundRect(x, yMid - h / 2, w, h, 6);
  g.fill();
}

/** Axis labels: round market caps, kept at least 54px apart. */
const TICKS = [50e3, 75e3, 100e3, 150e3, 200e3, 250e3, 300e3, 350e3, 400e3, 450e3, 500e3, 600e3, 750e3, 1e6, 1.25e6, 1.5e6, 2e6, 2.5e6, 3e6, 4e6, 5e6, 7.5e6, 10e6];

// ---------- the "background worker": Tippy's real engine on the pretend coin ----------
let busy = false;
async function engineTick() {
  if (busy) return;
  const { plans = {} } = (await browser.storage.local.get('plans')) as { plans?: Record<string, Plan> };
  for (const plan of Object.values(plans)) {
    if (plan.key !== HARNESS_KEY || plan.state !== 'armed') continue;
    // Your real average entry, as fomo's trade history would give it (the demo bag was bought at $300K).
    if (plan.entry.source === 'armed-at') plan.entry = { priceUSD: ENTRY_MC / SUPPLY, mc: ENTRY_MC, source: 'trades' };
    const now = Date.now();
    const res = evaluate(plan, { priceUSD: mc / SUPPLY, mc, at: now }, demoCtl.bag, { now, gap: false, gapPolicy: 'sell', minSellUsd: 2, dustUsd: 1 });
    const sell = res.actions.find((a): a is SellAction => a.type === 'sell');
    await browser.storage.local.set({ plans: { ...plans, [plan.id]: sell ? markExecuting(res.plan, sell.level, now) : res.plan } });
    if (sell) {
      busy = true;
      setTimeout(() => void fill(plan.id, sell), 650);
      return;
    }
  }
}

async function fill(planId: string, sell: SellAction) {
  const { plans = {}, notices = [] } = (await browser.storage.local.get(['plans', 'notices'])) as { plans?: Record<string, Plan>; notices?: Notice[] };
  const plan = plans[planId];
  const before = demoCtl.bag;
  const after = sell.level.kind === 'sl' || sell.level.kind === 'trail' ? 0 : Math.max(0, sell.targetRemaining);
  const soldAmount = before - after;
  demoCtl.bag = after;
  realised += (soldAmount * mc) / SUPPLY;
  soldTokens += soldAmount;
  const now = Date.now();
  const done = applyOutcome(plan, sell.level as LevelRef, { status: 'filled', balanceAfter: after, soldAmount }, now);
  const n = sellFilledNotice(done, sell.level, { soldPct: (soldAmount / done.origBalance) * 100, emptied: after === 0 });
  fills.push({ idx: candles.length - 1, mc, at: performance.now() });
  await browser.storage.local.set({ plans: { ...plans, [planId]: done }, notices: [...notices, { ...n, id: crypto.randomUUID(), at: now }].slice(-10) });
  busy = false;
}

// ---------- the director's controls (driven from the recording script) ----------
const demo = {
  /** Glide the market cap to `to` over `ms` (ease in and out). */
  moveTo(to: number, ms = 4000, ease: 'inOut' | 'in' = 'inOut') {
    tween = { from: target, to, t0: performance.now(), ms, ease: ease === 'in' ? easeIn : easeInOut };
  },
  /** Run through waypoints [[mc, ms], …] with fast candles — a pump with pullbacks. */
  run(points: [number, number][], candle = 300, chop = 0.006) {
    tween = null;
    path = points.map(([m, ms]) => ({ mc: m, ms }));
    candleMs = candle;
    wiggle = chop;
  },
  /** How choppy the price is (share of the price per tick). */
  chop(v: number) {
    wiggle = v;
  },
  reset() {
    demoCtl.bag = START_BAG;
    realised = 0;
    soldTokens = 0;
    fills.length = 0;
    $('b-soldbox').classList.remove('on');
    void browser.storage.local.set({ plans: {}, buys: {}, notices: [] });
  },
  get mc() {
    return mc;
  },
};
(window as unknown as Record<string, unknown>).__demo = demo;

// Dry run off and no intro, so the take looks like everyday use.
void browser.storage.local.get('settings').then((v) => {
  const s = (v.settings ?? {}) as Record<string, unknown>;
  void browser.storage.local.set({ settings: { ...s, dryRun: false, stayAwake: true }, status: { health: 'watching', message: 'Watching your coins.' } });
});

void readLines();
setInterval(() => step(performance.now()), 70);
setInterval(() => void engineTick(), 220);
(function frame() {
  header();
  draw();
  requestAnimationFrame(frame);
})();
