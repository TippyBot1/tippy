// Market cap must be the number fomo shows on its pages (price × total supply),
// not filterTokens' `marketCap` (price × circulating supply). Values captured
// live from fomo's filterTokens on 2026-10-12.
import { describe, expect, it } from 'vitest';
import { toQuote } from '../src/fomo/api';

describe('toQuote market cap', () => {
  it('uses price × total supply, like fomo’s page', () => {
    const rhea = toQuote({ token: { address: '0x4c06', networkId: 56, symbol: 'RHEA', info: { totalSupply: '999194387.8221383' } }, priceUSD: '0.07957259436927816', marketCap: '8051639.217947707' })!;
    expect(rhea.mc! / 1e6).toBeCloseTo(79.51, 1); // fomo showed $79.3M–$79.4M; `marketCap` said $8.05M
    const sol = toQuote({ token: { address: 'So1', networkId: 1399811149, symbol: 'SOL', info: { totalSupply: '600799086' } }, priceUSD: '108.9084385294791', marketCap: '61932600815.99359' })!;
    expect(sol.mc! / 1e9).toBeCloseTo(65.43, 1); // fomo showed $65.2B; `marketCap` said $61.9B
  });

  it('a fixed-supply memecoin is the same either way', () => {
    const q = toQuote({ token: { address: '0x1a91', networkId: 4663, symbol: 'MONITOR', info: { totalSupply: '1000000000' } }, priceUSD: '0.0016298015531465712', marketCap: '1629801.5525305981' })!;
    expect(q.mc).toBeCloseTo(1_629_801.55, 0);
  });

  it('falls back to marketCap without a total supply', () => {
    expect(toQuote({ token: { address: 'x', networkId: 56, symbol: 'X' }, priceUSD: '2', marketCap: '500' })!.mc).toBe(500);
  });
});

describe('fomo minimums', () => {
  it("reads /config's per-chain buy and sell minimums (live shape 2026-10-12)", async () => {
    const { parseMinimums } = await import('../src/fomo/api');
    const { minTradeUsdFor } = await import('../src/shared/config');
    const m = parseMinimums({ '1': { buy: 25, sell: 5 }, default: { buy: 2, sell: 2 } });
    expect(m).toEqual({ buy: { '1': 25, default: 2 }, sell: { '1': 5, default: 2 } });
    expect(minTradeUsdFor(m.buy, 1, 'buy')).toBe(25);
    expect(minTradeUsdFor(m.buy, 4663, 'buy')).toBe(2);
    expect(minTradeUsdFor(m.sell, 1, 'sell')).toBe(5);
    // nothing loaded yet: the known values
    expect(minTradeUsdFor({}, 1, 'buy')).toBe(25);
    expect(minTradeUsdFor(undefined, 56, 'sell')).toBe(2);
    expect(parseMinimums({ '8453': 3 })).toEqual({ buy: { '8453': 3 }, sell: { '8453': 3 } });
  });
});
