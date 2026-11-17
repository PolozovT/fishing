#!/usr/bin/env bash
# Opens a tournament on Fluent Testnet as the owner (the deployer from .env) and funds its prize in BLEND.
#
#   ./new-tournament.sh "<name>" <location> <rod> <lure> <waterTier> <green> <startsInSec> <minutes> <casts> <counted> <prizeBlend>
#
#   location   0 pond, 1 river, 2 lake, 3 sea, 4 rapids, 5 golden lake, 6 swamp, 7 phantom waters
#   rod        0 willow … 5 pearl master: the rod everyone fishes with; only its owners may enter (everyone owns willow)
#   lure       0 = none, else lure id + 1 (1 spoon, 2 spinner, 3 fly, 4 jig, 5 popper, 6 abyss)
#   waterTier  0–2, added to a fish's rarity to get how hard it fights (the web game uses 0,0,1,2,2,1,2,2 per location)
#   green      width of the green band, 100000 = the whole gauge. The game's rule: (0.20 + 0.006 × rod catch, max 0.30) × 125000
#
# Example: ./new-tournament.sh "Village Pond Open" 0 0 0 0 25000 60 30 30 10 100
set -euo pipefail
cd "$(dirname "$0")"
[[ $# -eq 11 ]] || { sed -n 2,13p "$0"; exit 1; }
set -a; source .env; set +a
RPC=fluent_testnet
DEP=../deployments/20994.json
CUP=$(python3 -c "import json;print(json.load(open('$DEP'))['tournaments'])")
BLEND=$(python3 -c "import json;print(json.load(open('$DEP'))['blend'])")
now=$(cast block latest --field timestamp --rpc-url "$RPC")
start=$((now + $7)); end=$((start + $8 * 60))
prize=$(cast to-wei "${11}")
send() { cast send "$@" --rpc-url "$RPC" --private-key "$DEPLOYER_KEY" >/dev/null; }
allowance=$(cast call "$BLEND" "allowance(address,address)(uint256)" "$DEPLOYER_ADDRESS" "$CUP" --rpc-url "$RPC" | awk '{print $1}')
if [[ "$(python3 -c "print(int($allowance < $prize))")" == "1" ]]; then send "$BLEND" "approve(address,uint256)" "$CUP" "$prize"; fi
id=$(cast call "$CUP" "count()(uint256)" --rpc-url "$RPC")
send "$CUP" "create((string,uint40,uint40,uint8,uint8,uint8,uint8,uint32,uint16,uint8,uint96))" "(\"$1\",$start,$end,$2,$3,$4,$5,$6,$9,${10},$prize)"
echo "tournament $id: \"$1\" opens in $7 s and runs $8 min, prize ${11} BLEND"
