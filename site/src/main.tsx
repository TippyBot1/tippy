import { render } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import '@ext/ui/tippy.css';
import '@ext/ui/window.css';
import './site.css';
import { Mascot, type Mood } from '@ext/ui/Mascot';
import { Demo } from './Demo';
import { STORE_LIVE, STORE_URL, GITHUB_URL } from './links';

function InstallButton({ big = false }: { big?: boolean }) {
  if (!STORE_LIVE) {
    return (
      <span class={`cta cta-soon${big ? ' cta-big' : ''}`} aria-disabled="true">
        <ChromeGlyph /> Coming soon to the Chrome Web Store
      </span>
    );
  }
  return (
    <a class={`cta${big ? ' cta-big' : ''}`} href={STORE_URL} target="_blank" rel="noopener">
      <ChromeGlyph /> Add to Chrome — it's free
    </a>
  );
}

function ChromeGlyph() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="11" fill="currentColor" opacity="0.18" />
      <circle cx="12" cy="12" r="4.5" fill="currentColor" />
    </svg>
  );
}

const MOODS: Mood[] = ['watching', 'happy', 'watching', 'worried', 'watching', 'happy'];

function Hero() {
  const [i, setI] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setI((n) => (n + 1) % MOODS.length), 2600);
    return () => clearInterval(t);
  }, []);
  return (
    <header class="hero">
      <div class="hero-text">
        <span class="eyebrow">Free browser extension for fomo</span>
        <h1>
          Take profit &amp; stop loss,
          <br />
          <span class="mint">on autopilot.</span>
        </h1>
        <p class="lead">Tippy is a friendly little wizard bot that watches your fomo coins — selling when they hit your targets and buying the dips you pick — using fomo's own Buy and Sell buttons. No keys. No wallet connect.</p>
        <div class="hero-ctas">
          <InstallButton big />
          <a class="cta-ghost" href="#demo">
            Try the demo ↓
          </a>
        </div>
        <ul class="trust-row">
          <li>✓ Never asks for your keys</li>
          <li>✓ One permission: fomo.family</li>
          <li>✓ Open source</li>
          <li>✓ Tiny — under 200 KB download</li>
        </ul>
      </div>
      <div class="hero-bot" aria-hidden="true">
        <div class="hero-glow" />
        <Mascot mood={MOODS[i]} size={260} title="Tippy the robot" />
        <div class={`speech speech-${i}`}>
          {MOODS[i] === 'happy' ? 'Sold 50% at 2x! 🎉' : MOODS[i] === 'worried' ? 'Dipping… stop loss ready 🛟' : 'Watching your bags 👀'}
        </div>
      </div>
    </header>
  );
}

function How() {
  const steps = [
    { n: '1', t: 'Add Tippy to Chrome', d: "One click from the official Chrome Web Store. Nothing to download, nothing to sign." },
    { n: '2', t: 'Open a coin on fomo', d: 'Log in to fomo.family on your computer like normal and tap the little Tippy bubble.' },
    { n: '3', t: 'Pick a plan, tap Guard', d: '“Sell half at 2x, a quarter at 5x, stop at −30%.” Tippy watches and sells for you.' },
  ];
  return (
    <section class="section" id="how">
      <h2>Three taps. That's it.</h2>
      <div class="steps">
        {steps.map((s) => (
          <div class="step t-card" key={s.n}>
            <div class="step-n">{s.n}</div>
            <h3>{s.t}</h3>
            <p>{s.d}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

function Features() {
  const f = [
    { e: '🪜', t: 'Take-profit ladder', d: 'Sell a slice at each target — 2x, 5x, 10x — so you always take something home.' },
    { e: '🛟', t: 'Stop loss', d: 'Cuts losses when a coin turns. Ignores one-tick wicks so you don’t get shaken out.' },
    { e: '🧗', t: 'Trailing stop', d: 'Follows the price up and sells if it drops from the top. Ride runners, keep gains.' },
    { e: '🎯', t: 'Limit buys', d: 'Buy $10 when it dips to $1M market cap — or breaks out — then guard it with your take-profit and stop loss automatically.' },
    { e: '🛡️', t: 'Auto-guard', d: 'Save a preset once — Tippy attaches it to every new buy, even ones made on your phone.' },
    { e: '🧪', t: 'Practice runs', d: 'Watch Tippy walk through a real sell or buy on fomo and stop right before the final button. Test it with zero risk.' },
    { e: '📱', t: 'Phone alerts', d: 'A Telegram ping when Tippy sells, needs you, or stops watching because your laptop slept.' },
    { e: '⛓️', t: 'Every fomo chain', d: 'Solana, Base, BNB Chain, Monad and Robinhood Chain — if fomo trades it, Tippy guards it.' },
  ];
  return (
    <section class="section">
      <h2>Everything fomo's buttons can't do on their own</h2>
      <div class="features">
        {f.map((x) => (
          <div class="feature" key={x.t}>
            <div class="feature-e">{x.e}</div>
            <h3>{x.t}</h3>
            <p>{x.d}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

function Safety() {
  return (
    <section class="section safety" id="safety">
      <div class="safety-text">
        <h2>Boring about safety. On purpose.</h2>
        <ul class="checks">
          <li>
            <b>No keys, ever.</b> Tippy never asks for your private key, seed phrase or password. Anything that does is a scam.
          </li>
          <li>
            <b>No wallet connect.</b> Tippy works inside your own logged-in fomo tab and presses fomo's own buttons.
          </li>
          <li>
            <b>One permission.</b> Chrome will only say “Read and change your data on fomo.family”. Nothing else.
          </li>
          <li>
            <b>Your session stays in your tab.</b> Tippy reads prices the same way fomo's page does. Nothing about your account is sent to us.
          </li>
          <li>
            <b>Open source.</b> Every line is public. Install only from the official Chrome Web Store — never from a ZIP file or a DM.
          </li>
        </ul>
      </div>
      <div class="prompt-mock t-card" aria-label="What Chrome shows when you add Tippy">
        <div class="prompt-head">
          <Mascot mood="idle" size={40} />
          <b>Add “Tippy — take profit &amp; stop loss for fomo”?</b>
        </div>
        <p>It can:</p>
        <ul>
          <li>Read and change your data on fomo.family</li>
        </ul>
        <div class="prompt-btns">
          <span class="pb">Cancel</span>
          <span class="pb pb-primary">Add extension</span>
        </div>
        <small>That's the whole list.</small>
      </div>
    </section>
  );
}

function Faq() {
  const qs: [string, string][] = [
    ['Does Tippy work on my phone?', "Tippy runs on your computer, in Chrome, Brave or Edge, while you're logged in to fomo.family. You can still trade on your phone — Tippy sees those coins too, and Telegram alerts land on your phone."],
    ['What if my laptop goes to sleep?', "Your orders stay on until you turn them off, and Tippy keeps your computer awake while they are (leave a laptop's lid open). It can only sell while the computer is on and the browser is open: if it's off when a price is hit, a stop sells when Tippy is back — at that moment's price — and a take-profit only sells if the price is still there. If Tippy stops watching while you have orders on, it pings you on Telegram so you're never in the dark."],
    ['Will my stop loss always fill at my price?', "No bot can promise that. Tippy sells at market with fomo's own Sell button, so in a fast dump or a thin pool the fill can be lower than your stop. Tippy shows price impact and lets you set limits."],
    ['Can a limit buy spend more than I set?', "No. Each limit buy spends only the amount you choose, once. If Tippy can't confirm a buy went through, it stops and asks you instead of trying again. It also won't chase a coin that pumped way past your level, or catch one that crashed straight through it."],
    ['Is Tippy made by fomo?', "No. Tippy is an independent, open-source project and isn't affiliated with or endorsed by fomo. If fomo changes its app, Tippy pauses safely instead of guessing."],
    ['What does it cost?', 'Nothing. Tippy is free — no token, no subscription, no fees on your trades.'],
    ['Which chains?', 'Everything fomo trades on the web: Solana, Base, BNB Chain, Monad and Robinhood Chain.'],
  ];
  return (
    <section class="section faq" id="faq">
      <h2>Honest answers</h2>
      {qs.map(([q, a]) => (
        <details key={q}>
          <summary>{q}</summary>
          <p>{a}</p>
        </details>
      ))}
    </section>
  );
}

function App() {
  return (
    <div class="tippy site" data-theme="dark">
      <nav class="nav">
        <a class="brand" href="/">
          <Mascot mood="idle" size={34} />
          <span>tippy</span>
        </a>
        <div class="nav-links">
          <a href="#how">How it works</a>
          <a href="#safety">Safety</a>
          <a href="#faq">FAQ</a>
        </div>
      </nav>
      <Hero />
      <section class="section" id="demo">
        <h2>Try Tippy right here</h2>
        <p class="section-lead">Pick a plan, tap Guard, then pump or dump the pretend coin. This is the real Tippy brain — the same one in the extension.</p>
        <Demo />
      </section>
      <How />
      <Features />
      <Safety />
      <Faq />
      <section class="section final">
        <Mascot mood="happy" size={110} />
        <h2>Stop staring at charts.</h2>
        <p class="section-lead">Let Tippy watch them for you.</p>
        <InstallButton big />
      </section>
      <footer class="footer">
        <span>© {new Date().getFullYear()} Tippy · Free &amp; open source · Not affiliated with fomo</span>
        <span class="footer-links">
          <a href="/privacy">Privacy</a>
          <a href={GITHUB_URL} target="_blank" rel="noopener">
            Source code
          </a>
        </span>
        <small>Memecoins are extremely risky and can go to zero. Tippy is a tool, not financial advice.</small>
      </footer>
    </div>
  );
}

render(<App />, document.getElementById('app')!);
