// Talking to Tippy's content script inside fomo tabs, and keeping the "desk" tab
// (the fomo tab Tippy reads prices through) alive.

import { browser } from 'wxt/browser';
import { DESK_URL, EXEC_MARKER } from '../shared/config';
import type { RelayRequest, RelayResponse, Status } from '../shared/messages';
import type { Settings } from '../shared/settings';

export const RELAY_TIMEOUT_MS = 4_000;

export async function relay<T>(tabId: number, req: RelayRequest, timeoutMs = RELAY_TIMEOUT_MS): Promise<RelayResponse<T>> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<RelayResponse<T>>((resolve) => {
    timer = setTimeout(() => resolve({ ok: false, error: 'timeout' }), timeoutMs);
  });
  try {
    const res = (await Promise.race([browser.tabs.sendMessage(tabId, req), timeout])) as RelayResponse<T> | undefined;
    return res ?? { ok: false, error: 'no-response' };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  } finally {
    clearTimeout(timer);
  }
}

/** Tabs Tippy opened to sell in — never used as the desk. */
export const execTabs = new Set<number>();
/** Query marker on trade tabs (lives in shared/config so fomo's page knows it too). */
export { EXEC_MARKER };

const isExecTab = (t: { id?: number; url?: string }) => (t.id != null && execTabs.has(t.id)) || (t.url ?? '').includes(EXEC_MARKER);
/** Desk tabs that didn't recover — skipped for a while, then given another chance. */
const abandoned = new Map<number, number>();
const ABANDON_MS = 10 * 60_000;
/** Desk tabs Tippy opened itself (so it may close them). */
const createdDesks = new Set<number>();
let lastDeskCreatedAt = 0;
export function allowDeskNow() {
  lastDeskCreatedAt = 0;
}
const focusedWaits = new Map<number, number>();
const DESK_CREATE_EVERY_MS = 10 * 60_000;

const isAbandoned = (id: number) => {
  const until = abandoned.get(id);
  if (until == null) return false;
  if (Date.now() > until) {
    abandoned.delete(id);
    return false;
  }
  return true;
};

export async function abandonDesk(tabId: number) {
  abandoned.set(tabId, Date.now() + ABANDON_MS);
  if (createdDesks.has(tabId)) {
    createdDesks.delete(tabId);
    await browser.tabs.remove(tabId).catch(() => {});
  }
}
const isDeskPage = (t: { url?: string }) => (t.url ?? '').startsWith(DESK_URL);

async function fomoTabs() {
  // Host permission for fomo.family lets us filter by URL without the `tabs` permission.
  return browser.tabs.query({ url: 'https://fomo.family/*' });
}

async function keepAlive(tabId: number) {
  try {
    await browser.tabs.update(tabId, { autoDiscardable: false });
  } catch {
    /* tab gone */
  }
}

/**
 * Find (or, with the user's OK, open) the fomo tab Tippy reads prices through.
 * Prefers the tab it used last, then a pinned fomo tab, then any fomo tab.
 */
export async function ensureDesk(settings: Settings, status: Status): Promise<number | null> {
  const tabs = (await fomoTabs()).filter((t) => t.id != null && !isExecTab(t) && !isAbandoned(t.id));
  const current = tabs.find((t) => t.id === status.deskTabId);
  const pick = current ?? tabs.find((t) => t.pinned && isDeskPage(t)) ?? tabs.find(isDeskPage) ?? tabs.find((t) => t.pinned) ?? tabs.find((t) => !t.discarded) ?? tabs[0];
  if (pick?.id != null) {
    if (pick.discarded) await browser.tabs.reload(pick.id).catch(() => {});
    if (pick.id !== status.deskTabId) await keepAlive(pick.id);
    status.deskTabId = pick.id;
    return pick.id;
  }
  if (!settings.deskConsent) {
    status.deskTabId = null;
    return null;
  }
  // Never spawn desks in a loop: at most one new desk per DESK_CREATE_EVERY_MS.
  if (Date.now() - lastDeskCreatedAt < DESK_CREATE_EVERY_MS) {
    status.deskTabId = null;
    return null;
  }
  lastDeskCreatedAt = Date.now();
  const tab = await browser.tabs.create({ url: DESK_URL, pinned: true, active: false });
  if (tab.id == null) return null;
  createdDesks.add(tab.id);
  await keepAlive(tab.id);
  status.deskTabId = tab.id;
  await waitForContent(tab.id, 30_000);
  return tab.id;
}

/** Wait until Tippy's content script answers in a tab. */
export async function waitForContent(tabId: number, timeoutMs: number): Promise<boolean> {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    const res = await relay(tabId, { type: 'PING' }, 1_500);
    if (res.ok) return true;
    await new Promise((r) => setTimeout(r, 700));
  }
  return false;
}

export async function focusTab(tabId: number) {
  const tab = await browser.tabs.update(tabId, { active: true });
  if (tab?.windowId != null) await browser.windows.update(tab.windowId, { focused: true }).catch(() => {});
}

export { keepAlive };

/**
 * The desk stopped answering: reload it (only if the user isn't looking at it and
 * we're online), and after two reloads that didn't help, give it up so
 * ensureDesk() picks another fomo tab or opens a fresh desk.
 */
export async function recoverDesk(tabId: number, reloadsSoFar: number): Promise<'reloaded' | 'waiting' | 'abandon'> {
  if (reloadsSoFar >= 2) return 'abandon';
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return 'waiting';
  const tab = await browser.tabs.get(tabId).catch(() => null);
  if (!tab) return 'abandon';
  // Don't yank the page the user is looking at (selected tab of the focused window) —
  // unless it has been dead for over 2 minutes.
  if (tab.active) {
    const win = await browser.windows.get(tab.windowId).catch(() => null);
    if (win?.focused) {
      const since = focusedWaits.get(tabId) ?? Date.now();
      focusedWaits.set(tabId, since);
      if (Date.now() - since < 120_000) return 'waiting';
    }
  }
  focusedWaits.delete(tabId);
  if (isDeskPage(tab) || !tab.url?.startsWith('https://fomo.family/')) await browser.tabs.update(tabId, { url: DESK_URL }).catch(() => {});
  else await browser.tabs.reload(tabId).catch(() => {});
  return 'reloaded';
}
