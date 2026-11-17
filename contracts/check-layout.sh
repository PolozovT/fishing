#!/usr/bin/env bash
# Guards the proxies: a new version of an upgradeable contract may only APPEND state variables.
# Compares the current storage layout with the one recorded at the last deployment (storage/<Contract>.layout):
# the recorded layout must be an exact prefix of the current one.
#   ./check-layout.sh           check
#   ./check-layout.sh --record  record the current layout (do this right after a deployment or an upgrade)
set -euo pipefail
cd "$(dirname "$0")"
mkdir -p storage
status=0
for c in FishingGame Tournaments; do
  now=$(forge inspect "src/$c.sol:$c" storage-layout --json | python3 -c '
import json, re, sys
for s in json.load(sys.stdin)["storage"]:
    print(s["slot"], s["offset"], s["label"], re.sub(r"\)\d+", ")", s["type"]))')
  file="storage/$c.layout"
  if [[ "${1:-}" == "--record" ]]; then
    echo "$now" > "$file"
    echo "recorded $file"
  elif [[ ! -f "$file" ]]; then
    echo "$c: no recorded layout (run ./check-layout.sh --record after deploying)"; status=1
  elif [[ "$(echo "$now" | head -n "$(wc -l < "$file")")" == "$(cat "$file")" ]]; then
    echo "$c: ok ($(( $(echo "$now" | wc -l) - $(wc -l < "$file") )) new variable(s) appended)"
  else
    echo "$c: LAYOUT CHANGED. An upgrade would corrupt player state:"; diff <(cat "$file") <(echo "$now" | head -n "$(wc -l < "$file")") || true; status=1
  fi
done
exit $status
