#!/usr/bin/env bash
# Connects Tippy's alerts worker to your Telegram bot — run it once after
# creating the bot with @BotFather:
#
#   cd ~/Documents/tippy/alerts-worker && ./connect-telegram.sh
#
# It asks for the bot token without showing it, stores it as a Cloudflare
# secret (never in a file), makes a random webhook secret, and points
# Telegram at https://alerts.tippybot.fun/telegram. The token is only ever
# typed by you — it isn't printed, logged or saved anywhere on disk.
set -euo pipefail
cd "$(dirname "$0")"

URL="https://alerts.tippybot.fun/telegram"

printf 'Paste the bot token from @BotFather (it stays hidden), then press Enter: '
IFS= read -rs TOKEN
echo
TOKEN="$(printf '%s' "$TOKEN" | tr -d '[:space:]')"
if [[ ! "$TOKEN" =~ ^[0-9]+:[A-Za-z0-9_-]{30,}$ ]]; then
  echo "That doesn't look like a bot token (it should look like 123456789:AA…). Nothing was changed."
  exit 1
fi

# Check the token with Telegram and read the bot's username.
ME="$(curl -s "https://api.telegram.org/bot${TOKEN}/getMe")"
USERNAME="$(printf '%s' "$ME" | sed -n 's/.*"username":"\([^"]*\)".*/\1/p')"
if [[ -z "$USERNAME" ]]; then
  echo "Telegram didn't accept that token. Nothing was changed."
  exit 1
fi
echo "✓ Token works — your bot is @${USERNAME}"

SECRET="$(openssl rand -hex 32)"
printf '%s' "$TOKEN" | npx wrangler secret put TG_TOKEN >/dev/null
printf '%s' "$SECRET" | npx wrangler secret put TG_SECRET >/dev/null
echo "✓ Saved as Cloudflare secrets"

HOOK="$(curl -s "https://api.telegram.org/bot${TOKEN}/setWebhook" \
  --data-urlencode "url=${URL}" \
  --data-urlencode "secret_token=${SECRET}" \
  --data-urlencode 'allowed_updates=["message"]' \
  --data-urlencode "drop_pending_updates=true")"
if printf '%s' "$HOOK" | grep -q '"ok":true'; then
  echo "✓ Telegram now sends messages to ${URL}"
else
  echo "✗ Telegram refused the webhook: ${HOOK}"
  exit 1
fi

# A short, honest bio so people know what the bot is.
curl -s "https://api.telegram.org/bot${TOKEN}/setMyShortDescription" \
  --data-urlencode "short_description=Alerts from Tippy, the free TP/SL bot for fomo. I never ask for keys, seed phrases or passwords." >/dev/null || true
curl -s "https://api.telegram.org/bot${TOKEN}/setMyDescription" \
  --data-urlencode "description=I'm Tippy's alert bot. Connect me from Tippy's settings in your browser and I'll tell you when Tippy takes profit, hits a stop, needs your OK, or stops watching. I never message first and never ask for keys, seed phrases or passwords. tippybot.fun" >/dev/null || true

unset TOKEN SECRET
echo
echo "Done. Tell Claude your bot is @${USERNAME} so Tippy's settings link to it."
