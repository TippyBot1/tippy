// @vitest-environment happy-dom
// The level box keeps what you type, key by key — even when the window passes
// the new level back late. On fomo the box redrew with the level it had sent one
// keystroke earlier ("2") before the window caught up with "2." (no level yet),
// took that for a change from outside and wiped the box. Here the window's update
// is delayed on purpose to reproduce that order.
import { h, render } from 'preact';
import { useState } from 'preact/hooks';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Trigger } from '../src/engine/types';
import { TriggerBox } from '../src/ui/OrderForm';

const now = { priceUSD: 0.00122, mc: 1_220_000 };
let root: HTMLDivElement;
let external: ((t: Trigger | null) => void) | null = null;

/** A window that applies the box's level a moment later (after the box has redrawn itself). */
function LateWindow() {
  const [trigger, setTrigger] = useState<Trigger | null>(null);
  external = setTrigger;
  return h(TriggerBox, { side: 'sell', trigger, unit: 'mc', canFlip: true, onFlip: () => {}, now, tone: null, onChange: (t: Trigger | null) => void setTimeout(() => setTrigger(t), 0) });
}

const box = () => root.querySelector<HTMLInputElement>('.tw-trig-in')!;
async function type(text: string) {
  await act(async () => {
    box().value = text;
    box().dispatchEvent(new Event('input', { bubbles: true }));
  });
  await act(async () => {
    await new Promise((r) => setTimeout(r, 5));
  });
}

beforeEach(() => {
  root = document.createElement('div');
  document.body.append(root);
});
afterEach(() => {
  render(null, root);
  root.remove();
  external = null;
});

describe('typing into the level box', () => {
  it('the exact order seen on fomo: "2" → "2." → the late "2" arrives → then "no level" — the box keeps "2."', async () => {
    const sent: (Trigger | null)[] = [];
    const show = (trigger: Trigger | null) =>
      act(async () => render(h(TriggerBox, { side: 'sell', trigger, unit: 'mc', canFlip: true, onFlip: () => {}, now, tone: null, onChange: (t: Trigger | null) => void sent.push(t) }), root));
    await show(null);
    await act(async () => {
      box().value = '2';
      box().dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => {
      box().value = '2.';
      box().dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(sent).toEqual([{ kind: 'mc', value: 2 }, null]);
    await show(sent[0]); // the window applies "2" only now — after "2." was typed
    expect(box().value).toBe('2.');
    await show(null); // …then catches up with "2." (no level yet)
    expect(box().value).toBe('2.');
    await act(async () => {
      box().value = '2.5m';
      box().dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(sent.at(-1)).toEqual({ kind: 'mc', value: 2_500_000 });
    await show(sent.at(-1)!);
    expect(box().value).toBe('2.5m');
  });

  it('keeps "2." (and then "2.5m") while the window catches up', async () => {
    await act(async () => render(h(LateWindow, {}), root));
    let typed = '';
    for (const ch of '2.5m') {
      typed += ch;
      await type(typed);
      expect(box().value).toBe(typed);
    }
  });

  it('a tiny price typed key by key survives too', async () => {
    await act(async () => render(h(LateWindow, {}), root));
    let typed = '';
    for (const ch of '0.0004') {
      typed += ch;
      await type(typed);
      expect(box().value).toBe(typed);
    }
  });

  it('a real change from outside (✎ an order, a cleared form) still replaces what was typed', async () => {
    await act(async () => render(h(LateWindow, {}), root));
    await type('2.5m');
    await act(async () => external!({ kind: 'mc', value: 900_000 }));
    expect(box().value).toBe('900K');
    await act(async () => external!(null));
    expect(box().value).toBe('');
  });
});
