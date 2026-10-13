// fomo's chains, from its web bundle and live requests (recon 2026-10-11). URL
// slugs are used in token pages: https://fomo.family/tokens/<slug>/<address>

export interface Chain {
  networkId: number;
  slug: string;
  name: string;
  evm: boolean;
  /** fomo "cash" — never guarded. */
  usdc: string;
}

export const CHAINS: Chain[] = [
  { networkId: 1399811149, slug: 'solana', name: 'Solana', evm: false, usdc: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v' },
  { networkId: 8453, slug: 'base', name: 'Base', evm: true, usdc: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913' },
  { networkId: 56, slug: 'bnb', name: 'BNB Chain', evm: true, usdc: '0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d' },
  { networkId: 143, slug: 'monad', name: 'Monad', evm: true, usdc: '' },
  { networkId: 4663, slug: 'robinhood', name: 'Robinhood Chain', evm: true, usdc: '' },
  { networkId: 1, slug: 'ethereum', name: 'Ethereum', evm: true, usdc: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48' },
  { networkId: 5042, slug: 'arc', name: 'Arc', evm: true, usdc: '' },
];

/** Exact value fomo's web client sends as `X-Supported-Chains` (recon 2026-10-11). */
export const SUPPORTED_CHAINS_HEADER = '1,56,143,4663,5042,8453,1399811149';

export const chainById = (id: number) => CHAINS.find((c) => c.networkId === id) ?? null;
export const chainBySlug = (slug: string) => CHAINS.find((c) => c.slug === slug.toLowerCase()) ?? null;

const SOL_NATIVE = new Set(['So11111111111111111111111111111111111111112', '11111111111111111111111111111111']);

export function normalizeAddress(address: string, networkId: number): string {
  return chainById(networkId)?.evm ? address.toLowerCase() : address;
}

/** fomo token id: "<address>:<networkId>". */
export function tokenKey(address: string, networkId: number): string {
  return `${normalizeAddress(address, networkId)}:${networkId}`;
}

export function parseKey(key: string): { address: string; networkId: number } | null {
  const i = key.lastIndexOf(':');
  if (i <= 0) return null;
  const networkId = Number(key.slice(i + 1));
  if (!Number.isFinite(networkId)) return null;
  return { address: key.slice(0, i), networkId };
}

/** Cash and gas tokens are never guarded. */
export function isCashOrNative(address: string, networkId: number): boolean {
  const chain = chainById(networkId);
  if (!chain) return true;
  const a = normalizeAddress(address, networkId);
  if (chain.usdc && a === normalizeAddress(chain.usdc, networkId)) return true;
  if (chain.evm) return a === '0x0000000000000000000000000000000000000000' || a === '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';
  return SOL_NATIVE.has(a);
}

/** fomo's "cash" is the USDC balance (recon 2026-10-11). */
export function isCash(address: string, networkId: number): boolean {
  const chain = chainById(networkId);
  return !!chain?.usdc && normalizeAddress(address, networkId) === normalizeAddress(chain.usdc, networkId);
}

/** Total cash (USD) across a balances read, or null if none of it could be valued. */
export function cashUsd(holdings: { key: string; amount: number; priceUSD: number | null }[]): number {
  let total = 0;
  for (const h of holdings) {
    const k = parseKey(h.key);
    if (k && isCash(k.address, k.networkId)) total += h.amount * (h.priceUSD ?? 1);
  }
  return total;
}

export function tokenUrl(address: string, networkId: number): string {
  const chain = chainById(networkId);
  return `https://fomo.family/tokens/${chain?.slug ?? networkId}/${address}`;
}

/** Read "/tokens/<slug>/<address>" from a fomo URL. */
export function tokenFromUrl(href: string): { address: string; networkId: number; key: string } | null {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return null;
  }
  if (url.hostname !== 'fomo.family') return null;
  const m = url.pathname.match(/^\/tokens\/([^/]+)\/([^/?#]+)/);
  if (!m) return null;
  const chain = chainBySlug(m[1]) ?? chainById(Number(m[1]));
  if (!chain) return null;
  const address = decodeURIComponent(m[2]);
  return { address, networkId: chain.networkId, key: tokenKey(address, chain.networkId) };
}
