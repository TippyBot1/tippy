// Dev-only stand-in for `wxt/browser`: in-memory storage + a runtime that routes
// commands to Tippy's real background command handler.
type Listener = (changes: Record<string, unknown>, area: string) => void;

const store: Record<string, unknown> = {};
const listeners = new Set<Listener>();

function pick(keys: string | string[] | null | undefined) {
  if (keys == null) return { ...store };
  const list = Array.isArray(keys) ? keys : [keys];
  const out: Record<string, unknown> = {};
  for (const k of list) if (k in store) out[k] = structuredClone(store[k]);
  return out;
}

let handler: ((msg: unknown) => Promise<unknown>) | null = null;
export function setCommandHandler(fn: (msg: unknown) => Promise<unknown>) {
  handler = fn;
}

export const browser = {
  storage: {
    local: {
      get: async (keys?: string | string[]) => pick(keys),
      set: async (patch: Record<string, unknown>) => {
        Object.assign(store, structuredClone(patch));
        const changes = Object.fromEntries(Object.keys(patch).map((k) => [k, { newValue: patch[k] }]));
        listeners.forEach((l) => l(changes, 'local'));
      },
    },
    onChanged: {
      addListener: (l: Listener) => listeners.add(l),
      removeListener: (l: Listener) => listeners.delete(l),
    },
  },
  runtime: {
    id: 'harness',
    sendMessage: async (msg: unknown) => handler?.(msg),
    getURL: (p: string) => p,
    getManifest: () => ({ version: '0.0.0-harness' }),
    openOptionsPage: () => {},
    onMessage: { addListener: () => {} },
  },
  tabs: {
    query: async () => [],
    create: async ({ url }: { url: string }) => (console.info('[harness] would open', url), { id: 1 }),
    sendMessage: async () => undefined,
    update: async () => ({}),
    reload: async () => {},
    remove: async () => {},
  },
  windows: { update: async () => ({}) },
  permissions: { contains: async () => false, request: async () => false },
  alarms: { create: () => {}, onAlarm: { addListener: () => {} } },
  notifications: undefined,
  power: undefined,
};
