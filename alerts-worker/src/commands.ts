// What a message to the bot asks for. Commands that need Tippy (on the user's
// computer) are queued and picked up with its next heartbeat; the rest the bot
// answers itself. Only looking and pausing: nothing here buys or sells.

export type QueuedCommand = 'orders' | 'pause' | 'resume';

export type Parsed =
  | { kind: 'queue'; cmd: QueuedCommand; coin: string | null }
  | { kind: 'help' }
  | { kind: 'bad-coin'; cmd: QueuedCommand }
  | { kind: 'unknown' };

const ALIASES: Record<string, QueuedCommand | 'help'> = {
  orders: 'orders',
  status: 'orders',
  list: 'orders',
  pause: 'pause',
  resume: 'resume',
  unpause: 'resume',
  help: 'help',
  commands: 'help',
};

/** "$tippy", "TIPPY" → "TIPPY"; "all"/"everything"/nothing → null; anything else → undefined. */
function coinArg(arg: string | undefined): string | null | undefined {
  if (!arg) return null;
  if (/^(?:all|everything)$/i.test(arg)) return null;
  const m = /^\$?([A-Za-z0-9]{1,15})$/.exec(arg);
  return m ? m[1].toUpperCase() : undefined;
}

export function parseCommand(text: string): Parsed {
  // "/pause@TippyAlertsBot $TIPPY" → "pause", "$TIPPY"
  const m = /^\/([a-z]+)(?:@\w+)?(?:\s+(\S+))?\s*$/i.exec(text.trim());
  if (!m) return { kind: 'unknown' };
  const what = ALIASES[m[1].toLowerCase()];
  if (!what) return { kind: 'unknown' };
  if (what === 'help') return { kind: 'help' };
  if (what === 'orders') return { kind: 'queue', cmd: 'orders', coin: null };
  const coin = coinArg(m[2]);
  return coin === undefined ? { kind: 'bad-coin', cmd: what } : { kind: 'queue', cmd: what, coin };
}

export const HELP = [
  'Here’s what I can do from your phone:',
  '/orders — every coin Tippy is guarding and its next levels',
  '/pause — pause everything (nothing is bought or sold)',
  '/pause $TIPPY — pause one coin',
  '/resume — switch back on (or /resume $TIPPY)',
  '/stop — disconnect this chat',
  '',
  'Tippy runs on your computer and checks in about once a minute, so commands take up to a minute. I never ask for keys or passwords.',
].join('\n');

/** The command menu Telegram shows when you type "/". */
export const MENU = [
  { command: 'orders', description: 'What Tippy is guarding' },
  { command: 'pause', description: 'Pause everything (or /pause $COIN)' },
  { command: 'resume', description: 'Switch back on (or /resume $COIN)' },
  { command: 'help', description: 'What I can do' },
  { command: 'stop', description: 'Disconnect this chat' },
];

/** The bot's "got it" while the command waits for Tippy. */
export function ackText(cmd: QueuedCommand, coin: string | null, lastHeartbeat: number | null, now: number): string {
  const what =
    cmd === 'orders' ? 'Asking Tippy for your orders' : cmd === 'pause' ? (coin ? `Pausing $${coin}` : 'Pausing everything') : coin ? `Switching $${coin} back on` : 'Switching Tippy back on';
  const quiet = lastHeartbeat == null ? Infinity : now - lastHeartbeat;
  if (quiet > 3 * 60_000) {
    const ago = Number.isFinite(quiet) ? ` for ${Math.round(quiet / 60_000)} min` : ' yet';
    return `⏳ ${what}… Tippy hasn't checked in${ago} — your computer may be asleep or the browser closed. It'll do this as soon as it's back.`;
  }
  return `⏳ ${what}… (Tippy checks in about once a minute.)`;
}
