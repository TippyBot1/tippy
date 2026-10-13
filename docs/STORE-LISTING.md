# Chrome Web Store listing — copy & paste

Everything the Chrome Web Store developer console asks for, in the order it asks.
Images are in `store/out/` (re-render with `./store/render.sh`); the upload file
is `extension/dist/tippy-extension-<version>-chrome.zip` (`npm run zip` in `extension/`).

---

## Package tab
Upload `tippy-extension-<version>-chrome.zip`.

## Store listing tab

**Name** (from the manifest): Tippy — take profit & stop loss for fomo

**Short description** (≤132 characters, from the manifest — keep these in sync):
Take-profit, stop-loss and limit buys for your fomo trades. Any market cap, any % of your bag. No keys, no wallet connect.

**Description:**

Tippy adds the orders fomo is missing — take-profit, stop-loss and limit buys — to the coins you trade on fomo.family. Type a market cap, pick how much of your bag to sell, and Tippy watches the price and presses fomo's own Sell button for you when it gets there.

WHAT YOU CAN DO
• Take profit at any market cap: sell 25% at $1M, another 25% at $5M…
• Stop losses that sell exactly what you choose: 10% if it drops to $350K, the rest at $210K
• Wick protection: the price has to stay at your stop, not just touch it
• Limit buys at an exact market cap, then guard the new coins automatically
• See the move from now and your gain or loss before you press anything
• Your orders as dashed lines on fomo's chart — drag a line to move the order
• Chat with Tippy: "sell 10% at 700k", "tp half at 2x", "buy $20 at 300k mcap" — it shows exactly what it will do and waits for your tap
• Pop-ups when an order fills or expires, plus optional desktop notifications and Telegram alerts
• Practice runs: walk through a real sell or buy and stop before the final button
• Works on every chain fomo trades on the web

BUILT TO BE BORING ABOUT SAFETY
• Never asks for your private key, seed phrase or password
• No wallet connection — Tippy works inside your own logged-in fomo tab
• One permission: fomo.family only
• Your orders stay on your computer
• Free, no token, no account

HONEST LIMITS
• Your orders stay on until you turn them off, and Tippy keeps your computer awake while they are — but it can only sell while the computer is on and Chrome is open with fomo. Leave a laptop's lid open. If it's off when a price is hit, a stop sells when Tippy is back (at that moment's price) and a take-profit only sells if the price is still there. Phone alerts warn you if Tippy stops watching.
• Sells are market orders on fomo, so a fast drop can fill below your level.
• Tippy is an independent project and is not affiliated with or endorsed by fomo.

Questions: hello@tippybot.fun · https://tippybot.fun

**Category:** Productivity → Tools
**Language:** English

**Graphic assets**
- Store icon 128×128: `extension/public/icon/128.png`
- Screenshots (1280×800): `store/out/shot-1.png` … `shot-5.png` (in that order)
- Small promo tile 440×280: `store/out/promo-small.png`
- Marquee promo tile 1400×560: `store/out/promo-marquee.png`

**Additional fields**
- Official URL: tippybot.fun (verified in Search Console)
- Homepage URL: https://tippybot.fun
- Support URL: https://tippybot.fun (support email: hello@tippybot.fun)
- Mature content: No

## Privacy tab

**Single purpose:**
Adds take-profit, stop-loss and limit-buy orders to the user's own trades on fomo.family, executed with fomo's own buttons in the user's logged-in tab.

**Permission justifications**
- **Host permission (https://fomo.family/\*):** Shows Tippy's order window on fomo pages, reads prices and the user's balances from fomo inside the user's own tab, and presses fomo's Buy/Sell buttons when one of the user's orders triggers. Tippy runs on no other site.
- **storage:** Saves the user's orders and settings on their own computer.
- **alarms:** A 30-second backstop that restarts price checks if Chrome stopped the background worker, so orders aren't silently missed.
- **notifications (optional, asked only when the user turns it on):** Desktop pop-ups when an order fills or expires.
- **power:** Keeps the computer from sleeping while the user has orders on (on by default, one tap to turn off) — orders can only fire while the computer is awake. Released as soon as no orders are on.

**Remote code:** No, I am not using remote code. (Tippy downloads `tippybot.fun/status.json`, a small JSON file that can pause Tippy or show a banner — data only, never code.)

**Data usage — what's collected** (tick these):
- ☑ Authentication information — fomo's login session is used inside the user's own fomo tab to read their balances and trade on fomo. It never leaves the user's computer for Tippy's servers.
- ☑ Financial and payment information — only if the user connects Telegram alerts: a short alert ("Tippy sold 50% of $X at $1M MC") goes through Tippy's alerts service to their Telegram chat.
- Everything else: leave unticked.

**Certifications** (tick all three):
- ☑ I do not sell or transfer user data to third parties, outside of the approved use cases
- ☑ I do not use or transfer user data for purposes that are unrelated to my item's single purpose
- ☑ I do not use or transfer user data to determine creditworthiness or for lending purposes

**Privacy policy URL:** https://tippybot.fun/privacy

## Distribution tab
- Payments: Free
- Visibility: **Unlisted** for the first version (install it from the store link and test), then switch to Public.
- Regions: All regions
