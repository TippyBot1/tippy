// Extension-only glue between Preact UIs and the background service worker.
import { useEffect, useState } from 'preact/hooks';
import { browser } from 'wxt/browser';
import type { ChatApi } from '../chat/run';
import type { Command, CommandResult, StorageShape } from '../shared/messages';
import { load, watch } from '../shared/store';
import type { WindowApi } from './TippyWindow';

export async function send(cmd: Command): Promise<CommandResult> {
  try {
    return ((await browser.runtime.sendMessage(cmd)) as CommandResult) ?? { ok: false, error: 'No answer from Tippy.' };
  } catch (e) {
    return { ok: false, error: 'Tippy was just updated — reload this page.' };
  }
}

export const cardApi: WindowApi = {
  arm: (input) => send({ type: 'ARM', input }),
  pause: (planId) => send({ type: 'PAUSE_PLAN', planId }),
  resume: (planId) => send({ type: 'RESUME_PLAN', planId }),
  cancel: (planId) => send({ type: 'CANCEL_PLAN', planId }),
  resolveHeld: (planId, level, sell) => send({ type: 'RESOLVE_HELD', planId, level, sell }),
  retry: (planId, level) => send({ type: 'RETRY_LEVEL', planId, level }),
  update: (planId, edit) => send({ type: 'UPDATE_PLAN', planId, edit }),
  armBuy: (input) => send({ type: 'ARM_BUY', input }),
  cancelBuy: (orderId) => send({ type: 'CANCEL_BUY', orderId }),
  resolveBuy: (orderId, bought) => send({ type: 'RESOLVE_BUY', orderId, bought }),
  practice: (key, side, usd) => send({ type: 'PRACTICE', key, side, usd }),
};

/** What a confirmed chat card can send: the window's commands plus moving a buy, settings and pause-all. */
export const chatApi: ChatApi = {
  ...cardApi,
  moveBuy: (orderId, trigger, now) => send({ type: 'MOVE_BUY', orderId, trigger, now }),
  setSettings: (patch) => send({ type: 'SET_SETTINGS', patch }),
  pauseAll: (paused) => send({ type: 'PAUSE_ALL', paused }),
};

const KEYS = ['plans', 'settings', 'status', 'buys', 'practice', 'notices'] as const;
type Snapshot = Pick<StorageShape, (typeof KEYS)[number]>;

export function useTippyState(): Snapshot | null {
  const [state, setState] = useState<Snapshot | null>(null);
  useEffect(() => {
    let off: (() => void) | null = null;
    try {
      off = watch([...KEYS], setState);
    } catch {
      load(...KEYS).then(setState);
    }
    return () => off?.();
  }, []);
  return state;
}
