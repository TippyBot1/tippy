// The pretend trading app's own Buy / Sell panel, laid out like fomo's (from the
// markup captured during recon: tabs, a big $ box, four presets, Max, one button).
// It's "you trading yourself": Tippy never presses it here. Buying with
// Auto-guard on is how you see Tippy guard a new bag.

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
  const label = !value ? (side === 'buy' ? `Buy ${symbol}` : `Sell ${symbol}`) : short ? 'Insufficient balance' : `${side === 'buy' ? 'Buy' : 'Sell'} ${formatUsd(value)} ${symbol}`;

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
    setTimeout(() => setDone(null), 2_400);
  };

  return (
    <div class="fx-trade">
      <div class="fx-trade-in">
        <div class="fx-sides" role="tablist" aria-label="Buy or sell">
          <button role="tab" aria-selected={side === 'buy'} class={side === 'buy' ? 'is-buy' : ''} onClick={() => pick('buy')}>
            Buy
          </button>
          <button role="tab" aria-selected={side === 'sell'} class={side === 'sell' ? 'is-sell' : ''} onClick={() => pick('sell')}>
            Sell
          </button>
          <span class="fx-gear" aria-hidden="true">
            <svg width="16" height="16" viewBox="0 0 16 16">
              <path d="M2 4.5h7M12 4.5h2M2 11.5h2M7 11.5h7" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
              <circle cx="10.5" cy="4.5" r="1.6" fill="none" stroke="currentColor" stroke-width="1.5" />
              <circle cx="5.5" cy="11.5" r="1.6" fill="none" stroke="currentColor" stroke-width="1.5" />
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
            ? [10, 25, 50, 100].map((v) => (
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
        <div class="fx-avail">
          <span>{side === 'buy' ? 'Cash' : 'Available'}</span>
          <b>{formatUsd(room)}</b>
          <button onClick={() => setUsd(room.toFixed(2))} disabled={!room}>
            Max
          </button>
        </div>
        <button class={`fx-go fx-go-${side}`} disabled={!value || short} onClick={go}>
          {label}
        </button>
        {done ? (
          <p class="fx-done" role="status">
            <span aria-hidden="true">✓</span> {done}
          </p>
        ) : (
          <p class="fx-fees">Pretend money · you pressing the button, not Tippy</p>
        )}
      </div>
    </div>
  );
}
