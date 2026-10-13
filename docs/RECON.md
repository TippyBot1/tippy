# Recon checklist: do this before any real-money release

Everything about fomo's internals is inferred from its web bundle and from watching the live web app. **You** log in and place the small trades. Claude can watch the page and the network, but never trades.

## Findings (session 1, 2026-10-11)

Captured on the logged-in fomo.family web app, account with $0 cash and no positions. Read-only: nothing was bought or sold, no confirm button was pressed, and the session token was never printed or sent.

| Area | Finding | Changed in Tippy |
|---|---|---|
| Routes | Coin pages are `/tokens/<slug>/<address>` (e.g. `/tokens/solana/FiLR…pump`). `/` redirects to a trending coin page. `/discover` is **404 on web**. Unknown paths load a bare 404 **without** the logged-in app. | `DESK_URL` → `/leaderboard` (real logged-in page, no live chart); welcome button → `/` |
| Auth | Every `prod-api.fomo.family` call uses `credentials: 'include'` (**cookie auth**) with **no Authorization header**. Headers are `Content-Type`, `X-Supported-Chains: 1,56,143,4663,5042,8453,1399811149`, `App-Language: en`. `privy:token` is still in localStorage (JSON-quoted JWT, ~1 h). | `api.ts` copies fomo exactly; no Bearer token. The API's 401/403 decides "logged out" |
| Chains | The header adds Ethereum (1) and Arc (5042) to Solana, Base, BNB, Monad and Robinhood. | Added to `chains.ts`; Ethereum sell minimum $5 |
| Prices | `POST /proxy/filterTokens` with body `["<addr>:<networkId>", …]` returns `responseObject[]` with `priceUSD`, `marketCap`, `liquidity`, `token.{address, networkId, symbol, name, decimals}`. **It works without the session**, so a lapsed session only shows up on balances. | Parser unchanged. Background flags "logged out" when balances return 401/403 |
| Balances | `GET /v2/users/<id>/balances` returns `responseObject.{balances[], otherPnl, otherPnlV2, nativeEvmBalances, livePerpPnl, otherEquity}`. Row shape **not seen** (empty account). | none yet |
| Trades | `GET /trades` returns `responseObject.{activeTrades[], closedTrades[], hasNextPage, closedCount}`. Row shape not seen. | none yet |
| Config | `/config` has `minPurchaseAmountByChain` (buy minimum), `awaitRelayConfirmationOnSells`, `features`, … | — |
| Token flags | `POST /proxy/tokenWarnings` returns `{disableBuying, disableSelling, warnings[]}`. Request body not captured. | none yet |
| Trade panel | See `extension/test/fixtures/fomo-sell-panel-2026-10-11.html`. Tabs are plain buttons whose **active state is only a class** (`text-red`/`bg-red-transparent` for Sell, `text-green`/`bg-green-transparent` for Buy). The amount box is `<input placeholder="0">` with **no type**, in USD. Sell presets are **10/25/50/100%, no Max**. Confirm is a `<button>` "Sell <SYM>" (not a slider). When the amount is too big, the button's label becomes **"Insufficient balance"**. The "Swap settings" gear is in the tab row. "Unverified token" is a label, not a checkbox. | `selectors.ts` reads class-based tab state and untyped inputs. 9 tests on the real capture (all 9 failed before the fix) |

## Findings (session 2, 2026-10-11, small real-money trades placed **by the user**)

The user sold half their SOL, bought $5 BONK and sold all of it, while Claude recorded the page read-only. Claude never pressed Buy or Sell.

| Area | Finding | Changed in Tippy |
|---|---|---|
| Deposits | A small deposit arrived as **SOL**, a *position*, with **$0 cash**. "Cash" is the **USDC** balance row. | (USDC is already excluded from guarding) |
| Quote | While quoting, the confirm label reads **"Fetching quote..." (disabled)**. The quote shows in the amount box as **"0.0269 SOL (+0.03%)"**: the inline % is the price impact (negative = worse than market) plus a **"$0.10 fee"** line. There is **no "Price impact" wording**. The quote takes about 0.8 s and fomo re-quotes about every 2.3 s via `POST /swaps/v3` `{inTokenId, outTokenId, amount, retry}`. That response has `priceImpactPct`, `priceImpactWarningInfo{warningLevel, displayPriceImpactInline, name, description}`, `dynamicSlippageBps` and `swapUsdValue`. | `readImpactPct` parses the inline "(±x%)". Fixture `fomo-sell-quote-2026-10-11.html` |
| Sell panel with a position | Shows available "$6.12" plus a real **`<button>Max</button>`**. **100%** puts the position's USD value in the box (e.g. "4.89"). Max is preferred for sell-all. | `findMax` is used first for sell-all (test) |
| After pressing | Within ~0.1 s **the amount box clears**. A status strip opens below the panel: **"Selling 1.4M BONK" → "Sold 1.4M BONK"** (green check) ~0.3 s later. It closes after ~6 s. Buys show "Buying $5.00 BONK" → "Bought …". Available drops to $0 ~0.5 s after. fomo then polls balances every ~1 s. | "Sold …" counts as submitted as well as the cleared box. Balance still decides |
| Full sell | The coin's row **disappears from `/v2/users/:id/balances`** (no zero row). | Matches `verify()`: absent ×2 means filled, for exits only |
| Rows | Balances row = `{balance:{address, tokenAddress, walletId, balance(str), shiftedBalance(num), tokenId}, tokenFilterResult:{priceUSD, marketCap, token, …}, userToken, activeTrade, valuation}`. `/trades` `activeTrades[].trade` has **`avgEntryPrice`**, `humanTokenAmount`, `sumSwapOpen`, … `tokenWarnings` body = `{address, networkId}`. | Parser confirmed. Auto-guard can use `avgEntryPrice` (todo) |
| Reliability | fomo's balances endpoint returned a **504** once, and fomo's own UI showed **stale/contradictory balances for minutes** after the first sell (the profile still showed the old SOL balance; cash $0 for ~3+ min). | Validates the "missing/failed read = unknown, never sold" fixes and the longer verify window |
| Sweeps | `POST /sweeps` returns `{sweeps:[], failedNetworkIds:[]}` after trades/focus. | — |

## Findings (session 3, 2026-10-12, practice runs on the real account; nothing traded)

| Area | Finding | Changed in Tippy |
|---|---|---|
| Buy panel | Real markup captured read-only: Buy tab active = `bg-green-transparent text-green`, Sell inactive = `… text-text-secondary`; the amount box is the same `<input placeholder="0">` with a sibling `$`; $ presets **$10 / $100 / $500 / $1000** (disabled until cash loads); cash shown as "$5.81" + **Max**; confirm `<button>` "Buy SOL" (disabled while empty); a "Lowest fees: 0.05%" row. | Fixture `fomo-buy-panel-2026-10-12.html`; selectors verified (`executor.buy.real.test.ts`) |
| Practice sell (SOL) | Tippy opened a background tab, picked 50% ($2.99), got fomo's quote (impact ≈0%) and stopped before "Sell SOL". Balance unchanged. | — |
| Practice buy (SOL, $5) | Same, stopped before "Buy SOL" for $5.00 (impact ≈0%). Cash unchanged ($5.81). | — |
| Extension reload | After Tippy is reloaded/updated, fomo tabs opened before it lose their content script; the remembered desk tab stops answering. | Practice uses the tab it was pressed in when the desk doesn't answer |
| Market cap source | filterTokens `marketCap` = price × **circulating** supply; fomo's pages show price × **total** supply (`token.info.totalSupply`). RHEA (BNB): page $79.4M vs `marketCap` $8.05M; SOL $65.2B vs $61.9B; fixed-supply memecoins (MONITOR, BASECAT) match. | `toQuote` uses price × totalSupply (`api.quote.test.ts`) |
| Every chain | Practice buys stopped at the right button on **Solana** (SOL), **Robinhood Chain** (MONITOR), **BNB** (RHEA, impact 0.3%), **Base** (BASECAT). **Ethereum** (DNA): fomo refused $5 as under its minimum — Tippy stopped without pressing. URL slugs confirmed: solana, robinhood, bnb, base, ethereum. Cash ($5.81 USDC) is shared across chains. | — |
| Minimums | `/config` `minPurchaseAmountByChain` = `{ "1": { buy: 25, sell: 5 }, default: { buy: 2, sell: 2 } }` — buy and sell differ (Tippy previously expected one number per chain and ignored it). | `parseMinimums`, `status.minBuyUsd/minSellUsd`, fetched every 30 min |
| In-page navigation | Clicking a coin in fomo's list changes the URL without a page load; WXT's navigation event never reached the content script, so the window kept showing the old coin. | App polls `location.href` every 500 ms |

## Still to do

- [x] Balances row shape · `/trades` row shape · quote state · impact format · post-sell behaviour · `tokenWarnings` body (session 2).
- [ ] High-impact / warning UI on a thin coin (what `priceImpactWarningInfo` renders; any acknowledgement checkbox).
- [ ] A failed sell's strip wording (e.g. "Failed …").
- [ ] Cross-chain sell timing (Base/BNB coin with Solana cash).
- [ ] Use `disableSelling` from `tokenWarnings` and `avgEntryPrice` from `/trades` in Tippy.
- [ ] Swap settings (gear): slippage controls? Is a default worth recommending?
- [x] **Dry run** on a held coin from an **inactive** tab (practice sell + buy, 2026-10-12). Still to do: again after 6+ minutes hidden.
- [x] Compare Tippy's market cap with fomo's header (fixed — total supply).
- [ ] Monad and Arc coins (none were listed on 2026-10-12).
- [ ] Capture a Buy **quote** state, "Insufficient balance" on Buy, and a real "Bought …" strip.
- [ ] Energy Saver: is the `/leaderboard` desk tab frozen? Does "Always keep these sites active" fix it?
- [ ] Does the session keep refreshing in a hidden desk tab for more than 1 h?
- [ ] Laptop sleep → wake: gap detection and re-confirmation.

## Real money ($1–5, done by you)

- [ ] TP ladder fills both levels, verified by balance.
- [ ] SL fills after 2 ticks below.
- [ ] Trailing stop activates and fires.
- [ ] Auto-guard attaches to a phone buy.
- [ ] Manual sell on the phone, then Tippy marks the level "done elsewhere" with no double sell.
- [ ] Repeat on Base or BNB.

## Store

- [ ] Install from the packed zip and confirm the prompt shows exactly one line: "Read and change your data on fomo.family".
- [ ] Chrome Web Store: verified publisher (tippybot.fun), privacy practices form, unlisted beta first.
