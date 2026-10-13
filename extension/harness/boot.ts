// Shared harness setup: route commands to Tippy's real handler and seed a plan
// (?seed) plus a couple of limit buys — one watching, one Tippy isn't sure about.
import { handleCommand } from '../src/background/commands';
import { applyBuyOutcome, buildBuy, markBuyExecuting } from '../src/engine/buys';
import { buildPlan } from '../src/engine/orders';
import type { BuyInput } from '../src/engine/types';
import type { Command } from '../src/shared/messages';
import { browser, setCommandHandler } from './mock-browser';
import { HARNESS_KEY } from './mock-fomo';

setCommandHandler((msg) => handleCommand(msg as Command));

if (new URLSearchParams(location.search).has('seed')) {
  const [address] = HARNESS_KEY.split(':');
  const plan = buildPlan({
    id: 'seed-1',
    key: HARNESS_KEY,
    networkId: 1399811149,
    address,
    symbol: 'BONKLE',
    name: 'Bonkle (pretend)',
    entry: { priceUSD: 0.0003, mc: 300_000, source: 'armed-at' },
    balance: 250_000,
    tps: [
      { trigger: { kind: 'x', value: 2 }, sellPct: 50 },
      { trigger: { kind: 'x', value: 5 }, sellPct: 25 },
    ],
    sl: { trigger: { kind: 'x', value: 0.7 } },
    trailing: null,
    origin: 'manual',
    now: Date.now(),
  });
  plan.lastPrice = 0.00042;
  const now = Date.now();
  const buy = (over: Partial<BuyInput>) =>
    buildBuy({
      id: 'seed-buy',
      key: HARNESS_KEY,
      networkId: 1399811149,
      address,
      symbol: 'BONKLE',
      name: 'Bonkle (pretend)',
      trigger: { kind: 'mc', value: 340_000 },
      ref: { priceUSD: 0.00042, mc: 420_000, source: 'armed-at' },
      usd: 10,
      guardPresetId: 'classic',
      expiresInMs: 24 * 3_600_000,
      now,
      ...over,
    });
  const watching = buy({});
  const unsure = applyBuyOutcome(markBuyExecuting({ ...buy({ id: 'seed-buy-2', usd: 5, trigger: { kind: 'x', value: 0.7 } }), state: 'queued' }, now), { status: 'unknown' }, now);
  void browser.storage.local.set({
    plans: { [plan.id]: plan },
    buys: { [watching.id]: watching, [unsure.id]: unsure },
    status: { health: 'watching', message: 'Watching your coins.' },
  });
}
