import { browser } from 'wxt/browser';
import { handleCommand } from '../background/commands';
import { keepAlive } from '../background/relay';
import { backstop, clearStaleExecuting, kick } from '../background/runtime';
import { hookNotificationClicks } from '../shared/alerts';
import type { Command } from '../shared/messages';
import { load } from '../shared/store';

export default defineBackground(() => {
  browser.runtime.onInstalled.addListener(async ({ reason }) => {
    if (reason === 'install') await browser.tabs.create({ url: browser.runtime.getURL('/welcome.html') });
    kick();
  });
  browser.runtime.onStartup.addListener(() => kick());

  // Clicking a "Tippy filled order" notification opens that coin on fomo.
  hookNotificationClicks();
  browser.permissions.onAdded.addListener(() => hookNotificationClicks());

  // 30s backstop (Chrome's minimum): restarts the loop if the worker was stopped.
  browser.alarms.create('tippy-backstop', { periodInMinutes: 0.5 });
  browser.alarms.onAlarm.addListener((a) => {
    if (a.name === 'tippy-backstop') backstop();
  });

  browser.runtime.onMessage.addListener((msg: Command, sender, sendResponse) => {
    // Only accept commands from Tippy's own pages and content scripts.
    if (sender.id !== browser.runtime.id) return false;
    handleCommand(msg, { tabId: sender.tab?.id })
      .then(sendResponse)
      .catch((e) => sendResponse({ ok: false, error: e instanceof Error ? e.message : String(e) }));
    return true;
  });

  // The desk tab must stay un-discardable across navigations.
  browser.tabs.onUpdated.addListener(async (tabId, info) => {
    if (info.status !== 'complete') return;
    const { status } = await load('status');
    if (status.deskTabId === tabId) await keepAlive(tabId);
  });

  void clearStaleExecuting().then(kick);
});
