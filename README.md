# Tippy 🤖

The orders fomo is missing — **take-profit, stop-loss and limit buys** — for [fomo](https://fomo.family) spot trades. Type a market cap, pick how much of your bag to sell, and Tippy presses fomo's own Sell button when the price gets there. Free, open source, no keys.

[![Tests](https://github.com/TippyBot1/tippy/actions/workflows/tests.yml/badge.svg)](https://github.com/TippyBot1/tippy/actions/workflows/tests.yml) [![Chrome Web Store](https://img.shields.io/chrome-web-store/v/jgcaoiflcddgcifdcighcioakpjhgdoj?label=Chrome%20Web%20Store)](https://chromewebstore.google.com/detail/jgcaoiflcddgcifdcighcioakpjhgdoj)

**Website:** https://tippybot.fun · **Install:** [Chrome Web Store](https://chromewebstore.google.com/detail/jgcaoiflcddgcifdcighcioakpjhgdoj) · **What's new:** [CHANGELOG.md](CHANGELOG.md) · **Roadmap:** [issues](https://github.com/TippyBot1/tippy/issues?q=label%3Aroadmap) · **Contact:** hello@tippybot.fun

Tippy is a browser extension that runs inside your own logged-in fomo.family tab. It needs no private keys, no wallet connection, and no server holding funds — which also means it only trades while your computer is awake and Chrome is open (it keeps the computer awake while your orders are on).

What it does:

- **Sell orders at any market cap, any % of your bag** — above the price it's a take-profit, below it's a stop (partial stops sell just their share; the stop loss sells the rest; wick protection on both)
- **Limit buys** at an exact market cap, optionally guarded by a take-profit / stop-loss preset once bought
- One Axiom-style order form (market cap ⇄ price, slider, % / $ amounts) and a single ladder of your orders
- **Chart lines** on fomo's chart; drag one to move the order
- **Chat**: "sell 10% at 700k", "tp half at 2x", "buy $20 at 300k mcap" — parsed locally, always confirmed before anything happens
- **Fill notifications**: a pop-up on fomo, optional desktop notifications and Telegram alerts, plus a "Tippy stopped watching" warning
- **Auto-guard**: your preset goes on every new buy
- Developer builds (`npm run dev`, tests) also have practice runs and dry run, which walk through a trade and stop before the final button. The store build leaves them out: every order is real.

```
tippy/
  extension/      Chrome / Brave / Edge extension (WXT + Preact, MV3)
  alerts-worker/  Cloudflare Worker: Telegram alerts + "Tippy stopped watching" dead-man alerts
  site/           tippybot.fun landing page with a live demo (reuses the extension's engine + UI)
  store/          Chrome Web Store screenshots and promo tiles (./store/render.sh)
  docs/           store listing copy, recon notes on fomo's web app
```

## Trust rules (don't break these)

- Install **only** from the Chrome Web Store / Edge Add-ons. Never ship a ZIP or ask users to enable developer mode.
- The install prompt shows a single line: the manifest asks for `storage`, `alarms` and `power` (none of which show a warning) plus host access to `https://fomo.family/*` only. `notifications` is optional and requested in context.
- No `tabs` permission, no all-sites access, no remote code or remote selectors. `status.json` carries data only (kill switch, banner, min version).
- No wallet connection, no token, and never ask for keys or seed phrases.
- The fomo session token is read and used **inside the fomo tab only**.

## Extension

```bash
cd extension
npm test                 # engine, executor, background, UI and chat tests (vitest, fast-check, happy-dom)
npm run build            # → dist/chrome-mv3
npm run build:edge
npm run zip              # store upload zip
npm run harness          # dev page: real Tippy UI on a pretend coin, mocked APIs
```

How it works:

| Piece | File |
|---|---|
| Order engine (pure): take-profits, partial stops, stop loss with wick protection, trailing stop, declarative "remaining balance" targets, gap handling | `src/engine/orders.ts`, `triggers.ts`, `types.ts` |
| Limit buys (one-shot, never re-pressed after a possible click) | `src/engine/buys.ts` |
| Auto-guard (detects new buys, presets → plans) | `src/engine/autoguard.ts` |
| Tick loop in the service worker, desk tab, gap/blind/logged-out health, keep-awake | `src/background/runtime.ts`, `relay.ts` |
| Trade queue (re-check, fresh tab, focus escalation, verify by balance) | `src/background/queue.ts` |
| fomo API from the page's origin | `src/fomo/api.ts` |
| Drives fomo's Buy/Sell panel (**all selectors in one file**) | `src/executor/selectors.ts`, `steps.ts` |
| In-page window: order form, orders ladder, pop-ups | `src/ui/TippyWindow.tsx`, `OrderForm.tsx`, `Toasts.tsx`, `src/entrypoints/fomo.content/` |
| Chart lines (TradingView shapes in fomo's chart frame) | `src/entrypoints/fomo-chart.content.ts`, `src/shared/chartLines.ts` |
| Chat (local parser → confirm card) | `src/chat/` |
| Popup / settings / welcome | `src/entrypoints/{popup,options,welcome}` |

[docs/RECON.md](docs/RECON.md) records what was learned from fomo's real web app; the executor tests run against real captures of fomo's trade panel.

## Alerts worker

```bash
cd alerts-worker
npx wrangler d1 create tippy_alerts        # paste the id into wrangler.jsonc
npm run db:migrate
npm run deploy
./connect-telegram.sh                      # asks for the @BotFather token (hidden), sets the secrets + webhook
```

## Site

```bash
cd site
npm run dev
npm run deploy           # Cloudflare Workers static assets
```

Flip `STORE_LIVE` in `site/src/links.ts` once the Chrome Web Store listing is public.

---

MIT licensed. Not affiliated with fomo. Memecoins are extremely risky. Tippy is a tool, not financial advice.
