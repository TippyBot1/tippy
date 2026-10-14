// A pretend market for the site: Tippy's real engine running on a pretend coin,
// so the hero shot and the demo show the extension's real window, chat and fill
// pop-ups. Nothing here touches fomo or real money.

import { useEffect, useRef, useState } from 'preact/hooks';
import { applyBuyOutcome, buildBuy, cancelBuy, evaluateBuy, isLiveBuy, markBuyExecuting, moveBuy, protectedBy, resolveUnknownBuy, validateBuyInput } from '@ext/engine/buys';
import { presetToInput } from '@ext/engine/autoguard';
import { applyOutcome, buildPlan, cancelPlan, editPlan, evaluate, markExecuting, pausePlan, rescale, resumePlan, summarizePlan } from '@ext/engine/orders';
import { formatUsd } from '@ext/engine/triggers';
import type { BuyOrder, LevelRef, Plan, PlanInput } from '@ext/engine/types';
import type { PracticeResult } from '@ext/shared/messages';
import { buyFilledNotice, filledShare, sellFilledNotice, type Notice, type NoticeText } from '@ext/shared/notices';
import { DEFAULT_SETTINGS, type Settings } from '@ext/shared/settings';
import type { ChatCtx } from '@ext/chat/run';
import type { WindowApi, WindowToken } from '@ext/ui/TippyWindow';

export const SUPPLY = 1_000_000_000;
export const MIN_USD = 2;
const NETWORK = 1399811149;

/** A nudge from the demo itself ("now move the market"), never one of Tippy's own messages. */
export interface Hint {
  id: number;
  text: string;
}

export interface MarketConfig {
  symbol: string;
  name: string;
  startPrice: number;
  startBag: number;
  startCash: number;
  /** Ticks kept on the chart. */
  historyLen?: number;
  /** Random-walk size per tick. */
  vol?: number;
  tickMs?: number;
  /** Start ticking straight away (the hero window wanders on its own). */
  autoStart?: boolean;
  /** The chart before anyone touches it (ends at startPrice). */
  seedHistory?: () => number[];
  /** Orders already on when the page opens (and after Reset). */
  seedPlan?: (input: Pick<PlanInput, 'key' | 'networkId' | 'address' | 'symbol' | 'name' | 'balance' | 'now'>) => Plan | null;
  /** Tippy's settings right now (presets, dry run, pause, auto-guard). Defaults to the shipped settings. */
  getSettings?: () => Settings;
  /** The chat changed a setting ("dry run off", "pause everything"). */
  onSettings?: (patch: Partial<Settings>) => void;
}

let hintId = 0;
let noticeId = 0;

/** A deterministic random walk that ends exactly at `end` (no Math.random, so every visit looks the same). */
export function seedPath(end: number, from: number, n = 90, seed = 7): number[] {
  let s = seed;
  const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
  const out: number[] = [];
  let wob = 0;
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    // ease up from `from` to `end`, with a shallow dip two thirds of the way
    const dip = t > 0.55 && t < 0.8 ? 0.06 * Math.sin(((t - 0.55) / 0.25) * Math.PI) : 0;
    const trend = Math.exp(Math.log(from) + (Math.log(end) - Math.log(from)) * Math.pow(t, 1.35)) * (1 - dip);
    wob = wob * 0.6 + (rnd() - 0.5) * 0.045;
    out.push(trend * (1 + wob * (1 - t * 0.6)));
  }
  out[n - 1] = end;
  return out;
}

/** "Sell everything": a stop loss / trailing stop, or an order sized down to nothing. */
const sellsAll = (level: LevelRef, targetRemaining: number) => level.kind === 'sl' || level.kind === 'trail' || targetRemaining === 0;

export function useMarket(cfg: MarketConfig) {
  const H = cfg.historyLen ?? 90;
  const vol = cfg.vol ?? 0.12;
  const key = `${cfg.symbol.toLowerCase()}:${NETWORK}`;
  const base = { key, networkId: NETWORK, address: cfg.symbol.toLowerCase(), symbol: cfg.symbol, name: cfg.name, balance: cfg.startBag };
  const freshHistory = () => cfg.seedHistory?.() ?? Array.from({ length: H }, (_, i) => cfg.startPrice * (1 + Math.sin(i / 7) * 0.04));
  const freshPlan = () => cfg.seedPlan?.({ ...base, now: Date.now() }) ?? null;

  const [price, setPrice] = useState(cfg.startPrice);
  const [history, setHistory] = useState<number[]>(freshHistory);
  const [bag, setBag] = useState(cfg.startBag);
  const [cash, setCash] = useState(cfg.startCash);
  const [plan, setPlan] = useState<Plan | null>(freshPlan);
  const [buys, setBuys] = useState<BuyOrder[]>([]);
  const [practice, setPractice] = useState<PracticeResult | null>(null);
  /** Tippy's own pop-ups ("Tippy filled order"), in the extension's format. */
  const [notices, setNotices] = useState<Notice[]>([]);
  const [hint, setHint] = useState<Hint | null>(null);
  const [auto, setAuto] = useState(!!cfg.autoStart);
  const target = useRef<number | null>(null);
  const settingsNow = () => cfg.getSettings?.() ?? DEFAULT_SETTINGS;

  const live = useRef({ price, bag, plan, buys, cash });
  live.current = { price, bag, plan, buys, cash };

  const notice = (n: NoticeText) => setNotices((xs) => [...xs.slice(-9), { ...n, id: `n${++noticeId}`, at: Date.now() }]);
  const nudge = (text: string) => setHint({ id: ++hintId, text });

  const token: WindowToken = {
    key,
    address: base.address,
    networkId: NETWORK,
    chainName: 'pretend chain',
    symbol: cfg.symbol,
    name: cfg.name,
    priceUSD: price,
    mc: price * SUPPLY,
    balance: bag,
  };

  const step = () => {
    let { price: p, bag: b, plan: pl, cash: c } = live.current;
    const bs = live.current.buys;
    const goal = target.current;
    if (goal != null) {
      p = p + (goal - p) * 0.35 + p * (Math.random() - 0.5) * 0.04;
      if (Math.abs(goal - p) / goal < 0.03) target.current = null;
    } else {
      p = p * Math.exp((Math.random() - 0.48) * vol);
    }
    p = Math.max(cfg.startPrice * 0.05, p);
    setPrice(p);
    setHistory((h) => [...h.slice(-(H - 1)), p]);

    const now = Date.now();
    const s = settingsNow();
    // Paused (toolbar switch or chat): the price still moves, Tippy doesn't act.
    if (pl && pl.state === 'armed' && !s.paused) {
      const r = evaluate(pl, { priceUSD: p, mc: p * SUPPLY, at: now }, b, { now, gap: false, gapPolicy: s.gapPolicy, minSellUsd: MIN_USD, dustUsd: 1 });
      pl = r.plan;
      for (const a of r.actions) {
        if (a.type !== 'sell') continue;
        const before = pl;
        pl = markExecuting(pl, a.level, now);
        if (s.dryRun) {
          // Like the extension's dry run: the order counts as filled, nothing is sold.
          pl = applyOutcome(pl, a.level, { status: 'filled', balanceAfter: null, dryRun: true }, now);
          notice(sellFilledNotice(pl, a.level, { dryRun: true, soldPct: filledShare(before, pl) }));
          continue;
        }
        const sold = b - a.targetRemaining;
        b = a.targetRemaining;
        c += sold * p;
        pl = applyOutcome(pl, a.level, { status: 'filled', balanceAfter: b, soldAmount: sold }, now);
        notice(sellFilledNotice(pl, a.level, { soldPct: pl.origBalance > 0 ? (sold / pl.origBalance) * 100 : null, emptied: sellsAll(a.level, a.targetRemaining) || b * p < 1 }));
      }
    }

    // Limit buys go after the sells, one at a time, from pretend cash.
    if (bs.some(isLiveBuy) && !s.paused) {
      const next = new Map<string, BuyOrder>();
      for (const o of bs) {
        const r = evaluateBuy(o, { priceUSD: p, mc: p * SUPPLY, at: now }, now);
        if (!r.action) {
          next.set(o.id, r.order);
          continue;
        }
        let ord = markBuyExecuting(r.order, now);
        if (s.dryRun) {
          ord = applyBuyOutcome(ord, { status: 'filled', got: null, price: p, dryRun: true }, now);
          notice(buyFilledNotice(ord));
          next.set(o.id, ord);
          continue;
        }
        if (c < ord.usd) {
          next.set(o.id, applyBuyOutcome(ord, { status: 'no-cash', cash: c }, now));
          continue;
        }
        const got = ord.usd / p;
        c -= ord.usd;
        b += got;
        ord = applyBuyOutcome(ord, { status: 'filled', got, price: p }, now);
        const preset = s.presets.find((x) => x.id === ord.guardPresetId);
        const kept = !!pl && (pl.state === 'armed' || pl.state === 'paused');
        let guard: string | null = null;
        if (pl && kept) {
          // Like the extension: the coin's running orders cover the new coins, sized to the bigger bag.
          pl = rescale(pl, b, now);
          guard = 'Your orders on this coin now cover it.';
        } else if (preset) {
          pl = buildPlan({ ...presetToInput(preset, { ...token, priceUSD: p, mc: p * SUPPLY, balance: b }, 'manual'), id: `demo-${now}`, now });
          ord = protectedBy(ord, pl.id, `Guarding with ${preset.name}.`, now);
          guard = `Guarding with ${preset.name}: ${summarizePlan(pl)}.`;
        }
        notice(buyFilledNotice(ord, guard));
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
    }, cfg.tickMs ?? 450);
    return () => clearInterval(t);
  }, [auto]);

  const kick = () => {
    if (!auto && target.current == null) setAuto(true);
  };
  // One press is one move you can watch: about +50–90% up, −30–40% down.
  const pump = () => (target.current = live.current.price * (1.5 + Math.random() * 0.4));
  const dump = () => (target.current = live.current.price * (0.6 + Math.random() * 0.1));
  const reset = () => {
    target.current = null;
    setAuto(!!cfg.autoStart);
    setPrice(cfg.startPrice);
    setHistory(freshHistory());
    setBag(cfg.startBag);
    setCash(cfg.startCash);
    setPlan(freshPlan());
    setBuys([]);
    setPractice(null);
    setNotices([]);
    setHint(null);
  };

  /**
   * A market buy or sell made yourself in the trading app (not by Tippy). Running
   * orders follow the bigger bag; with Auto-guard on, a new bag gets the starred preset.
   */
  const trade = (side: 'buy' | 'sell', amount: number) => {
    const { price: p, plan: pl } = live.current;
    let { bag: b, cash: c } = live.current;
    const now = Date.now();
    if (side === 'buy') {
      if (amount > c) return { ok: false as const, error: 'Not enough pretend cash.' };
      c -= amount;
      b += amount / p;
      const s = settingsNow();
      const kept = !!pl && (pl.state === 'armed' || pl.state === 'paused');
      if (kept) setPlan(rescale(pl!, b, now));
      else if (s.autoGuard.enabled) {
        const preset = s.presets.find((x) => x.id === s.defaultPresetId) ?? s.presets[0];
        const next = buildPlan({ ...presetToInput(preset, { ...token, priceUSD: p, mc: p * SUPPLY, balance: b }, 'auto-guard'), id: `demo-${now}`, now });
        setPlan(next);
        notice({ key, title: `🛡️ Tippy is guarding $${cfg.symbol}`, text: `${summarizePlan(next)}. Change or undo it in Tippy.`, tone: 'info' });
      }
    } else {
      const sold = Math.min(b, amount);
      b -= sold;
      c += sold * p;
    }
    setBag(b);
    setCash(c);
    kick();
    return { ok: true as const };
  };

  const api: WindowApi = {
    arm: async (input) => {
      const p = buildPlan({ ...input, id: `demo-${Date.now()}`, now: Date.now() });
      setPlan(p);
      nudge(`Tippy is watching $${cfg.symbol}. Now pump or dump the price.`);
      kick();
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
      const issues = validateBuyInput(input, MIN_USD);
      if (issues.length) return { ok: false, error: issues[0].message };
      const o = buildBuy({ ...input, id: `buy-${Date.now()}`, now: Date.now() });
      setBuys((bs) => [...bs, o]);
      nudge(`Limit buy on. Hit ${o.direction === 'down' ? 'Dump' : 'Pump'} and watch Tippy buy it.`);
      kick();
      return { ok: true, buy: o };
    },
    cancelBuy: async (orderId) => (setBuys((bs) => bs.map((o) => (o.id === orderId ? cancelBuy(o, Date.now()) : o))), { ok: true }),
    resolveBuy: async (orderId, bought) => (setBuys((bs) => bs.map((o) => (o.id === orderId ? resolveUnknownBuy(o, bought, Date.now()) : o))), { ok: true }),
    // No fomo here, so a practice run just explains what it would do.
    practice: async (k, side, usd) => {
      await new Promise((r) => setTimeout(r, 1_400));
      const result: PracticeResult = {
        key: k,
        symbol: cfg.symbol,
        side,
        at: Date.now(),
        ok: true,
        stage: 'dry-run',
        detail:
          side === 'buy'
            ? `on fomo, Tippy would open Buy, type ${formatUsd(usd ?? 10)}, check the price impact and stop right before the final Buy button.`
            : 'on fomo, Tippy would open Sell, pick the amount, check the price impact and stop right before the final Sell button.',
      };
      setPractice(result);
      return { ok: true, practice: result };
    },
  };

  const coin = () => ({ ...token, priceUSD: live.current.price, mc: live.current.price * SUPPLY, balance: live.current.bag });
  const settings = settingsNow;
  const state = () => ({ plans: live.current.plan ? [live.current.plan] : [], buys: live.current.buys, settings: settings() });
  const chatCtx: ChatCtx = {
    coin: token,
    ...state(),
    latest: state,
    cash,
    minBuyUsd: () => MIN_USD,
    minSellUsd: () => MIN_USD,
    resolveCoin: async (s) => (s.replace(/^\$/, '').toUpperCase() === cfg.symbol ? coin() : null),
    fetchCoin: async () => coin(),
    api: {
      arm: api.arm,
      update: api.update,
      pause: api.pause,
      resume: api.resume,
      cancel: api.cancel,
      armBuy: api.armBuy,
      cancelBuy: api.cancelBuy,
      moveBuy: async (orderId, trigger, now) => {
        const o = live.current.buys.find((x) => x.id === orderId);
        if (!o) return { ok: false, error: 'That order is gone.' };
        const r = moveBuy(o, trigger, now, Date.now());
        if ('error' in r) return { ok: false, error: r.error };
        setBuys((bs) => bs.map((x) => (x.id === orderId ? r.order : x)));
        return { ok: true, buy: r.order };
      },
      practice: api.practice,
      // "dry run off", "auto guard on", "pause": the host owns settings.
      setSettings: async (patch) => (cfg.onSettings?.(patch), { ok: true }),
      pauseAll: async (paused) => (cfg.onSettings?.({ paused }), { ok: true }),
    },
  };

  return { price, history, bag, cash, plan, setPlan, buys, practice, notices, hint, auto, setAuto, token, api, chatCtx, pump, dump, reset, step, trade, notice, nudge };
}

/** Sets an <input>'s value the way typing would, so Preact's onInput sees it. */
export function typeInto(input: HTMLInputElement, value: string) {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

export const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

export const reducedMotion = () => typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
