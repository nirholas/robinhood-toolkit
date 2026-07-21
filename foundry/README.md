<!--
  robinhood-toolkit · Foundry project for Robinhood Chain
  Author: nirholas · https://github.com/nirholas/robinhood-toolkit
  License: All Rights Reserved (c) 2026 nirholas
-->

# Foundry setup for Robinhood Chain

A reusable Foundry project configured for both Robinhood Chain networks: named
RPC aliases, Blockscout verification wired per chain, deterministic compiler
settings, keystore-based signing, and a `forge script` deploy pipeline that
verifies in the same run. Built from
[`prompts/10-chain/02-foundry-setup.md`](../prompts/10-chain/02-foundry-setup.md).

## Networks

| Alias        | Chain ID | RPC (`--rpc-url`)                          | Explorer (Blockscout)                          |
| ------------ | -------- | ------------------------------------------ | ---------------------------------------------- |
| `rh_mainnet` | `4663`   | `https://rpc.mainnet.chain.robinhood.com`  | `https://robinhoodchain.blockscout.com`        |
| `rh_testnet` | `46630`  | `https://rpc.testnet.chain.robinhood.com`  | `https://explorer.testnet.chain.robinhood.com` |

**Verification endpoints** (Blockscout API, note the trailing `/api/`):

- `rh_mainnet` → `https://robinhoodchain.blockscout.com/api/`
- `rh_testnet` → `https://explorer.testnet.chain.robinhood.com/api/`

Both chains are Arbitrum Orbit (Nitro), fully EVM compatible, gas in ETH,
~0.055 gwei, ~101 ms blocks, permissionless deploys.

## Layout

```
foundry/
├── foundry.toml              # profiles, RPC aliases, [etherscan] verifiers
├── .env.example              # RPC URLs + keystore account name (copy to .env)
├── remappings.txt            # forge-std/ → lib/forge-std/src/
├── Makefile                  # setup / build / test / ping / deploy targets
├── src/Beacon.sol            # minimal deploy target
├── script/Ping.s.sol         # network sanity check
├── script/DeployBeacon.s.sol # broadcast + write run artifact
└── test/Beacon.t.sol         # unit + fuzz tests
```

## Setup

Prerequisites: Foundry (`foundryup`) and a funded testnet EOA imported as a
keystore account (see [`prompts/00-foundations/03-wallet-setup-and-funding.md`](../prompts/00-foundations/03-wallet-setup-and-funding.md)):

```sh
cast wallet import rh-deployer --interactive
```

Then, from this directory:

```sh
make setup          # installs Foundry if missing + vendors forge-std, copies .env
$EDITOR .env        # confirm RPC URLs and set RH_ACCOUNT to your keystore name
```

`.env` holds **no private key** — the key stays in the Foundry keystore and is
referenced by account name only. `make setup` runs `forge install
foundry-rs/forge-std`; run it manually if you prefer.

## Usage

```sh
source .env         # ALWAYS do this first in a new shell — see gotcha below
make build          # forge build --sizes
make test           # forge test -vv
make ping           # prints chain id 46630 against testnet
make deploy-testnet # broadcast + verify Beacon on 46630
make addresses-testnet   # read deployed addresses from the run artifact
```

Deploy against mainnet only after the identical script has landed and verified
on testnet: `make deploy-mainnet`.

### Fork tests against the live chain

```sh
forge test --fork-url rh_mainnet -vv
```

Pin a block inside a test for reproducibility:

```solidity
uint256 fork = vm.createSelectFork(vm.rpcUrl("rh_mainnet"), 1_000_000);
```

## Notes and gotchas

- **`source .env` first.** `[rpc_endpoints]` interpolation is silent when a
  variable is unset — you get an empty URL and a confusing connection error.
- **`evm_version = "cancun"` is UNVERIFIED for these chains.** Nitro tracks
  Ethereum hardforks closely but not instantly. If a deploy reverts with an
  invalid opcode, drop to `"shanghai"` in `foundry.toml` and redeploy. Confirm
  the live hardfork against <https://docs.robinhood.com/chain/> before assuming.
- **`bytecode_hash = "none"`** removes the trailing metadata hash for
  reproducible verification. It changes deployed bytecode — set it *before* your
  first deploy, or old and new deploys won't match byte for byte.
- **`[etherscan]` keys must match the `[rpc_endpoints]` aliases** (`rh_mainnet`,
  `rh_testnet`) so `--verify` inside `forge script` picks the right verifier.
  Blockscout ignores the API key, but Foundry requires the field non-empty —
  hence the literal `"blockscout"`.
- **`broadcast/` is git-ignored** because every run file embeds the sender
  address. Un-ignore deliberately in `.gitignore` if you want to track it.
- **~101 ms blocks** can outrun a public RPC serving the receipt. On a missing
  receipt, retry the read (or check the explorer) before redeploying.
