// @vitest-environment happy-dom
// Tippy's chat box: type a command, Enter, see Tippy's card; the verb button
// runs it once (disabled while running, then shows the result), Cancel runs
// nothing. Collapsed to the input until used, ✕ clears, ↑ recalls, and keys
// typed in it never reach fomo's page. Also: it sits at the bottom of the window.
import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Intent } from '../src/chat/intent';
import type { ChatApi, ChatCoin, ChatCtx } from '../src/chat/run';
import type { CommandResult } from '../src/shared/messages';
import { DEFAULT_PRESETS, withDefaults } from '../src/shared/settings';
import { Chat } from '../src/ui/Chat';
import { TippyWindow, type WindowApi } from '../src/ui/TippyWindow';

// parse.ts is another module's job: tests pick the intent, or fall through to the real parser.
const stub = vi.hoisted(() => ({ parse: null as null | ((message: string) => Intent) }));
vi.mock('../src/chat/parse', async (importOriginal) => {
  const real = await importOriginal<typeof import('../src/chat/parse')>();
  return { ...real, parse: (message: string, opts?: Parameters<typeof real.parse>[1]) => (stub.parse ? stub.parse(message) : real.parse(message, opts)) };
});

const claudia: ChatCoin = { key: 'Claud111:1399811149', address: 'Claud111', networkId: 1399811149, symbol: 'CLAUDIA', name: 'Claudia', priceUSD: 0.001, mc: 1_000_000, balance: 100_000 };
const ADD_TP: Intent = { type: 'add-tp', coin: { here: true }, level: { kind: 'mc', value: 2_000_000 }, sellPct: 50 };

let root: HTMLElement;
let calls: { fn: string; args: unknown[] }[];
let armResult: () => Promise<CommandResult>;

function api(): ChatApi {
  const rec =
    (fn: string, res: () => Promise<CommandResult> = async () => ({ ok: true })) =>
    (...args: unknown[]) => (calls.push({ fn, args }), res());
  return {
    arm: rec('arm', () => armResult()),
    update: rec('update'),
    pause: rec('pause'),
    resume: rec('resume'),
    cancel: rec('cancel'),
    armBuy: rec('armBuy'),
    cancelBuy: rec('cancelBuy'),
    moveBuy: rec('moveBuy'),
    practice: rec('practice'),
    setSettings: rec('setSettings'),
    pauseAll: rec('pauseAll'),
  };
}

function ctx(over: Partial<ChatCtx> = {}): ChatCtx {
  return {
    coin: claudia,
    plans: [],
    buys: [],
    settings: withDefaults(undefined),
    minBuyUsd: () => 2,
    minSellUsd: () => 2,
    cash: 100,
    resolveCoin: async (s) => (s.toUpperCase() === 'CLAUDIA' ? claudia : null),
    fetchCoin: async () => claudia,
    api: api(),
    ...over,
  };
}

const $ = <T extends Element = HTMLElement>(sel: string) => root.querySelector<T>(sel);
const input = () => $<HTMLInputElement>('.tw-chat-bar input')!;
const btn = (text: string) => [...root.querySelectorAll<HTMLButtonElement>('.tw-chat button')].find((b) => b.textContent!.trim() === text) ?? null;
const cards = () => [...root.querySelectorAll<HTMLElement>('.tw-chat-tippy')];

/** Let planning / running promises settle and re-render. */
async function settle() {
  for (let i = 0; i < 5; i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }
}

async function show(c: ChatCtx = ctx()) {
  await act(async () => {
    render(h(Chat, { ctx: c }), root);
  });
}

async function say(text: string) {
  await act(async () => {
    const el = input();
    el.value = text;
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await act(async () => {
    $('.tw-chat-bar')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });
  await settle();
}

async function click(el: Element | null) {
  expect(el).toBeTruthy();
  await act(async () => {
    (el as HTMLElement).click();
  });
}

async function key(k: string) {
  await act(async () => {
    input().dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
  });
}

beforeEach(() => {
  root = document.createElement('div');
  document.body.appendChild(root);
  calls = [];
  armResult = async () => ({ ok: true });
  stub.parse = () => ADD_TP;
});

afterEach(() => {
  render(null, root);
  root.remove();
});

describe('chat box', () => {
  it('starts as just the input', async () => {
    await show();
    expect(input().placeholder).toBe('Ask Tippy… e.g. tp at 500k mcap');
    expect($('.tw-chat-log')).toBeNull();
    expect(btn('✕')).toBeNull();
  });

  it('a command → Tippy\'s card; nothing is sent until you tap the verb, which runs it once', async () => {
    await show();
    await say('tp at 2m sell half');
    expect($('.tw-chat-you')!.textContent).toBe('tp at 2m sell half');
    expect(input().value).toBe('');
    expect(cards()[0].textContent).toContain('Add a take-profit on $CLAUDIA: sell 50% at $2M MC (2x from now).');
    expect(btn('Add it')).toBeTruthy();
    expect(btn('Cancel')).toBeTruthy();
    expect(calls).toEqual([]);

    await click(btn('Add it'));
    await settle();
    expect(calls.map((c) => c.fn)).toEqual(['arm']);
    expect(calls[0].args[0]).toMatchObject({ key: claudia.key, tps: [{ trigger: { kind: 'mc', value: 2_000_000 }, sellPct: 50 }] });
    expect(btn('Add it')).toBeNull();
    expect($('.tw-chat-result.ok')!.textContent).toMatch(/^Done! I'll sell 50% of \$CLAUDIA at \$2M MC/);
  });

  it('a fast double tap still runs it once', async () => {
    await show();
    await say('tp at 2m');
    const add = btn('Add it')!;
    await act(async () => {
      add.click();
      add.click();
    });
    await settle();
    expect(calls.filter((c) => c.fn === 'arm')).toHaveLength(1);
  });

  it('Cancel sends nothing', async () => {
    await show();
    await say('tp at 2m');
    await click(btn('Cancel'));
    await settle();
    expect(calls).toEqual([]);
    expect(btn('Add it')).toBeNull();
    expect(cards()[0].textContent).toContain('Cancelled — nothing changed.');
  });

  it('after a tap the cursor goes back to the box, so you can keep typing', async () => {
    await show();
    await say('tp at 2m');
    btn('Add it')!.focus();
    await click(btn('Add it'));
    await settle();
    expect(document.activeElement).toBe(input());

    await say('tp at 3m');
    btn('Cancel')!.focus();
    await click(btn('Cancel'));
    expect(document.activeElement).toBe(input());
  });

  it('buttons are disabled while it runs; an error shows amber', async () => {
    let finish!: (r: CommandResult) => void;
    armResult = () => new Promise((r) => (finish = r));
    await show();
    await say('tp at 2m');
    await click(btn('Add it'));
    await settle();
    expect(btn('Working…')!.disabled).toBe(true);
    expect(btn('Cancel')!.disabled).toBe(true);
    expect(btn('✕')!.disabled).toBe(true);
    await act(async () => finish({ ok: false, error: 'Tippy was just updated — reload this page.' }));
    await settle();
    expect($('.tw-chat-result.warn')!.textContent).toBe('Tippy was just updated — reload this page.');
    expect(calls).toHaveLength(1);
  });

  it('answers without a change have no buttons; problems are amber', async () => {
    stub.parse = () => ({ type: 'add-tp', coin: { here: true }, level: { kind: 'mc', value: 500_000 }, sellPct: null });
    await show();
    await say('tp at 500k');
    expect(cards()[0].classList.contains('warn')).toBe(true);
    expect(cards()[0].textContent).toMatch(/above where it is now/);
    expect(root.querySelector('.tw-chat-acts')).toBeNull();
    stub.parse = () => ({ type: 'help' });
    await say('help');
    expect(cards()[1].classList.contains('warn')).toBe(false);
    expect(cards()[1].textContent).toContain('"tp at 500k mcap"');
  });

  it('a new message retires a card still waiting for a tap', async () => {
    await show();
    await say('tp at 2m');
    stub.parse = () => ({ type: 'help' });
    await say('help');
    expect(cards()[0].textContent).toContain('Skipped — nothing changed.');
    expect(btn('Add it')).toBeNull();
    expect(calls).toEqual([]);
  });

  it('keeps the last few exchanges; ✕ clears back to just the input', async () => {
    stub.parse = () => ({ type: 'help' });
    await show();
    for (const m of ['one', 'two', 'three', 'four']) await say(m);
    expect([...root.querySelectorAll('.tw-chat-you')].map((e) => e.textContent)).toEqual(['two', 'three', 'four']);
    await click(btn('✕'));
    expect($('.tw-chat-log')).toBeNull();
  });

  it('↑ recalls what you sent, ↓ goes back to an empty box', async () => {
    stub.parse = () => ({ type: 'help' });
    await show();
    await say('tp at 2m');
    await say('sl -30%');
    await key('ArrowUp');
    expect(input().value).toBe('sl -30%');
    await key('ArrowUp');
    expect(input().value).toBe('tp at 2m');
    await key('ArrowDown');
    expect(input().value).toBe('sl -30%');
    await key('ArrowDown');
    expect(input().value).toBe('');
  });

  it("keys typed in the chat don't reach fomo's page", async () => {
    const page = vi.fn();
    document.addEventListener('keydown', page);
    document.addEventListener('keyup', page);
    try {
      await show();
      await act(async () => {
        input().dispatchEvent(new KeyboardEvent('keydown', { key: 'b', bubbles: true }));
        input().dispatchEvent(new KeyboardEvent('keyup', { key: 'b', bubbles: true }));
      });
      expect(page).not.toHaveBeenCalled();
    } finally {
      document.removeEventListener('keydown', page);
      document.removeEventListener('keyup', page);
    }
  });

  it('end to end with the real parser: "hey tippy add a tp at 500k mcap on CLAUDIA"', async () => {
    stub.parse = null;
    const low = { ...claudia, priceUSD: 0.0002, mc: 200_000 };
    await show(ctx({ coin: low, fetchCoin: async () => low }));
    await say('hey tippy add a tp at 500k mcap on CLAUDIA');
    expect(cards()[0].textContent).toContain('Add a take-profit on $CLAUDIA');
    expect(cards()[0].textContent).toContain('$500K MC');
    expect(calls).toEqual([]);
    await click(btn('Add it'));
    await settle();
    expect(calls).toHaveLength(1);
    expect(calls[0].args[0]).toMatchObject({ tps: [{ trigger: { kind: 'mc', value: 500_000 } }] });
  });
});

describe('in Tippy\'s window', () => {
  it('sits at the bottom, and its keys stay in the window', async () => {
    const ok = async (): Promise<CommandResult> => ({ ok: true });
    const windowApi: WindowApi = { arm: ok, pause: ok, resume: ok, cancel: ok, resolveHeld: ok, retry: ok, update: ok, armBuy: ok, cancelBuy: ok, resolveBuy: ok, practice: ok };
    const page = vi.fn();
    document.addEventListener('keydown', page);
    try {
      await act(async () => {
        render(
          h(TippyWindow, {
            token: { ...claudia, chainName: 'Solana' },
            plan: null,
            presets: DEFAULT_PRESETS,
            defaultPresetId: 'classic',
            api: windowApi,
            intro: false,
            chat: h(Chat, { ctx: ctx() }),
          }),
          root,
        );
      });
      const tw = $('.tw')!;
      expect(tw.lastElementChild!.classList.contains('tw-chat')).toBe(true);
      await say('tp at 2m');
      expect(cards()[0].textContent).toContain('Add a take-profit on $CLAUDIA');
      await act(async () => {
        input().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      });
      expect(page).not.toHaveBeenCalled();
    } finally {
      document.removeEventListener('keydown', page);
    }
  });
});
