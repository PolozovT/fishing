#!/usr/bin/env bash
# Guards the proxies: new code must read every storage slot the way the released code wrote it.
# Compares the storage layout of the current build with the latest release of every chain
# (contracts/releases/<chainId>/<Contract>/<NNN>/storage-layout.json, written by ./release.sh record), including
# the fields of every struct, wherever it is stored. The rules are in tools/layout.py.
#   ./check-layout.sh            check (exit 1 on an incompatible change)
#   ./check-layout.sh --selftest prove that the rules reject each kind of incompatible change
set -euo pipefail
cd "$(dirname "$0")"
if [[ "${1:-}" == "--selftest" ]]; then exec python3 tools/layout.py selftest; fi
exec python3 tools/layout.py check
