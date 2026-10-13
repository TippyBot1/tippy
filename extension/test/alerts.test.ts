// notify(): every fill / expiry pops up on fomo's page (always), on the desktop
// (when allowed) and on Telegram (when linked) — and a desktop click opens the coin.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const b = vi.hoisted(() => {
  const store: Record<string, unknown> = {};
  const created: { id: string; opts: { title: string; message: string } }[] = [];
  const opened: string[] = [];
  const clicks: ((id: string) => void)[] = [];
  return {
    store,
    created,
    opened,
    clicks,
    granted: { value: true },
    browser: {
      storage: {
        local: {
          get: async (keys: string[]) => Object.fromEntries(keys.filter((k) => k in store).map((k) => [k, structuredClone(store[k])])),
          set: async (patch: Record<string, unknown>) => {
            // A real storage write takes a moment — overlapping read-modify-writes would lose one.
            await new Promise((r) => setTimeout(r, 1));
            for (const [k, v] of Object.entries(patch)) store[k] = structuredClone(v);
          },
        },
        onChanged: { addListener() {}, removeListener() {} },
      },
      permissions: { contains: async () => b.granted.value },
      runtime: { getURL: (p: string) => `chrome-extension://tippy${p}` },
      notifications: {
        create: async (id: string, opts: { title: string; message: string }) => {
          created.push({ id, opts });
          return id;
        },
        clear: async () => true,
        onClicked: { addListener: (fn: (id: string) => void) => clicks.push(fn) },
      },
      tabs: { create: async ({ url }: { url: string }) => opened.push(url) },
    },
  };
});
vi.mock('wxt/browser', () => ({ browser: b.browser }));

import { hookNotificationClicks, notify } from '../src/shared/alerts';
import type { Notice, NoticeText } from '../src/shared/notices';
import { withDefaults } from '../src/shared/settings';

const KEY = 'HiGGsAddr:1399811149';
const fill: NoticeText = { key: KEY, title: 'Tippy filled order', text: 'Tippy bought $5 at $716K MC on $HIGGS.', tone: 'good' };
const notices = () => (b.store.notices ?? []) as Notice[];

beforeEach(() => {
  for (const k of Object.keys(b.store)) delete b.store[k];
  b.created.length = 0;
  b.opened.length = 0;
  b.granted.value = true;
});

describe('notify', () => {
  it("always leaves a pop-up for fomo's page — even with desktop notifications off", async () => {
    await notify(withDefaults(undefined), 'filled', fill);
    expect(notices()).toHaveLength(1);
    expect(notices()[0]).toMatchObject(fill);
    expect(notices()[0].id).toBeTruthy();
    expect(notices()[0].at).toBeGreaterThan(0);
    expect(b.created).toEqual([]);
  });

  it('shows a desktop notification when they are on and allowed', async () => {
    await notify(withDefaults({ notifications: true } as never), 'filled', fill);
    expect(b.created).toHaveLength(1);
    expect(b.created[0].opts).toMatchObject({ title: 'Tippy filled order', message: 'Tippy bought $5 at $716K MC on $HIGGS.' });

    b.granted.value = false; // allowed once, then taken back in Chrome's settings
    await notify(withDefaults({ notifications: true } as never), 'filled', fill);
    expect(b.created).toHaveLength(1);
  });

  it('keeps the last 10, and fills landing together are all kept', async () => {
    const s = withDefaults(undefined);
    await Promise.all(Array.from({ length: 12 }, (_, i) => notify(s, 'filled', { ...fill, text: `fill ${i}` })));
    expect(notices().map((n) => n.text)).toEqual(Array.from({ length: 10 }, (_, i) => `fill ${i + 2}`));
  });

  it('a notice with a dedupe key pops up once', async () => {
    const s = withDefaults(undefined);
    const skipped: NoticeText = { key: KEY, title: 'Tippy skipped a stop', text: 'too small', tone: 'stop' };
    await notify(s, 'attention', skipped, 'small:p1:too small');
    await notify(s, 'attention', skipped, 'small:p1:too small');
    await notify(s, 'attention', { ...skipped, text: 'another' }, 'small:p1:another');
    expect(notices().map((n) => n.text)).toEqual(['too small', 'another']);
  });

  it('clicking a desktop notification opens that coin on fomo', async () => {
    hookNotificationClicks();
    hookNotificationClicks(); // hooked once, however often it's called
    expect(b.clicks).toHaveLength(1);
    await notify(withDefaults({ notifications: true } as never), 'filled', fill);
    b.clicks[0](b.created[0].id);
    expect(b.opened).toEqual(['https://fomo.family/tokens/solana/HiGGsAddr']);

    b.clicks[0]('someone-elses-notification');
    expect(b.opened).toHaveLength(1);
  });
});
