// "Try Tippy before you install": the real Tippy window, chat and order engine on
// a pretend coin whose price you can pump and dump. Limit buys fill from pretend
// cash. It opens with a few orders already on, dry run showing. Nothing here
// touches fomo.

import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { isLiveBuy } from '@ext/engine/buys';
import { buildPlan } from '@ext/engine/orders';
import { formatUsd, triggerPrice } from '@ext/engine/triggers';
import type { BuyOrder, Plan } from '@ext/engine/types';
import { DEFAULT_PRESETS } from '@ext/shared/settings';
import { Chat } from '@ext/ui/Chat';
import { Mascot } from '@ext/ui/Mascot';
import { TippyWindow } from '@ext/ui/TippyWindow';
import { reducedMotion, seedPath, SUPPLY, typeInto, useMarket, wait } from './market';

/** $DEMO opens at an $800K market cap, so every example below is a valid order. */
const START = 0.0008;
const BAG = 125_000; // $100 of $DEMO
/** The phrases on the chips: each one comes back as a confirm card at the opening price. */
const PHRASES = ['sell 50% at 2x', 'sl half at 600k', 'buy $5 at 500k mcap'];

export function Demo() {
  const m = useMarket({
    symbol: 'DEMO',
    name: 'Demo coin',
    startPrice: START,
    startBag: BAG,
    startCash: 50,
    toggles: { dryRun: true },
    seedHistory: () => seedPath(START, START * 0.6, 90, 11),
    // Orders already on, so the chart shows its lines before anyone touches it.
    seedPlan: (base) => {
      const p = buildPlan({
        ...base,
        id: 'demo-seed',
        entry: { priceUSD: START, mc: START * SUPPLY, source: 'armed-at' },
        tps: [{ trigger: { kind: 'mc', value: 1_400_000 }, sellPct: 25 }],
        stops: [{ trigger: { kind: 'mc', value: 650_000 }, sellPct: 10 }],
        sl: { trigger: { kind: 'mc', value: 450_000 } },
        trailing: null,
        origin: 'manual',
      });
      p.lastPrice = START;
      return p;
    },
  });
  const side = useRef<HTMLDivElement>(null);
  const root = useRef<HTMLDivElement>(null);
  const [typing, setTyping] = useState(false);
  /** On phones the toasts sit fixed at the bottom of the screen, so only while the demo is on screen. */
  const [inView, setInView] = useState(false);
  useEffect(() => {
    const el = root.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(([e]) => setInView(e.isIntersecting));
    io.observe(el);
    return () => io.disconnect();
  }, []);
  const shownPlan = m.plan && (m.plan.state === 'armed' || m.plan.state === 'paused') ? m.plan : null;
  const done = m.plan && m.plan.state === 'done';
  /** The move across the chart you can see, so it matches the line. */
  const chg = (m.price / m.history[0] - 1) * 100;
  const chgText = `${chg >= 0 ? '+' : '−'}${Math.abs(chg).toFixed(1)}%`;

  /** A chip types its phrase into Tippy's real chat box and sends it. */
  const say = async (phrase: string) => {
    const input = side.current?.querySelector<HTMLInputElement>('.tw-chat-bar input');
    if (!input || typing) return;
    setTyping(true);
    if (reducedMotion()) typeInto(input, phrase);
    else for (let i = 1; i <= phrase.length; i++) {
      typeInto(input, phrase.slice(0, i));
      await wait(24);
    }
    await wait(80);
    input.form?.requestSubmit();
    setTyping(false);
  };

  return (
    <div class="demo" ref={root}>
      <div class="demo-main">
        <div class="demo-bar">
          <div class="dm-sym">
            <span class="dm-avatar" aria-hidden="true">
              D
            </span>
            <div>
              <b>$DEMO</b>
              <small>Pretend coin · pretend money</small>
            </div>
          </div>
          <dl class="dm-stats">
            <div>
              <dt>Market cap</dt>
              <dd>{formatUsd(m.price * SUPPLY)}</dd>
            </div>
            <div>
              <dt>Change</dt>
              <dd class={chg >= 0 ? 'up' : 'down'}>{chgText}</dd>
            </div>
            <div>
              <dt>Your bag</dt>
              <dd>{formatUsd(m.bag * m.price)}</dd>
            </div>
            <div>
              <dt>Cash</dt>
              <dd>{formatUsd(m.cash)}</dd>
            </div>
          </dl>
        </div>
        <Chart history={m.history} start={m.history[0]} plan={shownPlan ?? (done ? m.plan : null)} buys={m.buys.filter(isLiveBuy)} />
        <div class="demo-controls">
          <button class="dbtn dbtn-up" onClick={m.pump}>
            <i aria-hidden="true" /> Pump
          </button>
          <button class="dbtn dbtn-down" onClick={m.dump}>
            <i aria-hidden="true" /> Dump
          </button>
          <button class="dbtn" aria-pressed={m.auto} onClick={() => m.setAuto(!m.auto)}>
            {m.auto ? 'Pause market' : 'Let it run'}
          </button>
          <button class="dbtn dbtn-icon" onClick={m.reset} aria-label="Reset the demo" title="Reset">
            <ResetIcon />
          </button>
          <span class="dm-hint">Add an order in Tippy, then move the market.</span>
        </div>
        <div class={`toasts${inView ? '' : ' is-away'}`} aria-live="polite">
          {m.toasts.map((t) => (
            <div class={`toast toast-${t.tone}`} key={t.id}>
              <Mascot mood={t.tone === 'good' ? 'happy' : 'worried'} size={28} />
              <div>
                <b>{t.title}</b>
                <span>{t.text}</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div class="demo-side" ref={side}>
        <div class="tippy">
          <TippyWindow
            key={m.plan?.id ?? 'new'}
            token={m.token}
            plan={shownPlan}
            buys={m.buys}
            cash={m.cash}
            minBuyUsd={2}
            minSellUsd={2}
            practice={m.practice}
            presets={DEFAULT_PRESETS}
            defaultPresetId="classic"
            api={m.api}
            intro={!m.plan}
            toggles={m.toggles}
            onToggle={(name, v) => m.setToggles((t) => ({ ...t, [name]: v }))}
            note="Demo: dry run is on — nothing here touches fomo"
            chat={<Chat ctx={m.chatCtx} placeholder="Try: sell 50% at 2x" />}
          />
        </div>
        {done && (
          <button class="dbtn dbtn-wide" onClick={m.reset}>
            Play again
          </button>
        )}
        {/* Phones and tablets: the market controls again, right under the window, so you never scroll back up to move the price. */}
        <div class="demo-dock" role="group" aria-label="Move the pretend market">
          <span class="dock-q">
            {formatUsd(m.price * SUPPLY)} <em class={chg >= 0 ? 'up' : 'down'}>{chgText}</em>
          </span>
          <button class="dbtn dbtn-up" onClick={m.pump}>
            <i aria-hidden="true" /> Pump
          </button>
          <button class="dbtn dbtn-down" onClick={m.dump}>
            <i aria-hidden="true" /> Dump
          </button>
          <button class="dbtn dbtn-icon" onClick={m.reset} aria-label="Reset the demo" title="Reset">
            <ResetIcon />
          </button>
        </div>
        <div class="try">
          <p class="try-label">Type into Tippy’s chat</p>
          <div class="try-chips">
            {PHRASES.map((p) => (
              <button class="try-chip" key={p} disabled={typing} onClick={() => say(p)}>
                {p}
              </button>
            ))}
          </div>
          <p class="try-note">Tippy answers with a card. Nothing changes until you tap it.</p>
        </div>
      </div>
    </div>
  );
}

function ResetIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M3.2 6.2A5 5 0 1 1 3 9.6" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" />
      <path d="M2.6 2.8v3.6h3.6" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" />
    </svg>
  );
}

interface Level {
  price: number;
  tone: 'tp' | 'sl' | 'buy' | 'trail' | 'entry' | 'now';
  label: string;
  short: string;
}

function Chart({ history, start, plan, buys }: { history: number[]; start: number; plan: Plan | null; buys: BuyOrder[] }) {
  const box = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 760, h: 420 });
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const read = () => setSize({ w: Math.max(280, Math.round(el.clientWidth)), h: Math.max(240, Math.round(el.clientHeight)) });
    const ro = new ResizeObserver(read);
    ro.observe(el);
    read();
    return () => ro.disconnect();
  }, []);
  const W = size.w;
  const H = size.h;
  const narrow = W < 560;
  /** The right-hand axis: every line's price tag sits here, never on the chart. */
  const AX = narrow ? 104 : 136;

  const levels = useMemo(() => {
    const out: Level[] = [];
    if (plan) {
      out.push({ price: plan.entry.priceUSD, tone: 'entry', label: 'Entry', short: 'Entry' });
      plan.tps.forEach((t, i) => out.push({ price: triggerPrice(t.trigger, plan.entry), tone: 'tp', label: `TP${i + 1} ${t.sellPct}%`, short: `TP${i + 1}` }));
      (plan.stops ?? []).forEach((s, i) => out.push({ price: triggerPrice(s.trigger, plan.entry), tone: 'sl', label: `Stop ${s.sellPct}%`, short: `S${i + 1}` }));
      if (plan.sl) out.push({ price: triggerPrice(plan.sl.trigger, plan.entry), tone: 'sl', label: 'SL rest', short: 'SL' });
      if (plan.trailing?.active && plan.trailing.peakPrice) out.push({ price: plan.trailing.peakPrice * (1 - plan.trailing.trailPct / 100), tone: 'trail', label: 'Trail', short: 'Trail' });
    }
    buys.forEach((o) => out.push({ price: triggerPrice(o.trigger, o.ref), tone: 'buy', label: `Buy ${formatUsd(o.usd).replace('.00', '')}`, short: 'Buy' }));
    return out.filter((l) => Number.isFinite(l.price) && l.price > 0);
  }, [plan, buys]);

  const last = history[history.length - 1];
  const all = [...history, ...levels.map((l) => l.price)].filter((v) => v > 0);
  const lo = Math.log(Math.min(...all) * 0.85);
  const hi = Math.log(Math.max(...all) * 1.15);
  const pad = 20;
  const y = (p: number) => H - pad - ((Math.log(p) - lo) / (hi - lo || 1)) * (H - pad * 2);
  const plotW = W - AX - 10;
  const x = (i: number) => (i / (history.length - 1)) * plotW;
  const d = history.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p).toFixed(1)}`).join(' ');
  const up = last >= start;
  const grid = [0.1, 0.3, 0.5, 0.7, 0.9].map((f) => pad + f * (H - pad * 2));
  const priceAt = (gy: number) => Math.exp(lo + ((H - pad - gy) / (H - pad * 2)) * (hi - lo));

  // Tags never overlap: sort by height, push apart, then pull back inside the chart.
  const GAP = 21;
  const tags = [{ price: last, tone: 'now' as const, label: 'Now', short: 'Now' }, ...levels].map((l) => ({ ...l, y: y(l.price), ty: y(l.price) })).sort((a, b) => a.y - b.y);
  for (let i = 0; i < tags.length; i++) tags[i].ty = Math.max(tags[i].y, i ? tags[i - 1].ty + GAP : 12);
  for (let i = tags.length - 1; i >= 0; i--) tags[i].ty = Math.min(tags[i].ty, i < tags.length - 1 ? tags[i + 1].ty - GAP : H - 12);

  return (
    <div class="chart-box" ref={box}>
      <svg class="chart" width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`$DEMO market cap chart, now ${formatUsd(last * SUPPLY)}${levels.length ? `, with ${levels.length} order lines` : ''}`}>
        <defs>
          <linearGradient id="demo-fill" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stop-color={up ? 'var(--up)' : 'var(--down)'} stop-opacity="0.14" />
            <stop offset="1" stop-color={up ? 'var(--up)' : 'var(--down)'} stop-opacity="0" />
          </linearGradient>
        </defs>
        {grid.map((gy) => (
          <g key={gy}>
            <line x1="0" x2={W - AX} y1={gy} y2={gy} class="ch-grid" />
            {!tags.some((t) => Math.abs(t.ty - gy) < 18) && (
              <text x={W - 10} y={gy + 3.5} class="ch-axis" text-anchor="end">
                {formatUsd(priceAt(gy) * SUPPLY)}
              </text>
            )}
          </g>
        ))}
        <line x1={W - AX} x2={W - AX} y1="0" y2={H} class="ch-grid" />
        <path d={`${d} L${x(history.length - 1)},${H} L0,${H} Z`} fill="url(#demo-fill)" />
        {levels.map((l, i) => (
          <line key={`l${i}`} class={`ch-lvl ch-${l.tone}`} x1="0" x2={W - AX} y1={y(l.price)} y2={y(l.price)} />
        ))}
        <line class="ch-nowline" x1="0" x2={W - AX} y1={y(last)} y2={y(last)} />
        <path d={d} fill="none" class={`ch-line ${up ? 'is-up' : 'is-down'}`} />
        <circle cx={x(history.length - 1)} cy={y(last)} r="4" class={`ch-dot ${up ? 'is-up' : 'is-down'}`} />
        {tags.map((t, i) => (
          <g key={`t${i}`} class={`ch-tag ch-${t.tone}`}>
            {Math.abs(t.ty - t.y) > 1 && <path d={`M${W - AX},${t.y} L${W - AX + 4},${t.ty}`} class="ch-elbow" />}
            <rect x={W - AX + 4} y={t.ty - 9.5} width={AX - 10} height="19" rx="4" />
            <text x={W - AX + 11} y={t.ty + 3.5} class="ch-tag-l">
              {narrow ? t.short : t.label}
            </text>
            <text x={W - 13} y={t.ty + 3.5} class="ch-tag-v" text-anchor="end">
              {formatUsd(t.price * SUPPLY)}
            </text>
          </g>
        ))}
      </svg>
    </div>
  );
}
