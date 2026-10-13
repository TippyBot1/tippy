import { render, type ComponentChildren } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { browser } from 'wxt/browser';
import '../../ui/tippy.css';
import '../../ui/page.css';
import { linkStatus, newLinkId } from '../../shared/alerts';
import { SITE_URL, TELEGRAM_BOT } from '../../shared/config';
import type { Preset, Settings } from '../../shared/settings';
import { DEFAULT_PRESETS } from '../../shared/settings';
import { send, useTippyState } from '../../ui/bridge';
import { Mascot } from '../../ui/Mascot';

const set = (patch: Partial<Settings>) => send({ type: 'SET_SETTINGS', patch });

function Switch({ on, label, onChange }: { on: boolean; label: string; onChange: (v: boolean) => void }) {
  return <button class="t-switch" role="switch" aria-checked={on} aria-label={label} onClick={() => onChange(!on)} />;
}

function Setting({ title, help, children }: { title: string; help?: string; children: ComponentChildren }) {
  return (
    <div class="t-setting">
      <div>
        <b>{title}</b>
        {help && <small>{help}</small>}
      </div>
      {children}
    </div>
  );
}

async function withPermission(perm: 'notifications', on: boolean): Promise<boolean> {
  if (!on) return true;
  try {
    return await browser.permissions.request({ permissions: [perm] });
  } catch {
    return false;
  }
}

function Options() {
  const state = useTippyState();
  if (!state) return null;
  const s = state.settings;
  const isEdge = navigator.userAgent.includes('Edg/');

  return (
    <div class="tippy t-page">
      <div class="t-wrap">
        <div class="t-hero">
          <Mascot mood="happy" size={72} />
          <div>
            <h1>Tippy settings</h1>
            <p>Everything here stays on this computer.</p>
          </div>
        </div>

        <div class="t-promise">
          <Mascot mood="idle" size={34} />
          Tippy will never ask for your private key, seed phrase or password.
        </div>

        <section class="t-panel" id="awake">
          <h2>Keep your orders working</h2>
          <p>
            Your take-profits and stops stay on until you turn them off — but Tippy can only sell while this computer is on and Chrome is open. If it's off when
            a price is hit, a stop sells when Tippy is back (at that moment's price) and a take-profit only sells if the price is still there.
          </p>
          <Setting title="Keep this computer awake while orders are on" help="On by default. The screen can still turn off — but closing a laptop lid sleeps it, so leave the lid open and the charger in.">
            <Switch on={s.stayAwake} label="Keep this computer awake" onChange={(v) => set({ stayAwake: v })} />
          </Setting>
          <Setting title="Keep a fomo tab open for me" help="Tippy pins a small fomo tab so it can always see prices.">
            <Switch on={s.deskConsent} label="Keep a fomo tab open" onChange={(v) => set({ deskConsent: v })} />
          </Setting>
          <Setting
            title={isEdge ? 'Never put fomo to sleep' : 'Always keep fomo active'}
            help={isEdge ? 'In Edge settings → System and performance → "Never put these sites to sleep", add fomo.family.' : 'In Chrome settings → Performance → "Always keep these sites active", add fomo.family.'}
          >
            <button class="t-btn t-btn-ghost" onClick={() => browser.tabs.create({ url: isEdge ? 'edge://settings/system/managePerformance' : 'chrome://settings/performance' })}>
              Open settings
            </button>
          </Setting>
          <Setting title="Open Chrome when your computer starts" help="So Tippy is back after a restart. Mac: System Settings → General → Login Items → add Google Chrome. Windows: Chrome starts with Windows if you pin it to Startup apps.">
            <span />
          </Setting>
          <Setting title="Warn my phone if Tippy stops watching" help="With Telegram connected (below), Tippy messages you if your orders go unwatched for 10 minutes.">
            <a class="t-btn t-btn-ghost" href="#alerts">
              Set up
            </a>
          </Setting>
        </section>

        <section class="t-panel">
          <h2>Presets</h2>
          <p>Your one-tap plans — the P1 / P2 / P3 quick picks in Tippy's window (and the guard for limit buys). The starred one is used by Auto-guard.</p>
          {s.presets.map((p, i) => (
            <PresetEditor
              key={p.id}
              slot={i + 1}
              preset={p}
              isDefault={s.defaultPresetId === p.id}
              onDefault={() => set({ defaultPresetId: p.id })}
              onChange={(next) => set({ presets: s.presets.map((x, j) => (j === i ? next : x)) })}
            />
          ))}
          <button class="t-link" style={{ justifySelf: 'start' }} onClick={() => set({ presets: DEFAULT_PRESETS })}>
            Reset presets
          </button>
        </section>

        <section class="t-panel">
          <h2>Auto-guard (beta)</h2>
          <Setting title="Guard every new buy" help="When you buy a coin on fomo (phone or computer), Tippy attaches your starred preset and tells you. You can undo it anytime.">
            <Switch on={s.autoGuard.enabled} label="Auto-guard" onChange={(v) => set({ autoGuard: { ...s.autoGuard, enabled: v } })} />
          </Setting>
          <Setting title="Also guard coins I already hold" help="Off by default, so Tippy only touches new buys.">
            <Switch on={s.autoGuard.includeExisting} label="Include existing bags" onChange={(v) => set({ autoGuard: { ...s.autoGuard, includeExisting: v } })} />
          </Setting>
        </section>

        <section class="t-panel" id="alerts">
          <h2>Alerts</h2>
          <p>Tippy always pops up inside fomo’s page when an order fills or expires. Turn these on to hear about it anywhere.</p>
          <Setting
            title="Desktop notifications"
            help="A pop-up on this computer when Tippy buys or sells for you, or an order expires — click it to open the coin. Nothing showing on a Mac? Allow Google Chrome in System Settings → Notifications."
          >
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              {s.notifications && (
                <button class="t-btn t-btn-ghost" onClick={() => send({ type: 'TEST_ALERT' })}>
                  Send a test
                </button>
              )}
              <Switch
                on={s.notifications}
                label="Desktop notifications"
                onChange={async (v) => {
                  if (!(await withPermission('notifications', v))) return;
                  await set({ notifications: v });
                  if (v) await send({ type: 'TEST_ALERT' });
                }}
              />
            </div>
          </Setting>
          <TelegramLink settings={s} />
        </section>

        <section class="t-panel">
          <h2>When Tippy trades</h2>
          <Setting title="If a stop hit while my computer was asleep" help="Prices can move a lot during a nap.">
            <div class="t-seg">
              <button aria-pressed={s.gapPolicy === 'sell'} onClick={() => set({ gapPolicy: 'sell' })}>
                Sell anyway
              </button>
              <button aria-pressed={s.gapPolicy === 'ask'} onClick={() => set({ gapPolicy: 'ask' })}>
                Ask me first
              </button>
            </div>
          </Setting>
          <Setting title="Bring the fomo tab to the front for stop losses" help="Only if fomo gets stuck in the background. Stops are too important to miss.">
            <Switch on={s.focus.stopLoss} label="Focus for stop losses" onChange={(v) => set({ focus: { ...s.focus, stopLoss: v } })} />
          </Setting>
          <Setting title="…and for take-profits">
            <Switch on={s.focus.takeProfit} label="Focus for take-profits" onChange={(v) => set({ focus: { ...s.focus, takeProfit: v } })} />
          </Setting>
          <Setting title="Max price impact for take-profits" help="Skip a take-profit if selling would move the price more than this.">
            <NumberPill value={s.maxImpactTp} suffix="%" onChange={(v) => set({ maxImpactTp: v })} />
          </Setting>
          <Setting title="Max price impact for stop losses" help="Stops sell anyway up to this — getting out matters more.">
            <NumberPill value={s.maxImpactStop} suffix="%" onChange={(v) => set({ maxImpactStop: v })} />
          </Setting>
          <Setting title="Max price impact for limit buys" help="Skip a limit buy if buying would move the price more than this.">
            <NumberPill value={s.maxImpactBuy} suffix="%" onChange={(v) => set({ maxImpactBuy: v })} />
          </Setting>
          <Setting title="OK fomo's risk warnings for me" help="fomo sometimes asks you to tick 'I understand' on risky coins.">
            <Switch on={s.acceptRiskWarnings} label="Accept risk warnings" onChange={(v) => set({ acceptRiskWarnings: v })} />
          </Setting>
          <Setting title="Dry run (practice mode)" help="Tippy does everything except press the final Sell or Buy button — for take-profits, stop losses and limit buys.">
            <Switch on={s.dryRun} label="Dry run" onChange={(v) => set({ dryRun: v })} />
          </Setting>
          <Setting title="Show my levels on fomo's chart" help="Dashed lines: limit buys green, take-profits blue, stops red, trailing stop amber. Drag one to move it — Tippy asks before changing anything.">
            <Switch on={s.chartLines !== false} label="Chart lines" onChange={(v) => set({ chartLines: v })} />
          </Setting>
          <Setting title="Trailing stop" help="Show the trailing-stop option in Tippy's window.">
            <Switch on={!!s.showTrailing} label="Trailing stop" onChange={(v) => set({ showTrailing: v })} />
          </Setting>
        </section>

        <section class="t-panel">
          <h2>About</h2>
          <p>
            Tippy is free and open source, and not affiliated with fomo. It works inside your own fomo tab and presses fomo's own buttons — it has no access to your
            keys and no server ever touches your money. Version {browser.runtime.getManifest().version}.
          </p>
          <div class="t-foot" style={{ justifyContent: 'flex-start', gap: 16 }}>
            <a href={`${SITE_URL}/privacy`} target="_blank" rel="noreferrer">
              Privacy
            </a>
            <a href={SITE_URL} target="_blank" rel="noreferrer">
              tippybot.fun
            </a>
          </div>
        </section>
      </div>
    </div>
  );
}

function NumberPill({ value, suffix, onChange }: { value: number; suffix: string; onChange: (v: number) => void }) {
  const [v, setV] = useState(String(value));
  useEffect(() => setV(String(value)), [value]);
  return (
    <label class="t-pill">
      <input
        inputMode="numeric"
        value={v}
        onInput={(e) => setV(e.currentTarget.value)}
        onBlur={() => {
          const n = Number(v);
          if (Number.isFinite(n) && n > 0 && n < 100) onChange(n);
          else setV(String(value));
        }}
      />
      <span>{suffix}</span>
    </label>
  );
}

function PresetEditor({ slot, preset, isDefault, onDefault, onChange }: { slot: number; preset: Preset; isDefault: boolean; onDefault: () => void; onChange: (p: Preset) => void }) {
  const tp = (i: number, patch: Partial<Preset['tps'][number]>) => onChange({ ...preset, tps: preset.tps.map((t, j) => (j === i ? { ...t, ...patch } : t)) });
  const numIn = (val: number, cb: (n: number) => void, label: string) => (
    <input
      inputMode="decimal"
      value={String(val)}
      aria-label={label}
      onChange={(e) => {
        const n = Number(e.currentTarget.value);
        if (Number.isFinite(n) && n > 0) cb(n);
      }}
    />
  );
  return (
    <div class="t-preset-edit">
      <div class="t-setting">
        <div>
          <b>
            P{slot} · {preset.emoji} {preset.name}
          </b>
          <small>{preset.blurb}</small>
        </div>
        <button class={`t-btn ${isDefault ? 't-btn-primary' : 't-btn-ghost'}`} style={{ width: 'auto', padding: '8px 12px' }} onClick={onDefault}>
          {isDefault ? '★ Auto-guard' : '☆ Use for auto-guard'}
        </button>
      </div>
      {preset.tps.map((t, i) => (
        <div class="t-row" key={i}>
          At
          <label class="t-pill">
            {numIn(t.x, (x) => tp(i, { x }), 'multiple')}
            <span>x</span>
          </label>
          sell
          <label class="t-pill">
            {numIn(t.pct, (pct) => tp(i, { pct: Math.min(100, pct) }), 'percent')}
            <span>%</span>
          </label>
        </div>
      ))}
      <div class="t-row">
        Stop loss at −
        <label class="t-pill">
          {numIn(Math.round((1 - (preset.slX ?? 0.7)) * 100), (d) => onChange({ ...preset, slX: d < 100 ? 1 - d / 100 : preset.slX }), 'stop loss percent')}
          <span>%</span>
        </label>
        <Switch on={preset.slX != null} label="Stop loss on" onChange={(v) => onChange({ ...preset, slX: v ? 0.7 : null })} />
      </div>
    </div>
  );
}

function TelegramLink({ settings }: { settings: Settings }) {
  const [waiting, setWaiting] = useState(false);
  const { linkId, linked } = settings.telegram;

  useEffect(() => {
    if (!waiting || !linkId) return;
    let tries = 0;
    const t = setInterval(async () => {
      tries++;
      if (await linkStatus(linkId)) {
        clearInterval(t);
        setWaiting(false);
        await set({ telegram: { linkId, linked: true } });
        await send({ type: 'TEST_ALERT' });
      } else if (tries > 90) {
        clearInterval(t);
        setWaiting(false);
      }
    }, 2_000);
    return () => clearInterval(t);
  }, [waiting, linkId]);

  const connect = async () => {
    const id = newLinkId();
    await set({ telegram: { linkId: id, linked: false } });
    window.open(`https://t.me/${TELEGRAM_BOT}?start=${id}`, '_blank', 'noopener');
    setWaiting(true);
  };

  if (linked) {
    return (
      <Setting title="Telegram ✓ connected" help={`Tippy messages you from @${TELEGRAM_BOT}. It never messages first and never sends login links.`}>
        <div style={{ display: 'flex', gap: 8 }}>
          <button class="t-btn t-btn-ghost" onClick={() => send({ type: 'TEST_ALERT' })}>
            Send a test
          </button>
          <button class="t-btn t-btn-danger" onClick={() => set({ telegram: { linkId: null, linked: false } })}>
            Disconnect
          </button>
        </div>
      </Setting>
    );
  }
  return (
    <Setting title="Telegram" help={waiting ? 'Tap Start in Telegram — Tippy is waiting for you…' : 'Get a ping when Tippy sells, needs you, or stops watching (e.g. your laptop went to sleep).'}>
      <button class="t-btn t-btn-primary" style={{ width: 'auto' }} onClick={connect} disabled={waiting}>
        {waiting ? 'Waiting…' : 'Connect Telegram'}
      </button>
    </Setting>
  );
}

render(<Options />, document.getElementById('app')!);
