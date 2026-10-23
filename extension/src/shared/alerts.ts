// Phone + desktop alerts. Telegram goes through Tippy's own alerts worker (it
// sends CORS headers, so the extension needs no extra host permission). The
// payload is a short human sentence — never wallet addresses or session tokens.

import { browser } from 'wxt/browser';
import { parseKey, tokenUrl } from './chains';
import { ALERTS_URL } from './config';
import { KEEP_NOTICES, type Notice, type NoticeText } from './notices';
import type { Settings } from './settings';
import { load, save } from './store';

export type AlertKind = 'filled' | 'failed' | 'attention' | 'ask' | 'blind' | 'logged-out' | 'guarding' | 'ui-changed' | 'test' | 'near';

const lastSent = new Map<string, number>();
const DEDUPE_MS = 10 * 60_000;

/** True when something with this key already went out within `ms` (and remembers this one otherwise). */
function sentRecently(dedupeKey: string | undefined, ms: number): boolean {
  if (!dedupeKey) return false;
  const prev = lastSent.get(dedupeKey) ?? 0;
  if (Date.now() - prev < ms) return true;
  lastSent.set(dedupeKey, Date.now());
  return false;
}

export async function alert(settings: Settings, kind: AlertKind, title: string, text: string, dedupeKey?: string, dedupeMs = DEDUPE_MS): Promise<void> {
  if (sentRecently(dedupeKey, dedupeMs)) return;
  await Promise.allSettled([desktop(settings, title, text), telegram(settings, kind, `${title}\n${text}`)]);
}

/**
 * An order filled or ran out: a pop-up from Tippy on fomo's page (always — it
 * needs no permission), plus the desktop notification and Telegram when they're on.
 * `dedupeKey`: the same notice isn't shown again within `dedupeMs`.
 */
export async function notify(settings: Settings, kind: AlertKind, n: NoticeText, dedupeKey?: string, dedupeMs = DEDUPE_MS): Promise<void> {
  if (sentRecently(dedupeKey, dedupeMs)) return;
  await Promise.allSettled([pushNotice(n), desktop(settings, n.title, n.text, n.key), telegram(settings, kind, `${n.title}\n${n.text}`)]);
}

let noticeChain: Promise<unknown> = Promise.resolve();

/** Adds to the notices fomo's page shows. Only this writes `notices`, one at a time. */
function pushNotice(n: NoticeText): Promise<void> {
  const next = noticeChain.then(async () => {
    const { notices } = await load('notices');
    const notice: Notice = { ...n, id: crypto.randomUUID(), at: Date.now() };
    await save({ notices: [...(notices ?? []), notice].slice(-KEEP_NOTICES) });
  });
  noticeChain = next.catch(() => {});
  return next;
}

/** Desktop notification ids carry the coin, so clicking one opens it on fomo. */
const NOTE_PREFIX = 'tippy|';

async function desktop(settings: Settings, title: string, message: string, key?: string) {
  if (!settings.notifications || !browser.notifications) return;
  if (!(await browser.permissions.contains({ permissions: ['notifications'] }))) return;
  hookNotificationClicks();
  await browser.notifications.create(`${NOTE_PREFIX}${key ?? ''}|${crypto.randomUUID()}`, {
    type: 'basic',
    iconUrl: browser.runtime.getURL('/icon/128.png'),
    title,
    message,
    priority: 2,
  });
}

let clicksHooked = false;

/**
 * Clicking a Tippy notification opens that coin on fomo. Called when the service
 * worker starts (so a click can wake it) and again once notifications are allowed.
 */
export function hookNotificationClicks(): void {
  if (clicksHooked || !browser.notifications?.onClicked) return;
  clicksHooked = true;
  browser.notifications.onClicked.addListener((id) => {
    if (!id.startsWith(NOTE_PREFIX)) return;
    void browser.notifications.clear(id);
    const coin = parseKey(id.slice(NOTE_PREFIX.length).split('|')[0]);
    void browser.tabs.create({ url: coin ? tokenUrl(coin.address, coin.networkId) : 'https://fomo.family/' });
  });
}

async function telegram(settings: Settings, kind: AlertKind, text: string) {
  const { linkId, linked } = settings.telegram;
  if (!linkId || !linked) return;
  await fetch(`${ALERTS_URL}/notify`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ linkId, kind, text }),
  });
}

/** Dead-man heartbeat: the worker alerts you if these stop while orders are armed. */
export async function heartbeat(settings: Settings, armed: number): Promise<void> {
  const { linkId, linked } = settings.telegram;
  if (!linkId || !linked) return;
  await fetch(`${ALERTS_URL}/heartbeat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ linkId, armed }),
  }).catch(() => {});
}

export function newLinkId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export async function linkStatus(linkId: string): Promise<boolean> {
  try {
    const res = await fetch(`${ALERTS_URL}/link/${linkId}`);
    if (!res.ok) return false;
    return ((await res.json()) as { linked?: boolean }).linked === true;
  } catch {
    return false;
  }
}
