// First-run onboarding: keep the orders working (awake), log in, desk tab — then "you're all set".
import { useEffect, useState } from 'preact/hooks';
import { browser } from 'wxt/browser';
import type { RelayResponse } from '../../shared/messages';
import { send, useTippyState } from '../bridge';
import { Guide } from '../Guide';
import { Mascot } from '../Mascot';
import { TelegramConnect } from '../TelegramConnect';

const isEdge = navigator.userAgent.includes('Edg/');

/** Is there a fomo tab with a logged-in session? */
async function fomoReady(): Promise<boolean> {
  const tabs = await browser.tabs.query({ url: 'https://fomo.family/*' });
  for (const t of tabs) {
    if (t.id == null) continue;
    try {
      const res = (await browser.tabs.sendMessage(t.id, { type: 'PING' })) as RelayResponse;
      if (res?.ok && res.session.ok) return true;
    } catch {
      /* not loaded yet */
    }
  }
  return false;
}

export function WelcomePage() {
  const state = useTippyState();
  const [loggedIn, setLoggedIn] = useState(false);
  const [guide, setGuide] = useState(false);

  useEffect(() => {
    const check = () => fomoReady().then(setLoggedIn);
    check();
    const t = setInterval(check, 2_000);
    return () => clearInterval(t);
  }, []);

  const awakeDone = !!state?.settings.keepActiveDone;
  const allDone = loggedIn && !!state?.settings.deskConsent && awakeDone;
  useEffect(() => {
    if (allDone && state && !state.settings.onboarded) send({ type: 'SET_SETTINGS', patch: { onboarded: true } });
  }, [allDone]);

  if (!state) return null;
  const s = state.settings;

  return (
    <div class="tippy t-page">
      {guide && (
        <Guide
          id="keep-active"
          onDone={() => {
            void send({ type: 'SET_SETTINGS', patch: { keepActiveDone: true } });
            setGuide(false);
          }}
          onClose={() => setGuide(false)}
        />
      )}
      <div class="t-wrap" style={{ maxWidth: 600 }}>
        <div class="t-hero">
          <Mascot mood={allDone ? 'happy' : 'watching'} size={96} />
          <div>
            <h1>{allDone ? "You're all set!" : "Hi, I'm Tippy!"}</h1>
            <p>{allDone ? 'Open any coin on fomo and tap me in the bottom-right corner.' : "I'll take profit and stop your losses on fomo while you live your life. Three quick steps:"}</p>
          </div>
        </div>

        <div class="t-panel">
          <div class={`t-step${awakeDone ? ' t-done' : ''}`}>
            <div class="t-step-n">{awakeDone ? '✓' : '1'}</div>
            <div>
              <h3>Keep your orders working</h3>
              <p>
                Your take-profits and stops stay on until you turn them off — but I can only sell while this computer is on and {isEdge ? 'Edge' : 'Chrome'} is open.
              </p>
              <ul class="t-checks">
                <li>
                  <b>{s.stayAwake ? '✓ I keep this computer awake' : '✗ Keeping this computer awake is off'}</b> while your orders are on (the screen can still turn off).{' '}
                  {!s.stayAwake && (
                    <button class="t-btn t-btn-ghost" onClick={() => send({ type: 'SET_SETTINGS', patch: { stayAwake: true } })}>
                      Turn it on
                    </button>
                  )}
                </li>
                <li>Leave the laptop lid open and the charger in — closing the lid sleeps it.</li>
                <li>
                  {awakeDone ? (
                    <b>✓ fomo.family is on {isEdge ? 'Edge' : 'Chrome'}’s never-sleep list.</b>
                  ) : (
                    <>Add fomo.family to {isEdge ? 'Edge' : 'Chrome'}’s never-sleep list, so the fomo tab is always awake. Three clicks — I’ll show you.</>
                  )}
                </li>
              </ul>
              {!awakeDone && (
                <button class="t-btn t-btn-primary" onClick={() => setGuide(true)}>
                  Show me how
                </button>
              )}
            </div>
          </div>

          <div class={`t-step${loggedIn ? ' t-done' : ''}`}>
            <div class="t-step-n">{loggedIn ? '✓' : '2'}</div>
            <div>
              <h3>Open fomo and log in</h3>
              <p>I work inside your own fomo tab, using fomo's own buttons. I never see your keys.</p>
              {!loggedIn && (
                <button class="t-btn t-btn-primary" onClick={() => browser.tabs.create({ url: 'https://fomo.family/' })}>
                  Open fomo.family
                </button>
              )}
            </div>
          </div>

          <div class={`t-step${s.deskConsent ? ' t-done' : ''}`}>
            <div class="t-step-n">{s.deskConsent ? '✓' : '3'}</div>
            <div>
              <h3>Let me keep a little fomo tab open</h3>
              <p>It's my desk — I read prices through it. I'll pin it so it stays out of your way.</p>
              {!s.deskConsent && (
                <button class="t-btn t-btn-primary" onClick={() => send({ type: 'SET_SETTINGS', patch: { deskConsent: true } })}>
                  Sure, keep it pinned
                </button>
              )}
            </div>
          </div>

        </div>

        <div class="t-panel">
          <TelegramConnect settings={s} />
        </div>

        <div class="t-promise">
          <Mascot mood="idle" size={34} />
          I will never ask for your private key, seed phrase or password. If anything claiming to be me does, it's a scam.
        </div>

        <p class="t-help" style={{ textAlign: 'center' }}>
          Good to know: I only work while this computer is awake and your browser is open. Sells are market orders, so fast dumps can fill below your stop.
        </p>
      </div>
    </div>
  );
}

