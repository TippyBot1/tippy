import preact from '@preact/preset-vite';
import { resolve } from 'node:path';
import { defineConfig } from 'vite';

// The demo reuses the extension's real engine and Tippy card.
export default defineConfig({
  plugins: [preact()],
  resolve: {
    alias: { '@ext': resolve(import.meta.dirname, '../extension/src') },
  },
  build: {
    rollupOptions: {
      input: {
        main: resolve(import.meta.dirname, 'index.html'),
        privacy: resolve(import.meta.dirname, 'privacy.html'),
      },
    },
  },
});
