import { render } from 'preact';
import '../site.css';
import { DemoButton, NextPage, Page, PageHead } from '../layout';

/** What Tippy does, in order, when one of your levels is hit. */
const FIRES: [string, string][] = [
  ['It sees the price', 'Tippy reads the coin’s price from your logged-in fomo tab every few seconds, the same way fomo’s page does.'],
  ['It checks again', 'Right before it acts, Tippy re-reads the price and your balance, so it never sells twice or sells coins you already sold yourself.'],
  ['It presses fomo’s button', 'In a fomo tab, Tippy picks Sell (or Buy), enters the amount and presses fomo’s own button. It’s a market order, the same one you’d place.'],
  ['It confirms and tells you', 'Tippy checks your balance changed, then shows a pop-up on fomo — and on your phone too, if you’ve linked Telegram.'],
];

function Steps() {
  return (
    <section class="section section-how" aria-label="Three steps">
      <div class="wrap">
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

function WhenItFires() {
  return (
    <section class="section" aria-labelledby="fires-h">
      <div class="wrap split">
        <div class="split-l">
          <h2 id="fires-h">When a level hits</h2>
          <p>Everything happens in your browser, with fomo’s own buttons. No server holds your coins, your login or your orders.</p>
        </div>
        <ol class="fires">
          {FIRES.map(([t, d], i) => (
            <li key={t}>
              <span class="step-n">{i + 1}</span>
              <div>
                <h3>{t}</h3>
                <p>{d}</p>
              </div>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

function Awake() {
  return (
    <section class="section" aria-labelledby="awake-h">
      <div class="wrap">
        <div class="awake">
          <div class="awake-state" aria-hidden="true">
            <span class="awake-k">
              <i class="awake-led" />
              Keep awake
            </span>
            <b>On</b>
            <small>while orders are on</small>
          </div>
          <div class="awake-copy">
            <p class="cell-label">Good to know</p>
            <h2 id="awake-h">It only trades while your computer is awake</h2>
            <p>
              Tippy runs in Chrome on your machine, so orders fire only while the computer is on and Chrome is open. While you have orders on, Tippy keeps the computer from sleeping — on a laptop, leave the lid open. If it was off when a level hit, a stop sells when Tippy is back, at that moment’s price, and a take profit only sells if the price is still there.
            </p>
            <p>
              Link Telegram in Tippy’s settings and your phone hears about it if Tippy stops watching. <a href="/demo#setup">See the setup screen in the demo</a>.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

render(
  <Page current="how">
    <PageHead eyebrow="How it works" title="Three steps, no account" lead="No wallet to connect and nothing to sign up for. Tippy uses the fomo session you’re already logged in with.">
      <DemoButton />
    </PageHead>
    <Steps />
    <WhenItFires />
    <Awake />
    <NextPage from="how" />
  </Page>,
  document.getElementById('app')!,
);
