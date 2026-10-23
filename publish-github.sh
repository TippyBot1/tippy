#!/usr/bin/env bash
# Pushes this folder to its public GitHub repo:
#
#   cd ~/Documents/tippy && ./publish-github.sh
#
# It asks for a GitHub token without showing it (make one with "public_repo" and
# "workflow" ticked at
# https://github.com/settings/tokens/new?scopes=public_repo,workflow&description=tippy-push),
# creates the public repo "tippy" on your account if it isn't there yet, pushes
# the code and version tags, then updates the releases, roadmap issues and topics
# (scripts/github-extras.mjs). The token is only ever typed by you: it's passed
# along through the environment and never printed or saved.
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
# The automatic tests live in .github/workflows, and GitHub only takes those from a token with "workflow" ticked.
SCOPES="$(curl -fsSI "${auth[@]}" "$API/user" 2>/dev/null | tr -d '\r' | sed -n 's/^[Xx]-[Oo][Aa]uth-[Ss]copes: *//p')"
if [[ -n "$SCOPES" && "$SCOPES" != *workflow* ]]; then
  echo "This token can't push the automatic tests: make one with both \"public_repo\" and \"workflow\" ticked at"
  echo "  https://github.com/settings/tokens/new?scopes=public_repo,workflow&description=tippy-push"
  echo "Nothing was changed."
  exit 1
fi

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
export GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=http.extraHeader GIT_CONFIG_VALUE_0="Authorization: Basic ${BASIC}"
git push -u origin main
git push origin --tags
unset GIT_CONFIG_COUNT GIT_CONFIG_KEY_0 GIT_CONFIG_VALUE_0

GH_TOKEN="$TOKEN" node scripts/github-extras.mjs "$LOGIN" "$REPO" || echo "(The code is pushed, but the releases / issues didn't update — tell Claude.)"
unset TOKEN BASIC

echo
echo "Done: https://github.com/$LOGIN/$REPO"
echo "Tests run at https://github.com/$LOGIN/$REPO/actions — a green check means they passed."
