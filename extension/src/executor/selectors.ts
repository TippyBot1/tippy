// Every assumption Tippy makes about fomo's trade panel lives in this file.
// Matching is semantic (roles, labels, visible text) so cosmetic redesigns don't
// break it. When fomo changes for real, Tippy pauses instead of guessing —
// fixes ship as a store update (no remote selectors: Chrome Web Store policy).
//
// Verified against: real fomo.family web capture 2026-10-11
// (test/fixtures/fomo-sell-panel-2026-10-11.html) — panel, tabs, amount box,
// % presets, confirm label and "Insufficient balance". Still unverified (needs a
// real position): quote/price-impact text, acknowledgement boxes, post-sell state.

export const TEXT = {
  buy: /^(buy|acheter)$/i,
  sell: /^(sell|vendre)$/i,
  max: /^max$/i,
  /** fomo turns the Sell button's own label into this when the amount is too big. */
  insufficient: /^insufficient (cash )?balance$/i,
  /** Read from the confirm button's own label only ("Minimum received" in a quote is not this). */
  belowMinimum: /^(below|under)\b.*minimum|^minimum (sell|buy|purchase|amount|trade)|^amount too small|^at least \$/i,
  /** fomo's status strip after a buy: "Buying $5.00 BONK" → "Bought …" (recon 2026-10-11). */
  bought: /(^|\s)Bought\s/,
  login: /^(log ?in|sign ?in|sign ?up|get started)$/i,
  impact: /price impact/i,
  riskAck: /(i understand|i acknowledge|i accept|i'm aware|risk)/i,
  /** Acknowledgement boxes must be a first-person consent. */
  consent: /\b(i understand|i acknowledge|i accept|i agree|i'm aware|i am aware)\b/i,
  impactAck: /(price impact|slippage)/i,
  feeAck: /(fee|fees)/i,
};

/** Visible, trimmed, single-spaced text of an element (ignores Tippy's own UI). */
export function textOf(el: Element | null): string {
  if (!el) return '';
  return (el.textContent ?? '').replace(/\s+/g, ' ').trim();
}

export function isTippy(el: Element): boolean {
  return !!el.closest('tippy-ui, [data-tippy]');
}

/**
 * Visible if neither the element nor any ancestor is display:none / hidden.
 * aria-hidden is deliberately ignored: modal libraries put it on the whole app
 * while a dialog is open, which would hide fomo's panel from Tippy.
 */
export function isVisible(el: Element): boolean {
  const view = el.ownerDocument.defaultView;
  for (let n: Element | null = el; n; n = n.parentElement) {
    const h = n as HTMLElement;
    if (h.hidden) return false;
    const style = view?.getComputedStyle(h);
    if (style && (style.display === 'none' || style.visibility === 'hidden')) return false;
  }
  return true;
}

export function isDisabled(el: Element | null): boolean {
  if (!el) return true;
  return (el as HTMLButtonElement).disabled === true || el.getAttribute('aria-disabled') === 'true' || el.hasAttribute('data-disabled');
}

function clickables(root: ParentNode): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>('button, [role="tab"], [role="button"], a[href]')).filter(
    (el) => !isTippy(el) && isVisible(el),
  );
}

export function findByText(root: ParentNode, re: RegExp): HTMLElement[] {
  return clickables(root).filter((el) => re.test(textOf(el)) || re.test(el.getAttribute('aria-label') ?? ''));
}

/** Nearest common ancestor of a and b. */
function commonAncestor(a: Element, b: Element): Element | null {
  const seen = new Set<Element>();
  for (let n: Element | null = a; n; n = n.parentElement) seen.add(n);
  for (let n: Element | null = b; n; n = n.parentElement) if (seen.has(n)) return n;
  return null;
}

// fomo's amount box is a bare <input placeholder="0"> with no type (captured 2026-10-11).
function amountInputs(root: ParentNode): HTMLInputElement[] {
  return Array.from(
    root.querySelectorAll<HTMLInputElement>('input:not([type]), input[type="text"], input[type="number"], input[inputmode="decimal"], input[inputmode="numeric"]'),
  ).filter((el) => !isTippy(el) && isVisible(el) && !/search/i.test(el.placeholder || el.getAttribute('aria-label') || ''));
}

export interface TradePanel {
  root: HTMLElement;
  buyTab: HTMLElement;
  sellTab: HTMLElement;
}

/**
 * The trade panel is the smallest element containing a Buy tab, a Sell tab and an
 * amount input.
 */
export function findTradePanel(doc: Document = document): TradePanel | null {
  const buys = findByText(doc, TEXT.buy);
  const sells = findByText(doc, TEXT.sell);
  let best: TradePanel | null = null;
  let bestDepth = -1;
  for (const b of buys) {
    for (const s of sells) {
      const anc = commonAncestor(b, s);
      if (!anc) continue;
      // climb until the container also holds an amount input
      let root: Element | null = anc;
      while (root && amountInputs(root).length === 0) root = root.parentElement;
      if (!root) continue;
      let depth = 0;
      for (let n: Element | null = root; n; n = n.parentElement) depth++;
      if (depth > bestDepth) {
        bestDepth = depth;
        best = { root: root as HTMLElement, buyTab: b, sellTab: s };
      }
    }
  }
  return best;
}

// fomo marks the active Buy/Sell tab only with colour classes:
// active Sell "bg-red-transparent text-red", active Buy "bg-green-transparent text-green",
// inactive "… text-text-secondary" (captured 2026-10-11).
const ACTIVE_TAB_CLASS = /(^|\s)(text-(red|green)|bg-(red|green)-transparent)(\s|$)/;
const INACTIVE_TAB_CLASS = /(^|\s)text-text-secondary(\s|$)/;

export function isSelected(tab: Element): boolean {
  if (
    tab.getAttribute('aria-selected') === 'true' ||
    tab.getAttribute('data-state') === 'active' ||
    tab.getAttribute('aria-pressed') === 'true' ||
    tab.getAttribute('data-active') === 'true'
  ) {
    return true;
  }
  const cls = tab.getAttribute('class') ?? '';
  return ACTIVE_TAB_CLASS.test(cls) && !INACTIVE_TAB_CLASS.test(cls);
}

export function findAmountInput(panel: TradePanel): HTMLInputElement | null {
  return amountInputs(panel.root)[0] ?? null;
}

/**
 * Is the amount box in dollars? fomo puts a "$" right before the input
 * (captured 2026-10-11). Buys type a USD amount, so anything else — a coin-
 * denominated box — means Tippy must not type at all.
 */
export function amountInUsd(panel: TradePanel): boolean {
  const input = findAmountInput(panel);
  const row = input?.parentElement;
  if (!input || !row) return false;
  return Array.from(row.childNodes).some((n) => n !== input && /^(\$|usd)$/i.test((n.textContent ?? '').trim()));
}

export function findMax(panel: TradePanel): HTMLElement | null {
  return findByText(panel.root, TEXT.max)[0] ?? null;
}

export function findPercentPreset(panel: TradePanel, pct: number): HTMLElement | null {
  const re = new RegExp(`^${Math.round(pct)}\\s?%$`);
  return findByText(panel.root, re)[0] ?? null;
}

/**
 * The confirm button: a button in the panel whose label starts with the side
 * ("Sell", "Sell $WIF", "Swipe to sell"…) and which is not the tab itself.
 */
export function findConfirm(panel: TradePanel, side: 'buy' | 'sell'): HTMLElement | null {
  const tab = side === 'sell' ? panel.sellTab : panel.buyTab;
  const re = new RegExp(`^(${side}|confirm|review|swipe to ${side}|slide to ${side})\\b`, 'i');
  const candidates = clickables(panel.root).filter((el) => {
    if (el === tab || el.contains(tab) || tab.contains(el)) return false;
    if (el.getAttribute('role') === 'tab' || el.closest('[role="tablist"]')) return false;
    return re.test(textOf(el)) || re.test(el.getAttribute('aria-label') ?? '');
  });
  // The confirm control sits below the tabs: take the last one in DOM order.
  return candidates[candidates.length - 1] ?? null;
}

const PRESET_LABEL = /^(\d+\s?%|\$[\d,.]+[kmb]?|max)$/i;
/**
 * Every label fomo's confirm button has been seen with (recon 2026-10-11):
 * "Sell <SYM>" / "Buy <SYM>", "Fetching quote...", "Insufficient balance".
 * Plus plausible variants. Anything else is not treated as the confirm button.
 */
const CONFIRM_LABEL = /^(sell\b|buy\b|fetching quote|getting quote|insufficient|enter (an )?amount|minimum|below|under|amount too small|at least)/i;

/**
 * The confirm button: the last button in the panel (not a tab, not a preset)
 * whose label is one of the confirm button's known states. fomo rewrites its
 * label (e.g. "Sell DOPE" → "Insufficient balance"), so callers read it separately.
 */
export function findConfirmSlot(panel: TradePanel): HTMLElement | null {
  const candidates = clickables(panel.root).filter((el) => {
    if (el.tagName !== 'BUTTON' && el.getAttribute('role') !== 'button') return false;
    if (el === panel.sellTab || el === panel.buyTab || el.contains(panel.sellTab) || el.contains(panel.buyTab)) return false;
    if (el.getAttribute('role') === 'tab' || el.closest('[role="tablist"]')) return false;
    const label = textOf(el);
    return label.length > 0 && !PRESET_LABEL.test(label) && CONFIRM_LABEL.test(label);
  });
  return candidates[candidates.length - 1] ?? null;
}

/**
 * Where fomo shows quote details (price impact, fees, warnings): the panel plus
 * the expanding drawer that sits *after* it (outside the panel root on the
 * 2026-10-11 capture). Collapsed drawers are skipped so stale quotes aren't read.
 */
export function quoteScope(panel: TradePanel): HTMLElement[] {
  const out: HTMLElement[] = [panel.root];
  for (let n = panel.root.nextElementSibling; n; n = n.nextElementSibling) {
    if (isTippy(n) || /grid-rows-\[0fr\]/.test(n.getAttribute('class') ?? '') || !isVisible(n)) continue;
    out.push(n as HTMLElement);
  }
  return out;
}

export function quoteText(panel: TradePanel): string {
  return quoteScope(panel).map(textOf).join(' ');
}

export interface Ack {
  el: HTMLElement;
  kind: 'risk' | 'impact' | 'fee';
  checked: boolean;
}

/**
 * Acknowledgement checkboxes fomo shows before risky trades. Only real
 * checkboxes whose label is a first-person consent ("I understand…") count —
 * switches and other toggles (slippage, MEV protection, modes…) are never touched.
 */
export function findAcks(panel: TradePanel): Ack[] {
  const boxes = quoteScope(panel)
    .flatMap((scope) => Array.from(scope.querySelectorAll<HTMLElement>('input[type="checkbox"], [role="checkbox"]')))
    .filter((el) => !isTippy(el) && isVisible(el));
  const out: Ack[] = [];
  for (const el of boxes) {
    const label = textOf(el.closest('label') ?? el.parentElement);
    if (!TEXT.consent.test(label)) continue;
    const kind: Ack['kind'] = TEXT.impactAck.test(label) ? 'impact' : TEXT.feeAck.test(label) ? 'fee' : 'risk';
    const checked = (el as HTMLInputElement).checked === true || el.getAttribute('aria-checked') === 'true' || el.getAttribute('data-state') === 'checked';
    out.push({ el, kind, checked });
  }
  return out;
}

/**
 * fomo's quote slot: the part of the amount box that isn't the input — where it
 * shows "0.0269 SOL" and the inline impact "(+0.03%)" (recon 2026-10-11).
 */
export function quoteSlot(panel: TradePanel): HTMLElement | null {
  const input = findAmountInput(panel);
  if (!input) return null;
  for (let n = input.parentElement; n && panel.root.contains(n); n = n.parentElement) {
    const others = Array.from(n.children).filter((c) => !c.contains(input) && !isTippy(c) && !/^[$€£]?$/.test(textOf(c)));
    if (others.length) return others[others.length - 1] as HTMLElement;
    if (n === panel.root) break;
  }
  return null;
}

const PCT = /([+\-\u2212]?\d+(?:\.\d+)?)\s*%/;
const toNum = (s: string) => Number(s.replace('\u2212', '-'));

/**
 * Inline impact from the quote slot. Only an explicit "+" is favourable (0);
 * "-x%" and an unsigned "x%" both count as x% impact (when unsure, assume the worse).
 */
function inlineImpact(panel: TradePanel): number | null {
  const m = textOf(quoteSlot(panel)).match(PCT);
  if (!m) return null;
  return m[1].startsWith('+') ? 0 : Math.abs(toNum(m[1]));
}

function ownText(el: Element): string {
  return Array.from(el.childNodes)
    .filter((n) => n.nodeType === 3)
    .map((n) => n.textContent ?? '')
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Worded impact warnings ("Price impact 3.2%", "3.2% price impact", "Price impact: Very high").
 * The number must belong to the same label or row — never borrowed from a neighbour.
 */
function wordedImpact(panel: TradePanel): { unreadable: boolean; values: number[] } {
  const values: number[] = [];
  let unreadable = false;
  for (const scope of quoteScope(panel)) {
    const labels = Array.from(scope.querySelectorAll('*')).filter((el) => !isTippy(el) && TEXT.impact.test(ownText(el)));
    for (const label of labels) {
      const own = ownText(label);
      const back = own.match(/([+\-\u2212]?\d+(?:\.\d+)?)\s*%\s*(?:of\s+)?price impact/i);
      const row = label.parentElement && scope.contains(label.parentElement) && label.parentElement !== scope ? label.parentElement : label;
      const fwd = own.match(/price impact\s*[:=]?\s*\(?\s*([+\-\u2212]?\d+(?:\.\d+)?)\s*%/i) ?? textOf(row).match(/price impact\s*[:=]?\s*\(?\s*([+\-\u2212]?\d+(?:\.\d+)?)\s*%/i);
      // "Price impact > 5%" / "above 5%" is a threshold, not the impact.
      const threshold = /price impact[^0-9]{0,12}(>|<|\u2265|\u2264|above|over|under|below|more than|less than)/i.test(textOf(row));
      const m = back ?? fwd;
      // Any impact label without its own readable number makes the whole read unreadable.
      if (m && !threshold) values.push(Math.abs(toNum(m[1])));
      else unreadable = true;
    }
  }
  return { unreadable, values };
}

export interface ImpactRead {
  /** Highest impact Tippy could read, in %, or null if none shown. */
  pct: number | null;
  /** fomo mentions price impact somewhere Tippy couldn't put a number on. */
  unreadable: boolean;
}

export function readImpact(panel: TradePanel): ImpactRead {
  const inline = inlineImpact(panel);
  const worded = wordedImpact(panel);
  const all = [...(inline != null ? [inline] : []), ...worded.values];
  return { pct: all.length ? Math.max(...all) : null, unreadable: worded.unreadable };
}

/** Price impact in % (see readImpact). */
export function readImpactPct(panel: TradePanel): number | null {
  return readImpact(panel).pct;
}

/** Does fomo warn about price impact without a number Tippy can read? */
export function mentionsImpact(panel: TradePanel): boolean {
  return readImpact(panel).unreadable;
}

export function panelSays(panel: TradePanel, re: RegExp): boolean {
  return re.test(quoteText(panel));
}

export function looksLoggedOut(doc: Document = document): boolean {
  return findByText(doc, TEXT.login).length > 0 && !findTradePanel(doc);
}
