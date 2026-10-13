// Draws Tippy's levels on fomo's own chart. Runs in the PAGE's world because
// fomo's chart is the TradingView charting library inside a same-origin frame,
// and its drawing API lives there. Deliberately tiny and dumb:
//  - it only draws what Tippy's content script sends (JSON in a DOM event),
//  - lines are never saved into the user's chart layout (disableSave),
//  - when the user drags a line it reports where it was dropped — Tippy's own
//    window then asks the user to confirm. Nothing here can change an order.
// If fomo's chart isn't there or its API changes, it simply draws nothing.

import { LINES_EVENT, MOVED_EVENT, MOVED_SOURCE, type ChartLine, type ChartMove, type ChartPayload, type MovedMessage } from '../shared/chartProtocol';

const COLORS: Record<ChartLine['kind'], string> = { buy: '#2fe0a0', tp: '#5b9cff', sl: '#ff5d73', trail: '#ffb547' };
const MUTED = '#7e8994';
const SYNC_MS = 1_000;
/** A drop has to stay put this long before Tippy asks about it (a drag in progress moves the line every frame). */
const SETTLE_MS = 900;

interface Drawn {
  entity: unknown;
  value: number;
  sig: string;
  /** Where we last saw it, and since when (for drag detection). */
  seen: number;
  seenSince: number;
  reported: boolean;
}

// Minimal shape of the bits of TradingView's chart API this uses.
interface TvShape {
  getPoints(): { price: number }[];
}
interface TvChart {
  createShape(point: { price: number }, options: Record<string, unknown>): Promise<unknown> | unknown;
  removeEntity(id: unknown): void;
  getShapeById(id: unknown): TvShape;
  getPanes(): { getMainSourcePriceScale(): { getVisiblePriceRange(): { from: number; to: number } | null } }[];
}

export default defineContentScript({
  matches: ['https://fomo.family/*'],
  world: 'MAIN',
  runAt: 'document_idle',
  main() {
    let want: ChartPayload | null = null;
    let drawnFor: { key: string; axis: 'price' | 'mc'; nonce: number } | null = null;
    const drawn = new Map<string, Drawn>();
    let busy = false;

    document.addEventListener(LINES_EVENT, (e) => {
      try {
        const detail = (e as CustomEvent<string>).detail;
        const next = typeof detail === 'string' ? (JSON.parse(detail) as ChartPayload) : null;
        if (next && Array.isArray(next.lines)) want = next;
      } catch {
        /* not ours */
      }
      void sync();
    });

    /** fomo's chart: the biggest same-origin frame that carries TradingView's API. */
    function chart(): TvChart | null {
      for (const f of Array.from(document.querySelectorAll('iframe'))) {
        try {
          const api = (f.contentWindow as unknown as { tradingViewApi?: { activeChart(): TvChart } })?.tradingViewApi;
          if (api && f.clientWidth > 200) return api.activeChart();
        } catch {
          /* cross-origin frame */
        }
      }
      return null;
    }

    /** fomo's Price / MCap toggle: whichever the visible axis is closer to (they differ by the supply, ~millions×). */
    function axisOf(c: TvChart, now: ChartPayload['now']): 'price' | 'mc' | null {
      try {
        const range = c.getPanes()[0].getMainSourcePriceScale().getVisiblePriceRange();
        if (!range) return null;
        const mid = (range.from + range.to) / 2;
        if (!(mid > 0)) return null;
        if (!now.mc || !now.priceUSD) return 'price';
        return Math.abs(Math.log(mid / now.mc)) < Math.abs(Math.log(mid / now.priceUSD)) ? 'mc' : 'price';
      } catch {
        return null;
      }
    }

    function clear(c: TvChart | null) {
      for (const d of drawn.values()) {
        try {
          c?.removeEntity(d.entity);
        } catch {
          /* already gone */
        }
      }
      drawn.clear();
    }

    async function sync() {
      if (busy) return;
      busy = true;
      try {
        const c = chart();
        if (!c) return;
        if (!want) return clear(c);
        const axis = axisOf(c, want.now);
        if (!axis) return;
        // New coin, flipped axis or a forced redraw: start over.
        if (!drawnFor || drawnFor.key !== want.key || drawnFor.axis !== axis || drawnFor.nonce !== want.nonce) {
          clear(c);
          drawnFor = { key: want.key, axis, nonce: want.nonce };
        }
        const ids = new Set<string>();
        for (const line of want.lines) {
          const value = axis === 'mc' ? line.mc : line.price;
          if (value == null || !(value > 0)) continue;
          ids.add(line.id);
          const sig = `${value}|${line.label}|${line.muted ? 1 : 0}|${line.draggable ? 1 : 0}`;
          const have = drawn.get(line.id);
          if (have && have.sig === sig && exists(c, have.entity)) continue;
          if (have) remove(c, line.id);
          const color = line.muted ? MUTED : COLORS[line.kind];
          const entity = await c.createShape(
            { price: value },
            {
              shape: 'horizontal_line',
              lock: !line.draggable,
              disableSelection: !line.draggable,
              disableSave: true,
              disableUndo: true,
              showInObjectsTree: false,
              overrides: { linecolor: color, linestyle: 2, linewidth: 2, showLabel: true, text: line.label, textcolor: color, horzLabelsAlign: 'right', vertLabelsAlign: 'bottom', fontsize: 11, showPrice: true },
            },
          );
          if (entity != null) drawn.set(line.id, { entity, value, sig, seen: value, seenSince: Date.now(), reported: false });
        }
        for (const id of [...drawn.keys()]) if (!ids.has(id)) remove(c, id);
        watchDrags(c, axis);
      } catch {
        /* fomo's chart changed — draw nothing rather than break the page */
      } finally {
        busy = false;
      }
    }

    function exists(c: TvChart, entity: unknown): boolean {
      try {
        return c.getShapeById(entity).getPoints().length > 0;
      } catch {
        return false;
      }
    }

    function remove(c: TvChart, id: string) {
      const d = drawn.get(id);
      if (!d) return;
      try {
        c.removeEntity(d.entity);
      } catch {
        /* already gone */
      }
      drawn.delete(id);
    }

    /** A dragged line settles somewhere new → tell Tippy once (it asks the user before changing anything). */
    function watchDrags(c: TvChart, axis: 'price' | 'mc') {
      const now = Date.now();
      for (const [id, d] of drawn) {
        let at: number;
        try {
          at = c.getShapeById(d.entity).getPoints()[0]?.price;
        } catch {
          continue;
        }
        if (!(at > 0)) continue;
        if (Math.abs(at - d.seen) / d.seen > 1e-6) {
          d.seen = at;
          d.seenSince = now;
          d.reported = false;
          continue;
        }
        const moved = Math.abs(at - d.value) / d.value > 0.002;
        if (moved && !d.reported && now - d.seenSince >= SETTLE_MS) {
          d.reported = true;
          const move: ChartMove = { id, value: at, axis };
          const msg: MovedMessage = { source: MOVED_SOURCE, type: MOVED_EVENT, move };
          window.postMessage(msg, location.origin);
        }
      }
    }

    setInterval(() => void sync(), SYNC_MS);
  },
});
