// Dev-only: same as src/shared/chains.ts, but token pages work on localhost.
export * from '../src/shared/chains';
import { chainBySlug, chainById, tokenKey } from '../src/shared/chains';

export function tokenFromUrl(href: string) {
  const m = new URL(href).pathname.match(/\/tokens\/([^/]+)\/([^/?#]+)/);
  if (!m) return null;
  const chain = chainBySlug(m[1]) ?? chainById(Number(m[1]));
  if (!chain) return null;
  return { address: m[2], networkId: chain.networkId, key: tokenKey(m[2], chain.networkId) };
}
