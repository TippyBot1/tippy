// Dev-only harness build: swaps browser + fomo APIs for mocks.
import preact from '@preact/preset-vite';
import { resolve } from 'node:path';
import { defineConfig, type Plugin } from 'vite';

const here = import.meta.dirname;

function mocks(): Plugin {
  return {
    name: 'tippy-harness-mocks',
    enforce: 'pre',
    resolveId(source, importer) {
      if (source === 'wxt/browser') return resolve(here, 'mock-browser.ts');
      if (source.endsWith('/fomo/api') && importer && !importer.includes('/harness/')) return resolve(here, 'mock-fomo.ts');
      if (source.endsWith('/shared/chains') && importer?.endsWith('fomo.content/App.tsx')) return resolve(here, 'mock-chains.ts');
      return null;
    },
  };
}

export default defineConfig({
  root: here,
  base: './',
  plugins: [mocks(), preact()],
  define: { 'import.meta.env.WXT_ALERTS_URL': JSON.stringify('http://localhost:0') },
  build: {
    outDir: process.env.HARNESS_OUT ?? resolve(here, '../.harness-dist'),
    emptyOutDir: true,
    rollupOptions: {
      input: {
        index: resolve(here, 'index.html'),
        popup: resolve(here, 'pages/popup.html'),
        options: resolve(here, 'pages/options.html'),
        welcome: resolve(here, 'pages/welcome.html'),
      },
    },
  },
});
