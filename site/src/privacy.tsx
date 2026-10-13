import { render } from 'preact';
import '@ext/ui/tippy.css';
import './site.css';
import { Mascot } from '@ext/ui/Mascot';


function Privacy() {
  return (
    <div class="tippy site" data-theme="dark">
      <nav class="nav">
        <a class="brand" href="/">
          <Mascot mood="idle" size={34} />
          <span>tippy</span>
        </a>
      </nav>
      <main class="doc">
        <h1>Privacy</h1>
        <p>Short version: Tippy runs on your computer. Your plans and settings stay there. Tippy never sees your keys and never sends anything about your fomo account to us.</p>

        <h2>What stays on your computer</h2>
        <ul>
          <li>Your take-profit / stop-loss plans, presets and settings (in your browser's extension storage).</li>
          <li>Your fomo session. Tippy reads it only inside your own fomo.family tab, to ask fomo's own servers for prices and balances — exactly like fomo's page does. It is never copied anywhere else.</li>
        </ul>

        <h2>What Tippy sends, and only if you turn it on</h2>
        <ul>
          <li>
            <b>Telegram alerts (optional).</b> When something happens, Tippy sends a short message (for example “Sold 50% of $WIF at 2x, $41”) plus a random link ID to
            alerts.tippybot.fun, which forwards it to your Telegram chat. We store that link ID, your Telegram chat ID, and when we last heard from Tippy (so we can warn
            you if it stops watching). Type /stop to the bot or tap Disconnect to delete the link.
          </li>
          <li>
            <b>Safety status.</b> Every 30 minutes Tippy downloads tippybot.fun/status.json — a tiny public file that can pause Tippy for everyone if fomo changes
            something. Nothing about you is sent.
          </li>
        </ul>

        <h2>What Tippy never does</h2>
        <ul>
          <li>Ask for, read or store your private key, seed phrase or password.</li>
          <li>Connect to your wallet or sign anything outside fomo.</li>
          <li>Run on any site other than fomo.family.</li>
          <li>Use analytics, ads or trackers, or sell data.</li>
        </ul>

        <h2>Not affiliated with fomo</h2>
        <p>Tippy is an independent open-source project. fomo's own privacy policy covers your fomo account.</p>

        <h2>Contact</h2>
        <p>hello@tippybot.fun</p>
        <p>
          <small>Last updated October 2026.</small>
        </p>
      </main>
    </div>
  );
}

render(<Privacy />, document.getElementById('app')!);
