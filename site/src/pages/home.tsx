import { render } from 'preact';
import { useRef, useState } from 'preact/hooks';
import '@ext/ui/tippy.css';
import '@ext/ui/window.css';
import '../site.css';
import { HeroShot } from '../HeroShot';
import { Ctas, Page } from '../layout';
import { STORE_LIVE } from '../links';

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
            For Chrome, Brave and Edge on a computer. Independent — not affiliated with fomo.
          </p>
        </div>
        <HeroShot />
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
              Free <small>no fees</small>
            </dd>
          </div>
        </dl>
      </div>
    </section>
  );
}

/** The 30-second promo: a poster with one big play button, then the browser's own controls. */
function Watch() {
  const video = useRef<HTMLVideoElement>(null);
  const [started, setStarted] = useState(false);
  return (
    <section class="section section-watch" aria-labelledby="watch-h">
      <div class="wrap watch">
        <div class="watch-copy">
          <p class="cell-label">Watch</p>
          <h2 id="watch-h">Tippy in 30 seconds</h2>
          <p>Set a take profit and a stop loss, type an order in plain words, and see Tippy sell the moment the price gets there.</p>
          <a class="pillar-go" href="/demo">
            Try it yourself in the demo <span aria-hidden="true">→</span>
          </a>
        </div>
        <div class={`watch-frame${started ? ' is-started' : ''}`}>
          <video
            ref={video}
            src="/media/tippy-promo.mp4"
            poster="/media/tippy-promo-poster.jpg"
            width={1920}
            height={1080}
            preload="metadata"
            playsInline
            controls={started}
            onPlay={() => setStarted(true)}
            aria-label="Tippy in 30 seconds: setting a take profit and stop loss, typing an order, and Tippy selling when the price hits (demo prices)"
          />
          {!started && (
            <button class="watch-play" onClick={() => void video.current?.play()} aria-label="Play the 30-second video">
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M8 5.5v13l10.5-6.5z" fill="currentColor" />
              </svg>
              <span>Play · 0:30</span>
            </button>
          )}
        </div>
      </div>
    </section>
  );
}

/** Three reasons, each a door to the page that goes deep on it. */
const PILLARS: { k: string; title: string; text: string; href: string; link: string }[] = [
  {
    k: 'Orders',
    title: 'The orders fomo doesn’t have',
    text: 'Take profits, partial stops, a stop loss and limit buys, at any market cap and any % of your bag. Set them in Tippy’s window or just type them.',
    href: '/features',
    link: 'All features',
  },
  {
    k: 'Safety',
    title: 'Nothing to connect, nothing to hand over',
    text: 'No wallet connect, no seed phrase, no account. Chrome asks for one thing — fomo.family — and Tippy presses fomo’s own buttons in your tab.',
    href: '/safety',
    link: 'What Tippy can’t do',
  },
  {
    k: 'Setup',
    title: 'Set up in two minutes',
    text: 'Add it to Chrome, open a coin on fomo, type a level. Tippy runs in Chrome on your computer and keeps it awake while orders are on.',
    href: '/how',
    link: 'How it works',
  },
];

function Pillars() {
  return (
    <section class="section section-pillars" aria-label="Why Tippy">
      <div class="wrap pillars">
        {PILLARS.map((p) => (
          <a class="pillar" href={p.href} key={p.k}>
            <span class="cell-label">{p.k}</span>
            <h2>{p.title}</h2>
            <p>{p.text}</p>
            <span class="pillar-go">
              {p.link} <span aria-hidden="true">→</span>
            </span>
          </a>
        ))}
      </div>
    </section>
  );
}

function Closing() {
  return (
    <section class="final" aria-labelledby="final-h">
      <div class="wrap final-in">
        <div class="final-copy">
          <p class="build">v{__TIPPY_VERSION__} · Chrome, Brave, Edge · MIT licence</p>
          <h2 id="final-h">Tippy is free and open source</h2>
          <p class="final-text">{STORE_LIVE ? 'Install it from the Chrome Web Store — the only official place to get it.' : 'The Chrome Web Store listing is on its way. Until then, every line of the code is on GitHub.'}</p>
        </div>
        <Ctas />
      </div>
    </section>
  );
}

// Links to the old one-page site (tippybot.fun/#safety) go to that section's page now.
const OLD = location.hash.slice(1);
if (['how', 'features', 'demo', 'safety', 'faq'].includes(OLD)) location.replace(`/${OLD}`);

render(
  <Page current="home">
    <Hero />
    <Watch />
    <Pillars />
    <Closing />
  </Page>,
  document.getElementById('app')!,
);
