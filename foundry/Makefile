# built by nirholas x.com/nichxbt
# robinhood-toolkit · Foundry task runner
# Author: nirholas · https://github.com/nirholas/robinhood-toolkit
# License: All Rights Reserved (c) 2026 nirholas

# `-include` (not `include`) so targets like `setup` still run before .env exists.
-include .env
export

# Recursive `=` (not `:=`): the keystore lookup runs only when a deploy target
# actually references $(SENDER), not on every `make` invocation.
SENDER = $(shell cast wallet address --account $(RH_ACCOUNT))

TESTNET_VERIFIER_URL := https://explorer.testnet.chain.robinhood.com/api/
MAINNET_VERIFIER_URL := https://robinhoodchain.blockscout.com/api/

.PHONY: setup build test fmt ping deploy-testnet deploy-mainnet addresses-testnet addresses-mainnet

# One-time bootstrap: install Foundry if missing, then vendor forge-std.
setup:
	@command -v forge >/dev/null 2>&1 || (curl -L https://foundry.paradigm.xyz | bash && ~/.foundry/bin/foundryup)
	@test -f .env || cp .env.example .env
	forge install foundry-rs/forge-std

build: ; forge build --sizes
test:  ; forge test -vv
fmt:   ; forge fmt
ping:  ; forge script script/Ping.s.sol:Ping --rpc-url rh_testnet

deploy-testnet:
	forge script script/DeployBeacon.s.sol:DeployBeacon \
	  --rpc-url rh_testnet --account $(RH_ACCOUNT) --sender $(SENDER) \
	  --broadcast --verify --verifier blockscout \
	  --verifier-url $(TESTNET_VERIFIER_URL) -vvv

deploy-mainnet:
	forge script script/DeployBeacon.s.sol:DeployBeacon \
	  --rpc-url rh_mainnet --account $(RH_ACCOUNT) --sender $(SENDER) \
	  --broadcast --verify --verifier blockscout \
	  --verifier-url $(MAINNET_VERIFIER_URL) -vvv

# Read deployed addresses straight from the run artifact, not terminal scrollback.
addresses-testnet:
	@jq -r '.transactions[] | select(.transactionType=="CREATE") | {name: .contractName, address: .contractAddress, tx: .hash}' broadcast/DeployBeacon.s.sol/46630/run-latest.json

addresses-mainnet:
	@jq -r '.transactions[] | select(.transactionType=="CREATE") | {name: .contractName, address: .contractAddress, tx: .hash}' broadcast/DeployBeacon.s.sol/4663/run-latest.json
# built by nirholas x.com/nichxbt
