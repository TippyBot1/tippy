// Tippy's heartbeat. The loop runs in the service worker (never inside the page,
// where hidden-tab timers get throttled). Each tick is idempotent and all state
// lives in storage, so a worker restart just picks up where it left off.

import { browser } from 'wxt/browser';
import { blendedEntry, diffHoldings, presetToInput } from '../engine/autoguard';
import { buyOwnsIncrease, evaluateBuy, isLiveBuy, PRIOR_PRESS_MS, pruneBuys, reconcileBuy, withdrawBuy } from '../engine/buys';
import { nearAlerts } from '../engine/near';
import { buildPlan, evaluate, hasInFlight, reconcile, rescale, sortActions, summarizePlan } from '../engine/orders';
import type { Action, BuyAction, BuyOrder, Plan, SellAction } from '../engine/types';
import { alert, heartbeat, notify } from '../shared/alerts';
import { isCashOrNative, parseKey } from '../shared/chains';
import { STATUS_URL } from '../shared/config';
import type { Holding, Status, TokenQuote } from '../shared/messages';
import { buyExpiredNotice, buyFilledNotice, lateSells, sellFilledNotice, stopSkippedNotice, type LateSell } from '../shared/notices';
import type { Settings } from '../shared/settings';
import { load, save } from '../shared/store';
import { withLock } from './lock';
import { protectBuy } from './protect';
import { currentExecution, minTradeUsd, processQueue } from './queue';
import { presence } from './presence';
import type { BalancesRead, Minimums } from '../fomo/api';
import { abandonDesk, ensureDesk, recoverDesk, relay } from './relay';

export const TICK_MS = 3_000;
const IDLE_TICK_MS = 15_000;
const BALANCES_EVERY_MS = 9_000;
const GAP_MS = 120_000;
const BLIND_ALERT_MS = 180_000;
const HEARTBEAT_MS = 120_000;
const REMOTE_STATUS_EVERY_MS = 30 * 60_000;
const CONFIG_EVERY_MS = 30 * 60_000;

let timer: ReturnType<typeof setTimeout> | null = null;
let ticking = false;
let lastLoopAt = 0;
let lastBalancesAt = 0;
let lastHeartbeatAt = 0;
let lastArmedReported = 0;
let lastRemoteAt = 0;
let lastConfigAt = 0;
// Desk health — per desk tab (reset when the desk changes, or when Tippy idles/pauses).
let countersFor: number | null = null;
let noAnswer = 0;
let apiErrors = 0;
let deskReloads = 0;
let lastDeskReloadAt = 0;
let balanceFailures = 0;
let unparsedReads = 0;
/** Whether the last balance read was fully understood (then a missing coin really means 0). */
let balancesTrusted = false;
/** Balances older than this aren't used to size take-profits or partial stops (they wait; stop losses don't). */
const BALANCES_STALE_MS = 30_000;
/** Candidate top-ups awaiting a second read: coin → amount seen. */
const topUps = new Map<string, number>();

function resetDeskCounters(desk: number | null) {
  countersFor = desk;
  noAnswer = 0;
  apiErrors = 0;
  deskReloads = 0;
  lastDeskReloadAt = 0;
}
let balances: Map<string, Holding> | null = null;

/** Start (or nudge) the loop. Safe to call from any event. */
export function kick() {
  if (ticking) return;
  if (timer) clearTimeout(timer);
  timer = null;
  void loop();
}

/** Called by the 30s alarm: restart the loop if the worker was asleep. */
export function backstop() {
  if (Date.now() - lastLoopAt > IDLE_TICK_MS * 2) kick();
}

async function loop() {
  ticking = true;
  lastLoopAt = Date.now();
  let next: number | null = TICK_MS;
  try {
    next = await tick();
  } catch (e) {
    console.error('[tippy] tick failed', e);
  } finally {
    ticking = false;
  }
  if (next != null) timer = setTimeout(() => void loop(), next);
}

const isLive = (p: Plan) => p.state === 'armed' || hasInFlight(p);

/** One tick. Returns ms until the next tick, or null to sleep until an event/alarm. */
async function tick(): Promise<number | null> {
  const now = Date.now();
  await maybeFetchRemoteStatus(now);

  const { plans, settings, status, buys } = await load('plans', 'settings', 'status', 'buys');
  const live = Object.values(plans).filter(isLive);
  const liveBuys = Object.values(buys).filter(isLiveBuy);
  // Plans and limit buys Tippy is looking after (the heartbeat's "armed" count).
  const armed = live.length + liveBuys.length;
  const watching = armed > 0 || settings.autoGuard.enabled;

  void keepAwake(settings.stayAwake && armed > 0 && !settings.paused);

  if (status.health === 'killed') return null;
  if (!watching) {
    resetDeskCounters(null);
    presence.reset();
    balanceFailures = 0;
    status.blindSince = null;
    // lastTickAt: 0 → arming later isn't mistaken for "woke up from a sleep".
    if (status.health !== 'idle' || status.lastTickAt) await setHealth(status, 'idle', 'Nothing to guard yet.', { lastTickAt: 0 });
    // Tell the alerts worker nothing is armed, so its dead-man alert stays quiet.
    if (lastArmedReported > 0) {
      lastArmedReported = 0;
      void heartbeat(settings, 0);
    }
    return null;
  }
  if (settings.paused) {
    resetDeskCounters(null);
    presence.reset();
    balanceFailures = 0;
    status.blindSince = null;
    if (status.health !== 'paused' || status.lastTickAt) await setHealth(status, 'paused', 'Tippy is paused.', { lastTickAt: 0 });
    return IDLE_TICK_MS;
  }

  const desk = await ensureDesk(settings, status);
  if (desk == null) {
    // No prices at all: the "can't see fomo" clock keeps running across desk changes.
    status.blindSince ??= now;
    await setHealth(status, 'no-desk', 'Open fomo.family (and stay logged in) so Tippy can watch your coins.');
    if (armed && now - status.blindSince > BLIND_ALERT_MS) {
      await alert(settings, 'blind', "🙈 Tippy can't see fomo", 'There is no working fomo tab, so Tippy can\'t watch prices. Open fomo.family on your computer.', 'blind', 30 * 60_000);
    }
    return IDLE_TICK_MS;
  }

  if (desk !== countersFor) resetDeskCounters(desk);
  const gap = status.lastTickAt > 0 && now - status.lastTickAt > GAP_MS;
  // Coins with a plan, plus coins with a limit buy waiting for its level.
  const planKeys = [...new Set(live.map((p) => p.key))];
  const keys = [...new Set([...planKeys, ...liveBuys.map((o) => o.key)])];

  // Prices
  // fomo answers prices in chunks of 25, one after another: allow time per chunk.
  const qr = await relay<TokenQuote[]>(desk, keys.length ? { type: 'QUOTES', keys } : { type: 'PING' }, 8_000 + 3_000 * Math.max(0, Math.ceil(keys.length / 25) - 1));
  if (!qr.ok) {
    if (qr.authFailed) return await loggedOut(settings, status);
    // A reply without `session` means the tab never answered. Before calling it
    // dead, PING it: a live tab with a slow fomo API is not a dead tab.
    const alive = qr.session !== undefined || (await relay(desk, { type: 'PING' }, 1_500)).ok;
    if (!alive) {
      noAnswer++;
      if (noAnswer >= 2 && now - lastDeskReloadAt > 30_000) {
        const r = await recoverDesk(desk, deskReloads);
        if (r === 'reloaded') {
          deskReloads++;
          lastDeskReloadAt = now;
        } else if (r === 'abandon') {
          await abandonDesk(desk);
          status.deskTabId = null;
          resetDeskCounters(null);
        }
      }
    } else {
      apiErrors++;
    }
    status.blindSince ??= now;
    if (noAnswer + apiErrors >= 3) {
      await setHealth(status, 'blind', "Tippy can't see fomo right now (the tab may be asleep). Retrying…");
      if (now - status.blindSince > BLIND_ALERT_MS) {
        await alert(settings, 'blind', "🙈 Tippy can't see fomo", "Your fomo tab isn't responding, so Tippy can't watch prices. Check that your computer is awake and fomo.family is open.", 'blind', 30 * 60_000);
      }
    }
    return TICK_MS;
  }
  noAnswer = 0;
  apiErrors = 0;
  deskReloads = 0;
  // With nothing armed (auto-guard only) the request was a PING: no prices to read.
  const quotes = new Map(keys.length && Array.isArray(qr.data) ? (qr.data as TokenQuote[]).map((q) => [q.key, q]) : []);

  // Balances (also feeds auto-guard)
  let balancesFresh = false;
  if (now - lastBalancesAt > BALANCES_EVERY_MS || !balances) {
    const br = await relay<BalancesRead>(desk, { type: 'BALANCES' }, 8_000);
    if (br.ok && br.data && Array.isArray(br.data.holdings)) {
      balances = new Map(br.data.holdings.map((h) => [h.key, h]));
      lastBalancesAt = now;
      balancesFresh = true;
      balanceFailures = 0;
      balancesTrusted = br.data.unparsed === 0;
      // Only fully-understood reads count toward "this coin is gone"; a row at ~0 counts as gone too.
      if (br.data.unparsed === 0) {
        unparsedReads = 0;
        // Guarded coins only: a coin you're waiting to buy is *expected* to be missing.
        presence.record(planKeys, new Set(br.data.holdings.filter((h) => h.amount > 0 && (h.priceUSD == null || h.amount * h.priceUSD >= 0.01)).map((h) => h.key)), now);
      } else if (++unparsedReads === 3) {
        await alert(settings, 'attention', "🤔 Tippy can't read part of your fomo balances", 'fomo may have changed something. Take-profits and partial stops on affected coins are on hold; stop losses still fire.', 'unparsed');
      }
    } else if (!br.ok && br.authFailed) {
      // Prices are public on fomo; a lapsed session only shows up here.
      return await loggedOut(settings, status);
    } else if (++balanceFailures === 5) {
      await alert(settings, 'blind', "🙈 Tippy can't read your fomo balances", "fomo isn't answering balance checks, so take-profits and partial stops are on hold. Stop losses still try to sell.", 'balances', 30 * 60_000);
    }
  }

  // fomo's trade minimums (buy and sell differ per chain) — refreshed now and then.
  if (now - lastConfigAt > CONFIG_EVERY_MS) {
    lastConfigAt = now; // also after a failure: don't ask every tick
    const cfg = await relay<Minimums>(desk, { type: 'CONFIG' }, 4_000);
    if (cfg.ok && cfg.data && typeof cfg.data === 'object' && 'buy' in cfg.data) {
      status.minBuyUsd = cfg.data.buy;
      status.minSellUsd = cfg.data.sell;
    }
  }

  if (!status.userId) {
    const me = await relay<{ id: string; handle: string | null }>(desk, { type: 'ME' });
    if (me.ok) {
      status.userId = me.data.id;
      status.handle = me.data.handle;
    }
  }

  // Evaluate under the lock (UI commands may be changing plans concurrently).
  const fired: Action[] = [];
  const buysFired: BuyAction[] = [];
  const guardedNow: Plan[] = [];
  const goneNow: Plan[] = [];
  const tooSmall: Plan[] = [];
  const attentionNow: Plan[] = [];
  const bought: { order: BuyOrder; guard: string | null }[] = [];
  const buyAttention: BuyOrder[] = [];
  const expired: BuyOrder[] = [];
  /** Sells that weren't confirmed when pressed and just showed up in the balance. */
  const soldLate: { plan: Plan; sell: LateSell }[] = [];
  /** "Getting close" heads-ups this tick. */
  const nearNow: { key: string; title: string; text: string }[] = [];
  await withLock(async () => {
    const fresh = await load('plans', 'queue', 'baseline', 'status', 'buys');
    let plansNow = fresh.plans;
    // Only the trade actually running in this worker is left alone; a persisted
    // marker from before a restart is not trusted.
    const running = currentExecution();
    for (const plan of Object.values(plansNow).filter(isLive)) {
      const q = quotes.get(plan.key);
      const bal = balanceFor(plan.key, now);
      const skip = running?.kind === 'sell' && running.planId === plan.id ? running.level : null;
      let p = reconcile(plan, bal, now, q?.priceUSD ?? null, 1, skip);
      // Only levels Tippy pressed — the ones folded into (or covered by) a press are part of the same sell.
      const late = lateSells(plan, p, bal, now);
      if (q) {
        const minSellUsd = minTradeUsd(status, p.networkId);
        const r = evaluate(p, { priceUSD: q.priceUSD, mc: q.mc, at: now }, bal, { now, gap, gapPolicy: settings.gapPolicy, minSellUsd, dustUsd: 1 });
        p = r.plan;
        fired.push(...r.actions);
        // After the engine: a level that just fired isn't "getting close" any more.
        const near = nearAlerts(p, { priceUSD: q.priceUSD, mc: q.mc, at: now }, settings.near, now);
        if (near.near !== p.near) p = { ...p, near: near.near };
        for (const a of near.alerts) nearNow.push({ key: p.key, ...a });
      }
      if (p.state === 'done' && plan.state !== 'done' && p.history.some((h) => h.kind === 'sold-elsewhere' && h.at === now)) goneNow.push(p);
      if (p.history.some((h) => h.kind === 'too-small' && h.at === now)) tooSmall.push(p);
      if (p.attention && p.attention !== plan.attention) attentionNow.push(p);
      for (const sell of late) soldLate.push({ plan: p, sell });
      plansNow[p.id] = p;
    }

    // Limit buys: settle ones that may have bought, then see whose level was hit.
    let baseline = fresh.baseline;
    let buysNow = fresh.buys;
    const queuedBuys = new Set(fresh.queue.flatMap((a) => (a.type === 'buy' ? [a.orderId] : [])));
    for (const order of Object.values(buysNow).filter(isLiveBuy)) {
      const isRunning = running?.kind === 'buy' && running.orderId === order.id;
      let o = reconcileBuy(order, heldNow(order.key, now), now, isRunning);
      // Queued, but its place in the queue was lost: back to watching (it re-fires if the price still says so).
      if (o.state === 'queued' && !queuedBuys.has(o.id) && !isRunning) o = withdrawBuy(o, now);
      const q = quotes.get(o.key);
      const r = evaluateBuy(o, q ? { priceUSD: q.priceUSD, mc: q.mc, at: now } : null, now);
      o = r.order;
      if (r.action) buysFired.push(r.action);
      if (o.state === 'filled' && order.state !== 'filled') {
        // An unconfirmed buy whose coins just showed up: guard them like a fresh fill.
        const res = protectBuy({ order: o, plans: plansNow, presets: settings.presets, balance: heldNow(o.key, now), quote: q ?? null, baseline, now, newId: () => crypto.randomUUID() });
        o = res.order;
        plansNow = res.plans;
        baseline = res.baseline;
        if (res.armed) presence.forget(res.armed.key); // a fresh plan starts with a clean "is it gone?" record
        if (!o.dryRun) bought.push({ order: o, guard: res.text });
      } else if (o.attention && o.attention !== order.attention) {
        buyAttention.push(o);
      }
      if (o.state === 'expired' && order.state !== 'expired') expired.push(o);
      buysNow[o.id] = o;
    }
    buysNow = pruneBuys(buysNow, now);

    // Auto-guard & top-ups, only on a fresh balance read.
    if (balancesFresh && balances) {
      const holdings = [...balances.values()];
      const diff = diffHoldings(baseline, holdings, {
        includeExisting: settings.autoGuard.includeExisting,
        isIgnored: (key) => {
          const k = parseKey(key);
          return !k || isCashOrNative(k.address, k.networkId);
        },
      });
      // A limit buy with a guard preset protects its own coins: auto-guard leaves those alone.
      // Any limit buy owns its coins: a preset guards them, and "None" means none (auto-guard stays away).
      const guardingBuys = Object.values(buysNow).filter((o) => !o.dryRun);
      baseline = diff.baseline;
      for (const { holding, prev } of diff.increases) {
        const active = Object.values(plansNow).find((p) => p.key === holding.key && (p.state === 'armed' || p.state === 'paused'));
        if (active) {
          // Only rescale for a real top-up: seen on two fresh reads in a row, and not
          // right after Tippy itself sold (a lagging/contradictory read looks like a buy).
          const confirmed = (topUps.get(holding.key) ?? 0) >= holding.amount * 0.98;
          topUps.set(holding.key, holding.amount);
          // A limit buy with a guard on this coin resizes the plan itself once it fills — don't do it twice.
          // (An unconfirmed one only for a while — it may never be answered.)
          const buyGuarding = Object.values(buysNow).some(
            (o) => o.key === holding.key && !o.dryRun && o.guardPresetId && (o.state === 'queued' || o.state === 'executing' || (o.state === 'unknown' && now - o.updatedAt < PRIOR_PRESS_MS)),
          );
          const busy = hasInFlight(active) || buyGuarding || active.history.some((h) => h.kind === 'filled' && now - h.at < 120_000);
          if (prev > 0 && !(confirmed && !busy)) {
            if (baseline) baseline[holding.key] = prev; // keep the old amount so the next read still sees the increase
          } else if (prev > 0 && holding.priceUSD) {
            topUps.delete(holding.key);
            const entry = blendedEntry(prev, active.entry.priceUSD, holding.amount - prev, holding.priceUSD);
            plansNow[active.id] = rescale(active, holding.amount, now, entry);
          }
        } else if (settings.autoGuard.enabled && holding.priceUSD && !buyOwnsIncrease(guardingBuys, holding.key, now)) {
          const preset = settings.presets.find((x) => x.id === settings.defaultPresetId) ?? settings.presets[0];
          const k = parseKey(holding.key)!;
          const input = presetToInput(preset, { ...k, key: holding.key, symbol: holding.symbol, name: holding.name, priceUSD: holding.priceUSD, mc: holding.mc, balance: holding.amount }, 'auto-guard');
          const plan = buildPlan({ ...input, id: crypto.randomUUID(), now });
          plansNow[plan.id] = plan;
          guardedNow.push(plan);
        }
      }
    }

    // Sells first (stops, then take-profits), then buys.
    const queue = sortActions([...fresh.queue, ...(fired.filter((a) => a.type === 'sell') as SellAction[]), ...buysFired]);
    await save({
      plans: plansNow,
      queue,
      baseline,
      buys: buysNow,
      status: {
        ...fresh.status, // the executor may have updated it while we were fetching
        health: balanceFailures >= 5 ? 'blind' : 'watching',
        message: balanceFailures >= 5 ? "Can't read your fomo balances — take-profits and partial stops on hold." : gap ? 'Back! Double-checking prices after a nap.' : watchingText(keys.length),
        lastTickAt: now,
        lastQuoteAt: now,
        blindSince: null,
        deskTabId: status.deskTabId,
        userId: status.userId,
        handle: status.handle,
        minBuyUsd: status.minBuyUsd,
        minSellUsd: status.minSellUsd,
      },
    });
  });

  for (const a of fired) {
    if (a.type === 'ask') await alert(settings, 'ask', '⏸️ Tippy wants your OK', `${a.text} Open Tippy on your computer to decide.`);
  }
  for (const p of guardedNow) {
    await alert(settings, 'guarding', `🛡️ Tippy is guarding $${p.symbol}`, `${summarizePlan(p)}. Change or undo it in Tippy.`);
  }
  for (const p of attentionNow) {
    await alert(settings, 'attention', `😟 Tippy needs you: $${p.symbol}`, p.attention ?? '', `att:${p.id}:${p.attention}`);
  }
  for (const p of tooSmall) {
    // A pop-up on fomo's page like a fill, quoting this tick's note (an older one may
    // still be in the history). Never the same note twice.
    const n = stopSkippedNotice(p);
    if (n) await notify(settings, 'attention', n, `small:${p.id}:${n.text}`, 24 * 3600_000);
  }
  for (const p of goneNow) {
    await alert(settings, 'attention', `👀 Tippy stopped guarding $${p.symbol}`, "Your bag is gone from fomo, so it looks like you sold it elsewhere. Re-arm Tippy if that's wrong.");
  }
  for (const { order, guard } of bought) {
    await notify(settings, 'filled', buyFilledNotice(order, guard));
  }
  for (const a of nearNow) {
    await notify(settings, 'near', { key: a.key, title: a.title, text: a.text, tone: 'info' });
  }
  for (const { plan, sell } of soldLate) {
    // Pressed long ago, or dry run is on (Tippy never really presses): it looks sold, but Tippy doesn't claim it.
    await notify(settings, 'filled', sellFilledNotice(plan, sell.ref, { soldPct: sell.soldPct, emptied: sell.emptied, late: sell.late || settings.dryRun }));
  }
  for (const o of buyAttention) {
    const title = o.state === 'unknown' ? `🤔 Checking your $${o.symbol} buy` : `😟 Tippy needs you: $${o.symbol}`;
    await alert(settings, 'attention', title, o.attention ?? '', `att:${o.id}:${o.attention}`, 30 * 60_000);
  }
  for (const o of expired) {
    await notify(settings, 'attention', buyExpiredNotice(o));
  }

  if (now - lastHeartbeatAt > HEARTBEAT_MS || armed !== lastArmedReported) {
    lastHeartbeatAt = now;
    lastArmedReported = armed;
    void heartbeat(settings, armed);
  }

  void processQueue();
  return TICK_MS;
}

async function loggedOut(settings: Settings, status: Status): Promise<number> {
  balances = null;
  presence.reset();
  await setHealth(status, 'logged-out', "You're logged out of fomo — log back in so Tippy can keep watching.");
  await alert(settings, 'logged-out', '🔑 Tippy lost your fomo session', 'Log back in to fomo.family on your computer so Tippy can keep watching.', 'logged-out', 30 * 60_000);
  return IDLE_TICK_MS;
}

/** Live balance for a coin: amount, 0 once its absence is confirmed, or null (unknown). */
function balanceFor(key: string, now: number): number | null {
  if (presence.gone(key, now)) return 0;
  if (!balances || now - lastBalancesAt > BALANCES_STALE_MS) return null; // stale: take-profits wait
  const row = balances.get(key);
  if (!row) return null;
  if (row.amount <= 0 || (row.priceUSD != null && row.amount * row.priceUSD < 0.01)) return null; // presence decides
  return row.amount;
}

/**
 * A coin's amount for limit buys, from the latest balance read: what's there,
 * 0 if a fully-understood read doesn't list it (you don't hold it), or null if
 * unknown / stale.
 */
function heldNow(key: string, now: number): number | null {
  if (!balances || now - lastBalancesAt > BALANCES_STALE_MS) return null;
  const row = balances.get(key);
  if (row) return row.amount;
  return balancesTrusted ? 0 : null;
}

/** "Watching 3 coins." */
function watchingText(coins: number): string {
  if (coins === 0) return 'Watching for new coins.';
  return `Watching ${coins} coin${coins === 1 ? '' : 's'}.`;
}

/** On worker start: no trade can be running yet, so a persisted "executing" marker is stale. */
export async function clearStaleExecuting() {
  await withLock(async () => {
    const { status } = await load('status');
    if (status.executing) await save({ status: { ...status, executing: null } });
  });
}

let awake = false;
async function keepAwake(on: boolean) {
  if (on === awake || !browser.power) return;
  awake = on;
  if (on) browser.power.requestKeepAwake('system');
  else browser.power.releaseKeepAwake();
}

async function setHealth(status: Status, health: Status['health'], message: string, extra: Partial<Status> = {}) {
  await withLock(async () => {
    const { status: s } = await load('status');
    await save({ status: { ...s, deskTabId: status.deskTabId, blindSince: status.blindSince, health, message, ...extra } });
  });
}

/** Kill switch / banner from tippybot.fun — data only. */
async function maybeFetchRemoteStatus(now: number) {
  if (now - lastRemoteAt < REMOTE_STATUS_EVERY_MS) return;
  lastRemoteAt = now;
  try {
    const res = await fetch(STATUS_URL, { cache: 'no-store' });
    if (!res.ok) return;
    const remote = (await res.json()) as { killSwitch?: boolean; banner?: string | null; minVersion?: string };
    const version = browser.runtime.getManifest().version;
    const outdated = remote.minVersion && compareVersions(version, remote.minVersion) < 0;
    await withLock(async () => {
      const { status } = await load('status');
      status.banner = outdated ? 'Please update Tippy — a newer version is needed to keep selling safely.' : (remote.banner ?? null);
      if (remote.killSwitch || outdated) {
        status.health = 'killed';
        status.message = status.banner ?? 'Tippy is temporarily paused for safety.';
      } else if (status.health === 'killed') {
        status.health = 'idle';
      }
      await save({ status });
    });
  } catch {
    /* offline — keep going */
  }
}

function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d) return d;
  }
  return 0;
}
