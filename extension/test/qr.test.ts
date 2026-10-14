// The QR generator behind "scan with your phone". A real reader decodes its
// output in the site's checks; here: sizes, the fixed patterns, determinism.
import { describe, expect, it } from 'vitest';
import { qrMatrix, qrPath } from '../src/ui/qr';

const finderAt = (m: boolean[][], x: number, y: number) => {
  for (let dy = 0; dy < 7; dy++)
    for (let dx = 0; dx < 7; dx++) {
      const ring = Math.max(Math.abs(dx - 3), Math.abs(dy - 3));
      if (m[y + dy][x + dx] !== (ring !== 2)) return false;
    }
  return true;
};

describe('qr', () => {
  it('picks the smallest version that fits (level M)', () => {
    expect(qrMatrix('A').length).toBe(21); // version 1
    expect(qrMatrix('https://t.me/TippyAlertsBot?start=' + 'a'.repeat(32)).length).toBe(37); // version 5, 66 bytes
    expect(() => qrMatrix('x'.repeat(300))).toThrow();
  });

  it('draws the three finder patterns and the timing lines', () => {
    const m = qrMatrix('https://t.me/TippyAlertsBot?start=0123456789abcdef0123456789abcdef');
    const n = m.length;
    expect(finderAt(m, 0, 0)).toBe(true);
    expect(finderAt(m, n - 7, 0)).toBe(true);
    expect(finderAt(m, 0, n - 7)).toBe(true);
    for (let i = 8; i < n - 8; i++) {
      expect(m[6][i]).toBe(i % 2 === 0);
      expect(m[i][6]).toBe(i % 2 === 0);
    }
    expect(m[n - 8][8]).toBe(true); // the dark module
  });

  it('is the same every time, with a quiet zone around it', () => {
    const a = qrPath(qrMatrix('hello'));
    expect(qrPath(qrMatrix('hello'))).toEqual(a);
    expect(a.size).toBe(21 + 8);
    expect(a.d.startsWith('M4 4h1v1h-1z')).toBe(true);
  });
});
