// Dev harness: mounts Tippy's real in-page UI on a pretend coin page, with
// mocked browser + fomo APIs. `npm run harness` → open the printed URL.
import { render } from 'preact';
import '../src/ui/tippy.css';
import '../src/ui/window.css';
import './boot';
import { App, setSelling } from '../src/entrypoints/fomo.content/App';
import { browser } from './mock-browser';
import { HARNESS_KEY } from './mock-fomo';

const [address] = HARNESS_KEY.split(':');
const params = new URLSearchParams(location.search);
if (params.get('page') !== 'home' && !location.pathname.includes('/tokens/')) {
  history.replaceState(null, '', `${location.pathname.replace(/\/$/, '')}/tokens/solana/${address}${location.search}`);
}

const ctx = {
  addEventListener: (t: EventTarget, type: string, cb: EventListener) => t.addEventListener(type, cb),
  setInterval: (cb: () => void, ms: number) => setInterval(cb, ms),
};

// ?shadow mounts Tippy inside a shadow root, like the real content script does on fomo.
const slot = document.getElementById('tippy')!;
let root: HTMLElement = slot;
if (params.has('shadow')) {
  const shadow = slot.attachShadow({ mode: 'open' });
  for (const s of document.querySelectorAll('style, link[rel="stylesheet"]')) shadow.appendChild(s.cloneNode(true));
  root = document.createElement('div');
  shadow.appendChild(root);
}
render(<App ctx={ctx as never} />, root);

// expose for manual poking: __tippy.selling({symbol:'BONKLE', pct: 50, dryRun: false}),
// __tippy.storage.set({ notices: [...] }) (the store screenshots use this)
(window as unknown as Record<string, unknown>).__tippy = { selling: setSelling, storage: browser.storage.local };
