// Runs inside fomo.family. Two jobs:
//  1. Relay: answer the background's requests (prices, balances, sells, buys) from the
//     page's own origin, so the session token never leaves this tab.
//  2. UI: the floating Tippy bubble + card, in a Shadow DOM so fomo's styles and
//     ours never collide.

import { render } from 'preact';
import { browser } from 'wxt/browser';
import '../../ui/tippy.css';
import '../../ui/window.css';
import * as fomo from '../../fomo/api';
import { buyZone } from '../../engine/buys';
import { executeBuy } from '../../executor/buy';
import { executeSell, healthCheck } from '../../executor/steps';
import { tokenFromUrl } from '../../shared/chains';
import { load } from '../../shared/store';
import type { ExecOptions, ExecResult, RelayRequest, RelayResponse, SessionState } from '../../shared/messages';
import { App, setSelling } from './App';

export default defineContentScript({
  matches: ['https://fomo.family/*'],
  cssInjectionMode: 'ui',
  runAt: 'document_idle',
  async main(ctx) {
    browser.runtime.onMessage.addListener((msg: RelayRequest, sender, sendResponse) => {
      if (sender.id !== browser.runtime.id) return false;
      handle(msg).then(sendResponse);
      return true;
    });

    const ui = await createShadowRootUi(ctx, {
      name: 'tippy-ui',
      position: 'inline',
      anchor: 'body',
      append: 'last',
      onMount(container) {
        const root = document.createElement('div');
        container.append(root);
        render(<App ctx={ctx} />, root);
        return root;
      },
      onRemove(root) {
        if (root) render(null, root);
      },
    });
    ui.mount();

    browser.runtime.sendMessage({ type: 'HELLO', url: location.href }).catch(() => {});
  },
});

const PRACTICE_STOP = 'Practice run — Tippy never presses.';

/** A practice run is always a dry run, whatever the message says (belt and braces). */
function practiceSafe(options: ExecOptions): ExecOptions {
  return options.practice ? { ...options, practice: true, dryRun: true } : options;
}

async function handle(msg: RelayRequest): Promise<RelayResponse> {
  // fomo authenticates with cookies, so its API (a 401/403) is the source of
  // truth for "logged out"; the local session read is only a hint.
  let session: SessionState = fomo.session();
  try {
    switch (msg.type) {
      case 'PING':
        return { ok: true, data: { url: location.href }, session };
      case 'QUOTES':
        return { ok: true, data: await fomo.quotes(msg.keys), session };
      case 'BALANCES':
        return { ok: true, data: await fomo.balances(), session };
      case 'ME':
        return { ok: true, data: await fomo.me(), session };
      case 'CONFIG':
        return { ok: true, data: await fomo.minimums(), session };
      case 'HEALTH':
        return { ok: true, data: healthCheck(), session };
      case 'EXECUTE': {
        // Never sell on the wrong page.
        const here = tokenFromUrl(location.href);
        if (!here || here.key !== msg.action.key) {
          const res: ExecResult = { stage: 'error', clicked: false, detail: 'Tippy opened the wrong page — not selling.' };
          return { ok: true, data: res, session };
        }
        const options = practiceSafe(msg.options);
        setSelling({ side: 'sell', symbol: msg.symbol, pct: msg.action.sellPctOfCurrent, dryRun: options.dryRun, practice: options.practice });
        // Re-checked immediately before pressing: right coin page, not paused, no
        // kill switch, plan still armed (the user may have acted mid-sell).
        // A practice run belongs to no plan and never gets past this.
        const guard = async () => {
          if (options.practice) return PRACTICE_STOP;
          if (tokenFromUrl(location.href)?.key !== msg.action.key) return 'Tippy is no longer on the right coin page — not selling.';
          const { settings, status, plans } = await load('settings', 'status', 'plans');
          if (settings.paused) return 'Tippy was paused.';
          if (status.health === 'killed') return 'Tippy was paused for safety.';
          if (settings.dryRun && !options.dryRun) return 'Dry run was switched on — not selling.';
          if (plans[msg.action.planId]?.state !== 'armed') return 'The plan was paused or stopped.';
          return null;
        };
        try {
          return { ok: true, data: await executeSell(msg.action, options, document, undefined, guard), session };
        } finally {
          setSelling(null);
        }
      }
      case 'EXECUTE_BUY': {
        // Never buy on the wrong page.
        const here = tokenFromUrl(location.href);
        if (!here || here.key !== msg.action.key) {
          const res: ExecResult = { stage: 'error', clicked: false, detail: 'Tippy opened the wrong page — not buying.' };
          return { ok: true, data: res, session };
        }
        const options: ExecOptions = { ...practiceSafe(msg.options), symbol: msg.options.symbol ?? msg.symbol };
        setSelling({ side: 'buy', symbol: msg.symbol, usd: msg.action.usd, dryRun: options.dryRun, practice: options.practice });
        // Re-checked immediately before pressing: right coin page, not paused, no
        // kill switch, and the order still executing (the user may have cancelled
        // it mid-buy). Practice runs never get past this.
        const guard = async () => {
          if (options.practice) return PRACTICE_STOP;
          if (tokenFromUrl(location.href)?.key !== msg.action.key) return 'Tippy is no longer on the right coin page — not buying.';
          const { settings, status, buys } = await load('settings', 'status', 'buys');
          if (settings.paused) return 'Tippy was paused.';
          if (status.health === 'killed') return 'Tippy was paused for safety.';
          if (settings.dryRun && !options.dryRun) return 'Dry run was switched on — not buying.';
          const order = buys[msg.action.orderId];
          if (order?.state !== 'executing') return 'The buy was cancelled or changed.';
          if (order.expiresAt != null && Date.now() >= order.expiresAt) return 'The order expired — not buying.';
          // The price may have moved since Tippy opened this tab (up to a minute ago):
          // still at the level, and not run more than 25% past it?
          const [quote] = await fomo.quotes([order.key]).catch(() => []);
          if (!quote || !(quote.priceUSD > 0)) return "Tippy couldn't re-check the price — not buying.";
          if (buyZone(order, quote) !== 'at') return 'The price moved away from your level — not buying.';
          return null;
        };
        try {
          return { ok: true, data: await executeBuy(msg.action, options, document, undefined, guard), session };
        } finally {
          setSelling(null);
        }
      }
    }
  } catch (e) {
    const status = e instanceof fomo.FomoApiError ? e.status : 0;
    // Only 401 means "logged out"; 403 can be a block or a forbidden action.
    const authFailed = status === 401;
    if (authFailed) {
      session = { ok: false, reason: 'expired' };
      fomo.forgetUser();
    }
    return { ok: false, error: e instanceof Error ? e.message : String(e), session, authFailed };
  }
}
