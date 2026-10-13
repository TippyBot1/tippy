export const SITE_URL = 'https://tippybot.fun';
/** Kill switch / banner / minimum version — data only, never selectors or code. */
export const STATUS_URL = `${SITE_URL}/status.json`;
export const ALERTS_URL: string = import.meta.env.WXT_ALERTS_URL ?? 'https://alerts.tippybot.fun';
export const TELEGRAM_BOT = 'TippyBotAlerts';

/**
 * fomo's trade minimums (USD) when /config can't be read. Live values 2026-10-12:
 * minPurchaseAmountByChain = { "1": { buy: 25, sell: 5 }, default: { buy: 2, sell: 2 } }.
 */
export const DEFAULT_MIN_SELL_USD = 2;
export const MIN_SELL_USD_BY_CHAIN: Record<string, number> = { '1': 5 };
export const DEFAULT_MIN_BUY_USD = 2;
export const MIN_BUY_USD_BY_CHAIN: Record<string, number> = { '1': 25 };

/** fomo's minimum for a trade on this chain: its live /config table first, then the known values. */
export function minTradeUsdFor(live: Record<string, number> | undefined, networkId: number, side: 'buy' | 'sell'): number {
  const id = String(networkId);
  return live?.[id] ?? live?.default ?? (side === 'buy' ? (MIN_BUY_USD_BY_CHAIN[id] ?? DEFAULT_MIN_BUY_USD) : (MIN_SELL_USD_BY_CHAIN[id] ?? DEFAULT_MIN_SELL_USD));
}
/**
 * Query marker on the tabs Tippy opens to trade in (sells and buys), so they're
 * recognised even after a worker restart — and so Tippy's pop-ups stay out of them.
 */
export const EXEC_MARKER = 'tippy=sell';

/**
 * Page Tippy keeps open as its "desk". Recon 2026-10-11: /leaderboard is a real,
 * logged-in page with no live chart. (/discover 404s on web; unknown paths load
 * a bare 404 without the logged-in app, so fomo's session wouldn't refresh.)
 */
export const DESK_URL = 'https://fomo.family/leaderboard';
