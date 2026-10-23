// What a message to the bot asks for. Commands that need Tippy (on the user's
// computer) are queued and picked up with its next heartbeat; the rest the bot
// answers itself. Looking, pausing and cancelling: nothing here buys or sells.

export type QueuedCommand = 'orders' | 'pause' | 'resume' | 'cancel';

/**
 * The command set a Tippy must say it handles (the heartbeat's `remote`) before
 * the bot queues a command for it: 1 = orders / pause / resume, 2 = + cancel.
 */
export const NEEDS: Record<QueuedCommand, number> = { orders: 1, pause: 1, resume: 1, cancel: 2 };

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
  cancel: 'cancel',
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
  // Cancelling is one coin at a time: no "/cancel" that wipes every order.
  if (coin === undefined || (what === 'cancel' && coin === null)) return { kind: 'bad-coin', cmd: what };
  return { kind: 'queue', cmd: what, coin };
}

export const HELP = [
  'Here’s what I can do from your phone:',
  '/orders — every coin Tippy is guarding and its next levels',
  '/pause — pause everything (nothing is bought or sold)',
  '/pause $TIPPY — pause one coin',
  '/resume — switch back on (or /resume $TIPPY)',
  '/cancel $TIPPY — cancel a coin\'s orders (nothing is sold)',
  '/stop — disconnect this chat',
  '',
  'Tippy runs on your computer and checks in about once a minute, so commands take up to a minute. I never ask for keys or passwords.',
].join('\n');

/** The command menu Telegram shows when you type "/". */
export const MENU = [
  { command: 'orders', description: 'What Tippy is guarding' },
  { command: 'pause', description: 'Pause everything (or /pause $COIN)' },
  { command: 'resume', description: 'Switch back on (or /resume $COIN)' },
  { command: 'cancel', description: "Cancel a coin's orders: /cancel $COIN" },
  { command: 'help', description: 'What I can do' },
  { command: 'stop', description: 'Disconnect this chat' },
];

/** The bot's "got it" while the command waits for Tippy. */
export function ackText(cmd: QueuedCommand, coin: string | null, lastHeartbeat: number | null, now: number): string {
  const what =
    cmd === 'orders'
      ? 'Asking Tippy for your orders'
      : cmd === 'cancel'
        ? `Cancelling $${coin}'s orders`
        : cmd === 'pause'
          ? coin
            ? `Pausing $${coin}`
            : 'Pausing everything'
          : coin
            ? `Switching $${coin} back on`
            : 'Switching Tippy back on';
  const quiet = lastHeartbeat == null ? Infinity : now - lastHeartbeat;
  if (quiet > 3 * 60_000) {
    const ago = Number.isFinite(quiet) ? ` for ${Math.round(quiet / 60_000)} min` : ' yet';
    return `⏳ ${what}… Tippy hasn't checked in${ago} — your computer may be asleep or the browser closed. It'll do this as soon as it's back.`;
  }
  return `⏳ ${what}… (Tippy checks in about once a minute.)`;
}
