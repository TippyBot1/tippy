import { browser } from 'wxt/browser';
import { buildBuy, cancelBuy, moveBuy, pruneBuys, resolveUnknownBuy, validateBuyInput } from '../engine/buys';
import { buildPlan, cancelPlan, editPlan, getLevel, pausePlan, resolveHeld, resumePlan, retryLevel, undoDryRunFills } from '../engine/orders';
import { validatePlanInput } from '../engine/triggers';
import type { SellAction } from '../engine/types';
import { notify } from '../shared/alerts';
import type { Command, CommandResult } from '../shared/messages';
import { load, save } from '../shared/store';
import { withLock } from './lock';
import { presence } from './presence';
import { protectBuy } from './protect';
import { minTradeUsd, practice, readCoin, withdrawQueue } from './queue';
import { allowDeskNow } from './relay';
import { kick } from './runtime';

/** `from.tabId`: the tab the command came from (a fomo tab for the window's buttons). */
export async function handleCommand(cmd: Command, from: { tabId?: number } = {}): Promise<CommandResult> {
  const now = Date.now();
  switch (cmd.type) {
    case 'ARM': {
      const issues = validatePlanInput(cmd.input);
      if (issues.length) return { ok: false, error: issues[0].message };
      const plan = await withLock(async () => {
        const { plans } = await load('plans');
        // One live plan per coin: re-arming replaces the old one.
        for (const p of Object.values(plans)) {
          if (p.key === cmd.input.key && (p.state === 'armed' || p.state === 'paused')) plans[p.id] = cancelPlan(p, now);
        }
        const plan = buildPlan({ ...cmd.input, id: crypto.randomUUID(), now });
        presence.forget(plan.key); // a fresh plan starts with a clean "is it gone?" record
        plans[plan.id] = plan;
        await save({ plans: prune(plans) });
        return plan;
      });
      kick();
      return { ok: true, plan };
    }
    case 'UPDATE_PLAN': {
      const res = await withLock(async () => {
        const { plans } = await load('plans');
        const p = plans[cmd.planId];
        if (!p) return { ok: false as const, error: 'That plan is gone.', stale: true };
        const r = editPlan(p, cmd.edit, now);
        if (!r.ok) return r;
        plans[p.id] = r.plan;
        await save({ plans });
        return r;
      });
      kick();
      return res.ok ? { ok: true, plan: res.plan } : { ok: false, error: res.error, stale: res.stale };
    }
    case 'PAUSE_PLAN':
    case 'RESUME_PLAN':
    case 'CANCEL_PLAN': {
      const plan = await withLock(async () => {
        const { plans } = await load('plans');
        const p = plans[cmd.planId];
        if (!p) return null;
        plans[p.id] = cmd.type === 'PAUSE_PLAN' ? pausePlan(p, now) : cmd.type === 'RESUME_PLAN' ? resumePlan(p, now) : cancelPlan(p, now);
        // Paused / stopped plans lose their queued (not yet started) sells.
        const { queue } = await load('queue');
        const nextQueue = cmd.type === 'RESUME_PLAN' ? queue : queue.filter((a) => a.type !== 'sell' || a.planId !== p.id);
        await save({ plans, queue: nextQueue });
        return plans[p.id];
      });
      kick();
      return plan ? { ok: true, plan } : { ok: false, error: 'That plan is gone.' };
    }
    case 'RETRY_LEVEL': {
      const plan = await withLock(async () => {
        const { plans } = await load('plans');
        const p = plans[cmd.planId];
        if (!p) return null;
        plans[p.id] = retryLevel(p, cmd.level, now);
        await save({ plans });
        return plans[p.id];
      });
      kick();
      return plan ? { ok: true, plan } : { ok: false, error: 'That plan is gone.' };
    }
    case 'RESOLVE_HELD': {
      // Only a stop loss / trailing stop waits for your OK, and "yes" sells the rest. A
      // take-profit or partial stop sells a slice, so it's never sold from here.
      if (cmd.sell && cmd.level.kind !== 'sl' && cmd.level.kind !== 'trail') return { ok: false, error: 'Tippy only asks before selling the rest — this level sells on its own.' };
      const plan = await withLock(async () => {
        const { plans, queue } = await load('plans', 'queue');
        const p = plans[cmd.planId];
        if (!p) return null;
        const next = resolveHeld(p, cmd.level, cmd.sell, now);
        plans[p.id] = next;
        // Only a level that really was waiting for you (and is now queued) gets a sell.
        if (cmd.sell && next !== p && getLevel(next, cmd.level)?.status === 'queued') {
          const action: SellAction = {
            type: 'sell',
            planId: p.id,
            key: p.key,
            level: cmd.level,
            targetRemaining: 0,
            sellAmount: null,
            sellUsd: null,
            sellPctOfCurrent: 100,
            reason: 'confirmed by you',
            gapFill: true,
            priority: 0,
            queuedAt: now,
            consented: true,
          };
          queue.unshift(action);
        }
        await save({ plans, queue });
        return next;
      });
      kick();
      return plan ? { ok: true, plan } : { ok: false, error: 'That plan is gone.' };
    }
    case 'ARM_BUY': {
      const { settings, status } = await load('settings', 'status');
      const issues = validateBuyInput(cmd.input, minTradeUsd(status, cmd.input.networkId, 'buy'));
      if (issues.length) return { ok: false, error: issues[0].message };
      if (cmd.input.guardPresetId != null && !settings.presets.some((p) => p.id === cmd.input.guardPresetId)) {
        return { ok: false, error: "That guard preset is gone — pick another (or don't guard)." };
      }
      const buy = await withLock(async () => {
        const { buys } = await load('buys');
        const order = buildBuy({ ...cmd.input, id: crypto.randomUUID(), now });
        buys[order.id] = order;
        await save({ buys: pruneBuys(buys, now) });
        return order;
      });
      kick();
      return { ok: true, buy };
    }
    case 'CANCEL_BUY': {
      const buy = await withLock(async () => {
        const { buys, queue } = await load('buys', 'queue');
        const o = buys[cmd.orderId];
        if (!o) return null;
        buys[o.id] = cancelBuy(o, now);
        // A buy that hasn't started yet leaves the queue; one mid-buy is stopped by the last-moment check.
        await save({ buys, queue: queue.filter((a) => a.type !== 'buy' || a.orderId !== o.id) });
        return buys[o.id];
      });
      kick();
      return buy ? { ok: true, buy } : { ok: false, error: 'That order is gone.' };
    }
    case 'MOVE_BUY': {
      const res = await withLock(async () => {
        const { buys, queue } = await load('buys', 'queue');
        const o = buys[cmd.orderId];
        if (!o) return { error: 'That order is gone.' };
        const r = moveBuy(o, cmd.trigger, cmd.now, now);
        if ('error' in r) return r;
        buys[o.id] = r.order;
        // Moved while waiting its turn: it goes back to watching at the new level.
        await save({ buys, queue: queue.filter((a) => a.type !== 'buy' || a.orderId !== o.id) });
        return r;
      });
      kick();
      return 'order' in res ? { ok: true, buy: res.order } : { ok: false, error: res.error };
    }
    case 'RESOLVE_BUY': {
      // "It bought": read the coin's balance first, so its guard is sized on what's really there.
      const { buys: before } = await load('buys');
      const known = before[cmd.orderId];
      if (!known) return { ok: false, error: 'That order is gone.' };
      const coin = cmd.bought && known.guardPresetId ? await readCoin(known.key) : null;
      const buy = await withLock(async () => {
        const { buys, plans, baseline, settings } = await load('buys', 'plans', 'baseline', 'settings');
        const o = buys[cmd.orderId];
        if (!o) return null;
        let next = resolveUnknownBuy(o, cmd.bought, now);
        const patch: Parameters<typeof save>[0] = {};
        if (next.state === 'filled' && o.state !== 'filled') {
          const res = protectBuy({ order: next, plans, presets: settings.presets, balance: coin?.balance ?? null, quote: coin?.quote ?? null, baseline, now, newId: () => crypto.randomUUID() });
          next = res.order;
          if (res.armed) presence.forget(res.armed.key); // a fresh plan starts with a clean "is it gone?" record
          Object.assign(patch, { plans: res.plans, baseline: res.baseline });
        }
        buys[o.id] = next;
        await save({ ...patch, buys });
        return next;
      });
      kick();
      return buy ? { ok: true, buy } : { ok: false, error: 'That order is gone.' };
    }
    case 'PRACTICE': {
      const result = await practice(cmd.key, cmd.side, cmd.usd, from.tabId);
      await withLock(() => save({ practice: result }));
      return result.ok ? { ok: true, practice: result } : { ok: false, error: result.detail };
    }
    case 'SET_SETTINGS': {
      await withLock(async () => {
        const { settings } = await load('settings');
        const next = { ...settings, ...cmd.patch };
        const patch: Parameters<typeof save>[0] = { settings: next };
        // Turning auto-guard on takes a fresh snapshot so existing bags aren't grabbed.
        if (cmd.patch.autoGuard?.enabled && !settings.autoGuard.enabled) patch.baseline = null;
        // Going live: levels "sold" in the dry run never really sold — they go back to
        // watching, and every plan is sized on the real bag again.
        if (settings.dryRun && cmd.patch.dryRun === false) {
          const { plans } = await load('plans');
          let changed = false;
          for (const p of Object.values(plans)) {
            const next = undoDryRunFills(p, now);
            if (next !== p) {
              plans[p.id] = next;
              changed = true;
            }
          }
          if (changed) patch.plans = plans;
        }
        await save(patch);
      });
      kick();
      return { ok: true };
    }
    case 'PAUSE_ALL': {
      await withLock(async () => {
        const { settings, plans, buys, queue } = await load('settings', 'plans', 'buys', 'queue');
        if (cmd.paused) {
          // Withdraw queued sells and buys; they re-fire after waking only if still triggered.
          withdrawQueue(queue, plans, buys, now);
          await save({ settings: { ...settings, paused: true }, plans, buys, queue: [] });
        } else {
          await save({ settings: { ...settings, paused: false } });
        }
      });
      kick();
      return { ok: true };
    }
    case 'OPEN_DESK': {
      allowDeskNow(); // the user asked: skip the "one new desk per 10 min" limit
      await withLock(async () => {
        const { settings } = await load('settings');
        await save({ settings: { ...settings, deskConsent: true } });
      });
      kick();
      return { ok: true };
    }
    case 'TEST_ALERT': {
      const { settings } = await load('settings');
      await notify(settings, 'test', {
        key: '',
        title: '👋 Test from Tippy',
        text: 'Alerts are working. When an order fills you’ll see “Tippy filled order — Tippy bought $5 at $716K MC on $HIGGS.”',
        tone: 'info',
      });
      return { ok: true };
    }
    case 'OPEN_OPTIONS':
      await browser.tabs.create({ url: browser.runtime.getURL(`/options.html${cmd.section ? `#${cmd.section}` : ''}`) });
      return { ok: true };
    case 'HELLO':
      kick();
      return { ok: true };
  }
}

/** Keep finished plans for a while so people can see what happened, then drop them. */
function prune<T extends { state: string; updatedAt: number }>(plans: Record<string, T>): Record<string, T> {
  const week = 7 * 24 * 3600_000;
  const out: Record<string, T> = {};
  const finished = Object.entries(plans)
    .filter(([, p]) => p.state === 'done' || p.state === 'cancelled')
    .sort((a, b) => b[1].updatedAt - a[1].updatedAt);
  const keepFinished = new Set(finished.filter(([, p], i) => i < 30 && Date.now() - p.updatedAt < week).map(([id]) => id));
  for (const [id, p] of Object.entries(plans)) {
    if ((p.state !== 'done' && p.state !== 'cancelled') || keepFinished.has(id)) out[id] = p;
  }
  return out;
}
