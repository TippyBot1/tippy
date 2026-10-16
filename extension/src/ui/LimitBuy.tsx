// The "Buy" tab in Tippy's window: "buy $10 of this coin if it dips to $1.6M MC"
// (or breaks out to a level), then guard the new coins with a P-preset — or,
// when the coin already has a running plan, with that plan (the background
// keeps it rather than arming a preset). Same order form as the Sell tab
// (ui/OrderForm): Amount chips, the level as a market cap (⇄ price) with the %
// slider, one plain sentence and one big green button.
// Also: Tippy's one-line status above the main button and the 🧪 practice-run
// link, shared with the Sell tab.

import { useEffect, useMemo, useState } from 'preact/hooks';
import { validateBuyInput } from '../engine/buys';
import { summarizePlan } from '../engine/orders';
import { describeTrigger, formatUsd, formatX } from '../engine/triggers';
import type { BuyInput, BuyOrder, Plan, Trigger } from '../engine/types';
import { DEV_TOOLS } from '../shared/config';
import type { CommandResult, PracticeResult } from '../shared/messages';
import { DEFAULT_PRESETS, type Preset } from '../shared/settings';
import { BuyOrders } from './BuyList';
import { cash, parseMoney } from './format';
import { type FieldUnit, levelProblem, levelShort, movePct, niceMc, normalizeNumber, type Now, relToNow } from './levels';
import { AmountBox, TriggerBox } from './OrderForm';
import type { WindowApi, WindowToken } from './TippyWindow';

export interface BuyDraft {
  /** The level (null = none picked yet): a market cap, an exact price, or a move from the price now ({kind:'x', value: 0.8} = −20%). */
  trigger: Trigger | null;
  usd: number;
  /** Preset that guards the new coins (null = none). */
  guard: string | null;
  /** null = never expires. */
  expiresInMs: number | null;
}

const HOUR = 3_600_000;
const USD_CHIPS = [5, 10, 25, 50];
const EXPIRY_CHIPS: [string, number | null][] = [
  ['1h', HOUR],
  ['24h', 24 * HOUR],
  ['7d', 7 * 24 * HOUR],
  ['Never', null],
];
/** Practice results older than this aren't worth showing. */
const PRACTICE_SHOW_MS = 30 * 60_000;
/** Stop waiting for a practice run that never reports back. */
const PRACTICE_GIVE_UP_MS = 120_000;

/** The default level: the −20% dip, as a market cap the way traders say it ($1.6M) — or a move when fomo shows no market cap. */
export function defaultBuyLevel(now: Now): Trigger {
  return now.mc ? { kind: 'mc', value: niceMc(now.mc * 0.8) } : { kind: 'x', value: 0.8 };
}

/** A fresh limit buy: $10 on the −20% dip, guarded by the default preset for 24h. */
export function newBuyDraft(presets: Preset[], defaultPresetId: string, now: Now = { priceUSD: null, mc: null }): BuyDraft {
  const guard = presets.find((p) => p.id === defaultPresetId) ?? presets[0];
  return { trigger: defaultBuyLevel(now), usd: 10, guard: guard?.id ?? null, expiresInMs: 24 * HOUR };
}

/** "$10", "$12.50", "$1.5K". */
export const money = (n: number) => cash(n);

/** "2x 50% · 5x 25% · SL −30%" */
export function presetSummary(p: Preset): string {
  const parts = p.tps.map((t) => `${formatX(t.x)} ${t.pct}%`);
  if (p.slX != null) parts.push(`SL ${describeTrigger({ kind: 'x', value: p.slX })}`);
  if (p.trail) parts.push(`trail ${p.trail.pct}%${p.trail.activateX ? ` after ${formatX(p.trail.activateX)}` : ''}`);
  return parts.join(' · ') || 'no levels';
}

/** The preset's own words while its levels are the stock ones; once you change a level, what it now does. */
export function presetBlurb(p: Preset): string {
  const stock = DEFAULT_PRESETS.find((d) => d.id === p.id);
  const same = stock && JSON.stringify([stock.tps, stock.slX, stock.trail]) === JSON.stringify([p.tps, p.slX, p.trail]);
  return same ? p.blurb : presetSummary(p);
}

export function toBuyInput(d: BuyDraft & { trigger: Trigger }, token: WindowToken, guard: Preset | null): Omit<BuyInput, 'id' | 'now'> {
  return {
    key: token.key,
    networkId: token.networkId,
    address: token.address,
    symbol: token.symbol,
    name: token.name,
    trigger: d.trigger,
    ref: { priceUSD: token.priceUSD ?? 0, mc: token.mc, source: 'armed-at' },
    usd: d.usd,
    guardPresetId: guard?.id ?? null,
    expiresInMs: d.expiresInMs,
  };
}

/** Tippy's one line above the main button: what will happen, a problem (amber), or that it's done (mint). The full text is the tooltip if it doesn't fit. */
export function Say({ text, tone }: { text: string; tone?: 'warn' | 'ok' | 'hint' }) {
  return (
    <div class={`tw-sum${tone ? ` ${tone}` : ''}`} role="status" aria-live="polite" title={text}>
      {text}
    </div>
  );
}

/** Short amber lines under the sentence: what's stopping the button (or worth knowing). */
export function Problems({ lines }: { lines: string[] }) {
  return (
    <>
      {lines.map((l) => (
        <div class="tw-warn-line" role="status" key={l}>
          {l}
        </div>
      ))}
    </>
  );
}

export function LimitBuy({
  token,
  plan,
  buys,
  presets,
  defaultPresetId,
  draft,
  onDraft,
  cash: cashUsd,
  minBuyUsd,
  api,
  practice,
  unit,
  canFlip,
  onUnit,
  focusSignal = 0,
}: {
  token: WindowToken;
  /** This coin's running plan (armed or paused), if any. */
  plan: Plan | null;
  /** This coin's orders. */
  buys: BuyOrder[];
  presets: Preset[];
  /** The fallback guard when a running plan covers the new coins. */
  defaultPresetId: string;
  draft: BuyDraft;
  onDraft: (d: BuyDraft) => void;
  /** fomo cash (USDC), null = unknown. */
  cash: number | null;
  /** fomo's minimum buy on this chain. */
  minBuyUsd: number;
  api: WindowApi;
  practice: PracticeResult | null;
  /** The level box reads a market cap or a price (⇄). */
  unit: FieldUnit;
  canFlip: boolean;
  onUnit: (unit: FieldUnit) => void;
  /** Bumped when the trader just picked this tab: the level box takes the focus. */
  focusSignal?: number;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [placed, setPlaced] = useState<string | null>(null);
  const [custom, setCustom] = useState(() => (USD_CHIPS.includes(draft.usd) ? '' : String(draft.usd)));

  // A running plan on this coin guards the new coins too (the background keeps it
  // instead of arming a preset). The default preset still goes along, in case
  // that plan is gone by the time the buy fills.
  const covering = plan && (plan.state === 'armed' || plan.state === 'paused') ? plan : null;
  const guard = covering ? (presets.find((p) => p.id === defaultPresetId) ?? presets[0] ?? null) : (presets.find((p) => p.id === draft.guard) ?? null);
  const coverPaused = covering?.state === 'paused';
  const coverNoStop = !!covering && (covering.sl == null || covering.sl.status === 'cancelled');
  // Partial stops sell some of the bag on the way down — but not the rest.
  const coverSomeStops = !!covering && (covering.stops ?? []).some((s) => s.status === 'waiting');
  // Holding the coin with no plan: the preset guards the whole bag, priced from the new buy.
  const bagIncluded = !covering && !!guard && token.balance != null && token.balance > 0;
  const trigger = draft.trigger;
  const input = useMemo(() => (trigger ? toBuyInput({ ...draft, trigger }, token, guard) : null), [draft, token, guard]);
  const issues = useMemo(() => {
    if (!input || !trigger) return [];
    const out = validateBuyInput(input, minBuyUsd).map((i) => i.message);
    const p = levelProblem(trigger, 'buy', token);
    if (p) out.push(p);
    return [...new Set(out)];
  }, [input, minBuyUsd]);
  const rel = trigger ? relToNow(trigger, token) : NaN;
  const lvl = trigger ? levelShort(trigger, unit, token) : '';
  const short = cashUsd != null && draft.usd > cashUsd;
  const problems = error ? [error] : issues.slice(0, 1);
  if (short) problems.push(`You have ${formatUsd(cashUsd)} cash on fomo — top up, or Tippy can't buy ${money(draft.usd)} when it hits.`);
  const sentence = !trigger
    ? `Type a ${unit === 'mc' ? 'market cap' : 'price'} or drag: down to buy the dip, up for a breakout.`
    : Number.isFinite(rel) && Math.abs(rel - 1) >= 0.005
      ? `Buy ${money(draft.usd)} of $${token.symbol} if it ${rel < 1 ? 'drops' : 'rises'} ${movePct(rel)}% to ${lvl}`
      : `Buy ${money(draft.usd)} of $${token.symbol} at ${lvl}`;

  const change = (patch: Partial<BuyDraft>) => {
    setError(null);
    setPlaced(null);
    onDraft({ ...draft, ...patch });
  };

  const commitCustom = () => {
    const raw = custom.trim();
    if (!raw) return;
    // "2,50" is $2.50 and "1,000" is $1000 — a comma that's neither is too risky to guess.
    const text = normalizeNumber(raw);
    if (text.includes(',')) {
      setPlaced(null);
      setError("I'm not sure what that comma means — use a dot for cents, like 2.50.");
      return;
    }
    const n = parseMoney(text);
    if (n == null || !(n > 0)) {
      setPlaced(null);
      setError('Type an amount in dollars, like 15.');
      return;
    }
    const usd = +n.toFixed(2);
    setCustom(USD_CHIPS.includes(usd) ? '' : String(usd));
    change({ usd });
  };

  const place = async () => {
    if (busy || !input || issues.length) return;
    setBusy(true);
    const res = await api.armBuy(input);
    setBusy(false);
    if (!res.ok) return setError(res.error);
    setPlaced(`Done! I'm watching $${token.symbol} — ${money(draft.usd)} at ${lvl}${covering ? ', covered by your guard' : guard ? `, then ${guard.name}` : ''}.`);
    // Clear the level so a second press can't place the same buy twice.
    onDraft({ ...draft, trigger: null });
  };

  const run = async (fn: () => Promise<CommandResult>) => {
    setBusy(true);
    const res = await fn();
    setBusy(false);
    if (!res.ok) setError(res.error);
  };

  return (
    <div class="tw-body">
      <AmountBox
        label={
          <>
            Amount
            <span class="tw-info" tabIndex={0} role="img" aria-label="Uses your fomo cash, only the amount you set. Won't chase a pump or catch a falling knife." title="Uses your fomo cash · only the amount you set · won't chase a pump or catch a falling knife">
              ⓘ
            </span>
          </>
        }
        right={
          cashUsd != null && (
            <span class={`tw-box-r tw-cash${short ? ' warn' : ''}`}>
              Cash <b>{formatUsd(cashUsd)}</b>
            </span>
          )
        }
        group="Buy amount"
        chips={USD_CHIPS.map((u) => ({
          label: `$${u}`,
          on: !custom && draft.usd === u,
          onPick: () => {
            setCustom('');
            change({ usd: u });
          },
        }))}
        custom={{ value: custom, on: !!custom, prefix: '$', ariaLabel: 'Other amount in dollars (Enter to use it)', onInput: setCustom, onCommit: commitCustom }}
      />
      <TriggerBox
        side="buy"
        trigger={trigger}
        unit={unit}
        canFlip={canFlip}
        onFlip={() => onUnit(unit === 'mc' ? 'price' : 'mc')}
        now={token}
        tone="buy"
        focusSignal={focusSignal}
        onChange={(t) => change({ trigger: t })}
      />

      {covering ? (
        <>
          <div class="tw-covered" role="status">
            🛡 Your current guard on ${token.symbol} will cover the new coins: <b>{summarizePlan(covering)}</b>
          </div>
          {coverPaused && <div class="tw-warn-line">…but it's paused — resume it, or the new coins won't be protected.</div>}
          {coverNoStop && (
            <div class="tw-warn-line">
              …{coverPaused ? 'and' : 'but'} it has no stop loss{coverSomeStops ? ' for the rest' : ''}.
            </div>
          )}
        </>
      ) : (
        <>
          <div class="tw-optrow tw-guard" role="group" aria-label="Protect the new coins with">
            <span class="tw-optl">Protect with</span>
            <button class="tw-opt" aria-pressed={!guard} title="Don't set a take profit or stop loss" onClick={() => change({ guard: null })}>
              None
            </button>
            {presets.map((p, i) => (
              <button key={p.id} class="tw-opt" aria-pressed={guard?.id === p.id} title={`${p.emoji} ${p.name}: ${presetSummary(p)}`} onClick={() => change({ guard: p.id })}>
                P{i + 1}
              </button>
            ))}
          </div>
          <div class="tw-sub">{guard ? `${guard.emoji} ${guard.name}: ${presetSummary(guard)}` : "Tippy won't set a take profit or stop loss on these coins."}</div>
          {bagIncluded && (
            <div class="tw-guard-note" title={`The guard covers your whole $${token.symbol} bag, with its levels measured from the new buy's price.`}>
              Your current ${token.symbol} bag is included in the guard.
            </div>
          )}
        </>
      )}
      <div class="tw-optrow" role="group" aria-label="Expires after">
        <span class="tw-optl">Expires</span>
        {EXPIRY_CHIPS.map(([label, ms]) => (
          <button key={label} class="tw-opt" aria-pressed={draft.expiresInMs === ms} onClick={() => change({ expiresInMs: ms })}>
            {label}
          </button>
        ))}
      </div>

      <Say text={placed ?? sentence} tone={placed ? 'ok' : trigger ? undefined : 'hint'} />
      {!placed && <Problems lines={problems} />}
      <button class="tw-arm is-buy" disabled={busy || !input || issues.length > 0} onClick={place}>
        {busy ? 'Placing…' : !trigger ? 'Set a buy level first' : `Place limit buy · ${money(draft.usd)} at ${lvl}`}
      </button>
      {DEV_TOOLS && <PracticeRun side="buy" token={token} usd={draft.usd} blocked={draft.usd > 0 ? null : 'Pick an amount first.'} api={api} last={practice} />}
      <BuyOrders orders={buys} now={token} unit={unit} busy={busy} onCancel={(id) => run(() => api.cancelBuy(id))} onResolve={(id, bought) => run(() => api.resolveBuy(id, bought))} />
    </div>
  );
}

/**
 * 🧪 Practice a sell / buy: Tippy walks through fomo's real panel in a
 * background tab and stops right before the final press (always a dry run).
 * The result comes back with the command, or later through storage (`last`).
 */
export function PracticeRun({
  side,
  token,
  usd,
  blocked,
  api,
  last,
}: {
  side: 'sell' | 'buy';
  token: WindowToken;
  /** Buys: the amount to type. */
  usd?: number;
  /** Why it can't run right now (the disabled button's tooltip). */
  blocked: string | null;
  api: WindowApi;
  /** The last practice run Tippy saved. */
  last: PracticeResult | null;
}) {
  /** When the run in flight started. */
  const [running, setRunning] = useState<number | null>(null);
  const [mine, setMine] = useState<PracticeResult | null>(null);
  /** The result the trader closed (✕). */
  const [hidden, setHidden] = useState<number | null>(null);
  const stored = last && last.key === token.key && last.side === side ? last : null;
  const fail = (detail: string): PracticeResult => ({ key: token.key, symbol: token.symbol, side, at: Date.now(), ok: false, stage: 'skipped', detail });

  // A run that answered "started" finishes when its result lands in storage.
  useEffect(() => {
    if (running != null && stored && stored.at >= running) setRunning(null);
  }, [running, stored?.at]);
  useEffect(() => {
    if (running == null) return;
    const t = setTimeout(() => {
      setRunning(null);
      setMine(fail("Tippy didn't hear back from the practice run — check that a fomo tab is open and you're logged in."));
    }, PRACTICE_GIVE_UP_MS);
    return () => clearTimeout(t);
  }, [running]);

  const start = async () => {
    const at = Date.now();
    setRunning(at);
    setMine(null);
    const res = await api.practice(token.key, side, side === 'buy' ? usd : undefined);
    if (!res.ok) {
      setMine(fail(res.error));
      setRunning(null);
    } else if (res.practice) {
      setMine(res.practice);
      setRunning(null);
    }
  };

  const newest = [mine, stored].filter((r): r is PracticeResult => !!r).sort((a, b) => b.at - a.at)[0] ?? null;
  const result = newest && (newest === mine || Date.now() - newest.at < PRACTICE_SHOW_MS) && newest.at !== hidden ? newest : null;
  const line =
    running != null
      ? { text: "Practising… won't press the final button", tone: '' }
      : result
        ? {
            text: `${result.ok ? '✅ Practice worked' : '⚠️ Practice hit a snag'} — ${result.detail}${result.impactPct != null && Number.isFinite(result.impactPct) ? ` (price impact ≈${+result.impactPct.toFixed(1)}%)` : ''}`,
            tone: result.ok ? 'ok' : 'warn',
          }
        : null;

  return (
    <div class="tw-practice">
      <button
        class="tw-text-btn tw-practice-btn"
        disabled={!!blocked || running != null}
        title={blocked ?? `Walk through a real ${side} on fomo in a background tab and stop right before the final button`}
        onClick={start}
      >
        🧪 {running != null ? 'Practising…' : `Practice a ${side}`}
      </button>
      {line && (
        <span class="tw-practice-line">
          <span class={`tw-practice-msg ${line.tone}`} role="status" title={line.text}>
            {line.text}
          </span>
          {result && running == null && (
            <button class="tw-x" aria-label="Hide the practice result" onClick={() => setHidden(result.at)}>
              ×
            </button>
          )}
        </span>
      )}
    </div>
  );
}
