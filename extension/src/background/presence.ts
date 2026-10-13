// "Is this coin really gone from your fomo balances?"
//
// One balance read without a coin is not proof it was sold — fomo's API can
// time out, return partial lists, or lag behind a pending trade (all seen in
// recon on 2026-10-11). A coin counts as gone (balance 0) only after MISS_READS
// consecutive *trusted* reads without it, spanning at least MISS_MS. A gap
// between reads (logged out, asleep, failed reads) restarts the count.

export const MISS_READS = 3;
export const MISS_MS = 30_000;
/** Reads further apart than this aren't "consecutive". */
export const MISS_GAP_MS = 60_000;

interface Miss {
  count: number;
  firstAt: number;
  lastAt: number;
}

export class Presence {
  private misses = new Map<string, Miss>();
  private lastReadAt = 0;

  /** Record one trusted balance read. `keys` = coins being guarded, `held` = coins in the read. */
  record(keys: string[], held: Set<string>, now: number) {
    const consecutive = this.lastReadAt > 0 && now - this.lastReadAt <= MISS_GAP_MS;
    this.lastReadAt = now;
    for (const key of [...this.misses.keys()]) if (!keys.includes(key)) this.misses.delete(key);
    for (const key of keys) {
      if (held.has(key)) {
        this.misses.delete(key);
        continue;
      }
      const m = this.misses.get(key);
      if (m && consecutive && now - m.lastAt <= MISS_GAP_MS) this.misses.set(key, { count: m.count + 1, firstAt: m.firstAt, lastAt: now });
      else this.misses.set(key, { count: 1, firstAt: now, lastAt: now });
    }
  }

  /** Forget one coin (e.g. it was just re-armed). */
  forget(key: string) {
    this.misses.delete(key);
  }

  /** Forget everything (logged out, untrusted data, long pause). */
  reset() {
    this.misses.clear();
    this.lastReadAt = 0;
  }

  /** True once the coin's absence is confirmed. */
  gone(key: string, now: number): boolean {
    const m = this.misses.get(key);
    return !!m && m.count >= MISS_READS && m.lastAt - m.firstAt >= MISS_MS && now - m.lastAt <= MISS_GAP_MS;
  }
}

/** Shared by the tick loop and the sell queue. */
export const presence = new Presence();
