// Step-by-step help, front and centre, for the setup Tippy can't do for you:
// Chrome won't let an extension tick its own "always keep active" list, and
// nothing in a browser can open your Mac's System Settings. When Tippy can open
// the right page, the guide has that button; the steps say exactly what to
// click there, with a sketch of what it looks like. "Done" remembers it.

import type { ComponentChildren } from 'preact';
import { useEffect, useRef } from 'preact/hooks';
import { browser } from 'wxt/browser';
import { send } from './bridge';
import { Mascot } from './Mascot';

export type GuideId = 'keep-active' | 'login' | 'notifications';

const isEdge = () => navigator.userAgent.includes('Edg/');
const isMac = () => /Mac/.test(navigator.userAgent);
const browserName = () => (isEdge() ? 'Edge' : 'Chrome');

interface Spec {
  title: string;
  why: string;
  steps: ComponentChildren[];
  /** A sketch of the screen the steps happen on. */
  sketch?: ComponentChildren;
  /** The button that opens the right page, when Tippy can. */
  open?: { label: string; run: () => void };
}

function spec(id: GuideId): Spec {
  if (id === 'keep-active') {
    const edge = isEdge();
    return {
      title: edge ? 'Never put fomo to sleep' : 'Keep fomo active in Chrome',
      why: `${browserName()} puts background tabs to sleep to save memory. A sleeping fomo tab means Tippy can't see prices, so add fomo.family to the list it never puts to sleep.`,
      steps: [
        <>
          Press <b>Open {browserName()} settings</b> below. It opens the right page in a new tab.
        </>,
        <>
          Find <b>{edge ? 'Never put these sites to sleep' : 'Always keep these sites active'}</b> and press <b>Add</b>.
        </>,
        <>
          Type <b>fomo.family</b>, press <b>Add</b>, then come back to this tab and press <b>Done</b>.
        </>,
      ],
      sketch: (
        <div class="t-gsk" aria-hidden="true">
          <div class="t-gsk-row">
            <span>{edge ? 'Never put these sites to sleep' : 'Always keep these sites active'}</span>
            <i class="t-gsk-btn">Add</i>
          </div>
          <div class="t-gsk-pop">
            <small>Add site</small>
            <span class="t-gsk-in">fomo.family</span>
            <i class="t-gsk-btn t-gsk-go">Add</i>
          </div>
        </div>
      ),
      open: {
        label: `Open ${browserName()} settings`,
        run: () => void browser.tabs.create({ url: edge ? 'edge://settings/system/managePerformance' : 'chrome://settings/performance' }),
      },
    };
  }
  if (id === 'login') {
    return isMac()
      ? {
          title: 'Open Chrome when your Mac starts',
          why: 'Tippy runs in Chrome, so after a restart it only comes back once Chrome is open. Your Mac can open Chrome for you.',
          steps: [
            <>
              Click the <b>Apple menu</b> (top left of your screen) and choose <b>System Settings</b>.
            </>,
            <>
              Go to <b>General</b>, then <b>Login Items &amp; Extensions</b>.
            </>,
            <>
              Under <b>Open at Login</b>, press <b>+</b>, pick <b>Google Chrome</b> and press <b>Open</b>.
            </>,
          ],
          sketch: (
            <div class="t-gsk" aria-hidden="true">
              <div class="t-gsk-row">
                <span>Open at Login</span>
              </div>
              <div class="t-gsk-row t-gsk-item">
                <span>Google Chrome</span>
              </div>
              <div class="t-gsk-row">
                <i class="t-gsk-btn">+</i>
                <i class="t-gsk-btn t-gsk-dim">−</i>
              </div>
            </div>
          ),
        }
      : {
          title: 'Open Chrome when Windows starts',
          why: 'Tippy runs in Chrome, so after a restart it only comes back once Chrome is open. Windows can open Chrome for you.',
          steps: [
            <>
              Press the <b>Windows key</b>, type <b>Startup apps</b> and open it.
            </>,
            <>
              Find <b>Google Chrome</b> and switch it <b>On</b>.
            </>,
          ],
        };
  }
  return isMac()
    ? {
        title: 'Let Chrome show notifications',
        why: 'Your Mac decides whether Chrome may show pop-ups. If Tippy’s test didn’t appear, Chrome needs allowing.',
        steps: [
          <>
            Click the <b>Apple menu</b> and choose <b>System Settings</b>, then <b>Notifications</b>.
          </>,
          <>
            Scroll to <b>Google Chrome</b> and turn on <b>Allow notifications</b>.
          </>,
          <>
            Pick <b>Banners</b> or <b>Alerts</b>, come back here and press <b>Send a test</b>.
          </>,
        ],
        open: { label: 'Send a test', run: () => void send({ type: 'TEST_ALERT' }) },
      }
    : {
        title: 'Let Chrome show notifications',
        why: 'Windows decides whether Chrome may show pop-ups. If Tippy’s test didn’t appear, Chrome needs allowing.',
        steps: [
          <>
            Open <b>Settings</b>, then <b>System</b> and <b>Notifications</b>.
          </>,
          <>
            Find <b>Google Chrome</b> and switch it <b>On</b>.
          </>,
          <>
            Come back here and press <b>Send a test</b>.
          </>,
        ],
        open: { label: 'Send a test', run: () => void send({ type: 'TEST_ALERT' }) },
      };
}

export function Guide({ id, onDone, onClose }: { id: GuideId; onDone: () => void; onClose: () => void }) {
  const g = spec(id);
  const first = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    first.current?.focus();
    const key = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, []);
  return (
    <div class="t-guide-back" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div class="t-guide" role="dialog" aria-modal="true" aria-labelledby="t-guide-h">
        <div class="t-guide-head">
          <Mascot mood="happy" size={44} />
          <h2 id="t-guide-h">{g.title}</h2>
          <button class="t-guide-x" aria-label="Close" onClick={onClose}>
            ×
          </button>
        </div>
        <p class="t-guide-why">{g.why}</p>
        <ol class="t-guide-steps">
          {g.steps.map((s, i) => (
            <li key={i}>
              <span class="t-guide-n">{i + 1}</span>
              <span>{s}</span>
            </li>
          ))}
        </ol>
        {g.sketch}
        <div class="t-guide-acts">
          {g.open && (
            <button ref={first} class="t-btn t-btn-primary" onClick={g.open.run}>
              {g.open.label}
            </button>
          )}
          <button ref={g.open ? undefined : first} class={`t-btn ${g.open ? 't-btn-ghost' : 't-btn-primary'}`} onClick={onDone}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
