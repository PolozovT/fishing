#!/usr/bin/env bash
# Release snapshots of the upgradeable contracts (see tools/release.py and UPGRADES.md). Reads the chain and the
# build output only: no private key, no .env.
#   ./release.sh record fluent_testnet            snapshot what the proxies run now
#   ./release.sh verify fluent_testnet [--source] check the snapshots against the chain (and rebuild them from source)
#   ./release.sh check-impl FishingGame 0x… fluent_testnet   is this deployed implementation the current build?
set -euo pipefail
cd "$(dirname "$0")"
cmd="${1:?record | verify | check-impl}"; shift
case "$cmd" in
  record) exec python3 tools/release.py record --rpc "${1:?rpc alias or url}" ;;
  verify) rpc="${1:?rpc alias or url}"; shift; exec python3 tools/release.py verify --rpc "$rpc" "$@" ;;
  check-impl) exec python3 tools/release.py check-impl "${1:?contract}" "${2:?address}" --rpc "${3:?rpc alias or url}" ;;
  *) echo "unknown command: $cmd" >&2; exit 2 ;;
esac
