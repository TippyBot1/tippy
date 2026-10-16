// The store build: practice runs and dry run are developer tools, so with
// DEV_TOOLS off none of it can be reached — not from settings, not from chat,
// not by a stale saved setting — and every order Tippy places is real.
import { describe, expect, it, vi } from 'vitest';

vi.mock('../src/shared/config', async (orig) => ({ ...(await orig<typeof import('../src/shared/config')>()), DEV_TOOLS: false }));

const { parse } = await import('../src/chat/parse');
const { HELP } = await import('../src/chat/run');
const { withDefaults } = await import('../src/shared/settings');

const said = (t: string) => {
  const i = parse(t);
  return i.type === 'unknown' ? i.hint : null;
};

describe('store build (no developer tools)', () => {
  it('never loads with dry run on, even if it was saved on', () => {
    expect(withDefaults({ dryRun: true }).dryRun).toBe(false);
    expect(withDefaults(undefined).dryRun).toBe(false);
  });

  it('answers practice and dry-run requests with "every order is real"', () => {
    for (const t of ['practice a sell', 'practice buying $5', 'dry run on', 'dry run off', 'go live', 'test a buy on CLAUDIA', 'paper trading on']) {
      expect(said(t), t).toMatch(/real/i);
      expect(parse(t).type, t).not.toBe('practice');
      expect(parse(t).type, t).not.toBe('setting');
    }
  });

  it('never turns a "test" order into a real one by surprise', () => {
    for (const t of ['test sell 25% at 2x', 'practice tp at 500k']) {
      expect(said(t), t).toMatch(/leave out the "test"/);
    }
  });

  it('still reads real orders and other settings', () => {
    expect(parse('sell 25% at 2x').type).toBe('add-tp');
    expect(parse('auto guard on')).toMatchObject({ type: 'setting', name: 'autoGuard', value: true });
  });

  it('never mentions dry run or practice in the help', () => {
    expect(HELP).not.toMatch(/dry run|practi/i);
  });
});
