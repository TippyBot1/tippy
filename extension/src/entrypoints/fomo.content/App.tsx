import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import { browser } from 'wxt/browser';
import type { ContentScriptContext } from 'wxt/utils/content-script-context';
import type { ChatCoin, ChatCtx, ChatState } from '../../chat/run';
import { isLiveBuy } from '../../engine/buys';
import { planEditWith } from '../../engine/orders';
import type { BuyOrder, Plan } from '../../engine/types';
import { chartLinesFor, describeMove, LINES_EVENT, MOVED_EVENT, MOVED_SOURCE, stopTooSmall, triggerFromMove, type ChartLine, type ChartMove, type ChartPayload, type MovedMessage } from '../../shared/chartLines';
import * as fomo from '../../fomo/api';
import { cashUsd, chainById, isCashOrNative, parseKey, tokenFromUrl, tokenUrl } from '../../shared/chains';
import { EXEC_MARKER, minTradeUsdFor } from '../../shared/config';
import type { TokenQuote } from '../../shared/messages';
import { cardApi, chatApi, send, useTippyState } from '../../ui/bridge';
import { Chat } from '../../ui/Chat';
import { healthText, moodFor } from '../../ui/format';
import { Mascot } from '../../ui/Mascot';
import { PlanList } from '../../ui/PlanList';
import { levelProblem, stopOrderNote } from '../../ui/levels';
import { TelegramConnect } from '../../ui/TelegramConnect';
import { Toasts } from '../../ui/Toasts';
import { TippyPill, TippyWindow, type WindowNotice, type WindowToggles, type WindowToken } from '../../ui/TippyWindow';

// ---- "Tippy is trading" overlay state, set by the relay while executing ----
export type Selling = {
  side: 'sell' | 'buy';
  symbol: string;
  /** Sells: % of the bag. */
  pct?: number;
  /** Buys: cash to spend. */
  usd?: number;
  dryRun: boolean;
  /** A practice run from the window (always a dry run). */
  practice?: boolean;
} | null;
let selling: Selling = null;
const sellingListeners = new Set<(s: Selling) => void>();
export function setSelling(s: Selling) {
  selling = s;
  sellingListeners.forEach((l) => l(s));
}

// Window position + minimised state are per-viewer conveniences in their own key
// (the background never writes it).
interface UiPrefs {
  pos: { x: number; y: number } | null;
  minimized: boolean;
}
const UI_KEY = 'ui';
const MARGIN = 12;

/**
 * A coin for the chat, read fresh from fomo: price, market cap (price × total
 * supply, like everywhere else) and your bag. `known` fills in what fomo doesn't
 * say (and keeps the address as Tippy stored it).
 */
async function readChatCoin(key: string, known?: Pick<ChatCoin, 'address' | 'symbol' | 'name'> | null, bals?: fomo.BalancesRead | null): Promise<ChatCoin | null> {
  const k = parseKey(key);
  if (!k) return null;
  const [q, b] = await Promise.all([fomo.quotes([key]).catch((): TokenQuote[] => []), bals !== undefined ? bals : fomo.balances().catch(() => null)]);
  const quote = q.find((x) => x.key === key) ?? null;
  const bag = b?.holdings.find((h) => h.key === key) ?? null;
  const symbol = quote?.symbol ?? bag?.symbol ?? known?.symbol;
  if (!symbol) return null;
  return {
    key,
    address: known?.address ?? k.address,
    networkId: k.networkId,
    symbol,
    name: quote?.name ?? bag?.name ?? known?.name ?? '',
    priceUSD: quote?.priceUSD ?? bag?.priceUSD ?? null,
    mc: quote?.mc ?? bag?.mc ?? null,
    // Missing from a balances read only means "none" when every row was understood.
    balance: b ? (bag?.amount ?? (b.unparsed ? null : 0)) : null,
  };
}

/** The chat's "on CLAUDIA": a coin with a running plan or a limit buy, else the biggest bag you hold with that symbol. */
async function resolveChatCoin(symbol: string, plans: Plan[], buys: BuyOrder[]): Promise<ChatCoin | null> {
  const s = symbol.toLowerCase();
  const known = plans.find((p) => (p.state === 'armed' || p.state === 'paused') && p.symbol.toLowerCase() === s) ?? buys.find((o) => isLiveBuy(o) && o.symbol.toLowerCase() === s) ?? null;
  const bals = await fomo.balances().catch(() => null);
  let key = known?.key ?? null;
  if (!key && bals) {
    const value = (h: { amount: number; priceUSD: number | null }) => h.amount * (h.priceUSD ?? 0);
    const held = bals.holdings
      .filter((h) => h.amount > 0 && h.symbol.toLowerCase() === s && !isCashOrNative(parseKey(h.key)?.address ?? '', parseKey(h.key)?.networkId ?? 0))
      .sort((a, b) => value(b) - value(a))[0];
    key = held?.key ?? null;
  }
  return key ? readChatCoin(key, known, bals) : null;
}

function clamp(p: { x: number; y: number }, w: number, h: number) {
  return {
    x: Math.max(MARGIN, Math.min(p.x, innerWidth - w - MARGIN)),
    y: Math.max(MARGIN, Math.min(p.y, innerHeight - h - MARGIN)),
  };
}

export function App({ ctx }: { ctx: ContentScriptContext }) {
  const state = useTippyState();
  const [href, setHref] = useState(location.href);
  const [sell, setSell] = useState<Selling>(selling);
  const [prefs, setPrefs] = useState<UiPrefs | null>(null);
  const [manualOpen, setManualOpen] = useState(false);
  const [token, setToken] = useState<WindowToken | null>(null);
  /** fomo cash (USDC) in USD, null = couldn't read balances. */
  const [cash, setCash] = useState<number | null>(null);
  const [tokenError, setTokenError] = useState(false);
  /** A tab Tippy opened to trade in: no pop-ups there (fomo may tidy the address later, so remember it). */
  const [tradeTab] = useState(() => location.href.includes(EXEC_MARKER));
  const host = useRef<HTMLDivElement>(null);
  const dragMoved = useRef(false);
  /** Plans / buys / settings right now, for a chat card confirmed after they changed. */
  const chatState = useRef<ChatState | null>(null);

  const [minimums, setMinimums] = useState<fomo.Minimums | null>(null);
  useEffect(() => {
    fomo.minimums().then(setMinimums, () => {});
  }, []);

  useEffect(() => {
    sellingListeners.add(setSell);
    browser.storage.local.get(UI_KEY).then((v) => setPrefs({ pos: null, minimized: false, ...(v[UI_KEY] as Partial<UiPrefs> | undefined) }));
    const onChange = () => setHref(location.href);
    ctx.addEventListener(window, 'wxt:locationchange', onChange);
    // fomo switches coins in-page; Chrome's navigation event doesn't always reach
    // the extension (seen live 2026-10-12: the window kept showing the old coin).
    // Polling the address is cheap and never misses.
    ctx.setInterval(onChange, 500);
    return () => void sellingListeners.delete(setSell);
  }, []);

  const savePrefs = (p: UiPrefs) => {
    setPrefs(p);
    browser.storage.local.set({ [UI_KEY]: p }).catch(() => {});
  };

  const here = useMemo(() => tokenFromUrl(href), [href]);
  const open = here ? !prefs?.minimized : manualOpen;

  // Keep the coin's price and your bag fresh while the window is open.
  useEffect(() => {
    setToken(null);
    setTokenError(false);
    setManualOpen(false);
    if (!here || !open) return;
    let alive = true;
    const load = async () => {
      try {
        const [q, bals] = await Promise.all([fomo.quotes([here.key]), fomo.balances().catch(() => null)]);
        if (!alive) return;
        const quote = q[0];
        const bag = bals?.holdings.find((b) => b.key === here.key);
        setTokenError(false);
        setCash(bals ? cashUsd(bals.holdings) : null);
        setToken({
          key: here.key,
          address: here.address,
          networkId: here.networkId,
          chainName: chainById(here.networkId)?.name ?? '',
          symbol: quote?.symbol ?? bag?.symbol ?? '…',
          name: quote?.name ?? bag?.name ?? '',
          priceUSD: quote?.priceUSD ?? bag?.priceUSD ?? null,
          mc: quote?.mc ?? bag?.mc ?? null,
          balance: bals ? (bag?.amount ?? 0) : null,
        });
      } catch {
        if (alive) setTokenError(true);
      }
    };
    load();
    const t = ctx.setInterval(load, 3_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [here?.key, open]);

  // Keep the whole window on screen after it opens or grows.
  useLayoutEffect(() => {
    const el = host.current;
    if (!el || !prefs?.pos) return;
    // offset* ignore the opening animation's scale transform
    const next = clamp(prefs.pos, el.offsetWidth, el.offsetHeight);
    if (next.x !== prefs.pos.x || next.y !== prefs.pos.y) setPrefs({ ...prefs, pos: next });
  });

  // Re-clamp when the browser window is resized.
  useEffect(() => {
    const onResize = () => {
      const el = host.current;
      if (!el || !prefs?.pos) return;
      setPrefs((p) => p && p.pos && { ...p, pos: clamp(p.pos, el.offsetWidth, el.offsetHeight) });
    };
    ctx.addEventListener(window, 'resize', onResize);
  }, [prefs?.pos != null]);

  const drag = (fromButtons: boolean) => (e: PointerEvent) => {
    const target = e.target as Element;
    if (!fromButtons && target.closest('button, input, form')) return;
    const el = host.current;
    if (!el || !prefs) return;
    const r = el.getBoundingClientRect();
    const off = { x: e.clientX - r.left, y: e.clientY - r.top };
    let last = { x: r.left, y: r.top };
    dragMoved.current = false;
    const move = (ev: PointerEvent) => {
      if (Math.hypot(ev.clientX - e.clientX, ev.clientY - e.clientY) > 5) dragMoved.current = true;
      last = clamp({ x: ev.clientX - off.x, y: ev.clientY - off.y }, el.offsetWidth, el.offsetHeight);
      setPrefs((p) => p && { ...p, pos: last });
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      if (dragMoved.current) savePrefs({ ...prefs, pos: last, minimized: prefs.minimized });
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  // ---- Tippy's levels on fomo's chart (drawn by the main-world chart script) ----
  const [chartNonce, setChartNonce] = useState(0);
  const [dragged, setDragged] = useState<{ move: ChartMove; line: ChartLine } | null>(null);
  /** The 🔔 phone-alerts box in the window. */
  const [phone, setPhone] = useState(false);
  const [moveState, setMoveState] = useState<{ busy: boolean; error: string | null }>({ busy: false, error: null });
  const chartLines = useMemo(
    () => (state && here && state.settings.chartLines !== false ? chartLinesFor(here.key, Object.values(state.plans), Object.values(state.buys)) : []),
    [state?.plans, state?.buys, state?.settings.chartLines, here?.key],
  );
  useEffect(() => {
    if (!here) return;
    const payload: ChartPayload = { key: here.key, now: { priceUSD: token?.priceUSD ?? null, mc: token?.mc ?? null }, lines: chartLines, nonce: chartNonce };
    document.dispatchEvent(new CustomEvent(LINES_EVENT, { detail: JSON.stringify(payload) }));
  }, [chartLines, here?.key, token?.priceUSD, token?.mc, chartNonce]);
  useEffect(() => {
    // Anything on the page could send this, so it's only ever a question for the user.
    const onMoved = (e: MessageEvent) => {
      try {
        if (e.source !== window || e.origin !== location.origin) return;
        const msg = e.data as MovedMessage | null;
        if (!msg || msg.source !== MOVED_SOURCE || msg.type !== MOVED_EVENT || !msg.move) return;
        const move: ChartMove = { id: String(msg.move.id), value: Number(msg.move.value), axis: msg.move.axis };
        const line = chartLines.find((l) => l.id === move.id);
        if (!line || !line.draggable || !(move.value > 0) || (move.axis !== 'mc' && move.axis !== 'price')) return;
        setDragged({ move, line });
        setMoveState({ busy: false, error: null });
        setPrefs((p) => p && { ...p, minimized: false }); // the question is in the window
      } catch {
        /* not ours */
      }
    };
    window.addEventListener('message', onMoved);
    return () => window.removeEventListener('message', onMoved);
  }, [chartLines]);
  useEffect(() => setDragged(null), [here?.key]);

  if (!state || !prefs) return null;
  const { plans, settings, status, buys, practice, notices } = state;
  const all = Object.values(plans);
  const live = all.filter((p) => p.state === 'armed' || p.state === 'paused');
  const planHere: Plan | null = here ? (live.find((p) => p.key === here.key) ?? null) : null;
  const allBuys = Object.values(buys);
  const liveBuys = allBuys.filter(isLiveBuy);
  const buysHere = here ? allBuys.filter((o) => o.key === here.key) : [];
  const buyNeedsYou = liveBuys.some((o) => o.attention);
  const mood = sell ? 'selling' : buyNeedsYou ? 'worried' : moodFor(status.health, live);
  const watched = live.length + liveBuys.length;
  // fomo's buy minimum for this chain (Ethereum's is much higher than the rest).
  const minBuyUsd = minTradeUsdFor(minimums?.buy ?? status.minBuyUsd, here?.networkId ?? 0, 'buy');
  const minSellUsd = minTradeUsdFor(minimums?.sell ?? status.minSellUsd, here?.networkId ?? 0, 'sell');
  const pillLabel =
    here && !planHere
      ? buysHere.some(isLiveBuy)
        ? 'Limit buy set'
        : 'TP / SL / limit buy?'
      : watched
        ? [live.length && `${live.length} guarded`, liveBuys.length && `${liveBuys.length} buy${liveBuys.length === 1 ? '' : 's'}`].filter(Boolean).join(' · ')
        : healthText(status.health, status.message, live.length);
  const toggles: WindowToggles = {
    autoGuard: settings.autoGuard.enabled,
    dryRun: settings.dryRun,
    alerts: settings.telegram.linked || settings.notifications,
    stayAwake: settings.stayAwake,
  };
  const onToggle = (name: keyof WindowToggles, v: boolean) => {
    if (name === 'autoGuard') send({ type: 'SET_SETTINGS', patch: { autoGuard: { ...settings.autoGuard, enabled: v } } });
    else if (name === 'dryRun') send({ type: 'SET_SETTINGS', patch: { dryRun: v } });
    else if (name === 'stayAwake') send({ type: 'SET_SETTINGS', patch: { stayAwake: v } });
    else setPhone((v) => !v); // 🔔 phone alerts: connect (or check) right in the window
  };
  const minimize = () => (here ? savePrefs({ ...prefs, minimized: true }) : setManualOpen(false));
  const restore = () => (here ? savePrefs({ ...prefs, minimized: false }) : setManualOpen(true));
  const place = prefs.pos ? { left: `${prefs.pos.x}px`, top: `${prefs.pos.y}px` } : { right: '20px', bottom: '20px' };

  // 💬 What the chat needs: the coin on screen, your plans and buys, and fresh prices from fomo.
  chatState.current = { plans: all, buys: allBuys, settings };
  const knownCoin = (key: string) => (token?.key === key ? token : (all.find((p) => p.key === key) ?? allBuys.find((o) => o.key === key) ?? null));
  const chatCtx: ChatCtx = {
    coin: here && token ? token : null,
    plans: all,
    buys: allBuys,
    settings,
    latest: () => chatState.current ?? { plans: all, buys: allBuys, settings },
    cash,
    minBuyUsd: (networkId) => minTradeUsdFor(minimums?.buy ?? status.minBuyUsd, networkId, 'buy'),
    minSellUsd: (networkId) => minTradeUsdFor(minimums?.sell ?? status.minSellUsd, networkId, 'sell'),
    resolveCoin: (symbol) => resolveChatCoin(symbol, chatState.current?.plans ?? all, chatState.current?.buys ?? allBuys),
    fetchCoin: (key) => readChatCoin(key, knownCoin(key)),
    api: chatApi,
  };

  // A level dragged on fomo's chart → ask before changing anything.
  const putBack = () => {
    setDragged(null);
    setMoveState({ busy: false, error: null });
    setChartNonce((n) => n + 1); // redraw the line where it was
  };
  let notice: WindowNotice | null = null;
  if (dragged && here && token?.priceUSD) {
    const { move, line } = dragged;
    const trigger = triggerFromMove(move);
    const now = { priceUSD: token.priceUSD, mc: token.mc };
    // "buy:<orderId>", "tp:<planId>:<tpId>", "stop:<planId>:<stopId>" (a partial stop), "sl:<planId>".
    const [kind, id, levelId] = line.id.split(':');
    const plan = kind !== 'buy' && planHere?.id === id ? planHere : null;
    const side = kind === 'buy' ? 'buy' : kind === 'sl' ? 'sl' : kind === 'stop' ? 'stop' : 'tp';
    const base = plan ? { priceUSD: plan.entry.priceUSD, mc: plan.entry.mc } : now;
    const problem =
      moveState.error ??
      levelProblem(trigger, side, now, base) ??
      (kind === 'stop' && plan ? stopTooSmall(plan, levelId, trigger, minSellUsd) : null);
    // Worth knowing, not a block: a partial stop dropped at or under the stop loss
    // (or the stop loss at or over partial stops) would never fire.
    const headsUp = plan && (kind === 'stop' || kind === 'sl') ? stopOrderNote(plan, kind, trigger, now, base, move.axis) : null;
    const confirm = async () => {
      setMoveState({ busy: true, error: null });
      const res =
        kind === 'buy'
          ? await send({ type: 'MOVE_BUY', orderId: id, trigger, now })
          : plan
            ? await cardApi.update(plan.id, planEditWith(plan, kind === 'sl' ? { sl: trigger } : kind === 'stop' ? { stop: { id: levelId, trigger } } : { tp: { id: levelId, trigger } }))
            : { ok: false as const, error: 'That plan has changed — try again.' };
      if (res.ok) {
        setDragged(null);
        setMoveState({ busy: false, error: null });
      } else setMoveState({ busy: false, error: res.error });
    };
    notice = problem
      ? { text: problem, warn: true, onDismiss: putBack, dismissLabel: 'Put back' }
      : { text: headsUp ? `${describeMove(line, move)} ${headsUp}` : describeMove(line, move), warn: !!headsUp, onConfirm: confirm, confirmLabel: 'Move', onDismiss: putBack, dismissLabel: 'Keep', busy: moveState.busy };
  }

  return (
    <div class="tippy" data-theme="dark" data-tippy>
      {/* Pop-ups: never in Tippy's own trade tabs, and kept out of sight while "Tippy is selling…" is up. */}
      {!tradeTab && !href.includes(EXEC_MARKER) && (
        <Toasts
          notices={notices ?? []}
          here={here?.key ?? null}
          hidden={!!sell}
          onOpen={(key) => {
            const coin = parseKey(key);
            if (coin) location.href = tokenUrl(coin.address, coin.networkId);
          }}
        />
      )}
      {sell && (
        <div class="t-overlay" role="alertdialog" aria-live="assertive">
          <div class="tw" style={{ width: 300 }}>
            <div class="tw-say" style={{ padding: 16 }}>
              <Mascot mood="selling" size={64} />
              <div class="tw-bubble">
                <b>
                  {sell.practice ? 'Practice: ' : ''}
                  {sell.side === 'buy'
                    ? `Buying ${sell.usd != null ? `$${sell.usd.toFixed(2)} of ` : ''}$${sell.symbol}…`
                    : `Selling ${(sell.pct ?? 100) >= 99.5 ? 'the rest' : `${Math.round(sell.pct ?? 0)}%`} of $${sell.symbol}…`}
                </b>
                <div style={{ color: 'var(--t-muted)', fontWeight: 600, marginTop: 4 }}>
                  {sell.dryRun || sell.practice ? `Dry run — I’ll stop before pressing ${sell.side === 'buy' ? 'Buy' : 'Sell'}.` : 'Hang tight, a few seconds. Please don’t click here.'}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      <div class="tw-host" ref={host} style={place}>
        {!open ? (
          <TippyPill
            key={here?.key ?? 'pill'}
            peek={!!here && !planHere}
            mood={mood}
            count={watched}
            label={pillLabel}
            onOpen={() => (dragMoved.current ? (dragMoved.current = false) : restore())}
            dragHandle={drag(true)}
          />
        ) : here && token ? (
          <TippyWindow
            key={here.key}
            token={token}
            plan={planHere}
            buys={buysHere}
            cash={cash}
            minBuyUsd={minBuyUsd}
            minSellUsd={minSellUsd}
            showTrailing={settings.showTrailing}
            practice={practice && practice.key === here.key ? practice : null}
            presets={settings.presets}
            defaultPresetId={settings.defaultPresetId}
            api={cardApi}
            toggles={toggles}
            onToggle={onToggle}
            onMinimize={minimize}
            dragHandle={drag(false)}
            note={settings.dryRun ? 'Dry run is on — Tippy won’t actually buy or sell' : undefined}
            notice={notice}
            panel={phone ? <TelegramConnect settings={settings} compact onClose={() => setPhone(false)} /> : null}
            levelUnit={settings.levelUnit}
            onLevelUnit={(levelUnit) => send({ type: 'SET_SETTINGS', patch: { levelUnit } })}
            chat={<Chat ctx={chatCtx} />}
          />
        ) : (
          <div class="tw">
            <div class="tw-head" onPointerDown={drag(false) as never}>
              <span class="tw-grip" aria-hidden="true">
                ⠿
              </span>
              <Mascot mood={mood} size={24} />
              <b class="tw-title">Tippy</b>
              <span class="tw-spacer" />
              <button class="tw-icon" onClick={minimize} aria-label="Minimise Tippy">
                –
              </button>
            </div>
            <div class="tw-say">
              <Mascot mood={tokenError ? 'worried' : mood} size={44} />
              <div class="tw-bubble">
                {tokenError ? "I can't see this coin — are you logged in to fomo?" : here ? 'Looking up this coin…' : healthText(status.health, status.message, live.length)}
              </div>
            </div>
            {!here && (
              <div class="tw-body tw-list">
                {status.banner && <div class="t-banner">{status.banner}</div>}
                <PlanList
                  plans={all}
                  buys={allBuys}
                  onPause={cardApi.pause}
                  onResume={cardApi.resume}
                  onCancel={cardApi.cancel}
                  onCancelBuy={cardApi.cancelBuy}
                  onResolveBuy={cardApi.resolveBuy}
                  onOpen={(url) => (location.href = url)}
                />
                {settings.paused && (
                  <button class="tw-arm" onClick={() => send({ type: 'PAUSE_ALL', paused: false })}>
                    Wake Tippy up
                  </button>
                )}
              </div>
            )}
            <div class="tw-note" style={{ paddingTop: 6 }}>
              Trades with fomo’s own buttons · never asks for keys
            </div>
            {!here && <Chat ctx={chatCtx} placeholder="Ask Tippy… e.g. show my orders" />}
          </div>
        )}
      </div>
    </div>
  );
}
