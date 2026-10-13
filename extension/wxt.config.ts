import preact from '@preact/preset-vite';
import { defineConfig } from 'wxt';

// Trust rules (see plan): the install prompt must show a single line —
// "Read and change your data on fomo.family". No `tabs`, no all-sites access.
// `power` (keep the computer awake while orders are on) shows no install
// warning, so it's required; notifications are optional and asked for in context.
export default defineConfig({
  srcDir: 'src',
  outDir: 'dist',
  manifest: {
    name: 'Tippy — take profit & stop loss for fomo',
    short_name: 'Tippy',
    description:
      'Take-profit, stop-loss and limit buys for your fomo trades. Any market cap, any % of your bag. No keys, no wallet connect.',
    permissions: ['storage', 'alarms', 'power'],
    optional_permissions: ['notifications'],
    host_permissions: ['https://fomo.family/*'],
    homepage_url: 'https://tippybot.fun',
    action: { default_title: 'Tippy' },
  },
  vite: () => ({
    plugins: [preact()],
  }),
});
