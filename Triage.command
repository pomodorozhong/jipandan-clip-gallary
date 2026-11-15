#!/bin/bash
# Double-click in Finder to open the triage page. Close this window to stop it.
cd "$(dirname "$0")" || exit 1
exec python3 scripts/triage.py
