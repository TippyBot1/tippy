// The pretend app's own Buy / Sell panel, laid out like fomo's (from the markup
// captured during recon): Buy / Sell tabs and a settings gear, a big $ box, four
// presets, cash + Max, one button. It's you trading yourself: Tippy never
// presses it here. Buying with Auto-guard on is how you watch Tippy guard a bag.

import { useState } from 'preact/hooks';
import { formatUsd } from '@ext/engine/triggers';

type Side = 'buy' | 'sell';

export function TradePanel({
  symbol,
  price,
  bag,
  cash,
  onTrade,
}: {
  symbol: string;
  price: number;
  bag: number;
  cash: number;
  onTrade: (side: Side, amount: number) => { ok: true } | { ok: false; error: string };
}) {
  const [side, setSide] = useState<Side>('buy');
  const [usd, setUsd] = useState('');
  const [done, setDone] = useState<string | null>(null);
  const value = Number(usd) || 0;
  const held = bag * price;
  const room = side === 'buy' ? cash : held;
  const short = value > room + 1e-9;
  const label = short ? 'Insufficient balance' : `${side === 'buy' ? 'Buy' : 'Sell'} ${symbol}`;

  const pick = (s: Side) => {
    setSide(s);
    setUsd('');
  };
  const go = () => {
    if (!value || short) return;
    const res = onTrade(side, side === 'buy' ? value : value / price);
    if (!res.ok) return;
    setUsd('');
    setDone(`${side === 'buy' ? 'Bought' : 'Sold'} ${formatUsd(value)} ${symbol}`);
    setTimeout(() => setDone(null), 2_600);
  };

  return (
    <div class="fx-card fx-trade">
      <div class="fx-sides" role="tablist" aria-label="Buy or sell">
        <button role="tab" aria-selected={side === 'buy'} class={side === 'buy' ? 'is-buy' : ''} onClick={() => pick('buy')}>
          Buy
        </button>
        <button role="tab" aria-selected={side === 'sell'} class={side === 'sell' ? 'is-sell' : ''} onClick={() => pick('sell')}>
          Sell
        </button>
        <span class="fx-gear" aria-hidden="true">
          <svg width="18" height="18" viewBox="0 0 20 20">
            <path
              d="M10 6.8a3.2 3.2 0 1 0 0 6.4 3.2 3.2 0 0 0 0-6.4Zm7 4.1v-1.8l-2-.6a5.6 5.6 0 0 0-.6-1.4l1-1.8-1.3-1.3-1.8 1a5.6 5.6 0 0 0-1.4-.6l-.6-2H8.5l-.6 2a5.6 5.6 0 0 0-1.4.6l-1.8-1-1.3 1.3 1 1.8a5.6 5.6 0 0 0-.6 1.4l-2 .6v1.8l2 .6c.1.5.3 1 .6 1.4l-1 1.8 1.3 1.3 1.8-1c.4.3.9.5 1.4.6l.6 2h1.8l.6-2c.5-.1 1-.3 1.4-.6l1.8 1 1.3-1.3-1-1.8c.3-.4.5-.9.6-1.4l2-.6Z"
              fill="currentColor"
            />
          </svg>
        </span>
      </div>
      <label class="fx-amount">
        <span class="fx-cur">$</span>
        <input placeholder="0" inputMode="decimal" aria-label={`Amount to ${side} in dollars`} value={usd} onInput={(e) => setUsd(e.currentTarget.value.replace(/[^0-9.]/g, ''))} />
        <span class="fx-hint">{value ? `≈ ${(value / price).toLocaleString('en-US', { maximumFractionDigits: 0 })} ${symbol}` : 'Enter amount'}</span>
      </label>
      <div class="fx-presets">
        {side === 'buy'
          ? [10, 100, 500, 1000].map((v) => (
              <button key={v} onClick={() => setUsd(String(v))}>
                ${v}
              </button>
            ))
          : [10, 25, 50, 100].map((pct) => (
              <button key={pct} onClick={() => setUsd(((held * pct) / 100).toFixed(2))} disabled={!held}>
                {pct}%
              </button>
            ))}
      </div>
      <p class="fx-avail">
        {side === 'sell' && <span>Available</span>}
        <b>{formatUsd(room)}</b>
        <button onClick={() => setUsd(room.toFixed(2))} disabled={!room}>
          Max
        </button>
      </p>
      <button class={`fx-go fx-go-${side}${value && !short ? ' is-ready' : ''}`} disabled={!value || short} onClick={go}>
        {label}
      </button>
      {done ? (
        <p class="fx-done" role="status">
          <span aria-hidden="true">✓</span> {done}
        </p>
      ) : (
        <p class="fx-warn">
          <span aria-hidden="true">⚠</span> Pretend token · you pressing, not Tippy
        </p>
      )}
    </div>
  );
}
