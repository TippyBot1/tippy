import { render } from 'preact';
import './site.css';
import { Footer, Nav } from './layout';
import { EMAIL, GITHUB_URL } from './links';

function Privacy() {
  return (
    <div class="site">
      <a class="skip" href="#main">
        Skip to content
      </a>
      <Nav home={false} />
      <main id="main" class="doc">
        <div class="wrap">
          <header class="doc-head">
            <p class="eyebrow">Privacy</p>
            <h1>What Tippy keeps, sends and never touches.</h1>
            <p class="doc-lead">Short version: Tippy runs on your computer. Your orders and settings stay there. Tippy never sees your keys, and nothing about your fomo account is sent to us unless you turn on Telegram alerts.</p>
            <dl class="doc-meta">
              <div>
                <dt>Last updated</dt>
                <dd>October 2026</dd>
              </div>
              <div>
                <dt>Analytics</dt>
                <dd>None</dd>
              </div>
              <div>
                <dt>Contact</dt>
                <dd>
                  <a href={`mailto:${EMAIL}`}>{EMAIL}</a>
                </dd>
              </div>
            </dl>
          </header>

          <section class="doc-row">
            <h2>What stays on your computer</h2>
            <ul>
              <li>Your take-profit, stop-loss and limit-buy orders, presets and settings, in your browser’s extension storage.</li>
              <li>Your fomo session. Tippy reads it only inside your own fomo.family tab, to ask fomo’s own servers for prices and balances — exactly like fomo’s page does. It is never copied anywhere else.</li>
            </ul>
          </section>

          <section class="doc-row">
            <h2>What Tippy sends, and only if you turn it on</h2>
            <ul>
              <li>
                <b>Telegram alerts (optional).</b> When something happens, Tippy sends a short message (for example “Sold 50% of $WIF at 2x, $41”) plus a random link ID to alerts.tippybot.fun, which forwards it to your Telegram chat. While it’s linked, Tippy also checks in every two minutes with how many orders you have on. We store that link ID, your Telegram chat ID, how many orders you have on, and when we last heard from Tippy (so we can warn you if it stops watching). Type /stop to the bot or tap Disconnect to delete the link.
              </li>
              <li>
                <b>Safety status.</b> Every 30 minutes Tippy downloads tippybot.fun/status.json — a tiny public file that can pause Tippy for everyone if fomo changes something. Nothing about you is sent.
              </li>
            </ul>
          </section>

          <section class="doc-row">
            <h2>What Tippy never does</h2>
            <ul>
              <li>Ask for, read or store your private key, seed phrase or password.</li>
              <li>Connect to your wallet or sign anything outside fomo.</li>
              <li>Run on any site other than fomo.family.</li>
              <li>Use analytics, ads or trackers, or sell data.</li>
            </ul>
          </section>

          <section class="doc-row">
            <h2>This website</h2>
            <ul>
              <li>These pages carry no analytics or tracking code, and the fonts are served from tippybot.fun itself.</li>
              <li>The demo runs entirely in your browser on a pretend coin. Nothing you type into it leaves the page.</li>
            </ul>
          </section>

          <section class="doc-row">
            <h2>Not affiliated with fomo</h2>
            <ul>
              <li>Tippy is an independent open-source project. fomo’s own privacy policy covers your fomo account.</li>
            </ul>
          </section>

          <section class="doc-row">
            <h2>Contact</h2>
            <ul>
              <li>
                Questions or requests: <a href={`mailto:${EMAIL}`}>{EMAIL}</a>. The code is public on{' '}
                <a href={GITHUB_URL} target="_blank" rel="noopener">
                  GitHub
                </a>
                .
              </li>
            </ul>
          </section>
        </div>
      </main>
      <Footer home={false} />
    </div>
  );
}

render(<Privacy />, document.getElementById('app')!);
