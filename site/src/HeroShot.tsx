// The home page's product shot: Tippy's real window on a pretend $TIPPY bag with
// three orders on, drawn over its own order lines on one log scale, a take profit
// typed in and ready to add. It's a picture, not a demo: it doesn't move or take
// clicks, and clicking it opens the demo page (the one place to try Tippy).

import { useEffect, useRef, useState } from 'preact/hooks';
import { buildPlan } from '@ext/engine/orders';
import { formatUsd, triggerPrice } from '@ext/engine/triggers';
import { DEFAULT_PRESETS } from '@ext/shared/settings';
import { Chat } from '@ext/ui/Chat';
import { TippyWindow } from '@ext/ui/TippyWindow';
import { seedPath, SUPPLY, typeInto, useMarket, wait } from './market';

const START = 0.000412; // $412K
const ENTRY = 0.0003; // $300K

type Step = 'tp' | 'stop' | 'buy';
const STEPS: Record<Step, { name: string; tab: 'sell' | 'buy'; level: string; chip: string; mc: number; tag: string; rule: string; note: string }> = {
  tp: { name: 'Take profit', tab: 'sell', level: '1m', chip: '25%', mc: 1_000_000, tag: 'New', rule: 'above now = ', note: 'take profit' },
  stop: { name: 'Stop loss', tab: 'sell', level: '350k', chip: '10%', mc: 350_000, tag: 'New', rule: 'below now = ', note: 'stop loss' },
  buy: { name: 'Limit buy', tab: 'buy', level: '340k', chip: '$10', mc: 340_000, tag: 'Buy', rule: '$10 ', note: 'limit buy' },
};

/** One log scale for the whole stage: $2M at the top, $170K at the bottom. */
const TOP = 2_000_000;
const BOT = 170_000;
const yPct = (mc: number) => 5 + ((Math.log(TOP) - Math.log(mc)) / Math.log(TOP / BOT)) * 88;

export function HeroShot() {
  const m = useMarket({
    symbol: 'TIPPY',
    name: 'Tippy (example)',
    startPrice: START,
    startBag: 250_000,
    startCash: 25,
    seedHistory: () => seedPath(START, ENTRY * 0.97, 70, 5),
    seedPlan: (base) => {
      const p = buildPlan({
        ...base,
        id: 'hero-1',
        entry: { priceUSD: ENTRY, mc: ENTRY * SUPPLY, source: 'armed-at' },
        tps: [
          { trigger: { kind: 'x', value: 2 }, sellPct: 50 },
          { trigger: { kind: 'x', value: 5 }, sellPct: 25 },
        ],
        sl: { trigger: { kind: 'x', value: 0.7 } },
        trailing: null,
        origin: 'manual',
      });
      p.lastPrice = START;
      return p;
    },
  });
  const box = useRef<HTMLDivElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const [step, setStep] = useState<Step | null>('tp');
  /** The window stays invisible until it shows the typed take profit, so it never flashes its empty state. */
  const [ready, setReady] = useState(false);
  const busy = useRef(false);

  /** Put the window in a state the way a person would: pick the tab, type a market cap, pick an amount. */
  const show = async (s: Step, from?: HTMLElement, byMouse = false) => {
    const root = box.current;
    if (!root || busy.current) return;
    busy.current = true;
    setStep(s);
    const want = STEPS[s];
    const tab = root.querySelector<HTMLButtonElement>(`.tw-mode-${want.tab}`);
    if (tab && tab.getAttribute('aria-selected') !== 'true') {
      tab.click();
      await wait(80);
    }
    const input = [...root.querySelectorAll('input')].find((i) => (i.getAttribute('aria-label') || '').startsWith(`Market cap to ${want.tab} at`));
    if (input) typeInto(input, want.level);
    await wait(60);
    [...root.querySelectorAll<HTMLButtonElement>('.tw-chips button')].find((b) => (b.textContent || '').trim() === want.chip)?.click();
    // The window focuses its level box on a tab change; give the focus back.
    if (root.contains(document.activeElement)) (document.activeElement as HTMLElement).blur();
    // (a mouse click shouldn't leave a focus ring behind; a keyboard press should)
    from?.focus({ preventScroll: true, focusVisible: !byMouse } as FocusOptions);
    busy.current = false;
  };

  useEffect(() => {
    let live = true;
    // Type the take profit in, then freeze the window: from here on it's a picture.
    show('tp').finally(() => {
      if (!live) return;
      setReady(true);
      if (box.current) box.current.inert = true;
    });
    // never leave the window hidden, whatever happens
    const t = setTimeout(() => live && setReady(true), 900);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, []);

  const plan = m.plan && (m.plan.state === 'armed' || m.plan.state === 'paused') ? m.plan : null;
  const lines: { mc: number; tone: string; tag: string; note?: string }[] = [];
  if (plan) {
    const mc = (p: number) => p * SUPPLY;
    lines.push({ mc: mc(plan.entry.priceUSD), tone: 'entry', tag: 'Entry' });
    plan.tps.forEach((t, i) => lines.push({ mc: mc(triggerPrice(t.trigger, plan.entry)), tone: 'tp', tag: `TP${i + 1}`, note: `sell ${t.sellPct}%` }));
    (plan.stops ?? []).forEach((s) => lines.push({ mc: mc(triggerPrice(s.trigger, plan.entry)), tone: 'sl', tag: 'Stop', note: `sell ${s.sellPct}%` }));
    if (plan.sl) lines.push({ mc: mc(triggerPrice(plan.sl.trigger, plan.entry)), tone: 'sl', tag: 'SL', note: 'sell the rest' });
  }
  for (const o of m.buys.filter((b) => b.state === 'armed')) lines.push({ mc: triggerPrice(o.trigger, o.ref) * SUPPLY, tone: 'buy', tag: 'Buy', note: formatUsd(o.usd) });
  const nowMc = m.price * SUPPLY;
  const pv = step ? STEPS[step] : null;
  const visible = (mc: number) => Number.isFinite(mc) && mc < TOP * 1.02 && mc > BOT;

  const pts = m.history.map((p, i) => `${((i / (m.history.length - 1)) * 100).toFixed(2)},${yPct(p * SUPPLY).toFixed(2)}`);
  const path = `M${pts.join(' L')}`;

  return (
    <div class="hero-stage" ref={stage}>
      <div class="stage-grid" aria-hidden="true" />
      <div class="stage-plot" aria-hidden="true">
        <svg viewBox="0 0 100 100" preserveAspectRatio="none">
          <defs>
            <linearGradient id="stage-fill" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0.5" stop-color="#5ee6b5" stop-opacity="0.10" />
              <stop offset="1" stop-color="#5ee6b5" stop-opacity="0" />
            </linearGradient>
          </defs>
          <path class="sp-area" d={`${path} L100,100 L0,100 Z`} />
          <path class="sp-line" d={path} />
        </svg>
        <span class="sp-dot" style={{ top: `${yPct(nowMc)}%` }} />
      </div>
      {lines.filter((l) => visible(l.mc)).map((l, i) => (
        <div key={`${l.tag}${i}`} class={`lvl lvl-${l.tone}`} style={{ top: `${yPct(l.mc)}%` }} aria-hidden="true">
          <span class="lvl-tag">
            {l.tag} <b>{formatUsd(l.mc)}</b>
          </span>
          {l.note && <span class="lvl-note">{l.note}</span>}
        </div>
      ))}
      <div class="lvl lvl-now" style={{ top: `${yPct(nowMc)}%` }} aria-hidden="true">
        <span class="lvl-tag">
          Now <b>{formatUsd(nowMc)}</b>
        </span>
      </div>
      {pv && (
        <div class={`lvl lvl-new lvl-new-${step}`} style={{ top: `${yPct(pv.mc)}%` }} aria-hidden="true">
          <span class="lvl-tag">
            {pv.tag} <b>{formatUsd(pv.mc)}</b>
          </span>
          <span class="lvl-note">
            <span class="lvl-rule">{pv.rule}</span>
            {pv.note}
          </span>
        </div>
      )}

      <div class="stage-ui">
        <div class={`stage-window tippy${ready ? '' : ' is-pending'}`} ref={box}>
          <TippyWindow
            key={m.plan?.id ?? 'new'}
            token={m.token}
            plan={plan}
            buys={m.buys}
            cash={m.cash}
            minBuyUsd={2}
            minSellUsd={2}
            practice={m.practice}
            presets={DEFAULT_PRESETS}
            defaultPresetId="classic"
            api={m.api}
            intro={false}
            toggles={{ autoGuard: false, dryRun: false, alerts: true, stayAwake: true }}
            chat={<Chat ctx={m.chatCtx} placeholder="Ask Tippy… e.g. sell 50% at 2x" />}
          />
        </div>
        <a class="stage-caption" href="/demo">
          Tippy’s real window, on an example coin. <b>Try it in the demo →</b>
        </a>
      </div>
    </div>
  );
}
