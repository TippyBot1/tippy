import { render } from 'preact';
import '../site.css';
import { DemoButton, NextPage, Page, PageHead } from '../layout';

const Tri = ({ dir }: { dir: 'up' | 'down' }) => <i class={`tri tri-${dir}`} aria-hidden="true" />;


/** The partial-stop illustration: the line is SVG, every label is HTML so it stays 11–13px at any width. */
function Wick() {
  return (
    <div class="wick art" role="img" aria-label="A price wick dips below the stop and is ignored; a drop that stays down later fills the stop">
      <div class="wick-in">
        <svg viewBox="0 0 360 150" preserveAspectRatio="none" aria-hidden="true">
          <line x1="0" x2="360" y1="70" y2="70" class="wk-stop" />
          <path class="wk-path" d="M0,30 L22,36 L40,28 L58,40 L76,34 L94,42 L104,38 L112,50 L116,112 L120,48 L132,42 L150,50 L168,40 L186,52 L204,46 L222,56 L238,66 L252,80 L266,88 L282,96 L300,92 L318,102 L340,100 L360,106" />
        </svg>
        <span class="wk-dot wk-dot-wick" style={{ left: '32.2%', top: '74.7%' }} />
        <span class="wk-dot wk-dot-fill" style={{ left: '73.9%', top: '58.7%' }} />
        <span class="wk-t wk-t-stop" style={{ top: '46.7%' }}>
          Stop $350K · 10%
        </span>
        <span class="wk-t wk-t-wick" style={{ left: '32.2%', top: '74.7%' }}>
          wick — ignored
        </span>
        <span class="wk-t wk-t-fill">stayed down — sold 10%</span>
      </div>
    </div>
  );
}

function Bento() {
  return (
    <section class="section section-features" aria-label="Features">
      <div class="wrap">
        <div class="bento">
          <article class="cell c-7">
            <p class="cell-label">Sell orders</p>
            <h3>Sell at any market cap, any % of your bag</h3>
            <p>Ladder out on the way up and protect the rest on the way down, all on one list. Sells go through fomo’s own Sell button, at market.</p>
            <div class="ladder art" role="img" aria-label="Example orders, top to bottom: sell 25% at $1.5M, sell 50% at $600K, now $412K, sell 10% at $350K, sell the rest at $210K">
              <div class="lr">
                <Tri dir="up" />
                <b>$1.5M</b>
                <span>MC</span>
                <em class="up">+264.1%</em>
                <span class="lr-what">sell 25%</span>
              </div>
              <div class="lr">
                <Tri dir="up" />
                <b>$600K</b>
                <span>MC</span>
                <em class="up">+45.6%</em>
                <span class="lr-what">sell 50%</span>
              </div>
              <div class="lr lr-now">
                <span>now</span>
                <b>$412K</b>
              </div>
              <div class="lr">
                <Tri dir="down" />
                <b>$350K</b>
                <span>MC</span>
                <em class="down">−15.0%</em>
                <span class="lr-what">sell 10%</span>
              </div>
              <div class="lr">
                <Tri dir="down" />
                <b>$210K</b>
                <span>MC</span>
                <em class="down">−49.0%</em>
                <span class="lr-what">sell the rest</span>
              </div>
            </div>
          </article>

          <article class="cell c-5">
            <p class="cell-label">Partial stops</p>
            <h3>Stops that sell exactly what you choose</h3>
            <p>Sell 10% if it drops to $350K and the rest at $210K. The price has to stay down before a stop fires, so a one-tick wick doesn’t shake you out.</p>
            <Wick />
          </article>

          <article class="cell c-5">
            <p class="cell-label">Limit buys</p>
            <h3>Buy at an exact market cap</h3>
            <p>Buy $10 if it dips to $340K. It buys once — never twice — expires when you say, and can guard the new coins with your take profit and stop.</p>
            <div class="buybox art" role="img" aria-label="A limit buy: $10 at $340K market cap, expires in 24 hours; it buys once, then guards the coins with 2x 50%, 5x 25% and a stop at minus 30%">
              <div class="lr lr-buy">
                <Tri dir="down" />
                <b>$340K</b>
                <span>MC</span>
                <em class="down">−17.5%</em>
                <span class="lr-what">buy $10</span>
              </div>
              <div class="chips">
                <span>1h</span>
                <span class="on">24h</span>
                <span>7d</span>
                <span>Never</span>
              </div>
              <ol class="life">
                <li>
                  <span>Watching</span>
                  <b>until $340K or 24h</b>
                </li>
                <li>
                  <span>Buys once</span>
                  <b>$10 at $338K MC</b>
                </li>
                <li>
                  <span>Then guards</span>
                  <b class="up">2x 50% · 5x 25% · SL −30%</b>
                </li>
              </ol>
            </div>
          </article>

          <article class="cell c-7">
            <p class="cell-label">Chart lines</p>
            <h3>Your orders, drawn on the chart</h3>
            <p>Every order shows as a dashed line on the coin’s chart on fomo. Drag a line to move the order — Tippy asks before it changes anything.</p>
            <div class="mini-chart art" role="img" aria-label="Illustration: dashed order lines on a price chart; one take profit is dragged to $700K and Tippy asks to confirm the move">
              <svg viewBox="0 0 520 170" preserveAspectRatio="none" aria-hidden="true">
                <path class="mc-path" d="M0,128 L26,122 L48,130 L72,112 L96,118 L120,100 L146,106 L170,90 L196,96 L220,82 L246,88 L270,74 L296,80 L322,66 L348,72 L372,60 L398,64 L420,58 L440,62" />
              </svg>
              <div class="mc-line mc-tp mc-drag" style={{ top: '12%' }}>
                <i aria-hidden="true">⠿</i>
                <span>TP2 · $700K</span>
              </div>
              <div class="mc-line mc-tp" style={{ top: '27%' }}>
                <span>TP1 · $600K</span>
              </div>
              <div class="mc-line mc-sl" style={{ top: '90%' }}>
                <span>SL · $210K</span>
              </div>
              <div class="mc-ask">
                <p>
                  Move TP2 to <b>$700K</b> MC?
                </p>
                <span class="mc-btn mc-btn-go">Move</span>
                <span class="mc-btn">Put back</span>
              </div>
            </div>
          </article>

          <article class="cell c-7">
            <p class="cell-label">Chat</p>
            <h3>Or just type it</h3>
            <p>“sell 50% at 2x”, “sl half at 600k”, “buy $5 at 500k mcap”. Read on your computer, sent nowhere. Tippy answers with a card, and nothing happens until you tap it.</p>
            <a class="cell-go" href="/demo#chat">
              Type one in the demo <span aria-hidden="true">→</span>
            </a>
            <div class="chat art" role="img" aria-label="Chat example: you type 'sl half at 350k'; Tippy answers with a card to add a stop that sells 50% at $350K, with Add it and Cancel buttons">
              <p class="chat-me">sl half at 350k</p>
              <div class="chat-card">
                <p>
                  Add a stop on <b>$BONKLE</b>: sell 50% if it drops to <b>$350K</b> MC (<em class="down">−15.0%</em> from now).
                </p>
                <div>
                  <span class="mc-btn mc-btn-go">Add it</span>
                  <span class="mc-btn">Cancel</span>
                </div>
              </div>
            </div>
          </article>

          <article class="cell c-5">
            <p class="cell-label">Fill notifications</p>
            <h3>Know the moment an order fills</h3>
            <p>A pop-up on fomo, plus an optional desktop notification and Telegram message. If Tippy stops watching, your Telegram alerts tell you.</p>
            <a class="cell-go" href="/demo#alerts">
              Turn alerts on in the demo <span aria-hidden="true">→</span>
            </a>
            <div class="notes art" role="img" aria-label="Two example notifications: a pop-up on fomo saying Tippy filled an order, and a Telegram message saying Tippy stopped watching">
              <div class="note note-good">
                <span class="note-ch">On fomo</span>
                <b>Tippy filled an order</b>
                <span>Sold 50% of $BONKLE at $600K MC (take profit 1).</span>
              </div>
              <div class="note note-warn">
                <span class="note-ch">Telegram</span>
                <b>Tippy stopped watching your 3 guarded coins</b>
                <span>Your computer may be asleep or the browser closed.</span>
              </div>
            </div>
          </article>

          <article class="cell c-12 presets">
            <div class="presets-copy">
              <p class="cell-label">Presets &amp; Auto-guard</p>
              <h3>Your plans, one tap away</h3>
              <p>Three presets sit in Tippy’s window as P1, P2 and P3. Change them in settings. Turn on Auto-guard and your starred preset goes on every new buy — even one made on your phone. Practise first with Dry run: Tippy does everything but press the button.</p>
              <a class="cell-go" href="/demo#settings">
                Open the settings in the demo <span aria-hidden="true">→</span>
              </a>
            </div>
            <div class="presets-art art" role="img" aria-label="Three presets — Play it safe, Classic (starred for Auto-guard) and Moon bag — and the Auto-guard and Dry run switches">
              <div class="pz">
                <span class="pz-k">P1</span>
                <b>Play it safe</b>
                <span>2x 100% · SL −20%</span>
              </div>
              <div class="pz pz-on">
                <span class="pz-k">P2</span>
                <b>Classic</b>
                <span>2x 50% · 5x 25% · SL −30%</span>
                <em>★ Auto-guard</em>
              </div>
              <div class="pz">
                <span class="pz-k">P3</span>
                <b>Moon bag</b>
                <span>3x · 10x · trail 25%</span>
              </div>
              <div class="pz-sw">
                <span>
                  Auto-guard new buys <i class="state state-on">On</i>
                </span>
                <span>
                  Dry run <i class="state state-off">Off</i>
                </span>
              </div>
            </div>
          </article>
        </div>
        <p class="chains">
          Works on every chain fomo trades on the web <span>Solana</span>
          <span>Base</span>
          <span>BNB Chain</span>
          <span>Monad</span>
          <span>Robinhood Chain</span>
        </p>
      </div>
    </section>
  );
}

render(
  <Page current="features">
    <PageHead eyebrow="Features" title="Every order, at the market cap you pick" lead="Before you add anything, Tippy shows the market cap, the move from now and your gain or loss. Sells and buys go through fomo’s own buttons.">
      <DemoButton />
    </PageHead>
    <Bento />
    <NextPage from="features" />
  </Page>,
  document.getElementById('app')!,
);
