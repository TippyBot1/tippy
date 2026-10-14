// Shared page chrome for tippybot.fun: nav, footer, page headings, the install
// button and icons. Every page is its own HTML file; the nav marks where you are.
import type { ComponentChildren } from 'preact';
import { EMAIL, GITHUB_URL, STORE_LIVE, STORE_URL } from './links';

export type PageId = 'home' | 'how' | 'features' | 'demo' | 'safety' | 'faq' | 'privacy';

/** The site's pages in reading order: the nav, the footer and the "Next" links all use it. */
export const PAGES: { id: Exclude<PageId, 'home' | 'privacy'>; href: string; label: string; blurb: string }[] = [
  { id: 'how', href: '/how', label: 'How it works', blurb: 'Add it, open a coin, type a level.' },
  { id: 'features', href: '/features', label: 'Features', blurb: 'Every order type, chat, chart lines and alerts.' },
  { id: 'demo', href: '/demo', label: 'Demo', blurb: 'Use Tippy on a pretend coin page laid out like fomo.' },
  { id: 'safety', href: '/safety', label: 'Safety', blurb: 'What Chrome asks, and what Tippy can’t do.' },
  { id: 'faq', href: '/faq', label: 'FAQ', blurb: 'Laptop asleep, slippage, phones, cost.' },
];

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
 * not a button: outlined, no fill, nothing to click.
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

export function GitHubButton() {
  return (
    <a class="pill pill-ghost" href={GITHUB_URL} target="_blank" rel="noopener">
      <GitHubGlyph /> GitHub <Arrow />
    </a>
  );
}

/** The demo is the one place to try Tippy; until the store listing is live it's the main action. */
export function DemoButton({ primary = true }: { primary?: boolean }) {
  return (
    <a class={`pill ${primary ? 'pill-primary' : 'pill-ghost'}`} href="/demo">
      Try the demo <span aria-hidden="true">→</span>
    </a>
  );
}

export function Ctas() {
  return STORE_LIVE ? (
    <div class="ctas">
      <InstallCta />
      <DemoButton primary={false} />
    </div>
  ) : (
    <div class="ctas">
      <DemoButton />
      <GitHubButton />
      <InstallCta />
    </div>
  );
}

export function Nav({ current }: { current: PageId }) {
  return (
    <header class="nav">
      <div class="wrap nav-in">
        <a class="brand" href="/" aria-label="Tippy, home" aria-current={current === 'home' ? 'page' : undefined}>
          <img src="/favicon.svg" alt="" width="24" height="24" />
          <span class="brand-word">tippy</span>
          <span class="brand-tag">for fomo</span>
        </a>
        <nav class="nav-links" aria-label="Pages">
          {PAGES.map((p) => (
            <a key={p.id} href={p.href} class={p.id === 'demo' ? 'nav-demo' : undefined} aria-current={current === p.id ? 'page' : undefined}>
              {p.label}
            </a>
          ))}
        </nav>
        <details class="nav-menu">
          <summary aria-label="Menu">
            <span aria-hidden="true" />
          </summary>
          <nav aria-label="Pages">
            {PAGES.map((p) => (
              <a key={p.id} href={p.href} aria-current={current === p.id ? 'page' : undefined}>
                {p.label}
              </a>
            ))}
            <a href={GITHUB_URL} target="_blank" rel="noopener">
              GitHub <Arrow />
            </a>
          </nav>
        </details>
        <a class="pill pill-ghost pill-sm nav-gh" href={GITHUB_URL} target="_blank" rel="noopener">
          <GitHubGlyph /> GitHub
        </a>
      </div>
    </header>
  );
}

export function Footer() {
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
          {PAGES.map((p) => (
            <a key={p.id} href={p.href}>
              {p.label}
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

/** Every page: skip link, nav, the page, footer. */
export function Page({ current, children, class: cls }: { current: PageId; children: ComponentChildren; class?: string }) {
  return (
    <div class={`site${cls ? ` ${cls}` : ''}`}>
      <a class="skip" href="#main">
        Skip to content
      </a>
      <Nav current={current} />
      <main id="main">{children}</main>
      <Footer />
    </div>
  );
}

/** An inner page's heading: one h1, a lead, an optional aside on the right. */
export function PageHead({ eyebrow, title, lead, children }: { eyebrow: string; title: ComponentChildren; lead: ComponentChildren; children?: ComponentChildren }) {
  return (
    <header class="page-head">
      <div class="wrap page-head-in">
        <div>
          <p class="eyebrow">{eyebrow}</p>
          <h1>{title}</h1>
          <p class="page-lead">{lead}</p>
        </div>
        {children && <div class="page-head-aside">{children}</div>}
      </div>
    </header>
  );
}

/** The bottom of an inner page: on to the next one, so the site reads in order. */
export function NextPage({ from }: { from: PageId }) {
  const i = PAGES.findIndex((p) => p.id === from);
  const next = PAGES[i + 1];
  if (!next) return null;
  return (
    <nav class="next-page" aria-label="Next page">
      <div class="wrap">
        <a href={next.href}>
          <span class="next-k">Next</span>
          <b>
            {next.label} <span aria-hidden="true">→</span>
          </b>
          <span class="next-blurb">{next.blurb}</span>
        </a>
      </div>
    </nav>
  );
}
