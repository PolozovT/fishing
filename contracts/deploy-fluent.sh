#!/usr/bin/env bash
# Deploys the game to Fluent Testnet (chainId 20994) and verifies sources on testnet.fluentscan.xyz (Blockscout).
# Uses the testnet-only deployer from contracts/.env (fund DEPLOYER_ADDRESS at https://portal.fluent.xyz/builder/faucet).
# Pass --account <foundry-keystore-name> instead to deploy from your own wallet.
set -euo pipefail
cd "$(dirname "$0")"

RPC=fluent_testnet
VERIFY=(--verify --verifier blockscout --verifier-url https://testnet.fluentscan.xyz/api/)

if [[ "${1:-}" == "--account" ]]; then
  SIGNER=(--account "$2")
else
  set -a; source .env; set +a
  bal=$(cast balance "$DEPLOYER_ADDRESS" --rpc-url "$RPC")
  echo "deployer $DEPLOYER_ADDRESS balance: $(cast from-wei "$bal") ETH"
  if [[ "$bal" == "0" ]]; then
    echo "Fund the address at https://portal.fluent.xyz/builder/faucet and run again." >&2
    exit 1
  fi
  SIGNER=(--private-key "$DEPLOYER_KEY")
fi

forge script script/Deploy.s.sol --rpc-url "$RPC" --broadcast --slow "${SIGNER[@]}" "${VERIFY[@]}" || {
  echo "If only verification failed, the contracts are already deployed; addresses are in ../deployments/20994.json" >&2
  exit 1
}
echo "Done: ../deployments/20994.json. Next: cd ../web && pnpm dev:fluent"
