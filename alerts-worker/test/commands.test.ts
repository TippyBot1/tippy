// What the bot makes of a message: commands queued for Tippy, help, and the
// "got it" reply. Nothing here can buy or sell.
import { describe, expect, it } from 'vitest';
import { ackText, HELP, parseCommand } from '../src/commands';

describe('parseCommand', () => {
  it('reads /orders and its aliases', () => {
    for (const t of ['/orders', '/status', '/list', '/ORDERS', '/orders@TippyAlertsBot']) expect(parseCommand(t), t).toEqual({ kind: 'queue', cmd: 'orders', coin: null });
  });

  it('pauses and resumes everything, or one coin', () => {
    expect(parseCommand('/pause')).toEqual({ kind: 'queue', cmd: 'pause', coin: null });
    expect(parseCommand('/pause all')).toEqual({ kind: 'queue', cmd: 'pause', coin: null });
    expect(parseCommand('/pause $tippy')).toEqual({ kind: 'queue', cmd: 'pause', coin: 'TIPPY' });
    expect(parseCommand('/pause WIF')).toEqual({ kind: 'queue', cmd: 'pause', coin: 'WIF' });
    expect(parseCommand('/resume')).toEqual({ kind: 'queue', cmd: 'resume', coin: null });
    expect(parseCommand('/unpause $TIPPY')).toEqual({ kind: 'queue', cmd: 'resume', coin: 'TIPPY' });
    expect(parseCommand('/pause@TippyAlertsBot $TIPPY')).toEqual({ kind: 'queue', cmd: 'pause', coin: 'TIPPY' });
  });

  it('cancels one coin at a time — never every order at once', () => {
    expect(parseCommand('/cancel $tippy')).toEqual({ kind: 'queue', cmd: 'cancel', coin: 'TIPPY' });
    expect(parseCommand('/cancel')).toEqual({ kind: 'bad-coin', cmd: 'cancel' });
    expect(parseCommand('/cancel all')).toEqual({ kind: 'bad-coin', cmd: 'cancel' });
    expect(ackText('cancel', 'TIPPY', 1, 2)).toBe("⏳ Cancelling $TIPPY's orders… (Tippy checks in about once a minute.)");
  });

  it('asks which coin when the ticker is nonsense', () => {
    expect(parseCommand('/pause $$$')).toEqual({ kind: 'bad-coin', cmd: 'pause' });
    expect(parseCommand('/pause averyveryverylongtickername')).toEqual({ kind: 'bad-coin', cmd: 'pause' });
  });

  it('never queues anything that could trade', () => {
    for (const t of ['/sell $TIPPY 50%', '/buy $TIPPY', 'sell everything', 'hello', '/pause $TIPPY now please']) {
      expect(parseCommand(t).kind, t).not.toBe('queue');
    }
  });

  it('knows /help', () => {
    expect(parseCommand('/help')).toEqual({ kind: 'help' });
    expect(HELP).toContain('/orders');
    expect(HELP).toMatch(/never ask for keys/);
  });
});

describe('ackText', () => {
  const now = 1_800_000_000_000;
  it('says it takes about a minute when Tippy checked in recently', () => {
    expect(ackText('pause', null, now - 30_000, now)).toBe('⏳ Pausing everything… (Tippy checks in about once a minute.)');
    expect(ackText('resume', 'TIPPY', now - 30_000, now)).toBe('⏳ Switching $TIPPY back on… (Tippy checks in about once a minute.)');
  });

  it('warns when the computer seems to be asleep', () => {
    expect(ackText('orders', null, now - 12 * 60_000, now)).toMatch(/^⏳ Asking Tippy for your orders… Tippy hasn't checked in for 12 min/);
    expect(ackText('orders', null, null, now)).toMatch(/hasn't checked in yet/);
  });
});
