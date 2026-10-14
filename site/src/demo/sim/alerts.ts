// The demo's stand-in for the extension's shared/alerts (swapped in by
// vite.config.ts): linking Telegram is pretend, and nothing is sent anywhere.

export type AlertKind = 'filled' | 'failed' | 'attention' | 'ask' | 'blind' | 'logged-out' | 'guarding' | 'ui-changed' | 'test';

/** Link ids the pretend Telegram chat has "tapped Start" on. */
const linked = new Set<string>();

export function markLinked(linkId: string) {
  linked.add(linkId);
}

export function newLinkId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export async function linkStatus(linkId: string): Promise<boolean> {
  return linked.has(linkId);
}

export async function alert(): Promise<void> {}
export async function notify(): Promise<void> {}
export async function heartbeat(): Promise<void> {}
export function hookNotificationClicks(): void {}
