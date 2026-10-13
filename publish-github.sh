#!/usr/bin/env bash
# Publishes this folder as a public GitHub repo — run it once:
#
#   cd ~/Documents/tippy && ./publish-github.sh
#
# It asks for a GitHub token without showing it (make one at
# https://github.com/settings/tokens/new?scopes=public_repo&description=Tippy%20publish),
# creates the public repo "tippy" on your account if it isn't there yet, and
# pushes. The token is only ever typed by you: it's passed to git through the
# environment for this one push and never printed or saved.
set -euo pipefail
cd "$(dirname "$0")"
REPO="${1:-tippy}"
API="https://api.github.com"

git rev-parse --verify HEAD >/dev/null 2>&1 || { echo "Nothing committed yet — ask Claude to make the first commit."; exit 1; }

printf 'Paste the GitHub token (it stays hidden), then press Enter: '
IFS= read -rs TOKEN
echo
TOKEN="$(printf '%s' "$TOKEN" | tr -d '[:space:]')"
[[ -n "$TOKEN" ]] || { echo "No token given. Nothing was changed."; exit 1; }
auth=(-H "Authorization: Bearer ${TOKEN}" -H "Accept: application/vnd.github+json")

LOGIN="$(curl -fsS "${auth[@]}" "$API/user" 2>/dev/null | sed -n 's/^ *"login": *"\([^"]*\)".*/\1/p' | head -1 || true)"
[[ -n "$LOGIN" ]] || { echo "GitHub didn't accept that token. Nothing was changed."; exit 1; }
echo "✓ Signed in as @${LOGIN}"

if [[ "$(curl -s -o /dev/null -w '%{http_code}' "${auth[@]}" "$API/repos/$LOGIN/$REPO")" == 404 ]]; then
  curl -fsS -X POST "${auth[@]}" "$API/user/repos" \
    -d "{\"name\":\"$REPO\",\"description\":\"Take-profit, stop-loss and limit buys for fomo — a free browser extension. No keys, no wallet connect.\",\"homepage\":\"https://tippybot.fun\",\"private\":false,\"has_wiki\":false}" >/dev/null
  echo "✓ Created the public repo $LOGIN/$REPO"
else
  echo "✓ Repo $LOGIN/$REPO already exists"
fi

URL="https://github.com/$LOGIN/$REPO.git"
git remote get-url origin >/dev/null 2>&1 && git remote set-url origin "$URL" || git remote add origin "$URL"

BASIC="$(printf 'x-access-token:%s' "$TOKEN" | base64 | tr -d '\n')"
GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=http.extraHeader GIT_CONFIG_VALUE_0="Authorization: Basic ${BASIC}" \
  git push -u origin main
unset TOKEN BASIC

echo
echo "Done: https://github.com/$LOGIN/$REPO"
echo "Tell Claude the link so the website and store listing can point to it."
