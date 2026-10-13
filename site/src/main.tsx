import { render } from 'preact';
import '@ext/ui/tippy.css';
import '@ext/ui/window.css';
import './site.css';
import { Demo } from './Demo';
import { HeroStage } from './HeroStage';
import { Ctas, Footer, Nav } from './layout';
import { EMAIL, GITHUB_URL, STORE_LIVE } from './links';

const Tri = ({ dir }: { dir: 'up' | 'down' }) => <i class={`tri tri-${dir}`} aria-hidden="true" />;

function Hero() {
  return (
    <section class="hero" id="top">
      <div class="wrap hero-grid">
        <div class="hero-copy">
          <p class="kicker">
            <span class="dot" aria-hidden="true" />
            Chrome extension for fomo
            <span class="k-long">
              <span class="sep" aria-hidden="true">
                ·
              </span>
              free and open source
            </span>
          </p>
          <h1>
            Set the exit
            <br />
            before you need&nbsp;it.
          </h1>
          <p class="lead">Take profit, stop loss and limit buys at any market cap. Tippy watches the coin from your logged-in fomo tab and presses fomo’s own Buy and Sell buttons when your level hits.</p>
          <Ctas />
          <p class="cta-note">
            For Chrome, Brave and Edge on a computer. Tippy trades while that computer is awake and Chrome is open. Independent — not affiliated with fomo.
          </p>
        </div>
        <HeroStage />
        <dl class="spec">
          <div>
            <dt>Keys asked for</dt>
            <dd class="num">0</dd>
          </div>
          <div>
            <dt>Site access</dt>
            <dd>
              <span class="num">1</span> <small>fomo.family</small>
            </dd>
          </div>
          <div>
            <dt>Wallet connect</dt>
            <dd>None</dd>
          </div>
          <div>
            <dt>Price</dt>
            <dd>
              Free <small>no token</small>
            </dd>
          </div>
        </dl>
      </div>
    </section>
  );
}

/** How it works: a quiet three-column strip, no display headline. */
function How() {
  return (
    <section class="section section-how" id="how" aria-labelledby="how-h">
      <div class="wrap how">
        <div class="how-intro">
          <h2 id="how-h">How it works</h2>
          <p>No account, no wallet, no sign-up. Tippy uses the fomo session you’re already logged in with.</p>
        </div>
        <ol class="steps">
          <li>
            <span class="step-n">1</span>
            <h3>Add Tippy to Chrome</h3>
            <p>From the Chrome Web Store, once the listing is live. Chrome asks for one thing: access to fomo.family.</p>
            <code class="readout">
              <i>asks for</i> fomo.family <i>only</i>
            </code>
          </li>
          <li>
            <span class="step-n">2</span>
            <h3>Open a coin on fomo</h3>
            <p>Log in to fomo.family like you always do. Tippy’s window opens beside the coin with your bag, your cash and the market cap now.</p>
            <code class="readout">
              $BONKLE <b>$412K</b> <i>· bag</i> $103
            </code>
          </li>
          <li>
            <span class="step-n">3</span>
            <h3>Type a level, tap once</h3>
            <p>Above the price it’s a take profit, below it’s a stop. When a level hits, Tippy presses fomo’s Sell or Buy button for you.</p>
            <code class="readout">
              <i>sell 25% at</i> <b>$1M</b> <i>→</i> <em class="up">watching</em>
            </code>
          </li>
        </ol>
      </div>
    </section>
  );
}

const SETTINGS: [string, 'on' | 'off', string][] = [
  ['Keep computer awake', 'on', 'Stops the computer sleeping while you have orders on.'],
  ['Fill alerts', 'on', 'A pop-up on fomo. Desktop and Telegram alerts too, if you turn them on.'],
  ['Lines on fomo’s chart', 'on', 'Every order as a dashed line. Drag one to move it — Tippy asks first.'],
  ['Dry run', 'off', 'Practise: Tippy walks through each trade and stops before pressing Buy or Sell.'],
  ['Auto-guard new buys', 'off', 'Your preset take profit and stop on every new buy, even ones made on your phone.'],
  ['Trailing stop', 'off', 'Follows the price up and sells if it drops from the top. Turn it on in settings.'],
];

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

function Features() {
  return (
    <section class="section" id="features">
      <div class="wrap">
        <header class="feat-head">
          <h2>Every order, at the market cap you pick</h2>
          <p>Above the price it’s a take profit, below it’s a stop, and buys work the same way. Before you add anything you see the market cap, the move from now and your gain or loss.</p>
        </header>

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

          <article class="cell c-12 awake">
            <div class="awake-state" aria-hidden="true">
              <span class="awake-k">
                <i class="awake-led" />
                Keep awake
              </span>
              <b>On</b>
              <small>while orders are on</small>
            </div>
            <div class="awake-copy">
              <p class="cell-label">Keep-awake</p>
              <h3>It only trades while your computer is awake</h3>
              <p>Tippy runs in Chrome on your machine — no server holds your coins or your login. So orders fire only while the computer is on and Chrome is open. While you have orders on, Tippy keeps the computer from sleeping. On a laptop, leave the lid open.</p>
            </div>
          </article>

          <article class="cell c-12 sets">
            <div class="sets-head">
              <p class="cell-label">Settings</p>
              <h3>The switches, and how they ship</h3>
              <p class="chains">
                Chains <span>Solana</span>
                <span>Base</span>
                <span>BNB Chain</span>
                <span>Monad</span>
                <span>Robinhood Chain</span>
              </p>
            </div>
            <dl class="sets-list">
              {SETTINGS.map(([name, state, text]) => (
                <div key={name}>
                  <dt>
                    {name}
                    <span class={`state state-${state}`}>{state === 'on' ? 'On' : 'Off'}</span>
                  </dt>
                  <dd>{text}</dd>
                </div>
              ))}
            </dl>
          </article>
        </div>
      </div>
    </section>
  );
}

function DemoSection() {
  return (
    <section class="section section-demo" id="demo">
      <div class="wrap">
        <header class="demo-head">
          <p class="live">
            <span class="live-dot" aria-hidden="true" />
            Live demo <span class="live-sep">·</span> dry run, pretend money
          </p>
          <h2>Try it on a pretend coin</h2>
          <p class="demo-lead">Tippy’s real order engine, window and chat, running in this page. $DEMO opens with a few orders on. Add your own or tap a phrase to type it into the chat, then pump or dump the price. Nothing here touches fomo.</p>
        </header>
        <Demo />
      </div>
    </section>
  );
}

function Safety() {
  return (
    <section class="section section-safety" id="safety" aria-labelledby="safety-h">
      <div class="wrap safety">
        <figure class="perm">
          <figcaption class="perm-label">What Chrome asks when you add Tippy</figcaption>
          <div class="perm-ask">
            <p class="perm-top">
              <img src="/favicon.svg" alt="" width="26" height="26" />
              Add “Tippy”?
            </p>
            <p class="perm-it">It can:</p>
            <blockquote>Read and change your data on fomo.family</blockquote>
          </div>
          <dl class="perm-table">
            <div>
              <dt>Sites it can open</dt>
              <dd>fomo.family</dd>
            </div>
            <div>
              <dt>Other websites</dt>
              <dd>No access</dd>
            </div>
            <div>
              <dt>Keys &amp; seed phrase</dt>
              <dd>Never asked for</dd>
            </div>
            <div>
              <dt>Account</dt>
              <dd>None to create</dd>
            </div>
            <div>
              <dt>Desktop alerts</dt>
              <dd>Asked separately, if you turn them on</dd>
            </div>
          </dl>
        </figure>
        <div class="safety-r">
          <h2 id="safety-h">What Tippy can and can’t do</h2>
          <p class="safety-lead">Tippy can only do what you could do yourself in your fomo tab: press fomo’s buttons. It never holds funds and never sees a key.</p>
          <dl class="facts">
            <div>
              <dt>Private key or seed phrase</dt>
              <dd>
                <b>Never asked.</b> Anything that asks for one is a scam.
              </dd>
            </div>
            <div>
              <dt>Wallet connection</dt>
              <dd>
                <b>None.</b> Tippy presses fomo’s own buttons in your logged-in tab.
              </dd>
            </div>
            <div>
              <dt>Site access</dt>
              <dd>
                <b>fomo.family only.</b> It’s the one line Chrome shows when you add Tippy. Storage, alarms and keep-awake need no warning and can’t see other sites.
              </dd>
            </div>
            <div>
              <dt>Your fomo session</dt>
              <dd>
                <b>Stays in your tab.</b> Prices are read the way fomo’s page reads them. Nothing about your account is sent to us — unless you turn on Telegram alerts, which pass short fill messages to your chat.
              </dd>
            </div>
            <div>
              <dt>Tracking</dt>
              <dd>
                <b>None.</b> No analytics, no ads, no data sold.
              </dd>
            </div>
            <div>
              <dt>Source code</dt>
              <dd>
                <b>Open, MIT licensed.</b> Read every line on{' '}
                <a href={GITHUB_URL} target="_blank" rel="noopener">
                  GitHub
                </a>
                .
              </dd>
            </div>
            <div>
              <dt>Where to install</dt>
              <dd>
                <b>Only the official Chrome Web Store.</b> Never a ZIP file, never a link in a DM.
              </dd>
            </div>
          </dl>
        </div>
      </div>
    </section>
  );
}

const FAQ: [string, string][] = [
  [
    'Does Tippy trade when my computer is off?',
    'No. Tippy runs in Chrome on your computer, so it can only buy or sell while the computer is awake and Chrome is open. While you have orders on, it keeps the computer from sleeping — on a laptop, leave the lid open. If it was off when a level was hit, a stop sells when Tippy is back, at that moment’s price, and a take profit only sells if the price is still there. If you link Telegram alerts, they tell you when Tippy stops watching.',
  ],
  ['Will my stop always fill at my price?', 'No bot can promise that. Sells are market orders through fomo’s own Sell button, so in a fast dump or a thin pool the fill can land below your level. Tippy shows the price impact and lets you set limits on it.'],
  ['Can I try it without trading?', 'Yes. Turn on Dry run — the flask switch at the bottom of Tippy’s window — and Tippy walks through each order but stops before pressing Buy or Sell. A practice run goes one step further: it walks through a real sell or buy on fomo and stops right before the final button. Or use the demo on this page, which never touches fomo.'],
  ['Does it work on my phone?', 'Tippy runs on your computer, in Chrome, Brave or Edge, while you’re logged in to fomo.family. You can still trade on your phone — Tippy sees those coins too, and Telegram alerts land on your phone.'],
  ['Can a limit buy spend more than I set?', 'No. Each limit buy spends only the amount you choose, once. If Tippy can’t confirm a buy went through, it stops and asks you instead of trying again. It also won’t chase a coin that pumped way past your level, or catch one that crashed straight through it.'],
  [
    'When can I install it?',
    STORE_LIVE
      ? 'Now, from the Chrome Web Store. Install it only from the official listing — never from a ZIP file or a link someone sends you.'
      : 'Soon. Tippy is waiting on its Chrome Web Store listing; until then the code is on GitHub. When it’s live, install it only from the official listing — never from a ZIP file or a link someone sends you.',
  ],
  ['Is Tippy made by fomo?', 'No. Tippy is an independent, open-source project and isn’t affiliated with or endorsed by fomo. If fomo changes its app, Tippy pauses safely instead of guessing.'],
  ['What does it cost?', 'Nothing. Tippy is free — no token, no subscription, no fees on your trades.'],
  ['Which chains?', 'Everything fomo trades on the web: Solana, Base, BNB Chain, Monad and Robinhood Chain.'],
];

function Faq() {
  return (
    <section class="section section-faq" id="faq" aria-labelledby="faq-h">
      <div class="wrap faq">
        <div class="faq-l">
          <h2 id="faq-h">Questions</h2>
          <p>
            Something missing? <a href={`mailto:${EMAIL}`}>{EMAIL}</a>
          </p>
        </div>
        <div class="faq-list">
          {FAQ.map(([q, a], i) => (
            <details key={q} open={i === 0}>
              <summary>{q}</summary>
              <p>{a}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}

function Final() {
  return (
    <section class="final" aria-labelledby="final-h">
      <div class="wrap final-in">
        <div class="final-copy">
          <p class="build">v0.1.0 · Chrome, Brave, Edge · MIT licence</p>
          <h2 id="final-h">Tippy is free and open source</h2>
          <p class="final-text">{STORE_LIVE ? 'Install it from the Chrome Web Store — the only official place to get it.' : 'The Chrome Web Store listing is on its way. Until then, every line of the code is on GitHub.'}</p>
        </div>
        <Ctas />
      </div>
    </section>
  );
}

function App() {
  return (
    <div class="site">
      <a class="skip" href="#main">
        Skip to content
      </a>
      <Nav home />
      <main id="main">
        <Hero />
        <How />
        <Features />
        <DemoSection />
        <Safety />
        <Faq />
        <Final />
      </main>
      <Footer home />
    </div>
  );
}

render(<App />, document.getElementById('app')!);
