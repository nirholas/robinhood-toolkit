<!-- built by nirholas x.com/nichxbt -->
<!--
  robinhood-toolkit · deploy record for Beacon on Robinhood Chain
  Author: nirholas · https://github.com/nirholas/robinhood-toolkit
  License: All Rights Reserved (c) 2026 nirholas
-->

# Beacon — deploy record

## Network (verified 2026-07-21)

| | Testnet | Mainnet |
|---|---|---|
| Chain ID | `46630` | `4663` |
| RPC | `https://rpc.testnet.chain.robinhood.com` | `https://rpc.mainnet.chain.robinhood.com` |
| Explorer | `https://explorer.testnet.chain.robinhood.com` | `https://robinhoodchain.blockscout.com` |
| Gas token | ETH | ETH |

Live checks at build time: `cast chain-id` returned `46630` / `4663`; testnet
gas price `0.01 gwei`; testnet block height ~`91,908,520`.

## Build settings (pinned for reproducible verification)

- Compiler: `solc 0.8.24`
- Optimizer: `true`, runs `200`
- EVM version: `cancun`
- Foundry: `forge 1.7.1`

ABI-encoded constructor args (`constructor("robinhood-toolkit first deploy")`):

```
0x0000000000000000000000000000000000000000000000000000000000000020000000000000000000000000000000000000000000000000000000000000001e726f62696e686f6f642d746f6f6c6b6974206669727374206465706c6f790000
```

## Pre-flight verification (done — no key required)

- `forge build` → clean compile with pinned settings.
- `forge test` → 3/3 pass (constructor state, ping increments, event emit).
- **Full E2E on a local anvil node** using the exercised spec commands:
  `forge create` → `cast code` (1405 chars) → `note()` correct →
  `cast send ping()` (`status 0x1`) → `pings()` returned `1`.
  This proves the deploy/verify/exercise flow before spending testnet funds.

## Testnet deploy (TO FILL IN after running `./deploy-testnet.sh`)

| Field | Value |
|---|---|
| Contract address | `0x…` |
| Tx hash | `0x…` |
| Chain ID | `46630` |
| Deployer | `0x…` |
| Gas used | `…` |
| Effective gas price | `…` |
| Explorer | `https://explorer.testnet.chain.robinhood.com/address/0x…` |
| Verified | ☐ green "Contract" tab shows source |

### Exact commands

One-time key setup (encrypted keystore, never a plaintext file):

```sh
cast wallet import rh-deployer --interactive   # paste private key once
```

Deploy + confirm + verify (all wrapped in `./deploy-testnet.sh`):

```sh
forge create src/Beacon.sol:Beacon \
  --rpc-url https://rpc.testnet.chain.robinhood.com \
  --account rh-deployer \
  --broadcast --json \
  --constructor-args "robinhood-toolkit first deploy" | tee deploy.json

BEACON=$(jq -r .deployedTo deploy.json)

forge verify-contract "$BEACON" src/Beacon.sol:Beacon \
  --chain-id 46630 \
  --verifier blockscout \
  --verifier-url https://explorer.testnet.chain.robinhood.com/api/ \
  --constructor-args "$(cast abi-encode 'constructor(string)' 'robinhood-toolkit first deploy')" \
  --watch
```

> Note: `--constructor-args` is variadic in forge 1.7 — it must be the **last**
> option on the `forge create` line, or it swallows the flags after it.

### Exercise it

```sh
cast call "$BEACON" 'note()(string)'   --rpc-url https://rpc.testnet.chain.robinhood.com
cast call "$BEACON" 'pings()(uint256)' --rpc-url https://rpc.testnet.chain.robinhood.com
cast send "$BEACON" 'ping()' --rpc-url https://rpc.testnet.chain.robinhood.com --account rh-deployer
cast call "$BEACON" 'pings()(uint256)' --rpc-url https://rpc.testnet.chain.robinhood.com   # now 1
```

## Mainnet (only after testnet is green)

Same commands with `--rpc-url https://rpc.mainnet.chain.robinhood.com`,
`--chain-id 4663`, and `--verifier-url https://robinhoodchain.blockscout.com/api/`.
<!-- built by nirholas x.com/nichxbt -->
