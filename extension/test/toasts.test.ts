// @vitest-environment happy-dom
// Tippy's pop-ups on fomo's page: a fill shows "Tippy filled order — …" for a
// few seconds of you actually looking at the tab, pauses while hovered, × closes
// it, "View coin" opens a coin you're not on, and old news doesn't pop up when a
// page opens. Closed or fully shown pop-ups stay gone in that tab, even after a
// reload; and they keep out of the way while "Tippy is selling…" is up.
import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Notice } from '../src/shared/notices';
import { TOAST_MS, TOAST_ON_LOAD_MS, TOASTS_DONE_KEY, Toasts } from '../src/ui/Toasts';

const T0 = Date.UTC(2026, 9, 13, 12, 0, 0);
const HIGGS = 'HiGGsAddr:1399811149';
let root: HTMLDivElement;
let visibility: DocumentVisibilityState = 'visible';

const notice = (id: string, at: number, over: Partial<Notice> = {}): Notice => ({
  id,
  at,
  key: HIGGS,
  title: 'Tippy filled order',
  text: `Tippy bought $5 at $716K MC on $HIGGS. (${id})`,
  tone: 'good',
  ...over,
});

async function show(notices: Notice[], props: { here?: string | null; onOpen?: (key: string) => void; hidden?: boolean } = {}) {
  await act(async () => {
    render(h(Toasts, { notices, ...props }), root);
  });
}
const toasts = () => [...root.querySelectorAll<HTMLElement>('.tw-toast')];
const texts = () => toasts().map((t) => t.querySelector('.tw-toast-text')!.textContent);
async function pass(ms: number) {
  await act(async () => {
    vi.advanceTimersByTime(ms);
  });
}

beforeEach(() => {
  vi.useFakeTimers({ now: T0 });
  visibility = 'visible';
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibility });
  root = document.createElement('div');
  document.body.appendChild(root);
  window.sessionStorage.clear();
});

afterEach(() => {
  render(null, root);
  root.remove();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

/** A fresh page load in the same tab: the component starts over, sessionStorage stays. */
async function reload() {
  await act(async () => {
    render(null, root);
  });
}

describe("Tippy's pop-ups on fomo's page", () => {
  it('a fill pops up with the title and what happened, then goes after a few seconds', async () => {
    await show([]);
    expect(toasts()).toHaveLength(0);
    await show([notice('n1', T0)]);
    expect(toasts()).toHaveLength(1);
    expect(toasts()[0].querySelector('.tw-toast-title')!.textContent).toBe('Tippy filled order');
    expect(texts()[0]).toBe('Tippy bought $5 at $716K MC on $HIGGS. (n1)');
    expect(toasts()[0].className).toContain('good');
    await pass(TOAST_MS - 1_000);
    expect(toasts()).toHaveLength(1);
    await pass(1_000);
    expect(toasts()).toHaveLength(0);
  });

  it("waits for you: time in a background tab doesn't count", async () => {
    visibility = 'hidden';
    await show([notice('n1', T0)]);
    await pass(TOAST_MS * 5);
    expect(toasts()).toHaveLength(1);
    visibility = 'visible';
    await pass(TOAST_MS);
    expect(toasts()).toHaveLength(0);
  });

  it('stays while the pointer is on it', async () => {
    await show([notice('n1', T0)]);
    const box = root.querySelector('.tw-toasts')!;
    box.dispatchEvent(new MouseEvent('mouseenter'));
    await pass(TOAST_MS * 3);
    expect(toasts()).toHaveLength(1);
    box.dispatchEvent(new MouseEvent('mouseleave'));
    await pass(TOAST_MS);
    expect(toasts()).toHaveLength(0);
  });

  it('× closes it', async () => {
    await show([notice('n1', T0)]);
    await act(async () => root.querySelector<HTMLButtonElement>('.tw-toast-x')!.click());
    expect(toasts()).toHaveLength(0);
  });

  it('"View coin" opens a coin you\'re not looking at', async () => {
    const onOpen = vi.fn();
    await show([notice('n1', T0)], { here: HIGGS, onOpen });
    expect(root.querySelector('.tw-toast-open')).toBeNull(); // already on HIGGS
    await show([notice('n1', T0)], { here: 'OtherCoin:1399811149', onOpen });
    await act(async () => root.querySelector<HTMLButtonElement>('.tw-toast-open')!.click());
    expect(onOpen).toHaveBeenCalledWith(HIGGS);
    expect(toasts()).toHaveLength(0);
  });

  it('when a page opens, only fresh news pops up; at most three at once, newest on top', async () => {
    await show([notice('old', T0 - TOAST_ON_LOAD_MS - 1_000), notice('a', T0 - 60_000), notice('b', T0 - 1_000)]);
    expect(texts().map((t) => t!.match(/\((\w+)\)/)![1])).toEqual(['b', 'a']);
    await show([notice('a', T0 - 60_000), notice('b', T0 - 1_000), notice('c', T0), notice('d', T0)]);
    expect(texts().map((t) => t!.match(/\((\w+)\)/)![1])).toEqual(['d', 'c', 'b']);
  });

  it('closing the last pop-up while the pointer is on it does not freeze the next one', async () => {
    await show([notice('n1', T0)]);
    root.querySelector('.tw-toasts')!.dispatchEvent(new MouseEvent('mouseenter'));
    // × removes the whole stack, so no mouseleave ever comes.
    await act(async () => root.querySelector<HTMLButtonElement>('.tw-toast-x')!.click());
    expect(toasts()).toHaveLength(0);
    await show([notice('n1', T0), notice('n2', T0 + 1_000)]);
    expect(texts()).toEqual(['Tippy bought $5 at $716K MC on $HIGGS. (n2)']);
    await pass(TOAST_MS);
    expect(toasts()).toHaveLength(0);
  });

  it('closed or fully shown pop-ups stay gone after a reload of the tab', async () => {
    const all = [notice('closed', T0), notice('shown', T0), notice('half', T0)];
    await show([all[0]]);
    await act(async () => root.querySelector<HTMLButtonElement>('.tw-toast-x')!.click());
    await show([all[0], all[1]]);
    await pass(TOAST_MS);
    await show([all[0], all[1], all[2]]);
    await pass(TOAST_MS / 2);
    expect(JSON.parse(window.sessionStorage.getItem(TOASTS_DONE_KEY)!)).toEqual(['closed', 'shown']);
    await reload();
    await show(all);
    expect(texts().map((t) => t!.match(/\((\w+)\)/)![1])).toEqual(['half']); // half-seen comes back, the rest don't
  });

  it('"View coin" marks the pop-up done before it navigates', async () => {
    let storedWhenOpened: unknown = null;
    const onOpen = vi.fn(() => (storedWhenOpened = JSON.parse(window.sessionStorage.getItem(TOASTS_DONE_KEY) ?? 'null')));
    await show([notice('n1', T0)], { here: 'OtherCoin:1399811149', onOpen });
    await act(async () => root.querySelector<HTMLButtonElement>('.tw-toast-open')!.click());
    expect(onOpen).toHaveBeenCalledWith(HIGGS);
    expect(storedWhenOpened).toEqual(['n1']);
    await reload();
    await show([notice('n1', T0)], { here: HIGGS, onOpen });
    expect(toasts()).toHaveLength(0);
  });

  it('works when the page blocks sessionStorage', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    await show([notice('n1', T0)]);
    expect(toasts()).toHaveLength(1);
    await act(async () => root.querySelector<HTMLButtonElement>('.tw-toast-x')!.click());
    expect(toasts()).toHaveLength(0);
  });

  it('hidden while "Tippy is selling…" is up: nothing shows and no time counts', async () => {
    await show([notice('n1', T0)], { hidden: true });
    expect(toasts()).toHaveLength(0);
    await pass(TOAST_MS * 2);
    await show([notice('n1', T0)], { hidden: false });
    expect(toasts()).toHaveLength(1);
    await pass(TOAST_MS);
    expect(toasts()).toHaveLength(0);
  });

  it('a stop shows red, an expiry amber', async () => {
    await show([notice('s', T0, { tone: 'stop' }), notice('e', T0, { tone: 'info', title: 'Tippy order expired' })]);
    expect(toasts().map((t) => t.className)).toEqual(['tw-toast info', 'tw-toast stop']);
  });
});
