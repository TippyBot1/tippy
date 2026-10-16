// Tippy's mini window — a dark, compact "instant panel" like the ones traders
// know from GMGN / Axiom, sitting over fomo's own panel. Two tabs share one
// order form (ui/OrderForm):
//   Buy  — a limit buy: "buy $10 if it dips to $1.6M MC".
//   Sell — take profits and stops look the same: how much to sell, and a level.
//          Above the market it's a take profit; below it's a stop (100% below is
//          the stop loss that sells the rest). The button puts the order live at
//          once — a new plan, or an in-place change to the running one.
// There's no separate "running plan" page: the form is always there, so you can
// add another order at any time. "Your orders" lists every order of the running
// plan like a price ladder, with a "now" line between the take profits and the
// stops (✎ loads one into the form, × removes it), then one compact plan line
// (Guarding · 1.01x · +1.0% · Pause · Stop all). What happened sits in a
// closed "Activity" list. Used inside fomo (content script) and in the
// tippybot.fun demo.

import { type ComponentChildren, Fragment } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { isLiveBuy } from '../engine/buys';
import { currentX, getLevel, hasInFlight, isEditableStop, isEditableTp, levelLabel, normalizePlan, type PlanEdit, planEditWith, retryableLevels, sameRef } from '../engine/orders';
import { describeTrigger, formatUsd, formatX, validatePlanInput } from '../engine/triggers';
import type { BuyInput, BuyOrder, LevelRef, LevelStatus, Plan, PlanInput, Trigger } from '../engine/types';
import { DEFAULT_MIN_SELL_USD, DEV_TOOLS } from '../shared/config';
import type { CommandResult, PracticeResult } from '../shared/messages';
import type { Preset } from '../shared/settings';
import { cash, pctFmt } from './format';
import { type BuyDraft, defaultBuyLevel, LimitBuy, newBuyDraft, PracticeRun, presetSummary, Problems, Say } from './LimitBuy';
import { Mascot, type Mood } from './Mascot';
import { dropText, type FieldUnit, type LevelUnit, levelPriceAt, levelShort, movePct, niceMc, type Now, parsePct, relToNow, sameTrigger, stopOrderNote } from './levels';
import { AmountBox, NowLine, OrderRow, TriggerBox } from './OrderForm';

export interface WindowToken {
  key: string;
  address: string;
  networkId: number;
  chainName: string;
  symbol: string;
  name: string;
  priceUSD: number | null;
  mc: number | null;
  balance: number | null;
}

export interface WindowApi {
  arm(input: Omit<PlanInput, 'id' | 'now'>): Promise<CommandResult>;
  pause(planId: string): Promise<CommandResult>;
  resume(planId: string): Promise<CommandResult>;
  cancel(planId: string): Promise<CommandResult>;
  resolveHeld(planId: string, level: LevelRef, sell: boolean): Promise<CommandResult>;
  retry(planId: string, level: LevelRef): Promise<CommandResult>;
  /** Change a running plan in place (an order added, changed or removed). */
  update(planId: string, edit: PlanEdit): Promise<CommandResult>;
  /** Place a limit buy. */
  armBuy(input: Omit<BuyInput, 'id' | 'now'>): Promise<CommandResult>;
  cancelBuy(orderId: string): Promise<CommandResult>;
  /** After an 'unknown' buy: the user checked fomo — it bought, or it didn't (watch again). */
  resolveBuy(orderId: string, bought: boolean): Promise<CommandResult>;
  /** 🧪 Walk through a real sell / buy on fomo and stop before the final press. */
  practice(key: string, side: 'sell' | 'buy', usd?: number): Promise<CommandResult>;
}

export interface WindowNotice {
  text: string;
  /** Amber when it's a problem. */
  warn?: boolean;
  /** Present → a "Move" button. */
  onConfirm?: () => void;
  confirmLabel?: string;
  onDismiss: () => void;
  dismissLabel?: string;
  busy?: boolean;
}

export interface WindowToggles {
  autoGuard: boolean;
  dryRun: boolean;
  alerts: boolean;
  /** Keep the computer awake while orders are on (orders only fire while it's awake). */
  stayAwake?: boolean;
}

/** What the Sell form places: a take profit, a partial stop, or the stop loss that sells the rest. */
type SellKind = 'tp' | 'stop' | 'sl';
/** A running plan's order that ✎ loaded into the form. */
type EditRef = { kind: 'tp'; id: string } | { kind: 'stop'; id: string } | { kind: 'sl' };

interface SellOrder {
  kind: SellKind;
  trigger: Trigger;
  /** % of the bag (the stop loss always sells the rest). */
  pct: number;
}

interface SellDraft {
  /** The level (null = none picked): a market cap or a price — an order ✎ loaded keeps its own until it's moved. */
  trigger: Trigger | null;
  /** % of your bag. 100% below the market = the stop loss. */
  pct: number;
  /** ✎: the running plan's order this changes (null = a new order). */
  editing: EditRef | null;
}

type Mode = 'sell' | 'buy';

const SELL_CHIPS = [10, 25, 50, 100];
const TRAIL_CHIPS = [10, 20, 30];
/** A stop usually fills a bit under its level: its "pick at least" leaves 5% of room (the chat says the same). */
const STOP_ROOM = 1.05;
/** How many lines the Activity list keeps. */
const ACTIVITY_LINES = 6;
/** Within this of the market now, a level is "where it is now" — neither a take profit nor a stop. */
const AT_MARKET = 0.005;
/** Levels that still have work to do (counted on the Sell tab). */
const OPEN: LevelStatus[] = ['waiting', 'queued', 'held', 'executing', 'unknown', 'blocked'];
/** Finished levels: listed dimmed. */
const DONE: LevelStatus[] = ['filled', 'done-elsewhere', 'merged', 'cancelled'];
/** A level's chip in "Your orders" (none while it's just watching). */
const ROW_STATUS: Record<LevelStatus, [string, string] | null> = {
  waiting: null,
  queued: ['selling…', 'warn'],
  executing: ['selling…', 'warn'],
  unknown: ['checking…', 'warn'],
  held: ['needs OK', 'warn'],
  filled: ['sold ✓', 'ok'],
  'done-elsewhere': ['sold elsewhere', 'ok'],
  merged: ['combined', ''],
  blocked: ['needs retry', 'warn'],
  cancelled: ['skipped', ''],
};

const pctText = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));
const sumPct = (xs: { sellPct: number }[]) => xs.reduce((s, x) => s + x.sellPct, 0);

function openSellCount(plan: Plan | null): number {
  if (!plan) return 0;
  const open = (s: LevelStatus | undefined) => (s && OPEN.includes(s) ? 1 : 0);
  return [...plan.tps, ...plan.stops].reduce((n, t) => n + open(t.status), 0) + open(plan.sl?.status) + open(plan.trailing?.status);
}

/** A running plan's order, as the form shows it (null if it's gone). */
function findOrder(plan: Plan, ref: EditRef): { trigger: Trigger; pct: number; editable: boolean } | null {
  if (ref.kind === 'sl') return plan.sl ? { trigger: plan.sl.trigger, pct: 100, editable: plan.sl.status === 'waiting' } : null;
  if (ref.kind === 'tp') {
    const t = plan.tps.find((x) => x.id === ref.id);
    return t ? { trigger: t.trigger, pct: t.sellPct, editable: isEditableTp(t) } : null;
  }
  const s = plan.stops.find((x) => x.id === ref.id);
  return s ? { trigger: s.trigger, pct: s.sellPct, editable: isEditableStop(s) } : null;
}

/** The running plan with one order taken out (everything else exactly as it is). */
function withoutOrder(plan: Plan, ref: LevelRef): PlanEdit {
  const e = planEditWith(plan, {});
  return {
    tps: ref.kind === 'tp' ? e.tps.filter((t) => t.id !== ref.id) : e.tps,
    stops: ref.kind === 'stop' ? (e.stops ?? []).filter((s) => s.id !== ref.id) : (e.stops ?? []),
    sl: ref.kind === 'sl' ? null : e.sl,
    trailing: ref.kind === 'trail' ? null : e.trailing,
  };
}

/**
 * The running plan with the form's order added — or, after ✎, put in place of
 * the order it was loaded from. An order that stays the same kind keeps its id;
 * one that moved to the other side of the market becomes a new order there.
 */
function editWith(plan: Plan, order: SellOrder, editing: EditRef | null): PlanEdit {
  const e = editing ? withoutOrder(plan, editing) : { ...planEditWith(plan, {}) };
  const keep = editing && editing.kind !== 'sl' && editing.kind === order.kind ? editing.id : null;
  const tps = order.kind === 'tp' ? [...e.tps, { id: keep, trigger: order.trigger, sellPct: order.pct }] : e.tps;
  const stops = order.kind === 'stop' ? [...(e.stops ?? []), { id: keep, trigger: order.trigger, sellPct: order.pct }] : (e.stops ?? []);
  return { tps, stops, sl: order.kind === 'sl' ? { trigger: order.trigger } : e.sl, trailing: e.trailing };
}

/** Removing this would leave the plan nothing to watch (so × stops guarding instead). */
function leavesNothing(plan: Plan, e: PlanEdit): boolean {
  const blocked = [...plan.tps, ...plan.stops].some((l) => l.status === 'blocked');
  return !e.tps.length && !(e.stops ?? []).length && !e.sl && !e.trailing && !blocked;
}

/** A new plan on this coin. */
function planInput(token: WindowToken, parts: Pick<PlanInput, 'tps' | 'sl' | 'trailing'> & { stops?: PlanInput['stops'] }): Omit<PlanInput, 'id' | 'now'> {
  return {
    key: token.key,
    networkId: token.networkId,
    address: token.address,
    symbol: token.symbol,
    name: token.name,
    entry: { priceUSD: token.priceUSD ?? 0, mc: token.mc, source: 'armed-at' },
    balance: token.balance ?? 0,
    ...parts,
    origin: 'manual',
  };
}

/** A new plan with just the form's order. */
function orderInput(token: WindowToken, o: SellOrder): Omit<PlanInput, 'id' | 'now'> {
  return planInput(token, {
    tps: o.kind === 'tp' ? [{ trigger: o.trigger, sellPct: o.pct }] : [],
    ...(o.kind === 'stop' ? { stops: [{ trigger: o.trigger, sellPct: o.pct }] } : {}),
    sl: o.kind === 'sl' ? { trigger: o.trigger } : null,
    trailing: null,
  });
}

/**
 * fomo won't sell less than its minimum. A take profit is checked at today's
 * price; a stop at its level (it sells lower than today), so a stop that would
 * be skipped as too small is caught here, not after it hits.
 */
function minSellProblem(o: SellOrder, opts: { balance: number | null; ofBag: number | null; price: number | null; atLevel: number; min: number; lvl: string }): string | null {
  const { balance, ofBag, price, atLevel, min, lvl } = opts;
  if (!price || !(price > 0) || !(min > 0)) return null;
  const whole = o.kind === 'sl' ? balance : ofBag;
  if (whole == null || !(whole > 0)) return null;
  const px = o.kind === 'tp' || !(atLevel > 0) ? price : Math.min(price, atLevel);
  const at = px < price ? ` at ${lvl}` : '';
  const wholeUsd = whole * px;
  const usd = o.kind === 'sl' ? wholeUsd : (wholeUsd * o.pct) / 100;
  // A partial stop usually fills a little under its level, and a slice that ends
  // up under the minimum gets skipped: it needs a bit of room over it. The same
  // rule as the "Pick at least" tip below, so the two always agree.
  const room = o.kind === 'stop' ? STOP_ROOM : 1;
  const enough = (pct: number) => (wholeUsd * pct) / 100 >= min * room;
  if (o.kind === 'sl' ? usd >= min : enough(o.pct)) return null;
  const bag = cash(whole * price);
  if (o.kind === 'sl' || wholeUsd < min) {
    return at ? `Your ${bag} bag would be ${cash(wholeUsd)}${at} — below fomo's ${cash(min)} minimum sell, so Tippy couldn't sell it.` : `Your ${bag} bag is below fomo's ${cash(min)} minimum sell — Tippy couldn't sell it.`;
  }
  let need = Math.ceil(((min * room) / wholeUsd) * 100 - 1e-9);
  if (!enough(need)) need += 1; // never suggest a % this check would still refuse
  const tip = need >= 100 ? 'Only selling all of it would work there.' : `Pick at least ${need}%${room > 1 && usd < min ? ' (a stop can fill a bit lower)' : ''}.`;
  // Over the minimum, but not by enough for a stop.
  if (usd >= min) return `${pctText(o.pct)}% of your ${bag} bag is ${cash(usd)}${at} — only just over fomo's ${cash(min)} minimum sell, and a stop can fill a bit lower. ${tip}`;
  return `${pctText(o.pct)}% of your ${bag} bag is ${cash(usd)}${at} — fomo's minimum sell is ${cash(min)}. ${tip}`;
}

interface Row {
  key: string;
  ref: LevelRef;
  dir: 'up' | 'down';
  /** Where it sits against the price now (1.1 = 10% above); used to sort the ladder. */
  rel: number;
  level: string;
  move: string;
  what: string;
  status: [string, string] | null;
  done: boolean;
  editable: boolean;
  title: string;
}

/** Every order of the running plan, highest level first, like a price ladder. */
function orderRows(plan: Plan, now: Now, base: Now, unit: FieldUnit): Row[] {
  const rows: Row[] = [];
  const chip = (l: { status: LevelStatus; clickedAt: number | null }): [string, string] | null => (l.status === 'blocked' && l.clickedAt != null ? ['check fomo', 'warn'] : ROW_STATUS[l.status]);
  const add = (ref: LevelRef, l: { status: LevelStatus; clickedAt: number | null }, trigger: Trigger, dir: 'up' | 'down', what: string, editable: boolean, title: string) => {
    const rel = relToNow(trigger, now, base);
    rows.push({ key: ref.kind + ('id' in ref ? ref.id : ''), ref, dir, rel, level: levelShort(trigger, unit, base, now), move: Number.isFinite(rel) ? dropText(rel) : '', what, status: chip(l), done: DONE.includes(l.status), editable, title });
  };
  for (const t of plan.tps) add({ kind: 'tp', id: t.id }, t, t.trigger, 'up', `sell ${pctText(t.sellPct)}%`, isEditableTp(t), `Take profit at ${describeTrigger(t.trigger)} — sells ${pctText(t.sellPct)}% of your bag`);
  for (const s of plan.stops) add({ kind: 'stop', id: s.id }, s, s.trigger, 'down', `sell ${pctText(s.sellPct)}%`, isEditableStop(s), `Stop at ${describeTrigger(s.trigger)} — sells ${pctText(s.sellPct)}% of your bag`);
  if (plan.sl) add({ kind: 'sl' }, plan.sl, plan.sl.trigger, 'down', 'sell the rest', plan.sl.status === 'waiting', `Stop loss at ${describeTrigger(plan.sl.trigger)} — sells the rest`);
  const tr = plan.trailing;
  if (tr) {
    // Once it's trailing it has a level (that far under the top); until then it sits at the bottom.
    const stop = tr.active && tr.peakPrice ? tr.peakPrice * (1 - tr.trailPct / 100) : NaN;
    rows.push({
      key: 'trail',
      ref: { kind: 'trail' },
      dir: 'down',
      rel: now.priceUSD && Number.isFinite(stop) ? stop / now.priceUSD : NaN,
      level: `trailing ${pctText(tr.trailPct)}%`,
      move: 'from the top',
      what: `sell the rest${!tr.active && tr.activateX ? ` · starts at ${formatX(tr.activateX)}` : ''}`,
      status: tr.status === 'waiting' ? null : ROW_STATUS[tr.status],
      done: DONE.includes(tr.status),
      editable: tr.status === 'waiting',
      title: tr.active && tr.peakPrice ? `Top so far ${formatUsd(tr.peakPrice)} — sells the rest ${tr.trailPct}% under it` : `Sells the rest if it falls ${tr.trailPct}% from its top`,
    });
  }
  const key = (r: Row) => (Number.isFinite(r.rel) ? r.rel : -1);
  return rows.sort((a, b) => key(b) - key(a));
}

export function TippyWindow({
  token,
  plan,
  buys = [],
  cash: cashUsd = null,
  minBuyUsd = DEFAULT_MIN_SELL_USD,
  minSellUsd = DEFAULT_MIN_SELL_USD,
  practice = null,
  presets,
  defaultPresetId,
  api,
  intro = true,
  toggles,
  onToggle,
  onMinimize,
  onClose,
  dragHandle,
  note,
  notice,
  showTrailing = false,
  panel,
  chat,
}: {
  token: WindowToken;
  plan: Plan | null;
  /** This coin's limit-buy orders. */
  buys?: BuyOrder[];
  /** fomo cash (USDC) in USD, null = unknown. */
  cash?: number | null;
  /** fomo's minimum buy on this chain (USD). */
  minBuyUsd?: number;
  /** fomo's minimum sell on this chain (USD): a sell order smaller than this can't go through. */
  minSellUsd?: number;
  /** The last practice run on this coin. */
  practice?: PracticeResult | null;
  presets: Preset[];
  defaultPresetId: string;
  api: WindowApi;
  intro?: boolean;
  toggles?: WindowToggles;
  onToggle?: (name: keyof WindowToggles, value: boolean) => void;
  onMinimize?: () => void;
  onClose?: () => void;
  /** Pointer handler that lets the host drag the window by its header. */
  dragHandle?: (e: PointerEvent) => void;
  /** Tooltip for the DRY RUN badge (shown while toggles.dryRun is on). */
  note?: string;
  /**
   * Older hosts pass the "market cap or move" setting. The order form always
   * shows both the market cap and the % move now, so it's not needed.
   */
  levelUnit?: LevelUnit;
  onLevelUnit?: (unit: LevelUnit) => void;
  /** A question from outside the window (a level dragged on fomo's chart): shown under the header. */
  notice?: WindowNotice | null;
  /** settings.showTrailing: offer the trailing stop (it's always shown when the plan has one). */
  showTrailing?: boolean;
  /** A box under the header (phone alerts: TelegramConnect), shown until it closes itself. */
  panel?: ComponentChildren;
  /** 💬 The chat box (ui/Chat), shown at the very bottom of the window. */
  chat?: ComponentChildren;
}) {
  // Plans saved before partial stops existed have no `stops` list.
  const live = useMemo(() => (plan && (plan.state === 'armed' || plan.state === 'paused') ? normalizePlan(plan) : null), [plan]);
  /** The level box reads a market cap (default) or, after ⇄, a price — on both tabs. */
  const [unit, setUnit] = useState<FieldUnit>('mc');
  // Not holding the coin (and nothing to guard): open on Buy instead of a dead end.
  const [mode, setMode] = useState<Mode>(() => (token.balance === 0 && !live ? 'buy' : 'sell'));
  // Both drafts live here so switching tabs doesn't lose a half-made order.
  const [sell, setSell] = useState<SellDraft>({ trigger: null, pct: 50, editing: null });
  const [buyDraft, setBuyDraft] = useState(() => newBuyDraft(presets, defaultPresetId, token));
  /** A question the window asks itself (move your stop loss? add a preset?), in the notice bar. */
  const [ask, setAsk] = useState<WindowNotice | null>(null);
  /**
   * Bumped when the trader picks a tab or ✎ an order: the level box takes the
   * focus. Never on its own — the window opens by itself on every coin page and
   * mustn't steal the keyboard from fomo.
   */
  const [focusN, setFocusN] = useState(0);
  const focusLevel = () => setFocusN((n) => n + 1);
  /**
   * The untouched default limit buy (the −20% dip as a market cap) follows the
   * price, so a window left open on a moving coin doesn't offer a "dip" that's
   * become a breakout. Once you touch it, it stays.
   */
  const autoBuy = useRef<BuyDraft | null>(buyDraft);
  useEffect(() => {
    if (buyDraft !== autoBuy.current) return;
    const trigger = defaultBuyLevel(token);
    if (JSON.stringify(trigger) === JSON.stringify(buyDraft.trigger)) return;
    const next = { ...buyDraft, trigger };
    autoBuy.current = next;
    setBuyDraft(next);
  }, [token.mc, token.priceUSD]);

  const myBuys = buys.filter((o) => o.key === token.key);
  const liveBuys = myBuys.filter(isLiveBuy);
  const bagUsd = token.balance != null && token.priceUSD != null ? token.balance * token.priceUSD : null;
  const sellMood: Mood = live ? (live.attention ? 'worried' : live.state === 'paused' ? 'sleeping' : 'watching') : token.balance === 0 ? 'idle' : sell.trigger ? 'watching' : 'happy';
  const buyMood: Mood = liveBuys.some((o) => o.attention) ? 'worried' : liveBuys.length ? 'watching' : 'happy';
  const openSells = openSellCount(live);
  const canFlip = !!token.mc && !!token.priceUSD;
  const shown = notice ?? ask;

  const switchMode = (m: Mode) => {
    setAsk(null);
    setMode(m);
    focusLevel();
  };

  return (
    // Keys typed into Tippy stay in Tippy (fomo's page shortcuts never see them).
    <div class="tw" role="dialog" aria-label={`Tippy — take profit, stop loss and limit buys for $${token.symbol}`} onKeyDown={(e) => e.stopPropagation()}>
      <div class="tw-head" onPointerDown={dragHandle as never}>
        <span class="tw-grip" aria-hidden="true">
          ⠿
        </span>
        <span class={`tw-head-mascot${intro ? ' tw-intro' : ''}`} key={intro ? token.key : 'mascot'}>
          <Mascot mood={mode === 'buy' ? buyMood : sellMood} size={24} />
        </span>
        <b class="tw-title">Tippy</b>
        <span class="tw-token" title={`${token.name} on ${token.chainName}`}>
          ${token.symbol} <em>{token.mc != null ? formatUsd(token.mc) : formatUsd(token.priceUSD)}</em>
        </span>
        <span class="tw-spacer" />
        {toggles?.dryRun && (
          <span class="tw-dry" title={note ?? 'Dry run is on — Tippy won’t actually buy or sell'}>
            DRY
          </span>
        )}
        {onMinimize && (
          <button class="tw-icon" onClick={onMinimize} aria-label="Minimise Tippy" title="Minimise">
            –
          </button>
        )}
        {onClose && (
          <button class="tw-icon" onClick={onClose} aria-label="Close Tippy" title="Close">
            ×
          </button>
        )}
      </div>
      {shown && (
        <div class={`tw-notice${shown.warn ? ' warn' : ''}`} role="status">
          <span class="tw-notice-text">{shown.text}</span>
          {shown.onConfirm && (
            <button class="tw-notice-ok" disabled={shown.busy} onClick={shown.onConfirm}>
              {shown.busy ? '…' : (shown.confirmLabel ?? 'Move')}
            </button>
          )}
          <button class="tw-notice-no" disabled={shown.busy} onClick={shown.onDismiss}>
            {shown.dismissLabel ?? 'Keep'}
          </button>
        </div>
      )}

      {panel}

      <div class="tw-modes" role="tablist" aria-label="Buy or sell">
        <button role="tab" class="tw-mode tw-mode-buy" aria-selected={mode === 'buy'} onClick={() => switchMode('buy')}>
          Buy
          {liveBuys.length > 0 && (
            <span class="tw-count" title={`${liveBuys.length} limit buy${liveBuys.length === 1 ? '' : 's'} waiting`}>
              {liveBuys.length}
            </span>
          )}
        </button>
        <button role="tab" class="tw-mode tw-mode-sell" aria-selected={mode === 'sell'} onClick={() => switchMode('sell')}>
          Sell
          {openSells > 0 && (
            <span class="tw-count" title={`${openSells} sell order${openSells === 1 ? '' : 's'} open`}>
              {openSells}
            </span>
          )}
        </button>
      </div>

      {mode === 'buy' ? (
        <LimitBuy
          token={token}
          plan={live}
          buys={myBuys}
          presets={presets}
          defaultPresetId={defaultPresetId}
          draft={buyDraft}
          onDraft={setBuyDraft}
          cash={cashUsd}
          minBuyUsd={minBuyUsd}
          api={api}
          practice={practice}
          unit={unit === 'mc' && canFlip ? 'mc' : 'price'}
          canFlip={canFlip}
          onUnit={setUnit}
          focusSignal={focusN}
        />
      ) : (
        <SellTab
          token={token}
          live={live}
          draft={sell}
          onDraft={setSell}
          unit={unit}
          onUnit={setUnit}
          minSellUsd={minSellUsd}
          presets={presets}
          showTrailing={showTrailing}
          api={api}
          practice={practice}
          onAsk={setAsk}
          onBuyTab={() => switchMode('buy')}
          focusSignal={focusN}
          onFocusLevel={focusLevel}
        />
      )}

      {(live?.state === 'armed' || liveBuys.length > 0) && toggles?.stayAwake === false && onToggle && (
        <div class="tw-awake-off" role="status">
          <span>💤 This computer can sleep — your orders can't fire while it's off.</span>
          <button class="tw-notice-ok" onClick={() => onToggle('stayAwake', true)}>
            Keep it awake
          </button>
        </div>
      )}

      <div class="tw-foot">
        <span class="tw-stat" title="Your bag of this coin, and your fomo cash (USDC) for buys">
          Bag <b>{bagUsd != null ? formatUsd(bagUsd) : '—'}</b> · Cash <b>{cashUsd != null ? formatUsd(cashUsd) : '—'}</b>
        </span>
        <span class="tw-spacer" />
        {toggles && onToggle && (
          <>
            {toggles.stayAwake != null && (
              <button
                class={`tw-pill${toggles.stayAwake ? ' on' : ''}`}
                aria-pressed={toggles.stayAwake}
                title={toggles.stayAwake ? "Keeping this computer awake while your orders are on (leave the lid open). Tap to let it sleep." : 'This computer can sleep, so orders may not fire. Tap to keep it awake while orders are on.'}
                onClick={() => onToggle('stayAwake', !toggles.stayAwake)}
              >
                {toggles.stayAwake ? '☀' : '💤'}
              </button>
            )}
            <button class={`tw-pill${toggles.autoGuard ? ' on' : ''}`} aria-pressed={toggles.autoGuard} title="Auto-guard: attach your P-preset to every new buy" onClick={() => onToggle('autoGuard', !toggles.autoGuard)}>
              🛡 Auto
            </button>
            <button class={`tw-pill${toggles.alerts ? ' on' : ''}`} aria-pressed={toggles.alerts} title="Phone alerts" onClick={() => onToggle('alerts', !toggles.alerts)}>
              🔔
            </button>
            {DEV_TOOLS && (
              <button class={`tw-pill${toggles.dryRun ? ' on warn' : ''}`} aria-pressed={toggles.dryRun} title="Dry run: practise without buying or selling" onClick={() => onToggle('dryRun', !toggles.dryRun)}>
                🧪
              </button>
            )}
          </>
        )}
      </div>
      {chat}
    </div>
  );
}

/**
 * The Sell tab: the order form (always there, so another order can be added at
 * any time), then "Your orders" — the running plan as a price ladder, with
 * Retry / "sell now?" right under the order that needs it and one compact plan
 * line — the practice run, one row of quick presets and the closed Activity list.
 */
function SellTab({
  token,
  live,
  draft,
  onDraft,
  unit,
  onUnit,
  minSellUsd,
  presets,
  showTrailing,
  api,
  practice,
  onAsk,
  onBuyTab,
  focusSignal,
  onFocusLevel,
}: {
  token: WindowToken;
  /** This coin's running plan (armed or paused), with a `stops` list. */
  live: Plan | null;
  draft: SellDraft;
  onDraft: (d: SellDraft) => void;
  unit: FieldUnit;
  onUnit: (u: FieldUnit) => void;
  minSellUsd: number;
  presets: Preset[];
  showTrailing: boolean;
  api: WindowApi;
  practice: PracticeResult | null;
  /** Ask something in the window's notice bar (null = nothing to ask). */
  onAsk: (n: WindowNotice | null) => void;
  onBuyTab: () => void;
  /** Bumped when the level box should take the focus. */
  focusSignal: number;
  onFocusLevel: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [placed, setPlaced] = useState<string | null>(null);
  const [custom, setCustom] = useState(() => (SELL_CHIPS.includes(draft.pct) ? '' : String(draft.pct)));
  // Confirmations run later: they always build on the plan as it is then.
  const liveRef = useRef(live);
  liveRef.current = live;

  const sym = `$${token.symbol}`;
  // On a running plan, "x" levels are measured from your entry.
  const base: Now = live ? { priceUSD: live.entry.priceUSD, mc: live.entry.mc } : token;
  // A market-cap level needs a market cap now — and, on a running plan, one at your entry.
  const mcOk = !!token.mc && !!token.priceUSD && (!live || !!live.entry.mc);
  const fUnit: FieldUnit = unit === 'mc' && mcOk ? 'mc' : 'price';
  const selling = !!live && hasInFlight(live);
  const lockedWhy = selling ? `Tippy is selling ${sym} right now — try again once that's done.` : null;

  // What the form would place. An order ✎ loaded keeps its side until its level moves
  // (a take profit the price already passed is still a take profit).
  const src = live && draft.editing ? findOrder(live, draft.editing) : null;
  const unchanged = !!src && sameTrigger(draft.trigger, src.trigger);
  const rel = draft.trigger ? relToNow(draft.trigger, token, base) : NaN;
  const dir: 'up' | 'down' | null = unchanged ? (draft.editing!.kind === 'tp' ? 'up' : 'down') : !Number.isFinite(rel) || Math.abs(rel - 1) < AT_MARKET ? null : rel > 1 ? 'up' : 'down';
  const kind: SellKind | null = !draft.trigger || !dir ? null : dir === 'up' ? 'tp' : draft.pct >= 100 ? 'sl' : 'stop';
  const order: SellOrder | null = kind && draft.trigger ? { kind, trigger: draft.trigger, pct: draft.pct } : null;
  const lvl = draft.trigger ? levelShort(draft.trigger, fUnit, base, token) : '';
  const price = token.priceUSD;
  /** What the % chips are a share of: your original bag on a running plan. */
  const ofBag = live ? live.origBalance : token.balance;
  const shareTokens = draft.pct >= 100 ? token.balance : ofBag != null ? (ofBag * draft.pct) / 100 : null;

  const problem = ((): string | null => {
    if (selling) return `Tippy is selling ${sym} right now — you can change your orders once that's done.`;
    if (!live && token.balance === 0) return `You don't hold ${sym} yet — set a limit buy and I'll guard what I buy.`;
    if (draft.trigger && !Number.isFinite(rel) && !unchanged) return draft.trigger.kind === 'mc' ? "I can't see this coin's market cap yet." : "I can't see this coin's price yet.";
    if (!order) return null;
    if (!live) {
      if (token.balance == null) return "Tippy can't see your bag yet.";
      const issue = validatePlanInput(orderInput(token, order))[0];
      if (issue) return issue.message;
    } else {
      // Sold levels count toward the 100% too.
      const e = editWith(live, order, draft.editing);
      const tps = sumPct(live.tps.filter((t) => !isEditableTp(t) && t.status !== 'cancelled')) + sumPct(e.tps);
      if (tps > 100.0001) return `Your take-profits would add up to ${Math.round(tps)}% of your bag (counting what already sold) — keep it at 100% or less.`;
      const stops = sumPct(live.stops.filter((s) => !isEditableStop(s) && s.status !== 'cancelled')) + sumPct(e.stops ?? []);
      if (stops > 100.0001) return `Your stops would add up to ${Math.round(stops)}% of your bag (counting what already sold) — keep it at 100% or less.`;
    }
    return minSellProblem(order, { balance: token.balance, ofBag, price, atLevel: levelPriceAt(order.trigger, base, token), min: minSellUsd, lvl });
  })();
  // Worth knowing, never a block: a partial stop at or under the stop loss (or a
  // stop loss at or over partial stops) never fires — the stop loss sells everything first.
  const note = live && order && order.kind !== 'tp' ? stopOrderNote(live, order.kind, order.trigger, token, base, fUnit, draft.editing) : null;

  // While ✎ is changing an order, it can sell (or start selling) in the background: let go of it.
  useEffect(() => {
    if (!draft.editing || busy) return;
    if (live && findOrder(live, draft.editing)?.editable) return;
    onDraft({ trigger: null, pct: draft.pct, editing: null });
    setError('Your plan just changed — that order sold or started selling. Check it again.');
  }, [live]);

  const change = (patch: Partial<SellDraft>) => {
    setError(null);
    setPlaced(null);
    onAsk(null);
    onDraft({ ...draft, ...patch });
  };

  const commitCustom = () => {
    const raw = custom.trim();
    if (!raw) return;
    const n = parsePct(raw);
    if (n == null || !(n > 0) || n > 100) {
      setPlaced(null);
      setError('Type how much of your bag to sell, from 1 to 100%.');
      return;
    }
    const pct = +n.toFixed(1);
    setCustom(SELL_CHIPS.includes(pct) ? '' : String(pct));
    change({ pct });
  };

  /** "Tippy will sell 10% of $HIGGS if it drops to $700K MC." */
  const willDo = (o: SellOrder, l: string) => `Tippy will sell ${o.kind === 'sl' ? 'the rest' : `${pctText(o.pct)}%`} of ${sym} if it ${o.kind === 'tp' ? 'rises' : 'drops'} to ${l}.`;

  /** Put the order live: a new plan with it, or the running plan changed in place. */
  const commit = async (o: SellOrder, editing: EditRef | null, l: string) => {
    const cur = liveRef.current;
    setBusy(true);
    setError(null);
    setPlaced(null);
    const res = cur ? await api.update(cur.id, editWith(cur, o, editing)) : await api.arm(orderInput(token, o));
    setBusy(false);
    if (res.ok) {
      setError(null);
      setPlaced(`${editing ? 'Saved' : 'Done'}! ${willDo(o, l)}`);
      onDraft({ trigger: null, pct: o.pct, editing: null });
    } else {
      setError(res.error);
      if (res.stale) onDraft({ trigger: null, pct: o.pct, editing: null });
    }
  };

  const place = () => {
    if (busy || !order || problem) return;
    const editing = draft.editing;
    const old = live?.sl && live.sl.status !== 'cancelled' ? live.sl : null;
    // There's one stop loss: replacing it is worth a second look.
    if (order.kind === 'sl' && old && editing?.kind !== 'sl' && !sameTrigger(old.trigger, order.trigger)) {
      const from = levelShort(old.trigger, fUnit, base, token).replace(/ MC$/, '');
      const n: WindowNotice = {
        text: `Move your stop loss from ${from} to ${lvl}?`,
        confirmLabel: 'Move',
        dismissLabel: 'Keep',
        onConfirm: async () => {
          onAsk({ ...n, busy: true });
          await commit(order, editing, lvl);
          onAsk(null);
        },
        onDismiss: () => onAsk(null),
      };
      onAsk(n);
      return;
    }
    void commit(order, editing, lvl);
  };

  const run = async (fn: () => Promise<CommandResult>, done?: string) => {
    setBusy(true);
    setError(null);
    setPlaced(null);
    const res = await fn();
    setBusy(false);
    if (!res.ok) setError(res.error);
    else if (done) setPlaced(done);
    return res;
  };

  /** Ask in the notice bar; on yes, run `fn` (built from the plan as it is then). */
  const confirm = (text: string, label: string, fn: () => Promise<CommandResult>, done: string) => {
    const n: WindowNotice = {
      text,
      confirmLabel: label,
      dismissLabel: 'Cancel',
      onConfirm: async () => {
        onAsk({ ...n, busy: true });
        await run(fn, done);
        onAsk(null);
      },
      onDismiss: () => onAsk(null),
    };
    setError(null);
    setPlaced(null);
    onAsk(n);
  };
  const warn = (text: string) => onAsk({ text, warn: true, onDismiss: () => onAsk(null), dismissLabel: 'OK' });

  const startEdit = (ref: LevelRef) => {
    if (!live || ref.kind === 'trail') return;
    if (draft.editing && JSON.stringify(draft.editing) === JSON.stringify(ref)) return cancelEdit();
    const o = findOrder(live, ref);
    if (!o?.editable) return;
    setCustom(SELL_CHIPS.includes(o.pct) ? '' : String(o.pct));
    setError(null);
    setPlaced(null);
    onAsk(null);
    onDraft({ trigger: o.trigger, pct: o.pct, editing: ref });
    onFocusLevel();
  };
  const cancelEdit = () => {
    setError(null);
    onDraft({ trigger: null, pct: draft.pct, editing: null });
  };

  const remove = (ref: LevelRef) => {
    const cur = liveRef.current;
    if (!cur) return;
    if (draft.editing && JSON.stringify(draft.editing) === JSON.stringify(ref)) onDraft({ trigger: null, pct: draft.pct, editing: null });
    const e = withoutOrder(cur, ref);
    // The last order out: nothing left to watch, so stop guarding.
    void run(() => (leavesNothing(cur, e) ? api.cancel(cur.id) : api.update(cur.id, e)));
  };

  // ---- quick presets and the trailing stop: asked in the notice bar ----
  /** A preset's multiple as a level from the price now: a market cap the way traders say it, or a price. */
  const presetLevel = (x: number): Trigger | null =>
    mcOk ? { kind: 'mc', value: niceMc(token.mc! * x) } : !live ? { kind: 'x', value: x } : token.priceUSD ? { kind: 'price', value: token.priceUSD * x } : null;

  const askPreset = (p: Preset, i: number) => {
    const name = `P${i + 1} ${p.name}`;
    const lv = (x: number) => presetLevel(x)!;
    if (!token.priceUSD || !presetLevel(1)) return warn("I can't see this coin's price yet.");
    const parts = {
      tps: p.tps.map((t) => ({ trigger: lv(t.x), sellPct: t.pct })),
      sl: p.slX != null ? { trigger: lv(p.slX) } : null,
      trailing: p.trail ? { trailPct: p.trail.pct, activateX: p.trail.activateX } : null,
    };
    if (!live) {
      const input = planInput(token, parts);
      const issue = token.balance == null ? "Tippy can't see your bag yet." : validatePlanInput(input)[0]?.message;
      if (issue) return warn(issue);
      return confirm(`Add ${name}: ${presetSummary(p)}?`, 'Add', () => api.arm(input), `Done! ${name} is set on ${sym}.`);
    }
    confirm(
      `Use ${name} on ${sym} from now: ${presetSummary(p)}? It replaces your open orders.`,
      'Use',
      () => {
        const cur = liveRef.current;
        if (!cur) return Promise.resolve({ ok: false as const, error: 'That plan has finished.' });
        return api.update(cur.id, { tps: parts.tps.map((t) => ({ id: null, ...t })), stops: [], sl: parts.sl, trailing: parts.trailing });
      },
      `Done! ${name} is set on ${sym}.`,
    );
  };

  const trail = live?.trailing ?? null;
  const askTrail = (pct: number) => {
    if (trail?.trailPct === pct) return;
    const what = { trailPct: pct, activateX: trail?.activateX ?? null };
    if (!live) {
      const input = planInput(token, { tps: [], sl: null, trailing: what });
      const issue = token.balance == null ? "Tippy can't see your bag yet." : validatePlanInput(input)[0]?.message;
      if (issue) return warn(issue);
      return confirm(`Add a ${pct}% trailing stop on ${sym}? It sells the rest if it falls ${pct}% from its top.`, 'Add', () => api.arm(input), `Done! Trailing ${sym} ${pct}% from the top.`);
    }
    confirm(
      trail ? `Change your trailing stop to ${pct}% from the top?` : `Add a ${pct}% trailing stop on ${sym}? It sells the rest if it falls ${pct}% from its top.`,
      trail ? 'Change' : 'Add',
      () => {
        const cur = liveRef.current;
        if (!cur) return Promise.resolve({ ok: false as const, error: 'That plan has finished.' });
        return api.update(cur.id, { ...planEditWith(cur, {}), trailing: { trailPct: pct, activateX: cur.trailing?.activateX ?? null } });
      },
      `Done! Trailing ${sym} ${pct}% from the top.`,
    );
  };

  // ---- what to say, and the button ----
  const what = kind === 'sl' ? 'the rest' : `${pctText(draft.pct)}%`;
  const towards = (dir === 'up' && rel > 1) || (dir === 'down' && rel < 1);
  const sentence = !draft.trigger
    ? `Type a ${fUnit === 'mc' ? 'market cap' : 'price'} or drag: up to take profit, down for a stop.`
    : !kind
      ? "That's where it is now — drag up for a take profit, or down for a stop."
      : towards
        ? `Sell ${what} of ${sym} if it ${dir === 'up' ? 'rises' : 'drops'} ${movePct(rel)}% to ${lvl}`
        : `Sell ${what} of ${sym} at ${lvl}`;
  const tone = kind === 'tp' ? 'up' : kind ? 'down' : null;
  const label = busy
    ? draft.editing
      ? 'Saving…'
      : 'Adding…'
    : !kind
      ? 'Set a level above or below now'
      : `${draft.editing ? 'Save' : 'Add'} ${kind === 'tp' ? 'take profit' : 'stop loss'} · ${pctText(draft.pct)}% at ${lvl}`;
  const lines = [...(error ? [error] : []), ...(problem && problem !== error ? [problem] : [])];

  const rows = live ? orderRows(live, token, base, fUnit) : [];
  const nowAt = rows.findIndex((r) => !(r.rel > 1));
  const nowText = fUnit === 'mc' && token.mc ? formatUsd(token.mc) : formatUsd(token.priceUSD);
  const held: LevelRef | null = live?.sl?.status === 'held' ? { kind: 'sl' } : live?.trailing?.status === 'held' ? { kind: 'trail' } : null;
  const retry = live ? retryableLevels(live) : [];
  // Where it is against your entry: the live market cap (or price) when the window has it.
  const nowX = !live ? null : token.mc && live.entry.mc ? token.mc / live.entry.mc : token.priceUSD && live.entry.priceUSD > 0 ? token.priceUSD / live.entry.priceUSD : currentX(live);
  const pnl = nowX != null ? pctFmt((nowX - 1) * 100) : '';
  const isEditing = (ref: LevelRef) => !!draft.editing && JSON.stringify(draft.editing) === JSON.stringify(ref);

  return (
    <div class="tw-body">
      <AmountBox
        label="Amount"
        right={
          shareTokens != null &&
          price != null && (
            <span class="tw-box-r">
              {kind === 'sl' ? 'all' : `${pctText(draft.pct)}%`} ≈ <b>{cash(shareTokens * price)}</b>
            </span>
          )
        }
        group="Sell amount"
        chips={SELL_CHIPS.map((p) => ({
          label: `${p}%`,
          on: !custom && draft.pct === p,
          onPick: () => {
            setCustom('');
            change({ pct: p });
          },
        }))}
        custom={{ value: custom, on: !!custom, suffix: '%', ariaLabel: 'Other % of your bag (Enter to use it)', onInput: setCustom, onCommit: commitCustom }}
      />
      <TriggerBox
        side="sell"
        trigger={draft.trigger}
        unit={fUnit}
        canFlip={mcOk}
        onFlip={() => onUnit(fUnit === 'mc' ? 'price' : 'mc')}
        now={token}
        base={base}
        tone={tone}
        entry={live ? base : null}
        focusSignal={focusSignal}
        onChange={(trigger) => change({ trigger })}
      />
      <Say text={placed ?? sentence} tone={placed ? 'ok' : kind ? undefined : 'hint'} />
      {!placed && <Problems lines={lines} />}
      {!placed && note && (
        <div class="tw-warn-line tw-heads" role="status">
          {note}
        </div>
      )}
      <button class={`tw-arm${tone ? ` is-${tone}` : ''}`} disabled={busy || !order || !!problem} onClick={place}>
        {label}
      </button>
      {draft.editing && (
        <button class="tw-text-btn tw-cancel" onClick={cancelEdit}>
          Cancel — keep it as it was
        </button>
      )}
      {!live && token.balance === 0 && (
        <button class="tw-text-btn tw-text-mint" onClick={onBuyTab}>
          Set a limit buy instead →
        </button>
      )}

      {(showTrailing || trail) && (
        <div class="tw-optrow" role="group" aria-label="Trailing stop">
          <span class="tw-optl" title="Sells the rest if the price falls this far from its highest point">
            Trailing stop
          </span>
          {[...new Set([...TRAIL_CHIPS, ...(trail ? [trail.trailPct] : [])])]
            .sort((a, b) => a - b)
            .map((p) => (
              <button key={p} class="tw-opt is-down" aria-pressed={trail?.trailPct === p} disabled={busy || selling} title={`Sell the rest if it falls ${p}% from its top`} onClick={() => askTrail(p)}>
                {pctText(p)}%
              </button>
            ))}
        </div>
      )}

      {live && (
        <div class="tw-list" aria-label="Your orders">
          <div class="tw-list-head">Your orders</div>
          {rows.map((r, i) => (
            <Fragment key={r.key}>
              {i === nowAt && <NowLine text={nowText} />}
              <OrderRow
                dir={r.dir}
                tone={r.dir}
                level={r.level}
                move={r.move}
                what={r.what}
                status={r.status}
                done={r.done}
                editing={isEditing(r.ref)}
                title={r.title}
                busy={busy}
                lockedWhy={lockedWhy}
                onEdit={r.editable && r.ref.kind !== 'trail' ? () => startEdit(r.ref) : undefined}
                editLabel={`Change ${levelLabel(live, r.ref)}`}
                onRemove={r.editable ? () => remove(r.ref) : undefined}
                removeLabel={`Remove ${levelLabel(live, r.ref)}`}
              />
              {/* What this order needs from you, right under it. */}
              {retry.some((ref) => sameRef(ref, r.ref)) && (
                <div class="tw-row-note">
                  <span>{getLevel(live, r.ref)?.clickedAt != null ? 'Check fomo: did it sell? If not:' : "Tippy couldn't sell this one."}</span>
                  <button class="tw-btn tw-btn-sm" disabled={busy} aria-label={`Retry ${levelLabel(live, r.ref)}`} onClick={() => run(() => api.retry(live.id, r.ref))}>
                    ↻ Retry
                  </button>
                </div>
              )}
              {held && sameRef(held, r.ref) && (
                <div class="tw-row-note tw-held">
                  <span>This hit while your computer slept. Sell the rest now?</span>
                  <button class="tw-btn tw-btn-sm" disabled={busy} onClick={() => run(() => api.resolveHeld(live.id, held, false))}>
                    Keep watching
                  </button>
                  <button class="tw-btn tw-btn-sm tw-btn-sell" disabled={busy} onClick={() => run(() => api.resolveHeld(live.id, held, true))}>
                    Sell now
                  </button>
                </div>
              )}
            </Fragment>
          ))}
          {rows.length > 0 && nowAt === -1 && <NowLine text={nowText} />}
          {live.attention && !held && <div class="tw-row-note tw-attn-plan">{live.attention}</div>}
          <div class="tw-planline">
            <span class="tw-planline-txt" title={`${live.state === 'paused' ? 'Paused — nothing sells until you resume' : `Tippy is guarding ${sym}`}${nowX != null ? ` · ${formatX(nowX)} your entry` : ''}`}>
              {live.state === 'paused' ? 'Paused' : 'Guarding'}
              {nowX != null && (
                <>
                  {' · '}
                  {formatX(nowX)}
                  {' · '}
                  <b class={pnl[0] === '+' ? 'up' : pnl[0] === '−' ? 'down' : ''}>{pnl}</b>
                </>
              )}
            </span>
            {live.state === 'armed' ? (
              <button class="tw-plan-btn" disabled={busy} title="Stop watching for now — nothing sells while paused" onClick={() => run(() => api.pause(live.id))}>
                ❚❚ Pause
              </button>
            ) : (
              <button class="tw-plan-btn" disabled={busy} title="Start watching again" onClick={() => run(() => api.resume(live.id))}>
                ▶ Resume
              </button>
            )}
            <button
              class="tw-plan-btn tw-plan-stop"
              disabled={busy}
              title={`Cancel every order on ${sym} (nothing gets sold)`}
              onClick={() => confirm(`Cancel every order on ${sym}? Nothing gets sold.`, 'Stop all', () => api.cancel(live.id), `Done — Tippy stopped guarding ${sym}.`)}
            >
              ■ Stop all
            </button>
          </div>
        </div>
      )}
      {DEV_TOOLS && (
        <PracticeRun
          side="sell"
          token={token}
          blocked={token.balance == null ? "Tippy can't see your bag yet." : token.balance <= 0 ? `You don't hold ${sym} — nothing to practise selling yet.` : null}
          api={api}
          last={practice}
        />
      )}
      <div class="tw-quick" role="group" aria-label="Quick presets">
        <span class="tw-optl">Quick</span>
        {presets.map((p, i) => (
          <button key={p.id} class="tw-qchip" disabled={busy || selling} title={`${p.emoji} ${p.name}: ${presetSummary(p)}`} onClick={() => askPreset(p, i)}>
            <b>P{i + 1}</b> {p.name}
          </button>
        ))}
      </div>
      {live && live.history.length > 0 && (
        // What happened on this plan: tucked away until you open it.
        <details class="tw-activity">
          <summary>Activity</summary>
          {live.history
            .slice(-ACTIVITY_LINES)
            .reverse()
            .map((h, i) => (
              <div key={`${h.at}-${h.kind}-${i}`} title={h.text}>
                <span class="tw-dim">{new Date(h.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span> {h.text}
              </div>
            ))}
        </details>
      )}
    </div>
  );
}

/** Minimised state: a small draggable pill, like a docked instant-trade panel. The host ignores the click that ends a drag. */
export function TippyPill({ mood, count, label, onOpen, dragHandle, peek }: { mood: Mood; count: number; label: string; onOpen: () => void; dragHandle?: (e: PointerEvent) => void; peek?: boolean }) {
  return (
    <div class={`tw-pillbar${peek ? ' tw-peek' : ''}`} onPointerDown={dragHandle as never}>
      <button class="tw-pillbtn" onClick={onOpen} aria-label="Open Tippy">
        <Mascot mood={mood} size={30} />
        <span>
          <b>Tippy</b>
          <em>{label}</em>
        </span>
        {count > 0 && <span class="tw-badge">{count}</span>}
      </button>
    </div>
  );
}
