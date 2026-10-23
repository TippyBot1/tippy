# Changelog

What changed in each version of Tippy. The newest is at the top. Versions with
a date are on the Chrome Web Store; "Unreleased" is built and tested but not
shipped yet.

## [Unreleased]

### Added
- **Control Tippy from Telegram.** Message @TippyAlertsBot: /orders lists every
  coin Tippy is guarding with its next levels, /pause and /resume work for
  everything or one coin (/pause $TIPPY), and /cancel $TIPPY cancels one coin's
  orders and limit buys (one coin at a time, nothing is sold). Tippy picks
  commands up when it checks in, about once a minute, and answers in the chat.
  Nothing is bought or sold from Telegram.
- **Getting-close alerts.** A heads-up when a coin is part of the way from your
  entry to its next take-profit (50% and 90% by default), or within 20% above a
  stop. Pick any mix of 25 / 50 / 75 / 90% and off / 10 / 20 / 30% in
  Settings → Alerts, with at most 5 per coin per day. They show on fomo, as
  desktop notifications and on Telegram.

### Changed
- Tippy checks in with the alerts server every minute (was two), and keeps
  checking in while paused — reporting nothing armed, so pausing on purpose no
  longer sets off "Tippy stopped watching".

## [0.1.2] — 2026-10-16

First public version on the Chrome Web Store.

### Changed
- Practice runs and dry run are developer tools now: the store version leaves
  out the 🧪 switch, the "Practice a sell / buy" links and the Dry run setting,
  and the chat answers "every order I place is real".

## [0.1.1] — 2026-10-14

Submitted for review (not published).

### Added
- Take-profits, partial stops and a stop loss at any market cap and any % of
  your bag, with wick protection.
- Limit buys at an exact market cap, guarded by a preset once they fill.
- Your orders as dashed lines on fomo's chart; drag one to move it.
- Chat: type orders in plain words, confirmed before anything happens.
- Auto-guard for new buys, trailing stops, presets.
- Telegram alerts in two taps, including a warning when Tippy stops watching.
