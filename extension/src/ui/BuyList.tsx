// Limit-buy orders in plain words: what state an order is in, how long it has
// left, and this coin's orders as rows in Tippy's window (✕ to cancel, "It
// bought" / "It didn't buy" when Tippy isn't sure). The popup's list shares the
// words and the "not sure" answers.

import { Fragment } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { buyMove, isLiveBuy } from '../engine/buys';
import { formatUsd } from '../engine/triggers';
import type { BuyOrder } from '../engine/types';
import { dropText, type FieldUnit, levelShort, type Now, relToNow } from './levels';
import { OrderRow } from './OrderForm';

const BUY_STATUS: Record<BuyOrder['state'], [string, string]> = {
  armed: ['watching', ''],
  queued: ['in line', 'warn'],
  executing: ['buying…', 'warn'],
  unknown: ['needs you', 'warn'],
  filled: ['bought ✓', 'ok'],
  failed: ['failed', 'bad'],
  expired: ['expired', ''],
  cancelled: ['cancelled', ''],
};

/** [plain words, css class] for an order's state. */
export function buyStatus(o: BuyOrder): [string, string] {
  if (o.state === 'filled' && o.dryRun) return ['dry run ✓', 'ok'];
  return BUY_STATUS[o.state];
}

/** "$10", "$12.5", "$1.5K" — short enough for a row tag. */
export function usdShort(n: number): string {
  if (!Number.isFinite(n)) return '—';
  if (n >= 1000) return formatUsd(n);
  return `$${+n.toFixed(n >= 100 ? 0 : n >= 10 ? 1 : 2)}`;
}

function span(ms: number): string {
  const m = Math.max(1, Math.round(ms / 60_000));
  if (m < 60) return `${m}m`;
  const h = Math.round(m / 60);
  return h < 48 ? `${h}h` : `${Math.round(h / 24)}d`;
}

/** "23h left", "no expiry" — or "5m ago" once it's finished. */
export function buyWhen(o: BuyOrder, now: number): string {
  if (!isLiveBuy(o)) return `${span(now - o.updatedAt)} ago`;
  if (o.expiresAt == null) return 'no expiry';
  return o.expiresAt > now ? `${span(o.expiresAt - now)} left` : 'expiring';
}

/** What the level means in the units it isn't set in: "≈$1.6M MC" for a % move, "−20%" for a market cap or price. */
export function buyHint(o: BuyOrder): string {
  if (o.trigger.kind !== 'x') return buyMove(o);
  if (o.ref.mc) return `≈${formatUsd(o.ref.mc * o.trigger.value)} MC`;
  return o.ref.priceUSD > 0 ? `≈${formatUsd(o.ref.priceUSD * o.trigger.value)}` : '';
}

/** Live orders first (newest first), then the last few that finished. */
export function sortBuys(orders: BuyOrder[], recent = 3): BuyOrder[] {
  const live = orders.filter(isLiveBuy).sort((a, b) => b.createdAt - a.createdAt);
  const done = orders
    .filter((o) => !isLiveBuy(o))
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, recent);
  return [...live, ...done];
}

// ---- An order Tippy isn't sure about ('unknown') ----
// Tippy pressed Buy but the coins haven't shown up. It's never cancelled (that
// would drop the take-profit / stop loss if the coins land later) — the trader
// answers "It bought" or "It didn't buy". "It didn't buy" watches the price
// again (it may buy again), and fomo's balances can lag for minutes, so that
// answer waits a couple of minutes after Tippy pressed Buy.

/** How long "It didn't buy" waits after the order went 'unknown'. */
export const UNSURE_WAIT_MS = 120_000;
export const UNSURE_HINT = 'fomo can take a minute or two to show new coins';

/** Only orders Tippy is sure never pressed Buy can be cancelled. */
/** Only while it's watching or waiting its turn — mid-buy the press may be happening (Pause all still stops it). */
export const canCancelBuy = (o: BuyOrder) => isLiveBuy(o) && (o.state === 'armed' || o.state === 'queued');

/** When the order went 'unknown': its last 'unknown' event (or its last change). */
export function unsureSince(o: BuyOrder): number {
  for (let i = o.history.length - 1; i >= 0; i--) if (o.history[i].kind === 'unknown') return o.history[i].at;
  return o.updatedAt;
}

/** ms until "It didn't buy" can be tapped (0 = now). */
export function didntBuyWait(o: BuyOrder, now: number): number {
  return o.state === 'unknown' ? Math.max(0, unsureSince(o) + UNSURE_WAIT_MS - now) : 0;
}

/** "1:20" */
export function countdown(ms: number): string {
  const s = Math.ceil(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** The time now — and a re-render every second while `ticking` (live countdowns). */
export function useNow(ticking: boolean): number {
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!ticking) return;
    const t = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [ticking]);
  return Date.now();
}

/** Any of these orders still waiting out its "It didn't buy" countdown? */
export const anyUnsureWait = (orders: BuyOrder[]) => orders.some((o) => didntBuyWait(o, Date.now()) > 0);

/** "It bought" / "It didn't buy" for an 'unknown' order — in the window (`tw-`) or the popup's list (`t-`). */
export function UnsureAnswers({
  order,
  now,
  busy = false,
  onResolve,
  list = false,
}: {
  order: BuyOrder;
  now: number;
  busy?: boolean;
  onResolve: (orderId: string, bought: boolean) => void;
  list?: boolean;
}) {
  const wait = didntBuyWait(order, now);
  const btn = list ? 't-mini' : 'tw-btn';
  return (
    <div class={list ? 't-resolve' : 'tw-row2 tw-resolve'}>
      {wait > 0 && <div class={list ? 't-hint' : 'tw-resolve-hint'}>{UNSURE_HINT}</div>}
      <button class={btn} disabled={busy} title="You checked fomo and the coins are there" onClick={() => onResolve(order.id, true)}>
        It bought
      </button>
      <button
        class={btn}
        disabled={busy || wait > 0}
        title={wait > 0 ? `${UNSURE_HINT} — wait a moment before saying it didn't buy` : "You checked fomo and the coins aren't there — watch the price again (it may buy again)"}
        onClick={() => onResolve(order.id, false)}
      >
        It didn't buy
        {wait > 0 && <span class="t-wait"> (wait {countdown(wait)})</span>}
      </button>
    </div>
  );
}

/**
 * This coin's limit buys in Tippy's window, in the same row style as the sell
 * orders: "▼ $1.6M MC −20% · buy $10 · 23h left". The % is from the coin now
 * when the window knows it (else from when the order was placed).
 */
export function BuyOrders({
  orders,
  now: coin,
  unit = 'mc',
  busy,
  onCancel,
  onResolve,
}: {
  orders: BuyOrder[];
  /** Where the coin is now. */
  now?: Now;
  /** Show levels as a market cap (default) or a price. */
  unit?: FieldUnit;
  busy: boolean;
  onCancel: (orderId: string) => void;
  /** bought = "It bought" (true), or "It didn't buy" / "Try again" (false: watch again). */
  onResolve: (orderId: string, bought: boolean) => void;
}) {
  const now = useNow(anyUnsureWait(orders));
  const rows = sortBuys(orders);
  if (!rows.length) return null;
  return (
    <div class="tw-list tw-buys" aria-label="Your limit buys">
      <div class="tw-list-head">Your buys</div>
      {rows.map((o) => {
        const [word, cls] = buyStatus(o);
        const live = isLiveBuy(o);
        const cancel = canCancelBuy(o);
        const ref: Now = { priceUSD: o.ref.priceUSD, mc: o.ref.mc };
        const rel = coin ? relToNow(o.trigger, coin, ref) : NaN;
        const level = levelShort(o.trigger, unit, ref, coin ?? ref);
        return (
          <Fragment key={o.id}>
            <OrderRow
              dir={o.direction === 'down' ? 'down' : 'up'}
              tone="buy"
              level={level}
              move={live && Number.isFinite(rel) ? dropText(rel) : buyMove(o)}
              what={`buy ${usdShort(o.usd)} · ${buyWhen(o, now)}`}
              status={o.state === 'armed' ? null : [word, cls]}
              done={!live}
              busy={busy}
              title={o.direction === 'down' ? 'Buys the dip' : 'Buys a breakout'}
              onRemove={cancel ? () => onCancel(o.id) : undefined}
              removeLabel={`Cancel buy ${usdShort(o.usd)} at ${level}`}
            />
            {o.attention && <div class={`tw-attn${live ? '' : ' tw-attn-done'}`}>{o.attention}</div>}
            {o.state === 'unknown' && <UnsureAnswers order={o} now={now} busy={busy} onResolve={onResolve} />}
            {o.state === 'failed' && (
              <div class="tw-resolve">
                <button class="tw-btn" disabled={busy} title="Watch the price again (it may buy again)" onClick={() => onResolve(o.id, false)}>
                  ↻ Try again
                </button>
              </div>
            )}
          </Fragment>
        );
      })}
    </div>
  );
}
