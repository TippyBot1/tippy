// Connecting Telegram from the window, settings or welcome page: one link per
// browser, kept while it waits, turned on only when the alerts server says Start
// was tapped — then a first message.
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('wxt/browser', async () => ({ browser: (await import('./background.fakes')).fakeBrowser }));
vi.mock('../src/shared/store', async () => (await import('./background.fakes')).fakeStore);
vi.mock('../src/shared/alerts', async () => (await import('./background.fakes')).fakeAlerts);
vi.mock('../src/background/relay', async () => (await import('./background.fakes')).fakeRelayModule);
vi.mock('../src/background/runtime', () => ({ kick: () => {} }));

import { handleCommand } from '../src/background/commands';
import type { Settings } from '../src/shared/settings';
import { resetWorld, settingsWith, world } from './background.fakes';

const tg = () => (world.storage.settings as Settings).telegram;
const run = async (type: 'TELEGRAM_CONNECT' | 'TELEGRAM_CHECK' | 'TELEGRAM_OPEN' | 'TELEGRAM_DISCONNECT') => {
  const r = await handleCommand({ type });
  if (!r.ok) throw new Error(r.error);
  return r.telegram;
};

beforeEach(() => {
  resetWorld();
  world.storage = { settings: settingsWith() };
});

describe('connecting Telegram', () => {
  it('makes a one-time link and keeps it while it waits', async () => {
    const first = await run('TELEGRAM_CONNECT');
    expect(first).toEqual({ url: 'https://t.me/TippyAlertsBot?start=link-1', linked: false });
    expect(tg()).toEqual({ linkId: 'link-1', linked: false });
    // pressing Connect again (or on another page) shows the same code
    expect(await run('TELEGRAM_CONNECT')).toEqual(first);
  });

  it('stays off until Start is tapped, then turns on and says hello once', async () => {
    await run('TELEGRAM_CONNECT');
    expect(await run('TELEGRAM_CHECK')).toEqual({ url: 'https://t.me/TippyAlertsBot?start=link-1', linked: false });
    expect(world.notices).toEqual([]);
    world.telegramStarted.push('link-1');
    expect((await run('TELEGRAM_CHECK'))?.linked).toBe(true);
    expect(tg()).toEqual({ linkId: 'link-1', linked: true });
    expect(world.notices.map((n) => n.title)).toEqual(['📱 Tippy is on your phone']);
    // checking again doesn't send another hello
    await run('TELEGRAM_CHECK');
    expect(world.notices).toHaveLength(1);
  });

  it('a link someone else started never connects this browser', async () => {
    await run('TELEGRAM_CONNECT');
    world.telegramStarted.push('someone-elses');
    expect((await run('TELEGRAM_CHECK'))?.linked).toBe(false);
  });

  it('opens the same link in a tab for Telegram on this computer', async () => {
    await expect(handleCommand({ type: 'TELEGRAM_OPEN' })).resolves.toMatchObject({ ok: false });
    await run('TELEGRAM_CONNECT');
    await run('TELEGRAM_OPEN');
    expect(world.tabsOpened).toEqual(['https://t.me/TippyAlertsBot?start=link-1']);
  });

  it('disconnecting forgets the link, and the next connect makes a new one', async () => {
    await run('TELEGRAM_CONNECT');
    world.telegramStarted.push('link-1');
    await run('TELEGRAM_CHECK');
    await run('TELEGRAM_DISCONNECT');
    expect(tg()).toEqual({ linkId: null, linked: false });
    expect(await run('TELEGRAM_CHECK')).toEqual({ url: null, linked: false });
    expect((await run('TELEGRAM_CONNECT'))?.url).toBe('https://t.me/TippyAlertsBot?start=link-2');
  });
});
