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

Tippy gives your fomo trades the orders fomo doesn't have yet: take-profit, stop-loss and limit buys.

Pick a market cap, choose how much of your bag to sell, and Tippy watches the price for you. When it gets there, Tippy clicks fomo's own Sell button in your open fomo tab, just like you would.

SAFE BY DESIGN
- Tippy never asks for your seed phrase, private key or password. If anything claiming to be Tippy ever does, it's a scam.
- No wallet connection and nothing to sign. Your money stays in your own fomo account.
- Tippy can only click Buy and Sell on fomo. It can't withdraw or send your money anywhere.
- It only runs on fomo.family, the one site it asks permission for.
- Your orders are saved on your own computer, not on our servers.
- Free and open source, so anyone can read the code: https://github.com/TippyBot1/tippy
- No token, no account, no sign-up.

WHAT IT DOES
- Take profit at any market cap. For example: sell 25% at $1M and another 25% at $5M.
- Stop losses for exactly the amount you choose. For example: sell 10% if it drops to $350K and the rest at $210K.
- Wick protection: the price has to stay at your stop, so one quick wick doesn't sell you out.
- Limit buys at the market cap you want, with a take-profit and stop-loss added as soon as it fills if you like.
- Before you confirm, you see how far your level is from the price now and your gain or loss there.
- Your orders show as lines on fomo's chart. Drag a line to move the order.
- Type orders in plain English, like "sell 10% at 700k" or "buy $20 at 300k mcap". Tippy shows exactly what it will do and waits for you to confirm.
- A pop-up when an order fills or expires, plus optional desktop notifications and Telegram alerts.
- Practice mode walks through a real trade and stops before the final click, so you can watch it work without spending anything.
- Works on every chain you can trade on fomo's website.

GOOD TO KNOW
- Tippy runs in your browser, so it can only trade while your computer is on and Chrome is open. It keeps your computer awake while you have orders on. If your computer was off when a price was hit, a stop loss sells as soon as Tippy is back (at that moment's price), and a take-profit only sells if the price is still there.
- Sells are market orders on fomo, so in a fast drop the fill can come in below your level.
- Tippy is an independent project. It isn't made by or affiliated with fomo.

Questions or problems: hello@tippybot.fun
Website: https://tippybot.fun

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
