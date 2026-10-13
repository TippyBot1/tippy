// Every coin Tippy is guarding — and every limit buy it's waiting on — with live
// x and quick actions. Used in the toolbar popup and in the floating panel on
// non-token fomo pages.

import { buyLevelText, isLiveBuy } from '../engine/buys';
import { currentX, summarizePlan } from '../engine/orders';
import { formatX } from '../engine/triggers';
import type { BuyOrder, Plan } from '../engine/types';
import { tokenUrl } from '../shared/chains';
import { anyUnsureWait, buyHint, buyStatus, buyWhen, canCancelBuy, UnsureAnswers, usdShort, useNow } from './BuyList';
import { Mascot } from './Mascot';

/** "$341K MC (−20%) · watching · 23h left" */
const buyMeta = (o: BuyOrder, now: number) => `${buyLevelText(o.trigger)}${buyHint(o) ? ` (${buyHint(o)})` : ''} · ${buyStatus(o)[0]} · ${buyWhen(o, now)}`;

export function PlanList({
  plans,
  buys = [],
  onPause,
  onResume,
  onCancel,
  onCancelBuy,
  onResolveBuy,
  onOpen,
  emptyHint = 'Open any coin on fomo and tap Tippy to set a take-profit, stop loss or limit buy.',
}: {
  plans: Plan[];
  buys?: BuyOrder[];
  onPause: (id: string) => void;
  onResume: (id: string) => void;
  onCancel: (id: string) => void;
  onCancelBuy?: (orderId: string) => void;
  /** An order Tippy isn't sure about: "It bought" (true) or "It didn't buy" (false: watch again). */
  onResolveBuy?: (orderId: string, bought: boolean) => void;
  onOpen?: (url: string) => void;
  emptyHint?: string;
}) {
  const live = plans
    .filter((p) => p.state === 'armed' || p.state === 'paused')
    .sort((a, b) => (a.attention ? -1 : 0) - (b.attention ? -1 : 0) || b.updatedAt - a.updatedAt);
  const liveBuys = buys.filter(isLiveBuy).sort((a, b) => (a.attention ? -1 : 0) - (b.attention ? -1 : 0) || b.createdAt - a.createdAt);
  // Ticks while an "It didn't buy" countdown runs.
  const now = useNow(anyUnsureWait(liveBuys));
  // Recently finished: plans that ran their course and buys that bought, failed or expired (newest first).
  const recent = [
    ...plans.filter((p) => p.state === 'done').map((p) => ({ at: p.updatedAt, plan: p, buy: null })),
    ...buys.filter((o) => o.state === 'filled' || o.state === 'failed' || o.state === 'expired').map((o) => ({ at: o.updatedAt, plan: null, buy: o })),
  ]
    .sort((a, b) => b.at - a.at)
    .slice(0, 4);

  if (live.length === 0 && liveBuys.length === 0 && recent.length === 0) {
    return (
      <div class="t-empty">
        <Mascot mood="idle" size={56} />
        <div>{emptyHint}</div>
      </div>
    );
  }

  return (
    <div class="t-list">
      {live.map((p) => {
        const x = currentX(p);
        return (
          <div class="t-plan" key={p.id}>
            <div>
              <b>${p.symbol}</b>{' '}
              {p.state === 'paused' && <span class="t-chip">paused</span>}
              {p.attention && <span class="t-chip t-warn">needs you</span>}
              {p.origin === 'auto-guard' && <span class="t-chip">auto</span>}
            </div>
            <div class={`t-xnow ${x == null ? '' : x >= 1 ? 't-up' : 't-down'}`}>{x == null ? '…' : formatX(x)}</div>
            <div class="t-meta">{p.attention ?? summarizePlan(p)}</div>
            <div class="t-actions">
              {onOpen && (
                <button class="t-x" title="Open on fomo" aria-label={`Open $${p.symbol} on fomo`} onClick={() => onOpen(tokenUrl(p.address, p.networkId))}>
                  ↗
                </button>
              )}
              {p.state === 'armed' ? (
                <button class="t-x" title="Pause" aria-label={`Pause $${p.symbol}`} onClick={() => onPause(p.id)}>
                  ❚❚
                </button>
              ) : (
                <button class="t-x" title="Resume" aria-label={`Resume $${p.symbol}`} onClick={() => onResume(p.id)}>
                  ▶
                </button>
              )}
              <button class="t-x" title="Stop guarding" aria-label={`Stop guarding $${p.symbol}`} onClick={() => onCancel(p.id)}>
                ×
              </button>
            </div>
          </div>
        );
      })}
      {liveBuys.map((o) => (
        <div class="t-plan" key={o.id}>
          <div>
            <b>${o.symbol}</b> <span class="t-chip t-buy">limit buy</span> {o.attention && <span class="t-chip t-warn">needs you</span>}
          </div>
          <div class="t-xnow t-up">{usdShort(o.usd)}</div>
          <div class="t-meta">{o.attention ?? buyMeta(o, now)}</div>
          <div class="t-actions">
            {onOpen && (
              <button class="t-x" title="Open on fomo" aria-label={`Open $${o.symbol} on fomo`} onClick={() => onOpen(tokenUrl(o.address, o.networkId))}>
                ↗
              </button>
            )}
            {/* Never for an order Tippy isn't sure about — it may have bought, and its guard must still arm. */}
            {onCancelBuy && canCancelBuy(o) && (
              <button class="t-x" title="Cancel this buy" aria-label={`Cancel limit buy of $${o.symbol}`} onClick={() => onCancelBuy(o.id)}>
                ×
              </button>
            )}
          </div>
          {o.state === 'unknown' && onResolveBuy && <UnsureAnswers order={o} now={now} onResolve={onResolveBuy} list />}
        </div>
      ))}
      {recent.length > 0 && (
        <>
          <div class="t-section-label" style={{ marginTop: 6 }}>
            <span>Recently done</span>
          </div>
          {recent.map(({ plan: p, buy: o }) =>
            p ? (
              <div class="t-plan" key={p.id} style={{ opacity: 0.75 }}>
                <div>
                  <b>${p.symbol}</b> <span class="t-chip t-ok">done</span>
                </div>
                <div />
                <div class="t-meta">{p.history[p.history.length - 1]?.text}</div>
              </div>
            ) : (
              o && (
                <div class="t-plan" key={o.id} style={{ opacity: 0.75 }}>
                  <div>
                    <b>${o.symbol}</b> <span class={`t-chip ${o.state === 'filled' ? 't-ok' : o.state === 'failed' ? 't-warn' : ''}`}>{buyStatus(o)[0]}</span>
                  </div>
                  <div class="t-xnow">{usdShort(o.usd)}</div>
                  <div class="t-meta">{o.attention ?? o.history[o.history.length - 1]?.text ?? buyMeta(o, now)}</div>
                </div>
              )
            ),
          )}
        </>
      )}
    </div>
  );
}
