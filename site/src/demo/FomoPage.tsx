// The demo's pretend trading app, laid out like a coin page on fomo.family (the
// coin list on the left; the coin, its chart and swaps in the middle; the
// Buy / Sell panel, "About" and your positions on the right) so you can see
// exactly where Tippy sits. Neutral on purpose: no fomo logo or name in it, and
// every number is pretend. Tippy itself is drawn on top by the caller.

import type { ComponentChildren } from 'preact';
import { formatUsd } from '@ext/engine/triggers';
import type { ChartLine, ChartMove } from '@ext/shared/chartLines';
import type { Swap } from '../market';
import { CandleChart } from './CandleChart';
import { TradePanel } from './TradePanel';

/** The other coins in the list: pretend, and only $DEMO opens. */
const LIST: { sym: string; mc: number; chg: number; price: number; color: string }[] = [
  { sym: 'BONKLE', mc: 412_000, chg: 37.3, price: 0.000412, color: '#ff9f43' },
  { sym: 'FROGGO', mc: 2_150_000, chg: -12.4, price: 0.00215, color: '#58c472' },
  { sym: 'MOONCAT', mc: 14_300_000, chg: 18.8, price: 0.0143, color: '#a78bfa' },
  { sym: 'WAGGLE', mc: 1_380_000, chg: 720.3, price: 0.00138, color: '#f472b6' },
  { sym: 'PIXEL', mc: 91_900_000, chg: -5.5, price: 0.0919, color: '#60a5fa' },
  { sym: 'NOODLE', mc: 5_790_000, chg: -32.2, price: 0.00579, color: '#fbbf24' },
  { sym: 'ZAPPY', mc: 60_900_000, chg: 13.6, price: 0.0609, color: '#34d399' },
  { sym: 'HONK', mc: 324_500, chg: 8.7, price: 0.000325, color: '#f87171' },
];

const pct = (v: number) => `${v >= 0 ? '▲' : '▼'}${Math.abs(v).toFixed(2)}%`;
const Up = ({ v }: { v: number }) => <span class={v >= 0 ? 'up' : 'down'}>{pct(v)}</span>;

export function FomoPage({
  symbol,
  name,
  supply,
  price,
  history,
  tick,
  bag,
  cash,
  entry,
  swaps,
  lines,
  preview,
  onDrop,
  onTrade,
  onNote,
  children,
}: {
  symbol: string;
  name: string;
  supply: number;
  price: number;
  history: number[];
  tick: number;
  bag: number;
  cash: number;
  /** Your average entry price (for the position's profit / loss). */
  entry: number;
  swaps: Swap[];
  lines: ChartLine[];
  preview: ChartMove | null;
  onDrop: (line: ChartLine, move: ChartMove) => void;
  onTrade: (side: 'buy' | 'sell', amount: number) => { ok: true } | { ok: false; error: string };
  onNote: (text: string) => void;
  /** Tippy, drawn over the page: its window (or pill) and its pop-ups. */
  children: ComponentChildren;
}) {
  const mc = price * supply;
  const n = history.length;
  const since = (ticks: number) => (price / history[Math.max(0, n - 1 - ticks)] - 1) * 100;
  const day = (price / history[0] - 1) * 100;
  const value = bag * price;
  const pnl = entry > 0 ? (price / entry - 1) * 100 : 0;
  const others = () => onNote(`Only $${symbol} is live in this demo — the other coins in the list are just for show.`);

  return (
    <div class="fx">
      <header class="fx-top">
        <span class="fx-brand">
          <i aria-hidden="true" />
          demo app
        </span>
        <span class="fx-disc" aria-hidden="true">
          Discover
        </span>
        <span class="fx-search" aria-hidden="true">
          <svg width="15" height="15" viewBox="0 0 16 16">
            <circle cx="7" cy="7" r="5" fill="none" stroke="currentColor" stroke-width="1.5" />
            <path d="M11 11l3 3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
          </svg>
          Search for tokens or traders…
          <kbd>/</kbd>
        </span>
        <span class="fx-wallet">
          <span>
            <b>{formatUsd(cash)}</b> cash
          </span>
          <small>Pretend money</small>
        </span>
        <span class="fx-wallet">
          <b>{formatUsd(value + cash)}</b>
          <small class={pnl >= 0 ? 'up' : 'down'}>
            {pnl >= 0 ? '+' : '−'}
            {formatUsd(Math.abs(value - value / (1 + pnl / 100)))} 24h
          </small>
        </span>
        <span class="fx-me" aria-hidden="true" />
      </header>

      <div class="fx-body">
        <aside class="fx-card fx-list" aria-label="Coins">
          <div class="fx-list-tabs" aria-hidden="true">
            <span>Alerts</span>
            <span class="on">Tokens</span>
            <span>Leaderboard</span>
          </div>
          <div class="fx-pills" aria-hidden="true">
            <span>Watchlist</span>
            <span class="on">Trending</span>
            <span>Most held</span>
          </div>
          <ul>
            <li class="is-here">
              <span class="fx-av" style={{ background: 'var(--buy)' }} aria-hidden="true">
                {symbol[0]}
              </span>
              <span class="fx-li-n">
                <b>{symbol}</b>
                <small>{formatUsd(price)}</small>
              </span>
              <span class="fx-li-v">
                <b>{formatUsd(mc)} MC</b>
                <Up v={day} />
              </span>
            </li>
            {LIST.map((c) => (
              <li key={c.sym}>
                <button onClick={others} title={`$${c.sym} (pretend)`}>
                  <span class="fx-av" style={{ background: c.color }} aria-hidden="true">
                    {c.sym[0]}
                  </span>
                  <span class="fx-li-n">
                    <b>{c.sym}</b>
                    <small>{formatUsd(c.price)}</small>
                  </span>
                  <span class="fx-li-v">
                    <b>{formatUsd(c.mc)} MC</b>
                    <Up v={c.chg} />
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </aside>

        <section class="fx-center">
          <div class="fx-coin">
            <span class="fx-av fx-av-lg" style={{ background: 'var(--buy)' }} aria-hidden="true">
              {symbol[0]}
            </span>
            <div class="fx-name">
              <b>{symbol}</b>
              <small>
                {name} · 1d · pretend
              </small>
            </div>
            <dl class="fx-stats">
              <div class="fx-stat-mc">
                <dt>Market cap</dt>
                <dd>{formatUsd(mc)}</dd>
              </div>
              <div>
                <dt>Price</dt>
                <dd>{formatUsd(price)}</dd>
              </div>
              <div>
                <dt>24H change</dt>
                <dd>
                  <Up v={day} />
                </dd>
              </div>
              <div class="fx-stat-x">
                <dt>24H Vol.</dt>
                <dd>{formatUsd(mc * 0.31)}</dd>
              </div>
              <div class="fx-stat-x">
                <dt>Liquidity</dt>
                <dd>{formatUsd(mc * 0.11)}</dd>
              </div>
              <div class="fx-stat-xx">
                <dt>Holders</dt>
                <dd>1.3K</dd>
              </div>
            </dl>
          </div>

          <div class="fx-tools" aria-hidden="true">
            <span>1m</span>
            <i />
            <span>Indicators</span>
            <i />
            <span>
              Price / <em>MCap</em>
            </span>
            <span class="fx-tools-r">Chart ▾</span>
          </div>
          <div class="fx-chart">
            <CandleChart history={history} tick={tick} supply={supply} name={name} lines={lines} swaps={swaps} preview={preview} onDrop={onDrop} />
          </div>
          <div class="fx-range" aria-hidden="true">
            <span>1D</span>
            <span>1W</span>
            <span>1M</span>
            <span>3M</span>
            <span>1Y</span>
            <span class="fx-range-r">% · log · auto</span>
          </div>

          <div class="fx-card fx-swaps">
            <div class="fx-swaps-tabs" aria-hidden="true">
              <span>Holders (1,284)</span>
              <span class="on">Your swaps</span>
              <span>Thesis</span>
            </div>
            {swaps.length ? (
              <table>
                <thead>
                  <tr>
                    <th>Trader</th>
                    <th>Type</th>
                    <th>Amount</th>
                    <th>Market cap</th>
                    <th>When</th>
                  </tr>
                </thead>
                <tbody>
                  {[...swaps].reverse().map((s) => (
                    <tr key={s.id}>
                      <td>
                        you{s.by === 'tippy' && <em class="fx-by"> · pressed by Tippy</em>}
                      </td>
                      <td class={s.side === 'buy' ? 'up' : 'down'}>{s.side === 'buy' ? 'Buy' : 'Sell'}</td>
                      <td>{formatUsd(s.usd)}</td>
                      <td>{formatUsd(s.mc)}</td>
                      <td>{tick - s.tick < 3 ? 'now' : `${Math.round((tick - s.tick) * 0.45)}s ago`}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p class="fx-empty">No swaps yet. Buy in the panel on the right, or let Tippy fill one of your orders — it shows up here like any trade you make.</p>
            )}
          </div>
        </section>

        <aside class="fx-right">
          <TradePanel symbol={symbol} price={price} bag={bag} cash={cash} onTrade={onTrade} />
          <div class="fx-card fx-about">
            <h3>About {symbol}</h3>
            <p>A pretend coin for the Tippy demo. Every number here is made up.</p>
            <div class="fx-tf">
              <span>
                5M <Up v={since(5)} />
              </span>
              <span class="on">
                1H <Up v={since(60)} />
              </span>
              <span>
                4H <Up v={since(100)} />
              </span>
              <span>
                1D <Up v={day} />
              </span>
            </div>
            <div class="fx-flow">
              <p>
                <span>842 buys</span>
                <span>611 sells</span>
              </p>
              <i style="--b: 58%" />
            </div>
          </div>
          <div class="fx-card fx-pos">
            <div class="fx-pos-head">
              <h3>Your positions</h3>
              <span>
                <b>Open</b> Closed
              </span>
            </div>
            {bag > 0 ? (
              <div class="fx-pos-row">
                <span class="fx-av" style={{ background: 'var(--buy)' }} aria-hidden="true">
                  {symbol[0]}
                </span>
                <span class="fx-li-n">
                  <b>{symbol}</b>
                  <small>{Math.round(bag).toLocaleString('en-US')}</small>
                </span>
                <span class="fx-li-v">
                  <b>{formatUsd(value)}</b>
                  <Up v={pnl} />
                </span>
              </div>
            ) : (
              <p class="fx-empty">Nothing open.</p>
            )}
          </div>
        </aside>
      </div>

      <footer class="fx-status" aria-hidden="true">
        <span>Pretend prices · nothing here is fomo</span>
        <span class="fx-stable">
          <i /> Stable
        </span>
      </footer>

      {children}
    </div>
  );
}
