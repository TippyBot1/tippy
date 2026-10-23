// Tippy alerts worker.
//   POST /telegram   Telegram webhook (/start <linkId>, /stop, /help, and
//                    /orders /pause /resume — queued for Tippy, see commands.ts)
//   GET  /link/:id   has this link been connected yet?
//   POST /notify     { linkId, kind, text } → Telegram message
//   POST /heartbeat  { linkId, armed } → dead-man bookkeeping; answers with the
//                    commands waiting for this Tippy
//   cron             "Tippy stopped watching" when heartbeats stop while coins are
//                    guarded; drops commands nobody picked up
// Plain-text messages only (no HTML/Markdown parse mode), so nothing an
// extension sends can turn into a link or formatting trick.

import { ackText, HELP, MENU, NEEDS, parseCommand } from './commands';

export interface Env {
  DB: D1Database;
  TG_TOKEN: string;
  TG_SECRET: string;
  BOT_USERNAME: string;
}

const LINK_ID = /^[0-9a-f]{32}$/;
const DEADMAN_MS = 10 * 60_000;
const RATE_PER_MIN = 20;
const MAX_TEXT = 1500;
/** Commands Tippy didn't pick up in this long are dropped (the computer is off). */
const INBOX_TTL_MS = 30 * 60_000;

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
  'access-control-allow-headers': 'content-type',
  'access-control-max-age': '86400',
};

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...CORS } });

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });

    try {
      if (req.method === 'POST' && url.pathname === '/telegram') return await telegramWebhook(req, env);
      if (req.method === 'GET' && url.pathname.startsWith('/link/')) return await linkStatus(url.pathname.slice(6), env);
      if (req.method === 'POST' && url.pathname === '/notify') return await notify(req, env);
      if (req.method === 'POST' && url.pathname === '/heartbeat') return await heartbeat(req, env);
      if (req.method === 'GET' && url.pathname === '/') return new Response('Tippy alerts are running. 🤖', { headers: CORS });
      return json({ ok: false, error: 'not found' }, 404);
    } catch (e) {
      console.error(e);
      return json({ ok: false, error: 'server error' }, 500);
    }
  },

  async scheduled(_event: ScheduledEvent, env: Env): Promise<void> {
    const cutoff = Date.now() - DEADMAN_MS;
    const { results } = await env.DB.prepare('SELECT link_id, chat_id, armed FROM links WHERE armed > 0 AND deadman_sent = 0 AND last_heartbeat < ?').bind(cutoff).all<{
      link_id: string;
      chat_id: number;
      armed: number;
    }>();
    for (const r of results) {
      await send(
        env,
        r.chat_id,
        `😴 Tippy stopped watching your ${r.armed} guarded coin${r.armed === 1 ? '' : 's'}.\nYour computer may be asleep or the browser closed. Your take-profits and stop losses won't fire until it's back.`,
      );
      await env.DB.prepare('UPDATE links SET deadman_sent = 1 WHERE link_id = ?').bind(r.link_id).run();
    }
    // Commands nobody picked up: say so once per chat, then drop them.
    const stale = Date.now() - INBOX_TTL_MS;
    const { results: lost } = await env.DB.prepare('SELECT DISTINCT l.chat_id FROM inbox i JOIN links l ON l.link_id = i.link_id WHERE i.created_at < ?').bind(stale).all<{ chat_id: number }>();
    for (const r of lost) {
      await send(env, r.chat_id, "😴 Tippy didn't pick up your last command — your computer seems to be off or asleep. Send it again once it's back.");
    }
    await env.DB.prepare('DELETE FROM inbox WHERE created_at < ?').bind(stale).run();
    // keep the rate table small
    await env.DB.prepare('DELETE FROM rate WHERE minute < ?').bind(Math.floor(Date.now() / 60_000) - 10).run();
  },
};

interface TgUpdate {
  message?: { chat?: { id?: number; type?: string }; text?: string };
}

async function telegramWebhook(req: Request, env: Env): Promise<Response> {
  if (req.headers.get('x-telegram-bot-api-secret-token') !== env.TG_SECRET) return new Response('forbidden', { status: 403 });
  const update = (await req.json()) as TgUpdate;
  const chatId = update.message?.chat?.id;
  const text = (update.message?.text ?? '').trim();
  if (!chatId || update.message?.chat?.type !== 'private') return new Response('ok');

  const [cmd, arg] = text.split(/\s+/, 2);
  if (cmd === '/start' && arg && LINK_ID.test(arg)) {
    await env.DB.prepare('INSERT INTO links (link_id, chat_id, created_at) VALUES (?, ?, ?) ON CONFLICT(link_id) DO UPDATE SET chat_id = excluded.chat_id')
      .bind(arg, chatId, Date.now())
      .run();
    await send(env, chatId, "👋 Hi, I'm Tippy! You're connected.\nI'll message you when I take profit, hit a stop, need your OK, or stop watching. Type /orders to see what I'm guarding, or /help for everything I can do.\n\nI will never ask for your keys, seed phrase or password. Type /stop to disconnect.");
    await setMenu(env);
    return new Response('ok');
  }
  if (cmd === '/stop') {
    await env.DB.prepare('DELETE FROM inbox WHERE link_id IN (SELECT link_id FROM links WHERE chat_id = ?)').bind(chatId).run();
    await env.DB.prepare('DELETE FROM links WHERE chat_id = ?').bind(chatId).run();
    await send(env, chatId, "👋 Disconnected. I won't message you anymore. You can reconnect anytime from Tippy's settings.");
    return new Response('ok');
  }

  const links = (await env.DB.prepare('SELECT link_id, last_heartbeat, remote FROM links WHERE chat_id = ?').bind(chatId).all<{ link_id: string; last_heartbeat: number | null; remote: number }>()).results;
  if (!links.length) {
    await send(env, chatId, "I'm Tippy's alert bot. Connect me from Tippy's settings in your browser (Settings → Alerts → Connect Telegram).\nI never ask for keys or passwords.");
    return new Response('ok');
  }
  const parsed = parseCommand(text);
  if (parsed.kind === 'help') {
    await send(env, chatId, HELP);
    await setMenu(env);
  } else if (parsed.kind === 'bad-coin') {
    await send(env, chatId, parsed.cmd === 'cancel' ? 'Which coin? Cancelling is one coin at a time, like /cancel $TIPPY. To stop everything for now, /pause.' : `Which coin? Use its ticker, like /${parsed.cmd} $TIPPY — or /${parsed.cmd} on its own for everything.`);
  } else if (parsed.kind === 'queue') {
    const need = NEEDS[parsed.cmd];
    if (!links.some((l) => l.remote >= need)) {
      await send(env, chatId, 'Your Tippy is an older version that can’t take commands from Telegram yet. Chrome updates extensions by itself within a day — or go to chrome://extensions and press Update. Alerts keep working meanwhile.');
      return new Response('ok');
    }
    if (!(await allow(env, `chat:${chatId}`))) {
      await send(env, chatId, 'Slow down a little — try again in a minute.');
      return new Response('ok');
    }
    const now = Date.now();
    const able = links.filter((l) => l.remote >= need);
    for (const l of able) {
      await env.DB.prepare('INSERT INTO inbox (link_id, cmd, coin, created_at) VALUES (?, ?, ?, ?)').bind(l.link_id, parsed.cmd, parsed.coin, now).run();
    }
    // With Tippy on two computers, the freshest check-in says how soon it'll happen.
    const last = Math.max(...able.map((l) => l.last_heartbeat ?? 0)) || null;
    await send(env, chatId, ackText(parsed.cmd, parsed.coin, last, now));
  } else {
    await send(env, chatId, `I didn't get that.\n\n${HELP}`);
  }
  return new Response('ok');
}

async function linkStatus(id: string, env: Env): Promise<Response> {
  if (!LINK_ID.test(id)) return json({ linked: false });
  const row = await env.DB.prepare('SELECT 1 FROM links WHERE link_id = ?').bind(id).first();
  return json({ linked: !!row });
}

async function readBody<T>(req: Request): Promise<T | null> {
  try {
    return (await req.json()) as T;
  } catch {
    return null;
  }
}

async function notify(req: Request, env: Env): Promise<Response> {
  const body = await readBody<{ linkId?: string; kind?: string; text?: string }>(req);
  if (!body?.linkId || !LINK_ID.test(body.linkId) || typeof body.text !== 'string') return json({ ok: false, error: 'bad request' }, 400);
  const link = await env.DB.prepare('SELECT chat_id FROM links WHERE link_id = ?').bind(body.linkId).first<{ chat_id: number }>();
  if (!link) return json({ ok: false, error: 'not linked' }, 404);
  if (!(await allow(env, body.linkId))) return json({ ok: false, error: 'slow down' }, 429);
  await send(env, link.chat_id, clean(body.text));
  return json({ ok: true });
}

async function heartbeat(req: Request, env: Env): Promise<Response> {
  const body = await readBody<{ linkId?: string; armed?: number; remote?: number }>(req);
  if (!body?.linkId || !LINK_ID.test(body.linkId)) return json({ ok: false }, 400);
  const armed = Math.max(0, Math.min(500, Math.floor(Number(body.armed) || 0)));
  const prev = await env.DB.prepare('SELECT chat_id, deadman_sent FROM links WHERE link_id = ?').bind(body.linkId).first<{ chat_id: number; deadman_sent: number }>();
  if (!prev) return json({ ok: false, error: 'not linked' }, 404);
  await env.DB.prepare('UPDATE links SET last_heartbeat = ?, armed = ?, deadman_sent = 0, remote = ? WHERE link_id = ?').bind(Date.now(), armed, Math.max(0, Math.min(9, Math.floor(Number(body.remote) || 0))), body.linkId).run();
  if (prev.deadman_sent && armed > 0) await send(env, prev.chat_id, `✅ Tippy is back and watching your ${armed} coin${armed === 1 ? '' : 's'}.`);
  // Commands waiting for this Tippy (oldest first); handed over once.
  const { results } = await env.DB.prepare('SELECT id, cmd, coin, created_at FROM inbox WHERE link_id = ? ORDER BY id LIMIT 10').bind(body.linkId).all<{
    id: number;
    cmd: string;
    coin: string | null;
    created_at: number;
  }>();
  if (results.length) await env.DB.prepare('DELETE FROM inbox WHERE link_id = ? AND id <= ?').bind(body.linkId, results[results.length - 1].id).run();
  return json({ ok: true, commands: results.map((r) => ({ id: r.id, cmd: r.cmd, coin: r.coin, at: r.created_at })) });
}

async function allow(env: Env, linkId: string): Promise<boolean> {
  const minute = Math.floor(Date.now() / 60_000);
  const row = await env.DB.prepare('INSERT INTO rate (link_id, minute, n) VALUES (?, ?, 1) ON CONFLICT(link_id, minute) DO UPDATE SET n = n + 1 RETURNING n')
    .bind(linkId, minute)
    .first<{ n: number }>();
  return (row?.n ?? 0) <= RATE_PER_MIN;
}

/** Plain text, no control characters, bounded length. */
export function clean(text: string): string {
  return text.replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '').slice(0, MAX_TEXT);
}

/** The command menu Telegram shows when you type "/" (idempotent, so it's set on /start and /help). */
async function setMenu(env: Env) {
  await fetch(`https://api.telegram.org/bot${env.TG_TOKEN}/setMyCommands`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ commands: MENU }),
  }).catch(() => {});
}

async function send(env: Env, chatId: number, text: string) {
  const res = await fetch(`https://api.telegram.org/bot${env.TG_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true }),
  });
  if (!res.ok) console.error('telegram send failed', res.status, await res.text());
}
