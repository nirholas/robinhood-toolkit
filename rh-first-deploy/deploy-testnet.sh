#!/usr/bin/env bash
# robinhood-toolkit · deploy Beacon to Robinhood Chain testnet (chain 46630)
# Author: nirholas · https://github.com/nirholas/robinhood-toolkit
#
# This is the ONE step that needs your funded key. It uses a Foundry keystore
# account (encrypted at ~/.foundry/keystores) — never a plaintext key.
#
# One-time setup, before running this script:
#   cast wallet import rh-deployer --interactive   # paste the private key once
#
# Then:  ./deploy-testnet.sh
set -euo pipefail

RH_TESTNET_RPC="https://rpc.testnet.chain.robinhood.com"
ACCOUNT="rh-deployer"
NOTE="robinhood-toolkit first deploy"

# --- sanity: right network, funded deployer --------------------------------
CHAIN_ID=$(cast chain-id --rpc-url "$RH_TESTNET_RPC")
[ "$CHAIN_ID" = "46630" ] || { echo "Wrong chain id: $CHAIN_ID (expected 46630)"; exit 1; }

DEPLOYER=$(cast wallet address --account "$ACCOUNT")
echo "Deployer:  $DEPLOYER"
echo "Balance:   $(cast balance "$DEPLOYER" --rpc-url "$RH_TESTNET_RPC" --ether) ETH"
BAL_WEI=$(cast balance "$DEPLOYER" --rpc-url "$RH_TESTNET_RPC")
[ "$BAL_WEI" != "0" ] || { echo "Deployer has 0 balance — fund it first."; exit 1; }

# --- deploy (constructor-args MUST be last: it is variadic) -----------------
echo "== deploying Beacon =="
forge create src/Beacon.sol:Beacon \
  --rpc-url "$RH_TESTNET_RPC" \
  --account "$ACCOUNT" \
  --broadcast --json \
  --constructor-args "$NOTE" | tee deploy.json | jq '{deployedTo,deployer,transactionHash}'

BEACON=$(jq -r .deployedTo deploy.json)
TXHASH=$(jq -r .transactionHash deploy.json)
echo "BEACON=$BEACON"

# --- confirm code landed + gas actually paid --------------------------------
CODESIZE=$(cast code "$BEACON" --rpc-url "$RH_TESTNET_RPC" | wc -c)
echo "code size (chars): $CODESIZE  (must be > 2)"
cast receipt "$TXHASH" --rpc-url "$RH_TESTNET_RPC" --json | jq '{status,gasUsed,effectiveGasPrice: (.effectiveGasPrice // "n/a")}'

# --- verify source on Blockscout --------------------------------------------
echo "== verifying on Blockscout =="
forge verify-contract "$BEACON" src/Beacon.sol:Beacon \
  --chain-id 46630 \
  --verifier blockscout \
  --verifier-url https://explorer.testnet.chain.robinhood.com/api/ \
  --constructor-args "$(cast abi-encode 'constructor(string)' "$NOTE")" \
  --watch || echo "verify failed — if it complains about a key, append: --etherscan-api-key blockscout"

echo
echo "Explorer: https://explorer.testnet.chain.robinhood.com/address/$BEACON"
echo "Now fill in DEPLOY.md with the address, tx hash, and gas above."
