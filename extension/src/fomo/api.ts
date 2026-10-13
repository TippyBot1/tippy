// Calls fomo's own web API from inside the fomo.family page (content script), so
// requests look exactly like fomo's own. Recon 2026-10-11: fomo web authenticates
// with cookies (credentials: 'include') and sends no Authorization header, so
// Tippy never touches the session token — it only reads its expiry to tell
// "logged out" apart from "fomo is down". fomo's page keeps the session fresh.

import { SUPPORTED_CHAINS_HEADER, tokenKey } from '../shared/chains';
import type { Holding, SessionState, TokenQuote } from '../shared/messages';

const API = 'https://prod-api.fomo.family';
const TOKEN_KEY = 'privy:token';
const QUOTE_CHUNK = 25;

export class FomoApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

function decodeJwtExp(jwt: string): number | null {
  try {
    const payload = JSON.parse(atob(jwt.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
    return typeof payload.exp === 'number' ? payload.exp : null;
  } catch {
    return null;
  }
}

function readToken(): { token: string | null; session: SessionState } {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(TOKEN_KEY);
  } catch {
    /* storage blocked */
  }
  if (!raw) return { token: null, session: { ok: false, reason: 'no-token' } };
  let token: unknown = raw;
  try {
    token = JSON.parse(raw);
  } catch {
    /* stored unquoted */
  }
  if (typeof token !== 'string' || token.split('.').length !== 3) {
    return { token: null, session: { ok: false, reason: 'malformed' } };
  }
  const exp = decodeJwtExp(token);
  const expInSec = exp ? Math.floor(exp - Date.now() / 1000) : 3600;
  if (expInSec <= 0) return { token: null, session: { ok: false, reason: 'expired' } };
  return { token, session: { ok: true, expInSec } };
}

export function session(): SessionState {
  return readToken().session;
}

/** Same headers and credentials mode as fomo's web client. */
async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(API + path, {
    ...init,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      'X-Supported-Chains': SUPPORTED_CHAINS_HEADER,
      'App-Language': 'en',
      ...(init.headers ?? {}),
    },
  });
  if (!res.ok) throw new FomoApiError(`fomo said ${res.status}`, res.status);
  const body = (await res.json()) as { responseObject?: T; success?: boolean; statusCode?: number } & T;
  // fomo wraps errors in a 200 envelope too: { success:false, statusCode:401, … }
  if (body && body.success === false) throw new FomoApiError(`fomo said ${body.statusCode ?? 'error'}`, Number(body.statusCode) || 500);
  return (body.responseObject ?? body) as T;
}

const num = (v: unknown): number | null => {
  const n = typeof v === 'string' ? Number(v) : typeof v === 'number' ? v : NaN;
  return Number.isFinite(n) ? n : null;
};

interface RawFilterResult {
  token?: { address?: string; networkId?: number | string; symbol?: string; name?: string; info?: { totalSupply?: number | string } };
  priceUSD?: number | string;
  /** price × circulating supply — NOT what fomo shows (see toQuote). */
  marketCap?: number | string;
  liquidity?: number | string;
}

/**
 * fomo's pages show market cap as price × TOTAL supply (checked live 2026-10-12:
 * RHEA $79.4M on the page vs `marketCap` $8.05M, SOL $65.2B vs $61.9B). Traders
 * type the number they see, so Tippy uses the same one; `marketCap` is only a
 * fallback when the total supply is missing.
 */
export function toQuote(r: RawFilterResult): TokenQuote | null {
  const address = r.token?.address;
  const networkId = num(r.token?.networkId);
  const price = num(r.priceUSD);
  if (!address || networkId == null || price == null) return null;
  return {
    key: tokenKey(address, networkId),
    priceUSD: price,
    mc: shownMarketCap(price, num(r.token?.info?.totalSupply), num(r.marketCap)),
    liquidity: num(r.liquidity),
    symbol: r.token?.symbol ?? '???',
    name: r.token?.name ?? '',
  };
}

function shownMarketCap(price: number, totalSupply: number | null, marketCap: number | null): number | null {
  return totalSupply != null && totalSupply > 0 ? price * totalSupply : marketCap;
}

/** Live prices for "<address>:<networkId>" keys. */
export async function quotes(keys: string[]): Promise<TokenQuote[]> {
  const out: TokenQuote[] = [];
  for (let i = 0; i < keys.length; i += QUOTE_CHUNK) {
    const chunk = keys.slice(i, i + QUOTE_CHUNK);
    const rows = await call<RawFilterResult[]>('/proxy/filterTokens', { method: 'POST', body: JSON.stringify(chunk) });
    for (const r of Array.isArray(rows) ? rows : []) {
      const q = toQuote(r);
      if (q) out.push(q);
    }
  }
  return out;
}

let cachedUser: { id: string; handle: string | null; at: number } | null = null;
const USER_TTL_MS = 10 * 60_000; // re-check now and then, in case you switch accounts

export async function me(): Promise<{ id: string; handle: string | null }> {
  if (cachedUser && Date.now() - cachedUser.at < USER_TTL_MS) return cachedUser;
  const u = await call<{ id?: string; userHandle?: string }>('/v2/users', { method: 'POST', body: '{}' });
  if (!u?.id) throw new FomoApiError('Could not read your fomo account', 500);
  cachedUser = { id: String(u.id), handle: u.userHandle ?? null, at: Date.now() };
  return cachedUser;
}

export function forgetUser() {
  cachedUser = null;
}

interface RawBalanceRow {
  balance?: { tokenId?: string; tokenAddress?: string; shiftedBalance?: number | string };
  tokenFilterResult?: RawFilterResult;
}

/** Row → "<address>:<networkId>" (recon 2026-10-11: tokenId is exactly that), cross-checked with tokenAddress. */
function rowKey(row: RawBalanceRow): string | null {
  const tokenId = row.balance?.tokenId ?? '';
  const i = tokenId.lastIndexOf(':');
  const address = i > 0 ? tokenId.slice(0, i) : (row.balance?.tokenAddress ?? '');
  const networkId = i > 0 ? Number(tokenId.slice(i + 1)) : num(row.tokenFilterResult?.token?.networkId);
  if (!address || networkId == null || !Number.isFinite(networkId)) return null;
  if (row.balance?.tokenAddress && row.balance.tokenAddress.toLowerCase() !== address.toLowerCase()) return null;
  return tokenKey(address, networkId);
}

export interface BalancesRead {
  holdings: Holding[];
  /** Rows Tippy couldn't understand — when > 0, a missing coin proves nothing. */
  unparsed: number;
}

export async function balances(): Promise<BalancesRead> {
  const { id } = await me();
  const res = await call<{ balances?: RawBalanceRow[] }>(`/v2/users/${encodeURIComponent(id)}/balances`);
  // A reply without a balances list must never read as "you hold nothing".
  if (!Array.isArray(res?.balances)) throw new FomoApiError('fomo sent balances in an unexpected shape', 502);
  const out: Holding[] = [];
  let unparsed = 0;
  for (const row of res.balances) {
    const key = rowKey(row);
    const amount = num(row.balance?.shiftedBalance);
    if (!key || amount == null) {
      unparsed++;
      continue;
    }
    const q = row.tokenFilterResult ? toQuote(row.tokenFilterResult) : null;
    out.push({
      key,
      amount,
      priceUSD: q?.priceUSD ?? null,
      mc: q?.mc ?? null,
      symbol: q?.symbol ?? '???',
      name: q?.name ?? '',
    });
  }
  if (res.balances.length > 0 && out.length === 0) throw new FomoApiError("Tippy couldn't read fomo's balances (format changed?)", 502);
  return { holdings: out, unparsed };
}

export interface Minimums {
  /** USD, keyed by networkId plus "default". */
  buy: Record<string, number>;
  sell: Record<string, number>;
}

/**
 * fomo's minimum trade sizes. /config's minPurchaseAmountByChain looks like
 * { "1": { buy: 25, sell: 5 }, default: { buy: 2, sell: 2 } } (live 2026-10-12);
 * a plain number means the same for both.
 */
export async function minimums(): Promise<Minimums> {
  const cfg = await call<{ minPurchaseAmountByChain?: Record<string, unknown> }>('/config');
  return parseMinimums(cfg?.minPurchaseAmountByChain);
}

export function parseMinimums(table: Record<string, unknown> | undefined): Minimums {
  const out: Minimums = { buy: {}, sell: {} };
  for (const [k, v] of Object.entries(table ?? {})) {
    if (v && typeof v === 'object') {
      const buy = num((v as { buy?: unknown }).buy as number | string | undefined);
      const sell = num((v as { sell?: unknown }).sell as number | string | undefined);
      if (buy != null) out.buy[k] = buy;
      if (sell != null) out.sell[k] = sell;
    } else {
      const n = num(v as number | string | undefined);
      if (n != null) out.buy[k] = out.sell[k] = n;
    }
  }
  return out;
}

