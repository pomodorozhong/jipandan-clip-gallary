#!/bin/bash
# Double-click in Finder to open the triage page. Close this window to stop it.
cd "$(dirname "$0")" || exit 1
# A window opened from Finder may not have Node on its PATH yet, so look in the usual install places.
if ! command -v node >/dev/null 2>&1; then
  for dir in /opt/homebrew/bin /usr/local/bin "$HOME/.volta/bin"; do
    if [ -x "$dir/node" ]; then PATH="$dir:$PATH"; break; fi
  done
fi
if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is not installed. Install it from https://nodejs.org, then double-click Triage.command again."
  read -r -p "Press Return to close this window."
  exit 1
fi
exec node scripts/triage.mjs
