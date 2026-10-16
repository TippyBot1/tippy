// /demo?film&replay=<id>: a real trade replayed 1:1 in the demo, for a video.
// Market caps are the coin's real 1-minute closes from fomo's chart (in $K,
// minutes from the first candle shown; a minute with no trades keeps the last
// close). The page is still the demo's; only the coin, the prices, the clock and
// the trade are real, and the film says so.

export interface Replay {
  symbol: string;
  name: string;
  /** Under the coin's name, and in the chart legend. */
  sub: string;
  about: string;
  /** Time of day (minutes) of the last candle before the replay starts. */
  clock0: number;
  /** Cash before the trade. */
  cash: number;
  /** One candle per minute up to the start (market caps, $). */
  seed: number[];
  /** One candle per minute from the start, in order (market caps, $). */
  path: number[];
}

/** "m:close m:close …" (close in $K) → one market cap per minute from `from` to `to`, gaps forward-filled. */
export function minutes(sparse: string, from: number, to: number): number[] {
  const at = new Map(sparse.split(/\s+/).map((p) => p.split(':').map(Number) as [number, number]));
  const out: number[] = [];
  let last = at.get(from) ?? [...at.entries()].sort((a, b) => a[0] - b[0])[0][1];
  for (let m = from; m <= to; m++) {
    last = at.get(m) ?? last;
    out.push(Math.round(last * 1000));
  }
  return out;
}

/** Replays live here by id (none at the moment). */
export const REPLAYS: Record<string, Replay> = {};

export const REPLAY: Replay | undefined = (() => {
  const q = new URLSearchParams(typeof location === 'undefined' ? '' : location.search);
  return q.has('film') ? REPLAYS[q.get('replay') ?? ''] : undefined;
})();
