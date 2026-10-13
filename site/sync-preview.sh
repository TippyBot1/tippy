#!/bin/sh
# Build the site and mirror it where the desktop app's preview pane can read it.
set -e
cd "$(dirname "$0")"
npx vite build >/dev/null
SP="${TIPPY_PREVIEW_DIR:?set TIPPY_PREVIEW_DIR}"
mkdir -p "$SP" && rsync -a --delete dist/ "$SP/" && xattr -cr "$SP"
echo "synced to $SP"
