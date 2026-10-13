// Shared page chrome for tippybot.fun: nav, footer, the install button and icons.
import { EMAIL, GITHUB_URL, STORE_LIVE, STORE_URL } from './links';

export function Arrow() {
  return (
    <svg class="ico-arrow" width="11" height="11" viewBox="0 0 12 12" aria-hidden="true">
      <path d="M3.5 8.5l5-5M4.5 3.5h4v4" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
    </svg>
  );
}

export function GitHubGlyph() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" aria-hidden="true">
      <path
        fill="currentColor"
        d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"
      />
    </svg>
  );
}

/**
 * The store call to action. Until the listing is live (links.ts) it is a status,
 * not a button: outlined, no fill, nothing to click. GitHub is the action then.
 */
export function InstallCta() {
  if (!STORE_LIVE) {
    return (
      <p class="store-status">
        <span class="soon-dot" aria-hidden="true" />
        <span>
          Coming soon to the <b>Chrome Web Store</b>
        </span>
      </p>
    );
  }
  return (
    <a class="pill pill-primary" href={STORE_URL} target="_blank" rel="noopener">
      Add to Chrome — it’s free <Arrow />
    </a>
  );
}

export function GitHubButton({ primary = false }: { primary?: boolean }) {
  return (
    <a class={`pill ${primary ? 'pill-primary' : 'pill-ghost'}`} href={GITHUB_URL} target="_blank" rel="noopener">
      <GitHubGlyph /> {primary ? 'Read the code on GitHub' : 'GitHub'} <Arrow />
    </a>
  );
}

/** The hero and closing buttons: the store first once it's live; until then GitHub is the one real action. */
export function Ctas() {
  return STORE_LIVE ? (
    <div class="ctas">
      <InstallCta />
      <GitHubButton />
    </div>
  ) : (
    <div class="ctas">
      <GitHubButton primary />
      <InstallCta />
    </div>
  );
}

const SECTIONS: [string, string][] = [
  ['how', 'How it works'],
  ['features', 'Features'],
  ['demo', 'Demo'],
  ['safety', 'Safety'],
  ['faq', 'FAQ'],
];

export function Nav({ home }: { home: boolean }) {
  const to = (id: string) => (home ? `#${id}` : `/#${id}`);
  return (
    <header class="nav">
      <div class="wrap nav-in">
        <a class="brand" href={home ? '#top' : '/'} aria-label="Tippy, home">
          <img src="/favicon.svg" alt="" width="24" height="24" />
          <span class="brand-word">tippy</span>
          <span class="brand-tag">for fomo</span>
        </a>
        <nav class="nav-links" aria-label="Sections">
          {SECTIONS.map(([id, label]) => (
            <a key={id} href={to(id)}>
              {label}
            </a>
          ))}
        </nav>
        <nav class="nav-short" aria-label="Jump to">
          <a href={to('demo')}>Demo</a>
          <a href={to('faq')}>FAQ</a>
        </nav>
        <a class="pill pill-ghost pill-sm" href={GITHUB_URL} target="_blank" rel="noopener">
          <GitHubGlyph /> GitHub
        </a>
      </div>
    </header>
  );
}

export function Footer({ home }: { home: boolean }) {
  const to = (id: string) => (home ? `#${id}` : `/#${id}`);
  return (
    <footer class="footer">
      <div class="wrap foot-grid">
        <div class="foot-brand">
          <a class="brand" href="/" aria-label="Tippy, home">
            <img src="/favicon.svg" alt="" width="22" height="22" />
            <span class="brand-word">tippy</span>
          </a>
          <p>Take profit, stop loss and limit buys for fomo, from a Chrome extension that never asks for your keys.</p>
        </div>
        <div class="foot-col">
          <p class="foot-h">Product</p>
          {SECTIONS.map(([id, label]) => (
            <a key={id} href={to(id)}>
              {label}
            </a>
          ))}
        </div>
        <div class="foot-col">
          <p class="foot-h">Project</p>
          <a href={GITHUB_URL} target="_blank" rel="noopener">
            GitHub
          </a>
          <a href="/privacy">Privacy</a>
          <a href={`mailto:${EMAIL}`}>{EMAIL}</a>
        </div>
        <p class="foot-risk">Memecoins are extremely risky and can go to zero. Tippy is a tool, not financial advice.</p>
      </div>
      <div class="wrap foot-base">
        <span>© {new Date().getFullYear()} Tippy · MIT licensed</span>
        <span>Tippy is an independent project and is not affiliated with or endorsed by fomo.</span>
      </div>
    </footer>
  );
}
