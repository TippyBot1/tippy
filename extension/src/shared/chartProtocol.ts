// The wire format between Tippy's content script and the tiny main-world chart
// script. No imports on purpose: the main-world bundle stays a few KB.

export type ChartLineKind = 'buy' | 'tp' | 'sl' | 'trail';

export interface ChartLine {
  /** Stable id: "buy:<orderId>", "tp:<planId>:<tpId>", "stop:<planId>:<stopId>" (a partial stop, drawn as kind 'sl'), "sl:<planId>", "trail:<planId>". */
  id: string;
  kind: ChartLineKind;
  /** The level as a USD price… */
  price: number;
  /** …and as a market cap (fomo's basis: price × total supply), when known. */
  mc: number | null;
  /** Short label next to the line, e.g. "Tippy · TP1 · 50%", "Tippy · SL · 10%" (a partial stop). */
  label: string;
  /** Can be dragged to propose a new level (the user confirms in Tippy). */
  draggable: boolean;
  /** Paused plans draw faintly. */
  muted?: boolean;
}

export interface ChartPayload {
  /** The coin these lines belong to ("<address>:<networkId>"). */
  key: string;
  /** Where the coin is now — lets the chart side tell whether fomo's axis shows price or market cap. */
  now: { priceUSD: number | null; mc: number | null };
  lines: ChartLine[];
  /** Bumped to make the chart side redraw everything (e.g. snap a dragged line back). */
  nonce: number;
}

export interface ChartMove {
  id: string;
  /** Where the line was dropped, in the axis's units. */
  value: number;
  axis: 'price' | 'mc';
}

export const LINES_EVENT = 'tippy:chart-lines';
export const MOVED_EVENT = 'tippy:chart-moved';
/**
 * Page → Tippy goes by window.postMessage: Chrome doesn't hand a CustomEvent's
 * `detail` from the page's world to an extension's (seen live 2026-10-13).
 */
export const MOVED_SOURCE = 'tippy-chart';
export interface MovedMessage {
  source: typeof MOVED_SOURCE;
  type: typeof MOVED_EVENT;
  move: ChartMove;
}

