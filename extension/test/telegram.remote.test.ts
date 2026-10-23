// Commands typed to the Telegram bot (/orders, /pause, /resume), as Tippy
// carries them out when its heartbeat brings them back — and what it answers.
// Nothing here can buy or sell.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('wxt/browser', async () => ({ browser: (await import('./background.fakes')).fakeBrowser }));
vi.mock('../src/shared/store', async () => (await import('./background.fakes')).fakeStore);
vi.mock('../src/shared/alerts', async () => (await import('./background.fakes')).fakeAlerts);
vi.mock('../src/background/relay', async () => (await import('./background.fakes')).fakeRelayModule);
vi.mock('../src/background/runtime', () => ({ kick: () => {} }));

import { runRemote } from '../src/background/remote';
import { buildBuy } from '../src/engine/buys';
import { buildPlan } from '../src/engine/orders';
import type { Plan } from '../src/engine/types';
import type { RemoteCommand } from '../src/shared/alerts';
import { DEFAULT_STATUS } from '../src/shared/messages';
import { buyInput, KEY, resetWorld, settingsWith, SOL, T0, world } from './background.fakes';

function plan(id: string, symbol: string, key = `${symbol}:${SOL}`): Plan {
  const p = buildPlan({
    id,
    key,
    networkId: SOL,
    address: symbol,
    symbol,
    name: symbol,
    entry: { priceUSD: 0.0003, mc: 300_000, source: 'armed-at' },
    balance: 100_000,
    tps: [{ trigger: { kind: 'mc', value: 1_000_000 }, sellPct: 50 }],
    stops: [],
    sl: { trigger: { kind: 'mc', value: 200_000 } },
    trailing: null,
    origin: 'manual',
    now: T0,
  });
  p.lastPrice = 0.0006;
  p.lastMc = 600_000;
  return p;
}

const cmd = (c: RemoteCommand['cmd'], coin: string | null = null, at = T0): RemoteCommand => ({ id: 1, cmd: c, coin, at });

beforeEach(() => {
  vi.useFakeTimers({ now: T0 });
  resetWorld();
  world.storage = {
    settings: settingsWith(),
    status: { ...DEFAULT_STATUS },
    plans: { a: plan('a', 'TIPPY'), b: plan('b', 'WIF') },
    buys: {},
    queue: [],
  };
});

afterEach(() => {
  vi.useRealTimers();
});

describe('/orders', () => {
  it('lists every guarded coin with where it is now and its levels', async () => {
    await runRemote([cmd('orders')]);
    expect(world.replies).toHaveLength(1);
    expect(world.replies[0]).toBe(
      ['📋 Tippy is guarding 2 coins:', '• $TIPPY — $600K MC, 2x', '   $1M mc 50% · SL $200K mc', '• $WIF — $600K MC, 2x', '   $1M mc 50% · SL $200K mc'].join('\n'),
    );
  });

  it('includes limit buys, and says when nothing is on', async () => {
    world.storage.buys = { b1: buildBuy(buyInput()) };
    world.storage.plans = {};
    await runRemote([cmd('orders')]);
    expect(world.replies[0]).toMatch(/^📋 No coins guarded\.\nLimit buys waiting: 1\n• \$10\.00 of \$\w+ at /);
    world.storage.buys = {};
    await runRemote([cmd('orders')]);
    expect(world.replies[1]).toBe('📋 Tippy has no orders on right now.');
  });
});

describe('/pause and /resume', () => {
  it('pauses and resumes everything', async () => {
    await runRemote([cmd('pause')]);
    expect(world.storage.settings!.paused).toBe(true);
    expect(world.replies.at(-1)).toBe("⏸️ Paused. Tippy won't buy or sell anything until you /resume.");
    await runRemote([cmd('pause')]);
    expect(world.replies.at(-1)).toBe('Tippy is already paused. /resume switches it back on.');
    await runRemote([cmd('resume')]);
    expect(world.storage.settings!.paused).toBe(false);
    expect(world.replies.at(-1)).toBe('▶️ Back on — Tippy is watching your orders again.');
  });

  it('pauses and resumes one coin, leaving the others alone', async () => {
    await runRemote([cmd('pause', 'TIPPY')]);
    expect(world.storage.plans!.a.state).toBe('paused');
    expect(world.storage.plans!.b.state).toBe('armed');
    expect(world.replies.at(-1)).toBe('⏸️ Paused $TIPPY. Its orders stay put; /resume $TIPPY switches them back on.');
    await runRemote([cmd('resume', 'TIPPY')]);
    expect(world.storage.plans!.a.state).toBe('armed');
    expect(world.replies.at(-1)).toBe('▶️ $TIPPY is back on.');
  });

  it('matches the ticker whatever its case, and says when there is no such coin', async () => {
    world.storage.plans = { a: plan('a', 'Tippy') };
    await runRemote([cmd('pause', 'TIPPY')]);
    expect(world.storage.plans!.a.state).toBe('paused');
    await runRemote([cmd('pause', 'BONK')]);
    expect(world.replies.at(-1)).toBe("Tippy isn't guarding a coin called $BONK. /orders shows what it's guarding.");
  });

  it('resuming one coin while everything is paused says so', async () => {
    await runRemote([cmd('pause', 'TIPPY'), cmd('pause')]);
    await runRemote([cmd('resume', 'TIPPY')]);
    expect(world.replies.at(-1)).toBe('▶️ $TIPPY is back on. Tippy as a whole is still paused — /resume to switch everything back on.');
  });

  it('a command picked up late says the computer was offline', async () => {
    await runRemote([cmd('pause', null, T0 - 12 * 60_000)]);
    expect(world.replies[0]).toMatch(/^\(Your message from 12 min ago — Tippy was offline\.\)\n⏸️ Paused\./);
  });

  it('never sells or buys: nothing is queued and fomo is never asked to trade', async () => {
    await runRemote([cmd('orders'), cmd('pause', 'TIPPY'), cmd('resume', 'TIPPY'), cmd('pause'), cmd('resume')]);
    expect(world.storage.queue).toEqual([]);
    expect(world.requests.filter((r) => r.req.type === 'EXECUTE' || r.req.type === 'EXECUTE_BUY')).toEqual([]);
    expect(KEY).toBeTruthy();
  });
});
