import preact from '@preact/preset-vite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig, type Plugin } from 'vite';

const here = import.meta.dirname;
const { version } = JSON.parse(readFileSync(resolve(here, '../extension/package.json'), 'utf8')) as { version: string };
/** One HTML file per page; Cloudflare serves /features from features.html. */
const PAGES = ['index', 'how', 'features', 'demo', 'safety', 'faq', 'privacy'];

/**
 * The demo runs the extension's real pages (settings, toolbar popup, welcome) on
 * pretend data: `wxt/browser` becomes an in-page stand-in, and Telegram linking
 * is simulated instead of calling the real alerts server.
 */
function pretendBrowser(): Plugin {
  return {
    name: 'tippy-pretend-browser',
    enforce: 'pre',
    resolveId(source, importer) {
      if (source === 'wxt/browser') return resolve(here, 'src/demo/sim/browser.ts');
      if (importer?.includes('/extension/src/') && /\/shared\/alerts$/.test(source)) return resolve(here, 'src/demo/sim/alerts.ts');
      return null;
    },
  };
}

// The demo reuses the extension's real engine, window and pages.
export default defineConfig({
  plugins: [pretendBrowser(), preact()],
  /** The extension's version, so the site never shows a stale one. */
  define: { __TIPPY_VERSION__: JSON.stringify(version) },
  resolve: {
    alias: { '@ext': resolve(here, '../extension/src') },
  },
  build: {
    rollupOptions: {
      input: Object.fromEntries(PAGES.map((p) => [p, resolve(here, `${p}.html`)])),
    },
  },
});
