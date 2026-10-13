import { browser } from 'wxt/browser';
import { DEFAULT_STATUS, type StorageShape } from './messages';
import { withDefaults } from './settings';

const DEFAULTS: StorageShape = {
  plans: {},
  settings: withDefaults(undefined),
  status: DEFAULT_STATUS,
  queue: [],
  buys: {},
  practice: null,
  baseline: null,
  notices: [],
};

export async function load<K extends keyof StorageShape>(...keys: K[]): Promise<Pick<StorageShape, K>> {
  const raw = (await browser.storage.local.get(keys as (keyof StorageShape)[])) as Partial<StorageShape>;
  const out = {} as Pick<StorageShape, K>;
  for (const k of keys) {
    const v = raw[k];
    if (k === 'settings') (out as StorageShape).settings = withDefaults(v as StorageShape['settings']);
    else if (k === 'status') (out as StorageShape).status = { ...DEFAULT_STATUS, ...(v as StorageShape['status']) };
    else (out as Record<string, unknown>)[k] = v ?? structuredClone(DEFAULTS[k]);
  }
  return out;
}

/** Only the background service worker writes; UIs send commands. */
export async function save(patch: Partial<StorageShape>): Promise<void> {
  await browser.storage.local.set(patch);
}

/** Subscribe to storage changes for live UIs. Returns an unsubscribe fn. */
export function watch<K extends keyof StorageShape>(keys: K[], cb: (v: Pick<StorageShape, K>) => void): () => void {
  let alive = true;
  const refresh = () => load(...keys).then((v) => alive && cb(v));
  const listener = (changes: Record<string, unknown>, area: string) => {
    if (area === 'local' && keys.some((k) => k in changes)) refresh();
  };
  browser.storage.onChanged.addListener(listener);
  refresh();
  return () => {
    alive = false;
    browser.storage.onChanged.removeListener(listener);
  };
}
