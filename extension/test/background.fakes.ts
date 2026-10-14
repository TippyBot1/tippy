// Test doubles for Tippy's background worker: an in-memory chrome.storage, a
// fake fomo (desk + trade tab) behind relay(), and recorded tabs, alerts and
// heartbeats. Nothing here touches the network or real fomo.
//
// The state lives on globalThis so a vi.resetModules() (a fresh worker, e.g. in
// the runtime tests) still talks to the same fake world.

import { buildBuy, evaluateBuy } from '../src/engine/buys';
import type { BuyAction, BuyInput, BuyOrder } from '../src/engine/types';
import { DEFAULT_STATUS, type ExecResult, type Holding, type RelayRequest, type RelayResponse, type StorageShape, type TokenQuote } from '../src/shared/messages';
import { withDefaults, type Settings } from '../src/shared/settings';

export const T0 = Date.UTC(2026, 9, 12, 12, 0, 0);
export const DESK = 7;
export const SOL = 1399811149;
export const KEY = `COIN:${SOL}`;
export const CASH_KEY = `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v:${SOL}`;
/** A coin with a billion supply: price 0.002 = $2M market cap. */
export const SUPPLY = 1e9;

export type ExecRequest = Extract<RelayRequest, { type: 'EXECUTE' | 'EXECUTE_BUY' }>;

export interface World {
  storage: Partial<StorageShape>;
  holdings: Holding[];
  unparsed: number;
  quotes: Record<string, TokenQuote>;
  balancesError: { error: string; authFailed?: boolean } | null;
  /** The trade tab's answer to EXECUTE / EXECUTE_BUY; null = the reply never came back. */
  exec: (req: ExecRequest, world: World) => Promise<ExecResult | null> | ExecResult | null;
  requests: { tabId: number; req: RelayRequest }[];
  tabsOpened: string[];
  tabsClosed: number[];
  focused: number[];
  alerts: { kind: string; title: string; text: string; dedupeKey?: string }[];
  heartbeats: number[];
  /** What notify() was asked to show (title, text, key, tone). */
  notices: { key: string; title: string; text: string; tone?: string }[];
  nextTabId: number;
  /** Tabs whose content script is gone (e.g. opened before Tippy was reloaded). */
  deadTabs: Set<number>;
  /** chrome.power calls: 'system' (keep awake) / 'release'. */
  power: string[];
  /** Scripted balance reads: each BALANCES call takes the next list (then falls back to `holdings`). */
  balancesSeq: Holding[][];
  /** Telegram link ids someone tapped Start on (what the alerts server would say). */
  telegramStarted: string[];
  /** newLinkId() results, in order. */
  linkIds: string[];
}

function newWorld(): World {
  return {
    storage: {},
    holdings: [],
    unparsed: 0,
    quotes: {},
    balancesError: null,
    exec: () => ({ stage: 'dry-run', clicked: false, detail: 'Dry run — not clicked.' }),
    requests: [],
    tabsOpened: [],
    tabsClosed: [],
    focused: [],
    alerts: [],
    heartbeats: [],
    notices: [],
    nextTabId: 100,
    deadTabs: new Set(),
    power: [],
    balancesSeq: [],
    telegramStarted: [],
    linkIds: ['link-1', 'link-2', 'link-3'],
  };
}

const g = globalThis as unknown as { __tippyWorld?: World };
export const world: World = (g.__tippyWorld ??= newWorld());

export function resetWorld() {
  Object.assign(world, newWorld());
}

// ---- world helpers ----

export function quoteAt(priceUSD: number, liquidity: number | null = 200_000, key = KEY): TokenQuote {
  return { key, priceUSD, mc: priceUSD * SUPPLY, liquidity, symbol: 'TST', name: 'Test Coin' };
}

export function setPrice(priceUSD: number, liquidity: number | null = 200_000) {
  world.quotes[KEY] = quoteAt(priceUSD, liquidity);
}

export function setCash(usd: number) {
  world.holdings = world.holdings.filter((h) => h.key !== CASH_KEY);
  if (usd > 0) world.holdings.push({ key: CASH_KEY, amount: usd, priceUSD: 1, mc: null, symbol: 'USDC', name: 'USD Coin' });
}

export function cash(): number {
  return world.holdings.find((h) => h.key === CASH_KEY)?.amount ?? 0;
}

export function setCoins(amount: number) {
  world.holdings = world.holdings.filter((h) => h.key !== KEY);
  const price = world.quotes[KEY]?.priceUSD ?? null;
  if (amount > 0) world.holdings.push({ key: KEY, amount, priceUSD: price, mc: price != null ? price * SUPPLY : null, symbol: 'TST', name: 'Test Coin' });
}

export function coins(): number {
  return world.holdings.find((h) => h.key === KEY)?.amount ?? 0;
}

/** fomo fills the buy when Buy is pressed: the coins (minus ~2% fees) show up, the cash goes. */
export function fillsOnPress(): World['exec'] {
  return (req) => {
    if (req.type !== 'EXECUTE_BUY') return { stage: 'error', clicked: false, detail: 'unexpected sell' };
    const price = world.quotes[KEY].priceUSD;
    setCoins(coins() + (req.action.usd / price) * 0.98);
    setCash(cash() - req.action.usd);
    return { stage: 'submitted', clicked: true, bought: true, detail: 'Bought' };
  };
}

export function execRequests(): ExecRequest[] {
  return world.requests.map((r) => r.req).filter((r): r is ExecRequest => r.type === 'EXECUTE' || r.type === 'EXECUTE_BUY');
}

export function settingsWith(patch: Partial<Settings> = {}): Settings {
  return { ...withDefaults(undefined), ...patch };
}

export function buyInput(over: Partial<BuyInput> = {}): BuyInput {
  return {
    id: 'b1',
    key: KEY,
    networkId: SOL,
    address: 'COIN',
    symbol: 'TST',
    name: 'Test Coin',
    trigger: { kind: 'mc', value: 1_600_000 },
    ref: { priceUSD: 0.002, mc: 2_000_000, source: 'armed-at' },
    usd: 10,
    guardPresetId: 'classic',
    expiresInMs: 24 * 3600_000,
    now: T0,
    ...over,
  };
}

/** A limit buy whose level was hit: the order is 'queued' and its action is ready for the queue. */
export function queuedBuy(over: Partial<BuyInput> = {}, price = 0.00155): { order: BuyOrder; action: BuyAction } {
  let order = buildBuy(buyInput(over));
  for (let i = 0; i < 5; i++) {
    const r = evaluateBuy(order, { priceUSD: price, mc: price * SUPPLY, at: T0 + i }, T0 + i);
    order = r.order;
    if (r.action) return { order, action: r.action };
  }
  throw new Error('the buy never fired');
}

// ---- module doubles ----

const DEFAULTS: Omit<StorageShape, 'settings' | 'status'> = { plans: {}, queue: [], buys: {}, practice: null, baseline: null, notices: [] };

export const fakeStore = {
  async load<K extends keyof StorageShape>(...keys: K[]): Promise<Pick<StorageShape, K>> {
    const out = {} as Record<string, unknown>;
    for (const k of keys) {
      const v = world.storage[k];
      if (k === 'settings') out.settings = withDefaults(structuredClone(v as Settings | undefined));
      else if (k === 'status') out.status = { ...DEFAULT_STATUS, ...structuredClone(v as StorageShape['status'] | undefined) };
      else out[k] = v === undefined ? structuredClone(DEFAULTS[k as keyof typeof DEFAULTS]) : structuredClone(v);
    }
    return out as Pick<StorageShape, K>;
  },
  async save(patch: Partial<StorageShape>): Promise<void> {
    for (const [k, v] of Object.entries(patch)) (world.storage as Record<string, unknown>)[k] = structuredClone(v);
  },
  watch: () => () => {},
};

export const fakeAlerts = {
  async alert(_settings: Settings, kind: string, title: string, text: string, dedupeKey?: string) {
    world.alerts.push({ kind, title, text, dedupeKey });
  },
  async notify(_settings: Settings, kind: string, n: { title: string; text: string; key: string }, dedupeKey?: string) {
    world.alerts.push({ kind, title: n.title, text: n.text, dedupeKey });
    world.notices.push(structuredClone(n));
  },
  async heartbeat(_settings: Settings, armed: number) {
    world.heartbeats.push(armed);
  },
  newLinkId: () => world.linkIds.shift() ?? 'link-x',
  linkStatus: async (id: string) => world.telegramStarted.includes(id),
};

async function relay<T>(tabId: number, req: RelayRequest): Promise<RelayResponse<T>> {
  world.requests.push({ tabId, req: structuredClone(req) });
  if (world.deadTabs.has(tabId)) return { ok: false, error: 'Could not establish connection. Receiving end does not exist.' };
  const session = { ok: true as const, expInSec: 3600 };
  const ok = (data: unknown) => ({ ok: true, data, session }) as RelayResponse<T>;
  switch (req.type) {
    case 'PING':
      return ok({ url: 'https://fomo.family/leaderboard' });
    case 'ME':
      return ok({ id: 'u1', handle: 'tester' });
    case 'CONFIG':
      return ok({});
    case 'HEALTH':
      return ok({ ok: true, missing: [] });
    case 'BALANCES':
      if (world.balancesError) return { ok: false, ...world.balancesError, session };
      return ok({ holdings: structuredClone(world.balancesSeq.shift() ?? world.holdings), unparsed: world.unparsed });
    case 'QUOTES':
      return ok(req.keys.flatMap((k) => (world.quotes[k] ? [structuredClone(world.quotes[k])] : [])));
    case 'EXECUTE':
    case 'EXECUTE_BUY': {
      const res = await world.exec(req, world);
      return res ? ok(res) : { ok: false, error: 'timeout' };
    }
  }
}

export const fakeRelayModule = {
  RELAY_TIMEOUT_MS: 4_000,
  EXEC_MARKER: 'tippy=sell',
  execTabs: new Set<number>(),
  relay,
  waitForContent: async () => true,
  focusTab: async (tabId: number) => {
    world.focused.push(tabId);
  },
  ensureDesk: async (_settings: Settings, status: { deskTabId: number | null }) => {
    status.deskTabId = DESK;
    return DESK;
  },
  recoverDesk: async () => 'waiting' as const,
  abandonDesk: async () => {},
  allowDeskNow: () => {},
  keepAlive: async () => {},
};

export const fakeBrowser = {
  tabs: {
    create: async ({ url }: { url: string }) => {
      world.tabsOpened.push(url);
      return { id: world.nextTabId++, url };
    },
    remove: async (id: number) => {
      world.tabsClosed.push(id);
    },
    update: async (id: number) => ({ id, windowId: 1 }),
    query: async () => [],
    get: async () => null,
    reload: async () => {},
    sendMessage: async () => undefined,
  },
  windows: { update: async () => ({}), get: async () => null },
  runtime: { getManifest: () => ({ version: '9.9.9' }), getURL: (p: string) => p, sendMessage: async () => {} },
  permissions: { contains: async () => false },
  power: {
    requestKeepAwake: (level: string) => void world.power.push(level),
    releaseKeepAwake: () => void world.power.push('release'),
  },
  storage: { local: { get: async () => ({}), set: async () => {} }, onChanged: { addListener() {}, removeListener() {} } },
};
