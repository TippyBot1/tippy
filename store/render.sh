#!/usr/bin/env bash
# Renders the Chrome Web Store images into store/out/:
#   shot-1..5.png   1280×800 screenshots (Tippy's real window on mocked data)
#   promo-small.png 440×280, promo-marquee.png 1400×560
# Uses the dev harness build (mocked browser + fomo APIs) and headless Chrome in
# a throwaway profile. Run from anywhere: ./store/render.sh
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
ext="$here/../extension"
work="$(mktemp -d)"
port=4790
chrome="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
trap 'kill $server 2>/dev/null || true; rm -rf "$work"' EXIT

(cd "$ext" && HARNESS_OUT="$work/site" npx vite build --config harness/vite.config.ts --logLevel error)
mkdir -p "$work/site/store" "$here/out"
cp "$here/shots.html" "$here/promo.html" "$ext/assets/tippy-icon.svg" "$work/site/store/"

python3 -m http.server "$port" --bind 127.0.0.1 --directory "$work/site" >/dev/null 2>&1 &
server=$!
sleep 1

shot() { # url width height out
  "$chrome" --headless=new --disable-gpu --hide-scrollbars --no-first-run --no-default-browser-check \
    --user-data-dir="$work/chrome-$(basename "$4" .png)" --force-device-scale-factor=1 --window-size="$2,$3" \
    --virtual-time-budget=8000 --screenshot="$4" "$1" >/dev/null 2>&1 || true
  [[ -s "$4" ]] && echo "✓ $(basename "$4")" || echo "✗ $(basename "$4") failed"
}

for n in 1 2 3 4 5; do shot "http://127.0.0.1:$port/store/shots.html?scene=$n" 1280 800 "$here/out/shot-$n.png"; done
shot "http://127.0.0.1:$port/store/promo.html?size=small" 440 280 "$here/out/promo-small.png"
shot "http://127.0.0.1:$port/store/promo.html?size=marquee" 1400 560 "$here/out/promo-marquee.png"
