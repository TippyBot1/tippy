// Dev-only stand-in for src/fomo/api.ts: a pretend coin with a wandering price,
// plus $25 of fomo "cash" (USDC) so limit buys have something to spend.
// ?bag=0 opens the pretend coin as one you don't hold (the Limit buy tab).
import { CHAINS, tokenKey } from '../src/shared/chains';
import type { Holding, SessionState, TokenQuote } from '../src/shared/messages';

export const HARNESS_KEY = 'TiPPYdemo1111111111111111111111111111111pump:1399811149';
let price = 0.00042;
const SUPPLY = 1e9;
const bagParam = new URLSearchParams(location.search).get('bag');
const BAG = bagParam != null && Number.isFinite(Number(bagParam)) ? Number(bagParam) : 250_000;
const SOLANA = CHAINS.find((c) => c.slug === 'solana')!;
const CASH: Holding = { key: tokenKey(SOLANA.usdc, SOLANA.networkId), amount: 25, priceUSD: 1, mc: null, symbol: 'USDC', name: 'USD Coin' };

export class FomoApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export function session(): SessionState {
  return { ok: true, expInSec: 3600 };
}

function q(): TokenQuote {
  price *= Math.exp((Math.random() - 0.5) * 0.04);
  return { key: HARNESS_KEY, priceUSD: price, mc: price * SUPPLY, symbol: 'BONKLE', name: 'Bonkle (pretend)' };
}

export async function quotes(keys: string[]): Promise<TokenQuote[]> {
  return keys.includes(HARNESS_KEY) ? [q()] : [];
}

export async function balances(): Promise<{ holdings: Holding[]; unparsed: number }> {
  const coin: Holding = { key: HARNESS_KEY, amount: BAG, priceUSD: price, mc: price * SUPPLY, symbol: 'BONKLE', name: 'Bonkle (pretend)' };
  return { holdings: BAG > 0 ? [coin, CASH] : [CASH], unparsed: 0 };
}

export async function me() {
  return { id: 'harness-user', handle: 'harness' };
}

export async function minimums() {
  return { default: 2 };
}

export function forgetUser() {}
