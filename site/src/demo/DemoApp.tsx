// The demo: a pretend coin page laid out like fomo's, in a browser window, with
// Tippy installed. Everything Tippy shows is the extension's real UI — its
// window, chat, fill pop-ups and chart lines on the coin page; its toolbar
// popup; its settings and welcome pages — running on pretend data through the
// stand-in browser in ./sim. One state behind all of it: change a preset in
// Settings and the window's P1/P2/P3 change; pause from the toolbar and nothing
// fills. Nothing here touches fomo, Telegram or real money.

import type { ComponentChildren } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { cancelBuy, isLiveBuy, resolveUnknownBuy } from '@ext/engine/buys';
import { buildPlan, planEditWith, undoDryRunFills } from '@ext/engine/orders';
import { formatUsd } from '@ext/engine/triggers';
import type { Plan } from '@ext/engine/types';
import { chartLinesFor, describeMove, stopTooSmall, triggerFromMove, type ChartLine, type ChartMove } from '@ext/shared/chartLines';
import { DEFAULT_STATUS, type Command, type CommandResult } from '@ext/shared/messages';
import { FILLED_TITLE, type Notice } from '@ext/shared/notices';
import { DEFAULT_PRESETS, withDefaults, type Settings } from '@ext/shared/settings';
import { useTippyState } from '@ext/ui/bridge';
import { Chat } from '@ext/ui/Chat';
import { moodFor } from '@ext/ui/format';
import { levelProblem, stopOrderNote } from '@ext/ui/levels';
import { Mascot } from '@ext/ui/Mascot';
import { PopupPage } from '@ext/ui/pages/PopupPage';
import { SettingsPage } from '@ext/ui/pages/SettingsPage';
import { WelcomePage } from '@ext/ui/pages/WelcomePage';
import { TelegramConnect } from '@ext/ui/TelegramConnect';
import { Toasts } from '@ext/ui/Toasts';
import { TippyPill, TippyWindow, type WindowApi, type WindowNotice, type WindowToggles } from '@ext/ui/TippyWindow';
import type { ChatCtx } from '@ext/chat/run';
import { MIN_USD, seedPath, SUPPLY, useMarket } from '../market';
import { linkStatus, markLinked, newLinkId } from './sim/alerts';
import { readStore, setCommandHandler, setOpenHandler, sim, writeStore } from './sim/browser';
import { FomoPage } from './FomoPage';
import { REPLAY } from './replay';

/** $TIPPY opens at an $800K market cap with a $100 bag and orders on. */
const START = 0.0008;
const BAG = 125_000;
const CASH = 150;
/** What the demo's QR code opens: this page (the real one opens @TippyAlertsBot). */
const DEMO_TG = 'https://tippybot.fun/demo';

/** /demo?film: the feature videos (see DemoApp's `film`). */
const FILM = new URLSearchParams(location.search).has('film');
/** The coin on the page: $TIPPY, or a replayed real trade. */
const COIN: { symbol: string; name: string; sub?: string; about?: string } = REPLAY ?? {
  symbol: 'TIPPY',
  name: 'Tippy',
  sub: 'Tippy · 1d · demo prices',
  about: 'Tippy running on $TIPPY. The prices and money on this page are pretend.',
};
const KEY = `${COIN.symbol.toLowerCase()}:1399811149`;

// The pretend extension's storage before anything renders: a fresh install, not set up yet
// (the feature videos start set up, so nothing nags).
void writeStore({
  settings: withDefaults(FILM ? { deskConsent: true, onboarded: true, keepActiveDone: true, loginItemDone: true } : { deskConsent: false, onboarded: false }),
  status: { ...DEFAULT_STATUS, health: 'watching', message: 'Watching your coins.' },
  plans: {},
  buys: {},
  notices: [],
  practice: null,
});

type View = 'coin' | 'settings' | 'welcome';
const TAB_TITLE: Record<View, string> = { coin: REPLAY ? `$${REPLAY.symbol} · replay` : `$${COIN.symbol} · demo`, settings: 'Tippy settings', welcome: 'Welcome to Tippy' };
const ADDRESS: Record<View, ComponentChildren> = {
  coin: REPLAY ? (
    <>
      <b>Replay of a real trade</b> — fomo’s real prices, shown on Tippy’s demo page
    </>
  ) : (
    <>
      <b>Demo page</b> — pretend prices, laid out like a coin page on fomo.family, where Tippy runs
    </>
  ),
  settings: 'chrome-extension://tippy/options.html',
  welcome: 'chrome-extension://tippy/welcome.html',
};

interface Phone {
  id: number;
  text: string;
}

/** Things to try, ticked off as you do them. */
type TaskId = 'tp' | 'stop' | 'buy' | 'chat' | 'drag' | 'fill' | 'preset' | 'telegram' | 'pause' | 'guard';
const TASKS: { id: TaskId; title: string; how: string }[] = [
  { id: 'tp', title: 'Add a take profit', how: 'In Tippy’s window: pick an amount, type a market cap above now, tap Add.' },
  { id: 'stop', title: 'Add a stop for part of your bag', how: 'Same box, a market cap below now — 10% or 25%, not just “the rest”.' },
  { id: 'buy', title: 'Set a limit buy', how: 'Tippy’s Buy tab: an amount and a market cap to buy at.' },
  { id: 'chat', title: 'Type an order in the chat', how: 'Try “sl half at 600k” in the box at the bottom of Tippy’s window.' },
  { id: 'drag', title: 'Drag a line on the chart', how: 'Grab a dashed line, drop it, then tap Move in Tippy’s window.' },
  { id: 'fill', title: 'Watch Tippy sell', how: 'Hit Pump above the page until a take profit fills.' },
  { id: 'preset', title: 'Change a preset', how: 'Settings tab → Presets. The P buttons in Tippy’s window follow.' },
  { id: 'telegram', title: 'Connect Telegram', how: 'Tap 🔔 in Tippy’s window → Connect Telegram → “Telegram on this computer”, then Start in the pretend chat. Nothing is sent.' },
  { id: 'pause', title: 'Pause everything', how: 'The Tippy button in the browser toolbar, then the switch.' },
  { id: 'guard', title: 'Auto-guard a new buy', how: 'Turn on Auto (🛡) in Tippy’s footer, stop the orders, then buy in the trade panel.' },
];

export function DemoApp({ film = false }: { film?: boolean }) {
  const state = useTippyState();
  const settingsRef = useRef<Settings>(withDefaults(undefined));
  if (state) settingsRef.current = state.settings;
  const s = settingsRef.current;

  const m = useMarket({
    symbol: COIN.symbol,
    name: COIN.name,
    startPrice: REPLAY ? REPLAY.seed[REPLAY.seed.length - 1] / SUPPLY : START,
    startBag: REPLAY ? 0 : BAG,
    startCash: REPLAY?.cash ?? CASH,
    historyLen: REPLAY ? 90 : 120,
    seedHistory: REPLAY ? () => REPLAY!.seed.map((mc) => mc / SUPPLY) : () => seedPath(START, START * 0.55, 120, 11),
    // /demo?film&fresh: a film that starts with no orders on (a replay starts before the trade).
    seedPlan: (base) => {
      if (REPLAY || (film && new URLSearchParams(location.search).has('fresh'))) return null;
      const p = buildPlan({
        ...base,
        id: 'demo-seed',
        entry: { priceUSD: START * 0.75, mc: START * 0.75 * SUPPLY, source: 'armed-at' },
        tps: [{ trigger: { kind: 'mc', value: 1_400_000 }, sellPct: 25 }],
        stops: [{ trigger: { kind: 'mc', value: 650_000 }, sellPct: 10 }],
        sl: { trigger: { kind: 'mc', value: 450_000 } },
        trailing: null,
        origin: 'manual',
      });
      p.lastPrice = START;
      return p;
    },
    getSettings: () => settingsRef.current,
    // The feature films script the market; the live demo starts it when an order goes on.
    autoKick: !film,
    onSettings: (patch) => void command({ type: 'SET_SETTINGS', patch }),
  });
  const live = useRef(m);
  live.current = m;

  /** Orders you add (in the window, the chat or by dragging) tick off the matching tasks. */
  const counted = (before: Plan | null, after: Plan | undefined) => {
    if (!after) return;
    const n = (k: 'tps' | 'stops') => (before && before.id === after.id ? (before[k] ?? []).length : 0);
    if (after.tps.length > n('tps')) tick('tp');
    if ((after.stops ?? []).length > n('stops')) tick('stop');
  };
  const api: WindowApi = {
    ...m.api,
    arm: async (input) => {
      const r = await m.api.arm(input);
      if (r.ok) counted(null, r.plan);
      return r;
    },
    update: async (planId, edit) => {
      const before = live.current.plan;
      const r = await m.api.update(planId, edit);
      if (r.ok) counted(before, r.plan);
      return r;
    },
    armBuy: async (input) => {
      const r = await m.api.armBuy(input);
      if (r.ok) tick('buy');
      return r;
    },
  };
  const chatCtx: ChatCtx = { ...m.chatCtx, settings: s, api: { ...m.chatCtx.api, arm: api.arm, update: api.update, armBuy: api.armBuy } };

  const [view, setView] = useState<View>('coin');
  const [popup, setPopup] = useState(false);
  const [note, setNote] = useState<{ id: number; text: string } | null>(null);
  const [phone, setPhone] = useState<Phone[]>([]);
  /** The pretend Telegram chat is open on @TippyAlertsBot, waiting for Start. */
  const [phoneStart, setPhoneStart] = useState(false);
  /** The 🔔 phone-alerts box in Tippy's window. */
  const [bell, setBell] = useState(false);
  const [done, setDone] = useState<Set<TaskId>>(new Set());
  const [tourOpen, setTourOpen] = useState(false);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const [minimized, setMinimized] = useState(false);
  const [dragged, setDragged] = useState<{ line: ChartLine; move: ChartMove } | null>(null);
  const [moveError, setMoveError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const coinRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<HTMLDivElement>(null);

  const tick = (id: TaskId) => setDone((d) => (d.has(id) ? d : new Set([...d, id])));
  // The feature videos carry their own captions: no demo notes in them.
  const say = (text: string) => !film && setNote({ id: Date.now(), text });
  const phoneSay = (text: string) => setPhone((xs) => [...xs.slice(-2), { id: Date.now() + Math.random(), text }]);

  useEffect(() => {
    if (!note) return;
    const t = setTimeout(() => setNote(null), 4_200);
    return () => clearTimeout(t);
  }, [note]);
  useEffect(() => {
    if (m.hint) say(m.hint.text);
  }, [m.hint]);

  // The pretend extension's storage follows the market, so the popup and the chat see the same orders.
  useEffect(() => {
    const plans: Record<string, Plan> = {};
    if (m.plan) plans[m.plan.id] = m.plan;
    void writeStore({ plans, buys: Object.fromEntries(m.buys.map((o) => [o.id, o])), notices: m.notices, practice: m.practice });
  }, [m.plan, m.buys, m.notices, m.practice]);
  useEffect(() => {
    void writeStore({ status: { ...DEFAULT_STATUS, health: s.paused ? 'paused' : 'watching', message: s.paused ? 'Paused.' : 'Watching your coins.' } });
    if (s.paused) tick('pause');
  }, [s.paused]);

  // Fills and guards: ticked off, and on the pretend phone when Telegram is linked.
  const seen = useRef(0);
  useEffect(() => {
    const fresh = m.notices.slice(seen.current);
    seen.current = m.notices.length;
    for (const n of fresh as Notice[]) {
      if (n.title === FILLED_TITLE && n.tone !== 'info' && /sold/i.test(n.text)) tick('fill');
      if (n.title.startsWith('🛡️')) tick('guard');
      if (settingsRef.current.telegram.linked) phoneSay(`${n.title}\n${n.text}`);
    }
  }, [m.notices]);

  // Tasks you finish in settings.
  useEffect(() => {
    if (JSON.stringify(s.presets) !== JSON.stringify(DEFAULT_PRESETS)) tick('preset');
    if (s.telegram.linked) tick('telegram');
  }, [s.presets, s.telegram.linked]);

  // ---- the pretend extension's commands (what its background script does) ----
  async function command(cmd: Command): Promise<CommandResult> {
    const mk = live.current;
    const now = Date.now();
    const cur = settingsRef.current;
    const mine = (id: string) => mk.plan?.id === id;
    switch (cmd.type) {
      case 'SET_SETTINGS': {
        if (cur.dryRun && cmd.patch.dryRun === false) mk.setPlan((p) => p && undoDryRunFills(p, now));
        await writeStore({ settings: withDefaults({ ...cur, ...cmd.patch }) });
        return { ok: true };
      }
      case 'PAUSE_ALL':
        await writeStore({ settings: { ...cur, paused: cmd.paused } });
        return { ok: true };
      case 'PAUSE_PLAN':
        return mine(cmd.planId) ? mk.api.pause(cmd.planId) : { ok: false, error: 'That order is gone.' };
      case 'RESUME_PLAN':
        return mine(cmd.planId) ? mk.api.resume(cmd.planId) : { ok: false, error: 'That order is gone.' };
      case 'CANCEL_PLAN':
        return mine(cmd.planId) ? mk.api.cancel(cmd.planId) : { ok: false, error: 'That order is gone.' };
      case 'CANCEL_BUY':
        return mk.api.cancelBuy(cmd.orderId);
      case 'RESOLVE_BUY':
        return mk.api.resolveBuy(cmd.orderId, cmd.bought);
      case 'ARM':
        return mk.api.arm(cmd.input);
      case 'ARM_BUY':
        return mk.api.armBuy(cmd.input);
      case 'UPDATE_PLAN':
        return mk.api.update(cmd.planId, cmd.edit);
      case 'PRACTICE':
        return mk.api.practice(cmd.key, cmd.side, cmd.usd);
      case 'MOVE_BUY':
        return mk.chatCtx.api.moveBuy(cmd.orderId, cmd.trigger, cmd.now);
      case 'OPEN_DESK':
        await writeStore({ settings: { ...cur, deskConsent: true } });
        return { ok: true };
      case 'TEST_ALERT':
        mk.notice({ key: '', title: '👋 Test from Tippy', text: 'Alerts are working. When an order fills you’ll see “Tippy filled order — Tippy sold 25% of $TIPPY at $1.4M MC.”', tone: 'info' });
        return { ok: true };
      case 'TELEGRAM_CONNECT': {
        if (cur.telegram.linked && cur.telegram.linkId) return { ok: true, telegram: { url: DEMO_TG, linked: true } };
        const linkId = cur.telegram.linkId ?? newLinkId();
        await writeStore({ settings: { ...cur, telegram: { linkId, linked: false } } });
        return { ok: true, telegram: { url: DEMO_TG, linked: false } };
      }
      case 'TELEGRAM_CHECK': {
        const { linkId, linked } = cur.telegram;
        if (!linkId) return { ok: true, telegram: { url: null, linked: false } };
        if (linked || !(await linkStatus(linkId))) return { ok: true, telegram: { url: DEMO_TG, linked } };
        await writeStore({ settings: { ...cur, telegram: { linkId, linked: true } } });
        mk.notice({ key: '', title: '📱 Tippy is on your phone', text: 'Alerts are working. You’ll get a message here when an order fills, when Tippy needs you, or if it stops watching.', tone: 'info' });
        return { ok: true, telegram: { url: DEMO_TG, linked: true } };
      }
      case 'TELEGRAM_OPEN':
        if (!cur.telegram.linkId) return { ok: false, error: 'Press Connect Telegram first.' };
        setPhone([]);
        setPhoneStart(true);
        return { ok: true };
      case 'TELEGRAM_DISCONNECT':
        await writeStore({ settings: { ...cur, telegram: { linkId: null, linked: false } } });
        return { ok: true };
      case 'OPEN_OPTIONS':
        go('settings', cmd.section);
        return { ok: true };
      default:
        return { ok: true };
    }
  }

  /** "Open a tab": the demo's views, a pretend Telegram, or a note about what Chrome would do. */
  const open = (url: string) => {
    if (url.startsWith('https://t.me/')) setPhoneStart(true);
    else if (url.includes('/options.html')) go('settings', url.split('#')[1]);
    else if (url.includes('/welcome.html')) go('welcome');
    else if (/^https:\/\/fomo\.family\/?$/.test(url)) {
      sim.fomoOpen = true;
      say('Pretend: you opened fomo.family and you’re logged in.');
    } else if (url.includes('fomo.family/tokens/')) {
      if (url.endsWith('/demo')) go('coin');
      else say('Only $TIPPY has a page in this demo.');
    } else if (url.startsWith('chrome://') || url.startsWith('edge://')) say('In Chrome this opens Settings → Performance, where you add fomo.family to “Always keep these sites active”.');
    else window.open(url, '_blank', 'noopener');
  };

  useEffect(() => {
    setCommandHandler((msg) => command(msg as Command));
    setOpenHandler(open);
  });

  /** Switch view, close the popup, and scroll to a section of the page if asked. */
  function go(v: View, section?: string) {
    setView(v);
    setPopup(false);
    // After the view has rendered (a page switch takes a frame or two).
    setTimeout(() => {
      const box = viewRef.current;
      if (!box) return;
      const el = section ? box.querySelector<HTMLElement>(`[id="${section}"]`) : null;
      box.scrollTo({ top: el ? el.getBoundingClientRect().top - box.getBoundingClientRect().top + box.scrollTop - 12 : 0 });
    }, 60);
  }

  // Deep links from the other pages: /demo#settings, #alerts, #setup, #popup, #chat.
  useEffect(() => {
    const route = () => {
      const h = location.hash.slice(1);
      if (h === 'settings') go('settings');
      else if (h === 'alerts' || h === 'awake') go('settings', h);
      else if (h === 'setup') go('welcome');
      else if (h === 'popup') (go('coin'), setPopup(true));
      else if (h === 'chat') (go('coin'), setTimeout(() => coinRef.current?.querySelector<HTMLInputElement>('.tw-chat-bar input')?.focus(), 300));
    };
    route();
    window.addEventListener('hashchange', route);
    return () => window.removeEventListener('hashchange', route);
  }, []);

  // A chat message sent counts as "typed an order".
  useEffect(() => {
    const el = coinRef.current;
    if (!el) return;
    const on = (e: Event) => (e.target as HTMLElement).closest?.('.tw-chat-bar') && tick('chat');
    el.addEventListener('submit', on, true);
    return () => el.removeEventListener('submit', on, true);
  }, []);

  // The popup closes when you click anywhere else.
  useEffect(() => {
    if (!popup) return;
    const off = (e: PointerEvent) => !(e.target as HTMLElement).closest('.bw-popup, .bw-ext') && setPopup(false);
    document.addEventListener('pointerdown', off);
    return () => document.removeEventListener('pointerdown', off);
  }, [popup]);

  // ---- the coin page: Tippy's window, its chart lines and a dragged line's question ----
  const plan = m.plan && (m.plan.state === 'armed' || m.plan.state === 'paused') ? m.plan : null;
  const lines = s.chartLines !== false ? chartLinesFor(KEY, plan ? [plan] : [], m.buys) : [];
  const putBack = () => (setDragged(null), setMoveError(null));
  let windowNotice: WindowNotice | null = null;
  if (dragged) {
    const { move, line } = dragged;
    const trigger = triggerFromMove(move);
    const now = { priceUSD: m.price, mc: m.price * SUPPLY };
    const [kind, id, levelId] = line.id.split(':');
    const p = kind !== 'buy' && plan?.id === id ? plan : null;
    const side = kind === 'buy' ? 'buy' : kind === 'sl' ? 'sl' : kind === 'stop' ? 'stop' : 'tp';
    const base = p ? { priceUSD: p.entry.priceUSD, mc: p.entry.mc } : now;
    const problem = moveError ?? levelProblem(trigger, side, now, base) ?? (kind === 'stop' && p ? stopTooSmall(p, levelId, trigger, MIN_USD) : null);
    const headsUp = p && (kind === 'stop' || kind === 'sl') ? stopOrderNote(p, kind, trigger, now, base, move.axis) : null;
    const confirm = async () => {
      const res =
        kind === 'buy'
          ? await m.chatCtx.api.moveBuy(id, trigger, now)
          : p
            ? await api.update(p.id, planEditWith(p, kind === 'sl' ? { sl: trigger } : kind === 'stop' ? { stop: { id: levelId, trigger } } : { tp: { id: levelId, trigger } }))
            : { ok: false as const, error: 'That plan has changed — try again.' };
      if (res.ok) (setDragged(null), setMoveError(null), tick('drag'));
      else setMoveError(res.error);
    };
    windowNotice = problem
      ? { text: problem, warn: true, onDismiss: putBack, dismissLabel: 'Put back' }
      : { text: headsUp ? `${describeMove(line, move)} ${headsUp}` : describeMove(line, move), warn: !!headsUp, onConfirm: confirm, confirmLabel: 'Move', onDismiss: putBack, dismissLabel: 'Keep' };
  }

  const toggles: WindowToggles = { autoGuard: s.autoGuard.enabled, dryRun: s.dryRun, alerts: s.telegram.linked || s.notifications, stayAwake: s.stayAwake };
  const onToggle = (name: keyof WindowToggles, v: boolean) => {
    if (name === 'autoGuard') void command({ type: 'SET_SETTINGS', patch: { autoGuard: { ...s.autoGuard, enabled: v } } });
    else if (name === 'dryRun') void command({ type: 'SET_SETTINGS', patch: { dryRun: v } });
    else if (name === 'stayAwake') void command({ type: 'SET_SETTINGS', patch: { stayAwake: v } });
    else setBell((b) => !b); // 🔔 phone alerts, right in the window — as in the extension
  };

  /** Drag Tippy's window by its header, inside the page, like on fomo. */
  const dragWindow = (e: PointerEvent) => {
    if ((e.target as HTMLElement).closest('button, input, a')) return;
    const page = coinRef.current;
    const host = (e.currentTarget as HTMLElement).closest<HTMLElement>('.tw-host');
    if (!page || !host) return;
    const pr = page.getBoundingClientRect();
    const hr = host.getBoundingClientRect();
    // the films zoom the page with a CSS transform: screen pixels → the page's own
    const k = pr.width / (page.offsetWidth || pr.width);
    const dx = (e.clientX - hr.left) / k;
    const dy = (e.clientY - hr.top) / k;
    const onMove = (ev: PointerEvent) =>
      setPos({
        x: Math.min((pr.width - hr.width) / k, Math.max(0, (ev.clientX - pr.left) / k - dx)),
        y: Math.min(pr.height / k - 40, Math.max(0, (ev.clientY - pr.top) / k - dy)),
      });
    const onUp = () => (window.removeEventListener('pointermove', onMove), window.removeEventListener('pointerup', onUp));
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  /** "Show me": take you to the place a task happens and point at it. */
  const show = (id: TaskId) => {
    setTourOpen(false);
    say(TASKS.find((t) => t.id === id)!.how);
    const target: Record<TaskId, [View, string, string?]> = {
      tp: ['coin', '.tw-level, .tw-form input'],
      stop: ['coin', '.tw-level, .tw-form input'],
      buy: ['coin', '.tw-mode-buy'],
      chat: ['coin', '.tw-chat-bar'],
      drag: ['coin', '.fx-chart'],
      fill: ['coin', '.dm-pump'],
      preset: ['settings', '.t-preset-edit'],
      telegram: ['coin', '.tw-foot'],
      pause: ['coin', '.bw-ext'],
      guard: ['coin', '.fx-trade'],
    };
    const [v, sel, section] = target[id];
    go(v, section);
    // The trade panel sits under Tippy's window: slide the window over the chart.
    if (id === 'guard' && coinRef.current && window.innerWidth > 860) {
      const page = coinRef.current.querySelector<HTMLElement>('.fx');
      const center = coinRef.current.querySelector<HTMLElement>('.fx-center');
      if (page && center) setPos({ x: center.offsetLeft + 12, y: Math.max(64, page.clientHeight - 640) });
    }
    if (minimized && v === 'coin') setMinimized(false);
    setTimeout(() => {
      const el = document.querySelector<HTMLElement>(sel.split(', ').map((x) => `.dm ${x}`).join(', '));
      if (!el) return;
      el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      setFlash(sel);
      el.classList.add('dm-flash');
      setTimeout(() => (el.classList.remove('dm-flash'), setFlash(null)), 2_400);
    }, 160);
  };

  const livePlans = [plan].filter((p): p is Plan => !!p && (p.state === 'armed' || p.state === 'paused'));
  const badge = livePlans.length + m.buys.filter(isLiveBuy).length;
  const mc = m.price * SUPPLY;
  const chg = (m.price / START - 1) * 100;

  const tour = (
    <div class="tour">
      <div class="tour-head">
        <b>Things to try</b>
        <span>
          {done.size} of {TASKS.length}
        </span>
      </div>
      <ol>
        {TASKS.map((t) => (
          <li key={t.id} class={done.has(t.id) ? 'is-done' : ''}>
            <span class="tour-tick" aria-hidden="true">
              {done.has(t.id) ? '✓' : ''}
            </span>
            <b>{t.title}</b>
            <button onClick={() => show(t.id)} aria-label={`Show me: ${t.title}`}>
              Show me
            </button>
          </li>
        ))}
      </ol>
    </div>
  );

  // Feature films (/demo?film): the capture script drives the demo through these.
  if (film)
    (window as unknown as { __film: unknown }).__film = {
      market: () => live.current,
      replay: REPLAY,
      settings: () => settingsRef.current,
      command,
      go,
      setPopup,
      setBell,
      setMinimized,
      setPos,
      phoneSay,
      setPhoneStart,
      clearPhone: () => (setPhone([]), setPhoneStart(false)),
    };

  return (
    <div class={`dm${film ? ' dm-film' : ''}`} id={film ? 'film-cam' : undefined} data-flash={flash ?? undefined}>
      <div class="dm-bar">
        <div class="dm-title">
          <h1>Demo</h1>
          <p>Pretend prices and money · the real Tippy</p>
        </div>
        <div class="dm-market" role="group" aria-label="Move the pretend market">
          <span class="dm-q">
            <small>${COIN.symbol} market cap</small>
            <b>{formatUsd(mc)}</b>
            <em class={chg >= 0 ? 'up' : 'down'}>
              {chg >= 0 ? '+' : '−'}
              {Math.abs(chg).toFixed(1)}%
            </em>
          </span>
          <button class="dbtn dbtn-up dm-pump" onClick={m.pump}>
            <i aria-hidden="true" /> Pump
          </button>
          <button class="dbtn dbtn-down" onClick={m.dump}>
            <i aria-hidden="true" /> Dump
          </button>
          <button class="dbtn" aria-pressed={m.auto} onClick={() => m.setAuto(!m.auto)}>
            {m.auto ? 'Pause market' : 'Let it run'}
          </button>
          <button
            class="dbtn dbtn-icon"
            onClick={() => {
              m.reset();
              setDragged(null);
              setPos(null);
              setMinimized(false);
            }}
            aria-label="Reset the demo"
            title="Reset the demo"
          >
            <svg width="15" height="15" viewBox="0 0 16 16" aria-hidden="true">
              <path d="M3.2 6.2A5 5 0 1 1 3 9.6" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" />
              <path d="M2.6 2.8v3.6h3.6" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" />
            </svg>
          </button>
        </div>
        <div class="dm-tour-btn">
          <button class="dbtn" aria-expanded={tourOpen} onClick={() => setTourOpen(!tourOpen)}>
            Things to try <span class="dm-count">{done.size}/{TASKS.length}</span>
          </button>
          {tourOpen && <div class="dm-tour-pop">{tour}</div>}
        </div>
      </div>

      <div class="dm-stage">
        <aside class="dm-side" aria-label="Things to try">
          {tour}
        </aside>

        <div class="bw" aria-label="A browser window with Tippy installed">
          <div class="bw-tabs" role="tablist" aria-label="Browser tabs">
            {(['coin', 'settings', 'welcome'] as View[]).map((v) => (
              <button key={v} role="tab" aria-selected={view === v} class="bw-tab" onClick={() => go(v)}>
                {v === 'coin' ? (
                  <span class="bw-fav bw-fav-coin" aria-hidden="true">
                    D
                  </span>
                ) : (
                  <img class="bw-fav" src="/favicon.svg" alt="" width="14" height="14" />
                )}
                <span>{TAB_TITLE[v]}</span>
              </button>
            ))}
          </div>
          <div class="bw-bar">
            <span class="bw-nav" aria-hidden="true">
              <svg width="14" height="14" viewBox="0 0 16 16">
                <path d="M10 3L5 8l5 5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" />
              </svg>
              <svg width="14" height="14" viewBox="0 0 16 16">
                <path d="M6 3l5 5-5 5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" />
              </svg>
            </span>
            <span class="bw-url">{ADDRESS[view]}</span>
            <button class="bw-ext" aria-expanded={popup} aria-label="Tippy (toolbar button)" title="Tippy" onClick={() => setPopup(!popup)}>
              <img src="/favicon.svg" alt="" width="18" height="18" />
              {badge > 0 && <span class="bw-badge">{badge}</span>}
            </button>
          </div>

          <div class="bw-view" ref={viewRef}>
            <div class="fx-wrap" ref={coinRef} hidden={view !== 'coin'}>
              <FomoPage
                symbol={COIN.symbol}
                name={COIN.name}
                sub={COIN.sub}
                about={COIN.about}
                clock0={REPLAY?.clock0}
                tag={REPLAY ? 'replay' : undefined}
                supply={SUPPLY}
                price={m.price}
                history={m.history}
                tick={m.tick}
                bag={m.bag}
                cash={m.cash}
                entry={plan?.entry.priceUSD ?? START}
                swaps={m.swaps}
                lines={lines}
                preview={dragged?.move ?? null}
                onDrop={(line, move) => {
                  setMoveError(null);
                  setDragged({ line, move });
                  setMinimized(false);
                }}
                onTrade={(side, amount) => m.trade(side, amount)}
                onNote={say}
              >
              {/* Tippy, as the extension draws it on the coin page: its window (or the pill), and its pop-ups. */}
              <div class="tippy tw-host" style={pos ? { left: `${pos.x}px`, top: `${pos.y}px` } : { right: '16px', bottom: '16px' }}>
                {minimized ? (
                  <TippyPill
                    mood={moodFor(s.paused ? 'paused' : 'watching', plan ? [plan] : [])}
                    count={badge}
                    label={[plan && '1 guarded', m.buys.some(isLiveBuy) && `${m.buys.filter(isLiveBuy).length} buy${m.buys.filter(isLiveBuy).length === 1 ? '' : 's'}`].filter(Boolean).join(' · ') || 'TP / SL / limit buy?'}
                    onOpen={() => setMinimized(false)}
                  />
                ) : (
                  <TippyWindow
                    key={m.plan?.id ?? 'new'}
                    token={m.token}
                    plan={plan}
                    buys={m.buys}
                    cash={m.cash}
                    minBuyUsd={MIN_USD}
                    minSellUsd={MIN_USD}
                    showTrailing={s.showTrailing}
                    practice={m.practice}
                    presets={s.presets}
                    defaultPresetId={s.defaultPresetId}
                    api={api}
                    intro={false}
                    toggles={toggles}
                    onToggle={onToggle}
                    onMinimize={() => setMinimized(true)}
                    dragHandle={dragWindow}
                    note={s.dryRun ? 'Dry run is on — Tippy won’t actually buy or sell' : undefined}
                    notice={windowNotice}
                    panel={bell ? <TelegramConnect settings={s} compact onClose={() => setBell(false)} /> : null}
                    chat={<Chat ctx={chatCtx} />}
                  />
                )}
              </div>
              <div class="tippy fx-toasts">
                <Toasts notices={m.notices} here={KEY} />
              </div>
              </FomoPage>
            </div>

            {view === 'settings' && (
              <div class="tippy bw-page">
                <SettingsPage />
              </div>
            )}
            {view === 'welcome' && (
              <div class="tippy bw-page">
                <WelcomePage />
              </div>
            )}
          </div>

          {popup && (
            <div class="tippy bw-popup" role="dialog" aria-label="Tippy toolbar popup">
              <PopupPage />
            </div>
          )}
          {note && (
            <p class="bw-note" role="status" key={note.id}>
              {note.text}
            </p>
          )}
        </div>
      </div>

      {(phone.length > 0 || phoneStart) && (
        <div class="phone" role="status" aria-label="Pretend phone: Telegram">
          <div class="phone-head">
            <Mascot mood="happy" size={22} />
            <b>TippyAlerts</b>
            <span>Telegram · pretend</span>
            <button aria-label="Close" onClick={() => (setPhone([]), setPhoneStart(false))}>
              ×
            </button>
          </div>
          {phoneStart && (
            <>
              <p>I'm Tippy's alert bot. Tap Start and I'll message you when Tippy sells or buys, needs you, or stops watching. I never ask for keys or passwords.</p>
              <button
                class="phone-start"
                onClick={() => {
                  const id = readStore<Settings>('settings')?.telegram.linkId;
                  if (id) markLinked(id);
                  setPhoneStart(false);
                  phoneSay("👋 Hi, I'm Tippy! You're connected.\nI'll message you when I take profit, hit a stop, need your OK, or stop watching.");
                }}
              >
                Start
              </button>
            </>
          )}
          {phone.map((p) => (
            <p key={p.id}>{p.text}</p>
          ))}
        </div>
      )}
    </div>
  );
}
