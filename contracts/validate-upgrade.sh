#!/usr/bin/env bash
# OpenZeppelin's upgrade-safety validation (@openzeppelin/upgrades-core) of the current code against the code that
# is released: storage layout compatibility, delegatecall, selfdestruct, initializers and the rest of its rules.
# The reference is not the current source: each contract is compared with the build of its latest release's source
# commit (contracts/releases/<chainId>/<Contract>/<NNN>/release.json), checked out into a throwaway worktree.
#   ./validate-upgrade.sh [chainId]     default 20994 (Fluent Testnet). Needs Node (npx) and the full git history.
#
# Two findings are allowed, by name, because they are how these contracts are built. Nothing else is, and the
# storage check is never skipped:
#   constructor               FishingGame and Tournaments have one: it fixes the token addresses in the bytecode and
#                             locks the bare implementation (initialize() reverts on it). Proxy state is set by
#                             initialize(). OpenZeppelin's non-upgradeable Ownable has one too; it writes the
#                             implementation's own owner, never the proxy's.
#   state-variable-immutable  the token addresses are immutables. A new implementation must be built with the same
#                             ones: script/Upgrade.s.sol and `./release.sh check-impl` verify that.
set -euo pipefail
cd "$(dirname "$0")"
CORE="@openzeppelin/upgrades-core@1.48.0"
ALLOW="constructor,state-variable-immutable"
chain="${1:-20994}"
work="$PWD/cache/oz-validate"
build() { # <contracts dir> <name>: a full build with the AST and the storage layout, into $work/<name>
  (cd "$1" && FOUNDRY_OUT="$work/out/$2" FOUNDRY_CACHE_PATH="$work/cache/$2" \
    forge build --force --ast --build-info --build-info-path "$work/$2" --skip test --skip script >"$work/$2.log" 2>&1) \
    || { cat "$work/$2.log"; echo "build of $2 failed"; exit 1; }
}
mkdir -p "$work"
rm -rf "$work/build-info"
build "$PWD" build-info
status=0
for c in FishingGame Tournaments; do
  latest=$(python3 -c "import json;print(json.load(open('releases/$chain/index.json'))['$c']['latest'])")
  commit=$(python3 -c "import json;print(json.load(open('releases/$chain/$c/$latest/release.json'))['sourceCommit'][:12])")
  ref="release-$commit"
  if [[ ! -d "$work/$ref" ]]; then # the released source never changes: built once, kept in cache/
    tree=$(mktemp -d)
    git -C .. worktree add --detach --quiet "$tree" "$commit"
    build "$tree/contracts" "$ref"
    git -C .. worktree remove --force "$tree"
  fi
  echo "== $c against release $latest of chain $chain (commit $commit)"
  npx --yes "$CORE" validate "$work/build-info" --contract "src/$c.sol:$c" --reference "$ref:src/$c.sol:$c" \
    --referenceBuildInfoDirs "$work/$ref" --requireReference --unsafeAllow "$ALLOW" || status=1
done
exit $status
