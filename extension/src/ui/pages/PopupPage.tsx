// The toolbar popup: every order on every coin, and pause-all. Also shown on tippybot.fun.
import { browser } from 'wxt/browser';
import { isLiveBuy } from '../../engine/buys';
import { cardApi, send, useTippyState } from '../bridge';
import { healthText, moodFor } from '../format';
import { Mascot } from '../Mascot';
import { PlanList } from '../PlanList';

export function PopupPage() {
  const state = useTippyState();
  if (!state) return null;
  const { plans, settings, status, buys } = state;
  const all = Object.values(plans);
  const live = all.filter((p) => p.state === 'armed' || p.state === 'paused');
  const allBuys = Object.values(buys);
  const liveBuys = allBuys.filter(isLiveBuy);
  // Coins Tippy is watching for you: guarded bags and limit buys.
  const watching = new Set([...live.map((p) => p.key), ...liveBuys.map((o) => o.key)]).size;
  const open = (url: string) => browser.tabs.create({ url });
  return (
    <div class="tippy t-popup">
      <div class="t-head" style={{ padding: '4px 4px 10px' }}>
        <Mascot mood={liveBuys.some((o) => o.attention) ? 'worried' : moodFor(status.health, live)} size={46} />
        <div class="t-grow">
          <h2>Tippy</h2>
          <p>{healthText(status.health, status.message, watching)}</p>
        </div>
        <button
          class="t-switch"
          role="switch"
          aria-checked={!settings.paused}
          aria-label={settings.paused ? 'Wake Tippy up' : 'Pause Tippy'}
          title={settings.paused ? 'Tippy is paused' : 'Tippy is on'}
          onClick={() => send({ type: 'PAUSE_ALL', paused: !settings.paused })}
        />
      </div>

      {status.banner && <div class="t-banner">{status.banner}</div>}
      {settings.dryRun && <div class="t-banner">Dry-run mode is on — Tippy won't actually buy or sell.</div>}
      {watching > 0 &&
        (settings.stayAwake ? (
          <p class="t-hint" style={{ margin: '0 2px 8px' }}>
            ☀ Keeping this computer awake while your orders are on — leave the lid open and Chrome running.
          </p>
        ) : (
          <div class="t-banner">
            💤 This computer can sleep, and orders can't fire while it's off.{' '}
            <button class="t-btn t-btn-ghost" onClick={() => send({ type: 'SET_SETTINGS', patch: { stayAwake: true } })}>
              Keep it awake
            </button>
          </div>
        ))}
      {status.health === 'no-desk' && watching > 0 && (
        <button class="t-btn t-btn-primary" onClick={() => send({ type: 'OPEN_DESK' })}>
          Open a fomo tab for Tippy
        </button>
      )}

      <PlanList plans={all} buys={allBuys} onPause={cardApi.pause} onResume={cardApi.resume} onCancel={cardApi.cancel} onCancelBuy={cardApi.cancelBuy} onResolveBuy={cardApi.resolveBuy} onOpen={open} />

      <p class="t-hint" style={{ margin: '8px 2px 0' }}>💬 Chat with Tippy in its window on any fomo coin page.</p>

      {!settings.onboarded && (
        <button class="t-btn t-btn-ghost" onClick={() => open(browser.runtime.getURL('/welcome.html'))}>
          Finish setting up Tippy (1 min)
        </button>
      )}

      <div class="t-foot">
        <a href="#" onClick={(e) => (e.preventDefault(), browser.runtime.openOptionsPage())}>
          Settings
        </a>
        <a href="https://fomo.family" target="_blank" rel="noreferrer">
          Open fomo ↗
        </a>
      </div>
    </div>
  );
}

