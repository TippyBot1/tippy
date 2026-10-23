// Commands typed to @TippyAlertsBot on your phone, picked up when Tippy checks
// in with the alerts worker (about once a minute): /orders shows what Tippy is
// guarding, /pause and /resume work for everything or one coin ($TIPPY). They
// only ever look or pause — nothing is bought or sold from Telegram. Each one
// gets an answer in the chat.

import { isLiveBuy } from '../engine/buys';
import { currentX, summarizePlan } from '../engine/orders';
import { describeTrigger, formatUsd, formatX } from '../engine/triggers';
import type { Plan } from '../engine/types';
import { reply, type RemoteCommand } from '../shared/alerts';
import { load } from '../shared/store';
import { handleCommand } from './commands';

/** Older than this when picked up: the answer says the computer was off. */
const LATE_MS = 5 * 60_000;
/** Coins listed in /orders before "…and N more". */
const LIST_MAX = 12;

const guarded = (p: Plan) => p.state === 'armed' || p.state === 'paused';
const sym = (s: string) => `$${s}`;
const sameCoin = (p: { symbol: string }, coin: string) => p.symbol.toUpperCase() === coin;

export async function runRemote(cmds: RemoteCommand[]): Promise<void> {
  for (const c of cmds) {
    const text = await answer(c);
    const late = Date.now() - c.at > LATE_MS ? `(Your message from ${Math.round((Date.now() - c.at) / 60_000)} min ago — Tippy was offline.)\n` : '';
    const { settings } = await load('settings');
    await reply(settings, late + text);
  }
}

async function answer(c: RemoteCommand): Promise<string> {
  if (c.cmd === 'orders') return ordersText();
  const pause = c.cmd === 'pause';
  const { settings, plans } = await load('settings', 'plans');

  if (c.coin == null) {
    if (pause === settings.paused) return pause ? 'Tippy is already paused. /resume switches it back on.' : 'Tippy is already on and watching your orders.';
    await handleCommand({ type: 'PAUSE_ALL', paused: pause });
    return pause ? "⏸️ Paused. Tippy won't buy or sell anything until you /resume." : '▶️ Back on — Tippy is watching your orders again.';
  }

  const mine = Object.values(plans).filter((p) => guarded(p) && sameCoin(p, c.coin!));
  if (!mine.length) return `Tippy isn't guarding a coin called ${sym(c.coin)}. /orders shows what it's guarding.`;
  const todo = mine.filter((p) => p.state === (pause ? 'armed' : 'paused'));
  if (!todo.length) return pause ? `${sym(c.coin)} is already paused. /resume ${sym(c.coin)} switches it back on.` : `${sym(c.coin)} is already on.`;
  for (const p of todo) await handleCommand({ type: pause ? 'PAUSE_PLAN' : 'RESUME_PLAN', planId: p.id });
  const off = !pause && settings.paused ? ' Tippy as a whole is still paused — /resume to switch everything back on.' : '';
  return pause ? `⏸️ Paused ${sym(c.coin)}. Its orders stay put; /resume ${sym(c.coin)} switches them back on.` : `▶️ ${sym(c.coin)} is back on.${off}`;
}

async function ordersText(): Promise<string> {
  const { settings, plans, buys } = await load('settings', 'plans', 'buys');
  const coins = Object.values(plans)
    .filter(guarded)
    .sort((a, b) => a.symbol.localeCompare(b.symbol));
  const waiting = Object.values(buys).filter(isLiveBuy);
  if (!coins.length && !waiting.length) return '📋 Tippy has no orders on right now.';

  const lines: string[] = [];
  const n = coins.length;
  lines.push(n ? `📋 Tippy is guarding ${n} coin${n === 1 ? '' : 's'}${settings.paused ? ' — all paused (/resume)' : ''}:` : `📋 No coins guarded${settings.paused ? ' — Tippy is paused (/resume)' : ''}.`);
  for (const p of coins.slice(0, LIST_MAX)) {
    const x = currentX(p);
    const now = [p.lastMc ? `${formatUsd(p.lastMc)} MC` : null, x ? formatX(x) : null].filter(Boolean).join(', ');
    lines.push(`• ${sym(p.symbol)}${p.state === 'paused' ? ' (paused)' : ''}${now ? ` — ${now}` : ''}\n   ${summarizePlan(p)}`);
  }
  if (n > LIST_MAX) lines.push(`…and ${n - LIST_MAX} more.`);
  if (waiting.length) {
    lines.push(`Limit buys waiting: ${waiting.length}`);
    for (const o of waiting.slice(0, LIST_MAX)) lines.push(`• ${formatUsd(o.usd)} of ${sym(o.symbol)} at ${describeTrigger(o.trigger)}`);
  }
  return lines.join('\n');
}
