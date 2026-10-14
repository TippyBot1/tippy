// The demo's stand-in for `wxt/browser` (swapped in by vite.config.ts), so the
// extension's real settings page, toolbar popup and welcome page run here
// unchanged. Storage lives in memory; commands go to the demo instead of a
// service worker; "opening a tab" switches the demo's view instead of leaving
// the page. Nothing here reaches fomo, Telegram or Tippy's servers.

type Changes = Record<string, { newValue?: unknown }>;
type Listener = (changes: Changes, area: string) => void;

const store: Record<string, unknown> = {};
const listeners = new Set<Listener>();
let commands: ((msg: unknown) => Promise<unknown>) | null = null;
let opener: ((url: string) => void) | null = null;

/** Pretend browser state the pages ask about. */
export const sim = {
  /** "Open fomo and log in" was done (the welcome page's step 2). */
  fomoOpen: false,
  /** Optional permissions granted so far (desktop notifications). */
  granted: new Set<string>(),
};

/** The demo answers Tippy's commands (SET_SETTINGS, PAUSE_ALL, CANCEL_PLAN…). */
export function setCommandHandler(fn: (msg: unknown) => Promise<unknown>) {
  commands = fn;
}

/** The demo decides what "open this URL" means: a view, a note, or a real link. */
export function setOpenHandler(fn: (url: string) => void) {
  opener = fn;
}

function pick(keys: string | string[] | null | undefined) {
  if (keys == null) return structuredClone(store);
  const out: Record<string, unknown> = {};
  for (const k of Array.isArray(keys) ? keys : [keys]) if (k in store) out[k] = structuredClone(store[k]);
  return out;
}

/** Write to the pretend storage and tell every page, like chrome.storage does. */
export async function writeStore(patch: Record<string, unknown>) {
  Object.assign(store, structuredClone(patch));
  const changes: Changes = Object.fromEntries(Object.keys(patch).map((k) => [k, { newValue: patch[k] }]));
  listeners.forEach((l) => l(changes, 'local'));
}

export function readStore<T>(key: string): T | undefined {
  return store[key] as T | undefined;
}

const url = (p: string) => `chrome-extension://tippy${p.startsWith('/') ? p : `/${p}`}`;

export const browser = {
  storage: {
    local: {
      get: async (keys?: string | string[] | null) => pick(keys),
      set: writeStore,
    },
    onChanged: {
      addListener: (l: Listener) => void listeners.add(l),
      removeListener: (l: Listener) => void listeners.delete(l),
    },
  },
  runtime: {
    id: 'tippy-demo',
    sendMessage: async (msg: unknown) => commands?.(msg),
    getURL: url,
    getManifest: () => ({ version: __TIPPY_VERSION__ }),
    openOptionsPage: async () => opener?.(url('/options.html')),
    onMessage: { addListener: (..._a: unknown[]) => {} },
  },
  tabs: {
    query: async (_q?: { url?: string | string[] }) => (sim.fomoOpen ? [{ id: 1, url: 'https://fomo.family/' }] : []),
    create: async ({ url: to }: { url: string }) => (opener?.(to), { id: 2 }),
    sendMessage: async (_id: number, msg: { type?: string }) => (msg?.type === 'PING' ? { ok: true, session: { ok: true } } : undefined),
    update: async (..._a: unknown[]) => ({}),
    reload: async (..._a: unknown[]) => {},
    remove: async (..._a: unknown[]) => {},
  },
  windows: { update: async (..._a: unknown[]) => ({}) },
  permissions: {
    contains: async ({ permissions = [] }: { permissions?: string[] }) => permissions.every((p) => sim.granted.has(p)),
    // The demo can't show Chrome's prompt; it says yes, as you would.
    request: async ({ permissions = [] }: { permissions?: string[] }) => (permissions.forEach((p) => sim.granted.add(p)), true),
  },
  alarms: { create: (..._a: unknown[]) => {}, onAlarm: { addListener: (..._a: unknown[]) => {} } },
  // Optional APIs the demo never has (typed as Chrome's, so the shared code checks;
  // undefined at run time, which the extension code already guards with `?.`).
  notifications: undefined as unknown as { create(id: string, options: unknown): Promise<string>; clear(id: string): Promise<boolean>; onClicked: { addListener(fn: (id: string) => void): void } },
  power: undefined as unknown as { requestKeepAwake(level: string): void; releaseKeepAwake(): void },
};

export default browser;
