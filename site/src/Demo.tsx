// "Try Tippy before you install": the real Tippy card + the real order engine,
// on a pretend coin whose price you can pump and dump. Limit buys fill from
// pretend cash. Nothing here touches fomo.

import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { applyBuyOutcome, buildBuy, cancelBuy, evaluateBuy, isLiveBuy, markBuyExecuting, protectedBy, resolveUnknownBuy, validateBuyInput } from '@ext/engine/buys';
import { applyOutcome, buildPlan, cancelPlan, editPlan, evaluate, markExecuting, pausePlan, rescale, resumePlan } from '@ext/engine/orders';
import { formatUsd, formatX, triggerPrice } from '@ext/engine/triggers';
import type { BuyOrder, Plan } from '@ext/engine/types';
import type { PracticeResult } from '@ext/shared/messages';
import { DEFAULT_PRESETS } from '@ext/shared/settings';
import { Mascot } from '@ext/ui/Mascot';
import { TippyWindow, type WindowApi, type WindowToggles, type WindowToken } from '@ext/ui/TippyWindow';

const START_PRICE = 0.0001;
const SUPPLY = 1_000_000_000;
const START_BAG = 1_000_000; // $100 at start
const START_CASH = 50; // pretend fomo cash for limit buys
const MIN_BUY_USD = 2;
const HISTORY = 90;

interface Toast {
  id: number;
  text: string;
  mood: 'happy' | 'worried';
}

let toastId = 0;

export function Demo() {
  const [price, setPrice] = useState(START_PRICE);
  const [history, setHistory] = useState<number[]>(() => Array.from({ length: HISTORY }, (_, i) => START_PRICE * (1 + Math.sin(i / 7) * 0.04)));
  const [bag, setBag] = useState(START_BAG);
  const [cash, setCash] = useState(START_CASH);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [buys, setBuys] = useState<BuyOrder[]>([]);
  const [practice, setPractice] = useState<PracticeResult | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [auto, setAuto] = useState(false);
  const [toggles, setToggles] = useState<WindowToggles>({ autoGuard: false, dryRun: false, alerts: true });
  /** Levels as a market cap (the default) or a move — ⇄ in the window flips it. */
  const [levelUnit, setLevelUnit] = useState<'mc' | 'move'>('mc');
  const target = useRef<number | null>(null);

  // refs so the interval always sees the latest state
  const live = useRef({ price, bag, plan, buys, cash });
  live.current = { price, bag, plan, buys, cash };

  const toast = (text: string, mood: Toast['mood']) => {
    const t = { id: ++toastId, text, mood };
    setToasts((xs) => [...xs.slice(-2), t]);
    setTimeout(() => setToasts((xs) => xs.filter((x) => x.id !== t.id)), 4_500);
  };

  const step = () => {
    let { price: p, bag: b, plan: pl, cash: c } = live.current;
    const bs = live.current.buys;
    // drift toward the pump/dump target, otherwise wander
    const goal = target.current;
    if (goal != null) {
      p = p + (goal - p) * 0.35 + p * (Math.random() - 0.5) * 0.04;
      if (Math.abs(goal - p) / goal < 0.03) target.current = null;
    } else {
      p = p * Math.exp((Math.random() - 0.48) * 0.12);
    }
    p = Math.max(START_PRICE * 0.05, p);
    setPrice(p);
    setHistory((h) => [...h.slice(-(HISTORY - 1)), p]);

    const now = Date.now();
    if (pl && pl.state === 'armed') {
      const r = evaluate(pl, { priceUSD: p, mc: p * SUPPLY, at: now }, b, { now, gap: false, gapPolicy: 'sell', minSellUsd: 2, dustUsd: 1 });
      pl = r.plan;
      for (const a of r.actions) {
        if (a.type !== 'sell') continue;
        const sold = b - a.targetRemaining;
        b = a.targetRemaining;
        c += sold * p;
        pl = markExecuting(pl, a.level, now);
        pl = applyOutcome(pl, a.level, { status: 'filled', balanceAfter: b }, now);
        const isTp = a.level.kind === 'tp';
        toast(`${isTp ? '🎉 Took profit' : '🛟 Stopped out'}: sold ${formatUsd(sold * p)} of $DEMO at ${formatX(p / pl.entry.priceUSD)}`, isTp ? 'happy' : 'worried');
      }
    }

    // Limit buys go after the sells, one at a time, from pretend cash.
    if (bs.some(isLiveBuy)) {
      const next = new Map<string, BuyOrder>();
      for (const o of bs) {
        const r = evaluateBuy(o, { priceUSD: p, mc: p * SUPPLY, at: now }, now);
        if (!r.action) {
          next.set(o.id, r.order);
          continue;
        }
        let ord = markBuyExecuting(r.order, now);
        if (c < ord.usd) {
          toast(`💸 Not enough pretend cash for that ${formatUsd(ord.usd)} buy.`, 'worried');
          next.set(o.id, applyBuyOutcome(ord, { status: 'no-cash', cash: c }, now));
          continue;
        }
        const got = ord.usd / p;
        c -= ord.usd;
        b += got;
        ord = applyBuyOutcome(ord, { status: 'filled', got, price: p }, now);
        const preset = DEFAULT_PRESETS.find((x) => x.id === ord.guardPresetId);
        const kept = !!pl && (pl.state === 'armed' || pl.state === 'paused');
        if (pl && kept) {
          // Like the extension: the coin's running guard covers the new coins, sized to the bigger bag.
          pl = rescale(pl, b, now);
        } else if (preset) {
          // Guard the whole bag with the preset, from this fill.
          pl = buildPlan({
            id: `demo-${now}`,
            key: token.key,
            networkId: token.networkId,
            address: token.address,
            symbol: 'DEMO',
            name: 'Demo coin',
            entry: { priceUSD: p, mc: p * SUPPLY, source: 'fill' },
            balance: b,
            tps: preset.tps.map((t) => ({ trigger: { kind: 'x', value: t.x }, sellPct: t.pct })),
            sl: preset.slX != null ? { trigger: { kind: 'x', value: preset.slX } } : null,
            trailing: preset.trail ? { trailPct: preset.trail.pct, activateX: preset.trail.activateX } : null,
            origin: 'manual',
            now,
          });
          ord = protectedBy(ord, pl.id, `Guarding with ${preset.name}.`, now);
        }
        toast(`🪄 Limit buy filled: ${formatUsd(ord.usd)} of $DEMO at ${formatUsd(p * SUPPLY)} MC${kept ? ' — your guard covers it' : preset ? ` — guarded with ${preset.name}` : ''}`, 'happy');
        next.set(o.id, ord);
      }
      // Merge, so an order placed or cancelled meanwhile isn't lost.
      setBuys((cur) => cur.map((o) => (o.state === 'cancelled' ? o : (next.get(o.id) ?? o))));
    }
    if (c !== live.current.cash) setCash(c);
    if (b !== live.current.bag) setBag(b);
    if (pl !== live.current.plan) setPlan(pl);
  };

  useEffect(() => {
    const t = setInterval(() => {
      if (auto || target.current != null) step();
    }, 450);
    return () => clearInterval(t);
  }, [auto]);

  const pump = () => (target.current = live.current.price * (2.2 + Math.random()));
  const dump = () => (target.current = live.current.price * (0.45 + Math.random() * 0.1));
  const reset = () => {
    target.current = null;
    setAuto(false);
    setPrice(START_PRICE);
    setHistory(Array.from({ length: HISTORY }, () => START_PRICE));
    setBag(START_BAG);
    setCash(START_CASH);
    setPlan(null);
    setBuys([]);
    setPractice(null);
  };

  const token: WindowToken = {
    key: 'demo:1399811149',
    address: 'demo',
    networkId: 1399811149,
    chainName: 'pretend chain',
    symbol: 'DEMO',
    name: 'Demo coin',
    priceUSD: price,
    mc: price * SUPPLY,
    balance: bag,
  };

  const api: WindowApi = {
    arm: async (input) => {
      const p = buildPlan({ ...input, id: `demo-${Date.now()}`, now: Date.now() });
      setPlan(p);
      toast('🛡️ Tippy is guarding $DEMO. Now hit Pump or Dump!', 'happy');
      if (!auto && target.current == null) setAuto(true);
      return { ok: true, plan: p };
    },
    pause: async () => (setPlan((p) => p && pausePlan(p, Date.now())), { ok: true }),
    resume: async () => (setPlan((p) => p && resumePlan(p, Date.now())), { ok: true }),
    cancel: async () => (setPlan((p) => p && cancelPlan(p, Date.now())), { ok: true }),
    resolveHeld: async () => ({ ok: true }),
    retry: async () => ({ ok: true }),
    update: async (_planId, edit) => {
      const p = live.current.plan;
      if (!p) return { ok: false, error: 'That plan is gone.', stale: true };
      const r = editPlan(p, edit, Date.now());
      if (!r.ok) return r;
      setPlan(r.plan);
      return { ok: true, plan: r.plan };
    },
    armBuy: async (input) => {
      const issues = validateBuyInput(input, MIN_BUY_USD);
      if (issues.length) return { ok: false, error: issues[0].message };
      const o = buildBuy({ ...input, id: `buy-${Date.now()}`, now: Date.now() });
      setBuys((bs) => [...bs, o]);
      toast(`🪄 Limit buy placed. Hit ${o.direction === 'down' ? 'Dump' : 'Pump'} and watch Tippy buy it!`, 'happy');
      if (!auto && target.current == null) setAuto(true);
      return { ok: true, buy: o };
    },
    cancelBuy: async (orderId) => (setBuys((bs) => bs.map((o) => (o.id === orderId ? cancelBuy(o, Date.now()) : o))), { ok: true }),
    resolveBuy: async (orderId, bought) => (setBuys((bs) => bs.map((o) => (o.id === orderId ? resolveUnknownBuy(o, bought, Date.now()) : o))), { ok: true }),
    // Demo only: no fomo here, so the practice run just explains what it would do.
    practice: async (key, side, usd) => {
      await new Promise((r) => setTimeout(r, 1_400));
      const result: PracticeResult = {
        key,
        symbol: 'DEMO',
        side,
        at: Date.now(),
        ok: true,
        stage: 'dry-run',
        detail:
          side === 'buy'
            ? `on fomo, Tippy would open Buy, type ${formatUsd(usd ?? 10)}, check the price impact and stop right before "Buy DEMO".`
            : 'on fomo, Tippy would open Sell, pick the amount, check the price impact and stop right before "Sell DEMO".',
      };
      setPractice(result);
      return { ok: true, practice: result };
    },
  };

  const shownPlan = plan && (plan.state === 'armed' || plan.state === 'paused') ? plan : null;
  const done = plan && plan.state === 'done';

  return (
    <div class="demo">
      <div class="demo-chart t-card">
        <div class="t-head">
          <div class="coin-avatar">D</div>
          <div class="t-grow">
            <h2>$DEMO</h2>
            <p>A pretend coin. Push it around and watch Tippy work.</p>
          </div>
          <div class="price">
            <b>{formatUsd(price * SUPPLY)}</b>
            <span class={price >= START_PRICE ? 't-up' : 't-down'}>{formatX(price / START_PRICE)}</span>
          </div>
        </div>
        <Chart history={history} plan={shownPlan ?? (done ? plan : null)} buys={buys.filter(isLiveBuy)} />
        <div class="demo-controls">
          <button class="t-btn t-btn-ghost" onClick={pump}>
            🚀 Pump
          </button>
          <button class="t-btn t-btn-ghost" onClick={dump}>
            📉 Dump
          </button>
          <button class="t-btn t-btn-ghost" aria-pressed={auto} onClick={() => setAuto(!auto)}>
            {auto ? '⏸ Pause market' : '🎲 Let it run'}
          </button>
          <button class="t-btn t-btn-ghost" onClick={reset} aria-label="Reset demo">
            ↺
          </button>
        </div>
        <div class="demo-wallet">
          <div>
            <span>Your bag</span>
            <b>{formatUsd(bag * price)}</b>
          </div>
          <div>
            <span>Cash</span>
            <b class="t-up">{formatUsd(cash)}</b>
          </div>
        </div>
      </div>

      <div class="demo-card">
        <TippyWindow
          key={plan?.id ?? 'new'}
          token={token}
          plan={shownPlan}
          buys={buys}
          cash={cash}
          minBuyUsd={MIN_BUY_USD}
          practice={practice}
          presets={DEFAULT_PRESETS}
          defaultPresetId="classic"
          api={api}
          intro={!plan}
          toggles={toggles}
          onToggle={(name, v) => setToggles((t) => ({ ...t, [name]: v }))}
          levelUnit={levelUnit}
          onLevelUnit={setLevelUnit}
        />
        {done && (
          <button class="tw-arm" style={{ marginTop: 12, width: '100%' }} onClick={reset}>
            Play again
          </button>
        )}
      </div>

      <div class="toasts" aria-live="polite">
        {toasts.map((t) => (
          <div class="toast t-card" key={t.id}>
            <Mascot mood={t.mood} size={36} />
            <span>{t.text}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function Chart({ history, plan, buys }: { history: number[]; plan: Plan | null; buys: BuyOrder[] }) {
  const W = 600;
  const H = 240;
  const levels = useMemo(() => {
    const out: { price: number; color: string; label: string }[] = [];
    if (plan) {
      out.push({ price: plan.entry.priceUSD, color: 'var(--t-muted)', label: 'entry' });
      plan.tps.forEach((t, i) => out.push({ price: triggerPrice(t.trigger, plan.entry), color: 'var(--t-up)', label: `TP${i + 1} ${formatX(triggerPrice(t.trigger, plan.entry) / plan.entry.priceUSD)}` }));
      if (plan.sl) out.push({ price: triggerPrice(plan.sl.trigger, plan.entry), color: 'var(--t-down)', label: 'SL' });
      if (plan.trailing?.active && plan.trailing.peakPrice) out.push({ price: plan.trailing.peakPrice * (1 - plan.trailing.trailPct / 100), color: 'var(--t-amber)', label: 'trail' });
    }
    buys.forEach((o) => out.push({ price: triggerPrice(o.trigger, o.ref), color: 'var(--t-gold)', label: `BUY ${formatUsd(o.usd)}`.replace('.00', '') }));
    return out.filter((l) => Number.isFinite(l.price) && l.price > 0);
  }, [plan, buys]);

  const all = [...history, ...levels.map((l) => l.price)].filter((v) => v > 0);
  const lo = Math.log(Math.min(...all) * 0.9);
  const hi = Math.log(Math.max(...all) * 1.1);
  const y = (p: number) => H - 14 - ((Math.log(p) - lo) / (hi - lo || 1)) * (H - 28);
  const x = (i: number) => (i / (history.length - 1)) * (W - 70);
  const d = history.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p).toFixed(1)}`).join(' ');
  const last = history[history.length - 1];

  return (
    <svg class="chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Demo price chart">
      <defs>
        <linearGradient id="fill" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stop-color="var(--t-mint)" stop-opacity="0.28" />
          <stop offset="1" stop-color="var(--t-mint)" stop-opacity="0" />
        </linearGradient>
      </defs>
      {levels.map((l, i) => (
        <g key={`${l.label}:${i}`}>
          <line x1="0" x2={W - 70} y1={y(l.price)} y2={y(l.price)} stroke={l.color} stroke-dasharray="5 5" stroke-width="1.5" opacity="0.8" />
          <text x={W - 64} y={y(l.price) + 4} fill={l.color} font-size="12" font-weight="800">
            {l.label}
          </text>
        </g>
      ))}
      <path d={`${d} L${x(history.length - 1)},${H} L0,${H} Z`} fill="url(#fill)" />
      <path d={d} fill="none" stroke="var(--t-mint)" stroke-width="2.5" stroke-linejoin="round" vector-effect="non-scaling-stroke" />
      <circle cx={x(history.length - 1)} cy={y(last)} r="5" fill="var(--t-mint)" />
    </svg>
  );
}
