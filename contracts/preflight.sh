#!/usr/bin/env bash
# Everything that must pass before an upgrade is sent. Reads only: no transaction, no private key, no .env.
#   ./preflight.sh                  the offline checks (this is what CI runs on every change)
#   ./preflight.sh fluent_testnet   the same, then the releases against the chain and the upgrade rehearsed on a fork
# See UPGRADES.md for what each step protects against.
set -euo pipefail
cd "$(dirname "$0")"
rpc="${1:-}"
step() { echo; echo "== $*"; }

step "1/6 the layout rules reject every kind of incompatible change"
./check-layout.sh --selftest
step "2/6 storage layout of the current code against the released code"
./check-layout.sh
step "3/6 OpenZeppelin upgrade validation against the released code"
./validate-upgrade.sh
step "4/6 contract sizes (limit 24,576 bytes)"
forge build --sizes --skip test --skip script 2>/dev/null | grep -E "^\| (Contract|FishingGame|Tournaments|GameLens|FishNFT) |^\|[-=|]+\|$" || { echo "a contract is over the size limit"; forge build --sizes --skip test --skip script; exit 1; }
step "5/6 tests, the upgrade from the released bytecode among them"
forge test 2>&1 | grep -E "^Ran [0-9]+ test suites|FAIL|^Suite result: FAILED" || true
forge test >/dev/null 2>&1 || { echo "tests failed: run forge test"; exit 1; }
if [[ -n "$rpc" ]]; then
  step "6/6 releases against the chain, rebuilt from their commits; the upgrade rehearsed on a fork"
  ./release.sh verify "$rpc" --source
  FORK_RPC="$rpc" forge test --match-contract UpgradeForkTest -vv 2>&1 | grep -E "PASS|FAIL|SKIP|compared|Suite result"
  FORK_RPC="$rpc" forge test --match-contract UpgradeForkTest >/dev/null 2>&1 || { echo "the fork rehearsal failed"; exit 1; }
else
  step "6/6 skipped: pass an rpc alias to check the releases against the chain and rehearse on a fork"
fi
echo; echo "preflight passed"
