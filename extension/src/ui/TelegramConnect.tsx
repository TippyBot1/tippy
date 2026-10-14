// Phone alerts in two taps: "Connect Telegram" shows a QR code (scan it with the
// phone, tap Start) and a button for Telegram on this computer. Tippy watches
// for the Start and turns itself on, then sends a first message. The same box is
// in Tippy's window (the 🔔 button), in settings and on the welcome page.

import { useEffect, useMemo, useState } from 'preact/hooks';
import { TELEGRAM_BOT } from '../shared/config';
import type { Settings } from '../shared/settings';
import { send } from './bridge';
import { qrMatrix, qrPath } from './qr';

/** How long to wait for the Start tap before saying so. */
const WAIT_MS = 5 * 60_000;

export function QrCode({ text, size = 148 }: { text: string; size?: number }) {
  const { d, size: n } = useMemo(() => qrPath(qrMatrix(text)), [text]);
  return (
    <svg class="t-qr" width={size} height={size} viewBox={`0 0 ${n} ${n}`} shape-rendering="crispEdges" role="img" aria-label="QR code: scan it with your phone to open Tippy's Telegram bot">
      <rect width={n} height={n} fill="#fff" />
      <path d={d} fill="#000" />
    </svg>
  );
}

export function TelegramConnect({ settings, compact = false, onClose }: { settings: Settings; compact?: boolean; onClose?: () => void }) {
  const { linked } = settings.telegram;
  const [url, setUrl] = useState<string | null>(null);
  const [late, setLate] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Bumped by every Connect press, so "Connect again" restarts the wait. */
  const [attempt, setAttempt] = useState(0);

  // While a code is up, ask Tippy every 2s whether Start was tapped.
  useEffect(() => {
    if (!url || linked) return;
    const started = Date.now();
    const t = setInterval(async () => {
      const r = await send({ type: 'TELEGRAM_CHECK' });
      if (r.ok && r.telegram?.linked) clearInterval(t);
      else if (Date.now() - started > WAIT_MS) {
        clearInterval(t);
        setLate(true);
      }
    }, 2_000);
    return () => clearInterval(t);
  }, [url, linked, attempt]);

  const start = async () => {
    setError(null);
    setLate(false);
    const r = await send({ type: 'TELEGRAM_CONNECT' });
    if (r.ok && r.telegram?.url) {
      setUrl(r.telegram.url);
      setAttempt((n) => n + 1);
    }
    else setError(r.ok ? 'Something went wrong — try again.' : r.error);
  };

  if (linked) {
    return (
      <div class={`t-tg t-tg-on${compact ? ' t-tg-compact' : ''}`}>
        <div class="t-tg-copy">
          <b>✓ Telegram connected</b>
          <small>Alerts go to @{TELEGRAM_BOT} on your phone. It never messages first and never sends login links.</small>
        </div>
        <div class="t-tg-acts">
          <button class="t-btn t-btn-ghost" onClick={() => send({ type: 'TEST_ALERT' })}>
            Send a test
          </button>
          {compact ? (
            onClose && (
              <button class="t-btn t-btn-ghost" onClick={onClose}>
                Done
              </button>
            )
          ) : (
            <button class="t-btn t-btn-danger" onClick={() => send({ type: 'TELEGRAM_DISCONNECT' })}>
              Disconnect
            </button>
          )}
        </div>
      </div>
    );
  }

  if (!url) {
    return (
      <div class={`t-tg${compact ? ' t-tg-compact' : ''}`}>
        <div class="t-tg-copy">
          <b>Alerts on your phone</b>
          <small>A Telegram message when Tippy sells or buys, needs you, or stops watching (say your laptop went to sleep). Free, two taps.</small>
          {error && <small class="t-tg-err">{error}</small>}
        </div>
        <div class="t-tg-acts">
          <button class="t-btn t-btn-primary" onClick={start}>
            Connect Telegram
          </button>
          {onClose && (
            <button class="t-btn t-btn-ghost" onClick={onClose}>
              Not now
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div class={`t-tg t-tg-code${compact ? ' t-tg-compact' : ''}`}>
      <QrCode text={url} size={compact ? 124 : 148} />
      <div class="t-tg-copy">
        <b>Scan with your phone</b>
        <ol>
          <li>Point your phone’s camera at the code.</li>
          <li>
            Telegram opens @{TELEGRAM_BOT}. Tap <b>Start</b>.
          </li>
        </ol>
        <small class={late ? 't-tg-err' : 't-tg-wait'}>{late ? 'Still waiting — tap Start in Telegram, then press Connect again.' : 'Waiting for you to tap Start…'}</small>
        <div class="t-tg-acts">
          <button class="t-btn t-btn-ghost" onClick={() => send({ type: 'TELEGRAM_OPEN' })}>
            Telegram on this computer
          </button>
          {late && (
            <button class="t-btn t-btn-ghost" onClick={start}>
              Connect again
            </button>
          )}
          {onClose && (
            <button class="t-btn t-btn-ghost" onClick={onClose}>
              Close
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
