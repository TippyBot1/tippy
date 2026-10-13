// The order form both tabs of Tippy's window share, laid out like the limit
// panels traders know from Axiom — in Tippy's own style:
//   Amount (quick chips + ✎ other) → the level as a market cap (⇄ price), and
//   right under it what that means ("−2.6% from now · −1.8% vs entry"),
//   then a −100%…+100% slider and a % box (0% = the market now) → one plain
//   sentence → one big button (the tabs draw the sentence and the button).
// Also the one row style every order is listed in ("Your orders", "Your buys"):
//   ▲ $790K MC +10% · sell 50%      ▼ $700K MC −2.6% · sell 10%

import type { ComponentChildren } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { formatUsd } from '../engine/triggers';
import type { Trigger } from '../engine/types';
import { Pencil } from './LevelEditor';
import { dropText, type FieldUnit, fieldText, levelFromPct, type Now, parseField, parsePct, pctBoxText, pctFromRel, relToNow, vsEntry } from './levels';


/** Off unless localStorage "tippyDebug" is set on the page — for chasing typing glitches on fomo. */
function debug(...args: unknown[]) {
  try {
    if (localStorage.getItem('tippyDebug')) console.debug('[tippy-dbg] level box:', ...args);
  } catch {
    /* storage blocked */
  }
}

/** Same level? (no level at all counts as the same whether it's null or undefined) */
function sameLevel(a: Trigger | null | undefined, b: Trigger | null | undefined): boolean {
  if (!a || !b) return !a && !b;
  return a.kind === b.kind && a.value === b.value;
}

export interface AmountChip {
  label: string;
  on: boolean;
  onPick: () => void;
}

/** The ✎ "other" box at the end of the amount chips. */
export interface AmountCustom {
  value: string;
  /** A custom amount is in use (lit like a chip). */
  on: boolean;
  prefix?: string;
  suffix?: string;
  ariaLabel: string;
  onInput: (text: string) => void;
  /** Enter, or leaving the box. */
  onCommit: () => void;
}

/** Amount: a label (what's chosen is on the right), four quick chips and ✎ other. */
export function AmountBox({ label, right, group, chips, custom }: { label: ComponentChildren; right?: ComponentChildren; group: string; chips: AmountChip[]; custom: AmountCustom }) {
  return (
    <div class="tw-box">
      <div class="tw-box-head">
        <span class="tw-box-l">{label}</span>
        {right}
      </div>
      <div class="tw-chips" role="group" aria-label={group}>
        {chips.map((c) => (
          <button key={c.label} class={`tw-chip${c.on ? ' on' : ''}`} aria-pressed={c.on} onClick={c.onPick}>
            {c.label}
          </button>
        ))}
        <form
          class={`tw-custom tw-amt-custom${custom.on ? ' on' : ''}`}
          onSubmit={(e) => {
            e.preventDefault();
            custom.onCommit();
          }}
        >
          <Pencil />
          {custom.prefix && <span aria-hidden="true">{custom.prefix}</span>}
          <input inputMode="decimal" autoComplete="off" spellcheck={false} value={custom.value} placeholder="other" aria-label={custom.ariaLabel} onInput={(e) => custom.onInput(e.currentTarget.value)} onBlur={custom.onCommit} />
          {custom.suffix && <span aria-hidden="true">{custom.suffix}</span>}
        </form>
      </div>
    </div>
  );
}

/** Slider tick labels (0% = the market now). */
const TICKS = ['−100%', '−50%', '0%', '50%', '100%'];

/** 'up' for a gain (mint), 'down' for a loss (red). */
const gain = (x: number) => (x > 1 ? 'up' : x < 1 ? 'down' : '');

/**
 * The level: a market cap (or, after ⇄, a price), what it means right under it
 * (the move from now and, on a sell, the gain or loss against your entry), and
 * — kept in step — a slider from −100% to +100% and a % box, both measured from
 * the market now. Typing in either box or dragging the slider sets the level;
 * what's typed stays as typed until you leave the box. The % box also takes
 * moves past +100% (+400% = 5x).
 */
export function TriggerBox({
  side,
  trigger,
  unit,
  canFlip,
  onFlip,
  now,
  base = now,
  tone,
  entry = null,
  focusSignal = 0,
  onChange,
}: {
  side: 'sell' | 'buy';
  /** The level as set (null = none yet). */
  trigger: Trigger | null;
  unit: FieldUnit;
  /** ⇄ is there only when both a market cap and a price are known. */
  canFlip: boolean;
  onFlip: () => void;
  /** Where the coin is now: what the % and the slider measure from. */
  now: Now;
  /** What "x" levels are measured from (your entry on a running plan). */
  base?: Now;
  /** Slider colour: mint above (take profit), red below (stop), mint for buys. */
  tone: 'up' | 'down' | 'buy' | null;
  /**
   * Sells: your entry on a running plan, for "−1.8% vs your entry". Without one,
   * a new plan's entry is the price now, so the move from now is the gain or loss.
   */
  entry?: Now | null;
  /** Bumped when the trader just picked this tab or ✎ an order: the level box takes the focus. */
  focusSignal?: number;
  onChange: (t: Trigger | null) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  /** What's typed in the level box / the % box (null = it shows the level as set). */
  const [lvlText, setLvlText] = useState<string | null>(null);
  const [pctText, setPctText] = useState<string | null>(null);
  useEffect(() => {
    if (!focusSignal || !input.current) return;
    // A tab picked or an order ✎'d: start the box fresh, then hand it the cursor.
    setLvlText(null);
    setPctText(null);
    input.current.focus();
    input.current.select();
  }, [focusSignal]);
  /** The last level this box set — anything else came from outside (✎ an order, a fresh form). */
  const sent = useRef<Trigger | null>(trigger ?? null);
  /** Is the trader typing in the level box right now? (works inside fomo's shadow root too) */
  const typing = () => {
    const el = input.current;
    return !!el && (el.getRootNode() as Document | ShadowRoot).activeElement === el;
  };
  /**
   * Levels this box sent that the window hasn't passed back yet, oldest first. Typing
   * can outrun the window: on fomo "2" came back only after "2." (no level yet) was
   * typed — that late "2" is our own echo, not a change from outside.
   */
  const pending = useRef<(Trigger | null)[]>([]);
  useEffect(() => {
    const mine = pending.current.findIndex((p) => sameLevel(p, trigger));
    if (mine >= 0) {
      pending.current = pending.current.slice(mine + 1);
      return;
    }
    // Compare by value: "no level" can come back as undefined or a fresh object.
    if (sameLevel(trigger, sent.current)) return;
    pending.current = [];
    sent.current = trigger ?? null;
    debug('level changed from outside → clearing what was typed', trigger, typing() ? '(while typing!)' : '');
    setLvlText(null);
    setPctText(null);
  }, [trigger]);
  useEffect(() => {
    debug('unit', unit, typing() ? '(while typing!)' : '');
    setLvlText(null);
  }, [unit]);

  useEffect(() => {
    debug('box mounted');
    return () => debug('box unmounted');
  }, []);

  const emit = (t: Trigger | null) => {
    sent.current = t ?? null;
    pending.current = [...pending.current, t ?? null].slice(-20);
    onChange(t);
  };
  const rel = trigger ? relToNow(trigger, now, base) : NaN;
  const pct = pctFromRel(rel);
  const slider = Number.isFinite(pct) ? Math.max(-100, Math.min(100, Math.round(pct))) : 0;
  const lvlBad = lvlText != null && lvlText.trim() !== '' && !parseField(lvlText, unit);
  const pctBad = pctText != null && pctText.trim() !== '' && parsePct(pctText) == null;
  const ref = unit === 'mc' ? now.mc : now.priceUSD;
  const what = unit === 'mc' ? 'Market cap' : 'Price';
  const vx = trigger && entry ? vsEntry(trigger, entry, now) : NaN;
  const entryText = entry ? (unit === 'mc' && entry.mc ? `${formatUsd(entry.mc)} MC` : formatUsd(entry.priceUSD)) : '';
  // The slider's fill runs from 0% (the middle) to the thumb.
  const thumb = (slider + 100) / 2;
  const fill = `--a:${Math.min(50, thumb)}%;--b:${Math.max(50, thumb)}%`;

  const typeLevel = (text: string) => {
    debug('typed', JSON.stringify(text), '→', parseField(text, unit));
    setLvlText(text);
    setPctText(null);
    emit(text.trim() ? parseField(text, unit) : null);
  };
  const typePct = (text: string) => {
    setPctText(text);
    setLvlText(null);
    const p = parsePct(text);
    emit(p == null || p === 0 ? null : levelFromPct(p, unit, now));
  };
  const slide = (v: number) => {
    setLvlText(null);
    setPctText(null);
    emit(v === 0 ? null : levelFromPct(v, unit, now));
  };
  // Leaving a box tidies what's typed into the level as set ("700k" → "700K") — unless it can't be read.
  const leaveLevel = () => {
    debug('left the box', JSON.stringify(lvlText), lvlBad ? '(kept: unreadable)' : '');
    if (!lvlBad) setLvlText(null);
  };
  const leavePct = () => !pctBad && setPctText(null);

  const shown = lvlText ?? fieldText(trigger, unit, base, now);
  if (typing() && input.current && input.current.value !== shown) debug('redraw overwrites what is typed', JSON.stringify(input.current.value), '→', JSON.stringify(shown), { lvlText, trigger, unit });

  return (
    <div class={`tw-box tw-trig${tone ? ` is-${tone}` : ''}`}>
      <form
        class={`tw-trig-row${lvlBad ? ' bad' : ''}`}
        onSubmit={(e) => {
          e.preventDefault();
          leaveLevel();
        }}
      >
        {canFlip ? (
          <button
            type="button"
            class="tw-flip"
            aria-label={unit === 'mc' ? 'Switch to price' : 'Switch to market cap'}
            title={unit === 'mc' ? 'Set the level as an exact price instead' : 'Set the level as a market cap'}
            onClick={onFlip}
          >
            {unit === 'mc' ? 'MC' : 'Price'} <span aria-hidden="true">⇄</span>
          </button>
        ) : (
          <span class="tw-flip off">{unit === 'mc' ? 'MC' : 'Price'}</span>
        )}
        <span class="tw-trig-cur" aria-hidden="true">
          $
        </span>
        <input
          ref={input}
          class="tw-trig-in"
          inputMode="decimal"
          autoComplete="off"
          spellcheck={false}
          value={shown}
          placeholder={ref ? fieldText(levelFromPct(0, unit, now), unit, now) : ''}
          aria-label={`${what} to ${side} at (or drag the slider)`}
          onInput={(e) => typeLevel(e.currentTarget.value)}
          onBlur={leaveLevel}
        />
        <span class="tw-trig-now" title="Where it is now">
          now {ref ? formatUsd(ref) : '—'}
        </span>
      </form>
      {trigger && Number.isFinite(rel) && (
        <div class="tw-means">
          <span class={side === 'sell' && !entry ? gain(rel) : ''}>{dropText(rel)} from now</span>
          {Number.isFinite(vx) && (
            <>
              {' · '}
              <span class={gain(vx)} title={`Against your entry at ${entryText}`}>
                {dropText(vx)} vs entry
              </span>
            </>
          )}
        </div>
      )}
      <div class="tw-slide-row">
        <div class="tw-slider">
          <input
            type="range"
            min={-100}
            max={100}
            step={1}
            value={slider}
            style={fill}
            disabled={!ref}
            aria-label="Move from the market now, in %"
            aria-valuetext={trigger && Number.isFinite(pct) ? `${pctBoxText(pct)}%` : '0% — the market now'}
            onInput={(e) => slide(Number(e.currentTarget.value))}
          />
          <div class="tw-ticks" aria-hidden="true">
            {TICKS.map((t) => (
              <span key={t}>{t}</span>
            ))}
          </div>
        </div>
        <form
          class={`tw-pctbox${pctBad ? ' bad' : ''}`}
          onSubmit={(e) => {
            e.preventDefault();
            leavePct();
          }}
        >
          <input
            inputMode="decimal"
            autoComplete="off"
            spellcheck={false}
            value={pctText ?? (trigger && Number.isFinite(pct) ? pctBoxText(pct) : '')}
            placeholder="0"
            disabled={!ref}
            aria-label="Move from now in % (minus = below)"
            onInput={(e) => typePct(e.currentTarget.value)}
            onBlur={leavePct}
          />
          <span aria-hidden="true">%</span>
        </form>
      </div>
    </div>
  );
}

/** One order in the list: ▲ / ▼, the level, how far from now, what it does — a status chip when it isn't just watching. */
export function OrderRow({
  dir,
  tone,
  level,
  move,
  what,
  status,
  done = false,
  editing = false,
  title,
  busy = false,
  onEdit,
  editLabel,
  onRemove,
  removeLabel,
  lockedWhy,
}: {
  dir: 'up' | 'down';
  /** up = take profit (mint), down = stop (red), buy = a limit buy (mint). */
  tone: 'up' | 'down' | 'buy';
  level: string;
  /** "+10%" / "−2.6%" from now ('' if unknown). */
  move: string;
  /** "sell 50%", "sell the rest", "buy $10 · 23h left". */
  what: string;
  /** [words, css class] — only when it isn't just watching. */
  status?: [string, string] | null;
  /** Finished (sold, skipped…): dimmed. */
  done?: boolean;
  /** Loaded into the form by ✎. */
  editing?: boolean;
  title?: string;
  busy?: boolean;
  onEdit?: () => void;
  editLabel?: string;
  onRemove?: () => void;
  removeLabel?: string;
  /** Why ✎ / × are greyed out (e.g. a sell is in flight). */
  lockedWhy?: string | null;
}) {
  return (
    <div class={`tw-row is-${tone}${done ? ' tw-done' : ''}${editing ? ' tw-editing' : ''}`} title={title}>
      <span class="tw-arrow" aria-hidden="true">
        {dir === 'up' ? '▲' : '▼'}
      </span>
      <b class="tw-row-lvl">{level}</b>
      {move && <span class="tw-row-move">{move}</span>}
      <span class="tw-row-what">· {what}</span>
      {status && <span class={`tw-status ${status[1]}`}>{status[0]}</span>}
      {onEdit && (
        <button class={`tw-row-btn${editing ? ' on' : ''}`} disabled={busy || !!lockedWhy} title={lockedWhy ?? 'Change this order'} aria-label={editLabel} aria-pressed={editing} onClick={onEdit}>
          <Pencil />
        </button>
      )}
      {onRemove && (
        <button class="tw-x" disabled={busy || !!lockedWhy} title={lockedWhy ?? 'Remove this order'} aria-label={removeLabel} onClick={onRemove}>
          ×
        </button>
      )}
    </div>
  );
}

/** The thin "now $719K" line between the orders above the market and those below. */
export function NowLine({ text }: { text: string }) {
  return (
    <div class="tw-nowline" role="separator" aria-label={`Now ${text}`}>
      <span>now {text}</span>
    </div>
  );
}
