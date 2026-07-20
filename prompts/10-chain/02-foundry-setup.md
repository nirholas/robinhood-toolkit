<!--
  robinhood-toolkit · build prompt: Foundry configured for Robinhood Chain
  Author: nirholas · https://github.com/nirholas/robinhood-toolkit
  License: MIT (c) 2026 nirholas
-->

# 02 · Foundry setup for Robinhood Chain

## Goal

Produce a reusable Foundry project configured for both Robinhood Chain networks:
named RPC aliases, Blockscout verification wired for each chain, deterministic
compiler settings, keystore-based signing, and a `forge script` deploy pipeline
that verifies in the same run. After this, every later prompt in this track can
assume `--rpc-url rh_testnet` works.

## Prerequisites

- Foundry (`foundryup`). `forge --version` and `cast --version` both respond.
- A funded testnet EOA imported as a keystore account (prompt 01, step 4).
- Network reachability confirmed with `cast chain-id` against both RPCs.

## Reference facts (verified)

- Mainnet: chain ID `4663`, RPC `https://rpc.mainnet.chain.robinhood.com`,
  explorer `https://robinhoodchain.blockscout.com`.
- Testnet: chain ID `46630`, RPC `https://rpc.testnet.chain.robinhood.com`,
  explorer `https://explorer.testnet.chain.robinhood.com`.
- Both explorers are Blockscout, so verification uses the Blockscout API
  (`--verifier blockscout`, endpoint at `<explorer-host>/api/`).
- Arbitrum Orbit (Nitro), fully EVM compatible, gas in ETH, around 0.055 gwei,
  around 101 ms blocks. Deployment is permissionless.
- Docs: <https://docs.robinhood.com/chain/deploy-smart-contracts/>.

## Steps

### 1. foundry.toml

```toml
# robinhood-toolkit · Foundry config for Robinhood Chain
# Author: nirholas · https://github.com/nirholas/robinhood-toolkit
# License: MIT (c) 2026 nirholas

[profile.default]
src = "src"
out = "out"
libs = ["lib"]
solc_version = "0.8.26"
optimizer = true
optimizer_runs = 200
via_ir = false
bytecode_hash = "none"
evm_version = "cancun"
fs_permissions = [{ access = "read-write", path = "./deployments" }]

[profile.ci]
verbosity = 3
fuzz = { runs = 512 }

[rpc_endpoints]
rh_mainnet = "${RH_MAINNET_RPC}"
rh_testnet = "${RH_TESTNET_RPC}"

[etherscan]
rh_mainnet = { key = "blockscout", chain = 4663,  url = "https://robinhoodchain.blockscout.com/api/" }
rh_testnet = { key = "blockscout", chain = 46630, url = "https://explorer.testnet.chain.robinhood.com/api/" }

[fmt]
line_length = 100
tab_width = 4
bracket_spacing = true
```

`bytecode_hash = "none"` removes the trailing metadata hash, which makes
verification reproducible across machines. Blockscout does not check the API
key, but Foundry requires the field to be non-empty, hence the literal
`"blockscout"`.

Set `evm_version` to a hardfork the chain actually supports. Nitro tracks
Ethereum hardforks closely but not instantly. If a deploy reverts with an
invalid opcode, drop to `"shanghai"` and redeploy. Which hardfork is live on
chain 4663 today is UNVERIFIED here. Confirm against
<https://docs.robinhood.com/chain/> before assuming `cancun`.

### 2. .env and .env.example

`.env.example` (commit this):

```sh
# robinhood-toolkit · environment template
# Author: nirholas · https://github.com/nirholas/robinhood-toolkit
# License: MIT (c) 2026 nirholas
RH_MAINNET_RPC=https://rpc.mainnet.chain.robinhood.com
RH_TESTNET_RPC=https://rpc.testnet.chain.robinhood.com
RH_ACCOUNT=rh-deployer
```

`.env` is the local copy. Add it to `.gitignore`. It holds no private key. The
key lives in the Foundry keystore and is referenced by account name only.

### 3. Sanity script

`script/Ping.s.sol`:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script, console} from "forge-std/Script.sol";

/// robinhood-toolkit · network sanity check
/// Author: nirholas · https://github.com/nirholas/robinhood-toolkit
/// License: MIT (c) 2026 nirholas
contract Ping is Script {
    function run() external view {
        console.log("chainid   ", block.chainid);
        console.log("blocknum  ", block.number);
        console.log("basefee   ", block.basefee);
        console.log("timestamp ", block.timestamp);
    }
}
```

```sh
source .env
forge script script/Ping.s.sol:Ping --rpc-url rh_testnet
```

### 4. Deploy script with broadcast and artifact write

`script/DeployBeacon.s.sol`:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script, console} from "forge-std/Script.sol";
import {Beacon} from "../src/Beacon.sol";

/// robinhood-toolkit · Beacon deployer
/// Author: nirholas · https://github.com/nirholas/robinhood-toolkit
/// License: MIT (c) 2026 nirholas
contract DeployBeacon is Script {
    function run() external returns (Beacon beacon) {
        string memory note = vm.envOr("BEACON_NOTE", string("robinhood-toolkit"));

        vm.startBroadcast();
        beacon = new Beacon(note);
        vm.stopBroadcast();

        console.log("Beacon deployed:", address(beacon));
        console.log("chainid:", block.chainid);
    }
}
```

Run it against testnet, broadcasting and verifying in one pass:

```sh
source .env
forge script script/DeployBeacon.s.sol:DeployBeacon \
  --rpc-url rh_testnet \
  --account "$RH_ACCOUNT" \
  --sender "$(cast wallet address --account "$RH_ACCOUNT")" \
  --broadcast \
  --verify \
  --verifier blockscout \
  --verifier-url https://explorer.testnet.chain.robinhood.com/api/ \
  -vvv
```

Foundry writes the run to
`broadcast/DeployBeacon.s.sol/46630/run-latest.json`. That file is your
deployment record. Extract addresses from it rather than copying from terminal
output:

```sh
jq -r '.transactions[] | select(.transactionType=="CREATE")
       | {name: .contractName, address: .contractAddress, tx: .hash}' \
  broadcast/DeployBeacon.s.sol/46630/run-latest.json
```

### 5. Makefile so nobody retypes flags

```make
# robinhood-toolkit · Foundry task runner
# Author: nirholas · https://github.com/nirholas/robinhood-toolkit
# License: MIT (c) 2026 nirholas
include .env
export

SENDER := $(shell cast wallet address --account $(RH_ACCOUNT))

.PHONY: build test fmt ping deploy-testnet deploy-mainnet

build: ; forge build --sizes
test:  ; forge test -vv
fmt:   ; forge fmt
ping:  ; forge script script/Ping.s.sol:Ping --rpc-url rh_testnet

deploy-testnet:
	forge script script/DeployBeacon.s.sol:DeployBeacon \
	  --rpc-url rh_testnet --account $(RH_ACCOUNT) --sender $(SENDER) \
	  --broadcast --verify --verifier blockscout \
	  --verifier-url https://explorer.testnet.chain.robinhood.com/api/ -vvv

deploy-mainnet:
	forge script script/DeployBeacon.s.sol:DeployBeacon \
	  --rpc-url rh_mainnet --account $(RH_ACCOUNT) --sender $(SENDER) \
	  --broadcast --verify --verifier blockscout \
	  --verifier-url https://robinhoodchain.blockscout.com/api/ -vvv
```

### 6. Fork tests against the live chain

Because the chain is EVM compatible, `forge test --fork-url` works normally.
This is how every later prompt tests against real deployed protocol state.

```sh
forge test --fork-url rh_mainnet -vv
```

In a test, pin a block so results are reproducible:

```solidity
uint256 fork = vm.createSelectFork(vm.rpcUrl("rh_mainnet"), 1_000_000);
```

## Deliverable

A Foundry project containing `foundry.toml`, `.env.example`, `.gitignore`
covering `.env` and `broadcast/`, `script/Ping.s.sol`,
`script/DeployBeacon.s.sol`, a `Makefile`, and a `README.md` documenting the
two RPC aliases and both verification endpoints. Every file carries the
attribution header.

## How to verify

1. `forge build --sizes` succeeds with the pinned `solc_version`.
2. `make ping` prints chain ID `46630`.
3. `make deploy-testnet` broadcasts, and the run JSON under
   `broadcast/.../46630/` contains a `CREATE` transaction with an address.
4. `cast code <address> --rpc-url rh_testnet` returns non-empty bytecode.
5. The testnet explorer shows verified source without a manual verify step.
6. `forge test --fork-url rh_mainnet` connects and runs.

## Gotchas

- `[rpc_endpoints]` interpolation is silent when the variable is unset. You get
  an empty URL and a confusing connection error. Always `source .env` first, and
  make `make ping` the first thing you run in a new shell.
- The `[etherscan]` table key must match the `[rpc_endpoints]` alias for
  `--verify` inside `forge script` to pick the right verifier automatically.
  Keep both named `rh_mainnet` and `rh_testnet`.
- Trailing slash on the verifier URL matters for some Foundry versions. Use
  `/api/` exactly as shown.
- Do not commit `broadcast/` if the repo is public and the sender address is
  meant to stay private. The address is in every run file.
- `bytecode_hash = "none"` changes deployed bytecode. Set it before your first
  deploy, not after, or old and new deploys will not match byte for byte.
- Around 101 ms blocks means `forge script` may confirm faster than a public RPC
  serves the receipt. If a run reports a missing receipt, retry the read rather
  than redeploying, and check the explorer before assuming failure.
- Testnet first for anything that spends. Only flip to `deploy-mainnet` after
  the identical script has landed and verified on 46630.
