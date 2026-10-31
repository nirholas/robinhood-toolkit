<!--
  robinhood-toolkit · Hardhat project README for Robinhood Chain
  Author: nirholas · https://github.com/nirholas/robinhood-toolkit
  License: All Rights Reserved (c) 2026 nirholas
-->

# rh-hardhat · Hardhat for Robinhood Chain

A Hardhat 3 (TypeScript) project that compiles, deploys, and verifies contracts on
both Robinhood Chain networks. Blockscout is not a built-in Hardhat network, so
this project carries `chainDescriptors` entries (with Blockscout API URLs) for
Hardhat's Blockscout verifier on chain IDs **4663** and **46630**.

Use this track if your team is TypeScript-first or already runs Hardhat. Foundry
(prompt 02) is the default elsewhere in the toolkit.

## Networks

| Hardhat network name | Chain ID | RPC | Explorer (Blockscout) |
|---|---|---|---|
| `rhMainnet` | `4663` | `https://rpc.mainnet.chain.robinhood.com` | `https://robinhoodchain.blockscout.com` |
| `rhTestnet` | `46630` | `https://rpc.testnet.chain.robinhood.com` | `https://explorer.testnet.chain.robinhood.com` |

Both networks are Arbitrum Orbit (Nitro), fully EVM compatible, gas token ETH
(around 0.055 gwei), around 101 ms blocks, permissionless deployment. The
`chainDescriptors` `apiUrl` points at Blockscout's Etherscan-compatible
API at `<host>/api` — no trailing slash, unlike Foundry's `--verifier-url`.

## Setup

```sh
cd rh-hardhat
npm install
```

Store the deployer key encrypted (preferred):

```sh
npx hardhat keystore set RH_DEPLOYER_KEY
```

Hardhat 3 does not load `.env` files. If you do not use the keystore, export
`RH_DEPLOYER_KEY` in your shell for the session instead. The config reads it
lazily, so compile and test never need a key. Treat the plain env var as a known
downgrade in security posture, not the intended path.

Requires Node 22.10 or newer (Hardhat 3, ESM only).

## Compile

```sh
npm run compile        # hardhat compile, solc 0.8.26
```

`evmVersion` is set to `cancun`. Which hardfork chain 4663 currently targets is
unverified here — check <https://docs.robinhood.com/chain/> and drop to
`shanghai` in [hardhat.config.ts](hardhat.config.ts) if a deploy reverts with an
invalid opcode.

## Test

```sh
npm test               # hardhat test mocha, on the in-process simulated network
npm run typecheck      # compiles, then type-checks config, scripts and tests
```

Tests never touch a real chain and never sign with a real key.

## Deploy

Testnet first — always:

```sh
npm run deploy:testnet
# or: npx hardhat run scripts/deploy-beacon.ts --network rhTestnet
```

The script guards on chain ID before it deploys, prints the deployer address and
balance, and writes a record to `deployments/rhTestnet.json`. Set `BEACON_NOTE`
to change the constructor string.

Mainnet uses the identical command with `--network rhMainnet`. Do not run it
until the testnet deploy is verified and the contract has been exercised.

```sh
npm run deploy:mainnet
```

## Verify

```sh
npx hardhat verify blockscout --network rhTestnet <ADDRESS> "robinhood-toolkit"
```

Constructor args must match exactly, including the string in
`deployments/rhTestnet.json`. Read them from that file rather than retyping.

## Verifying the setup

1. `npm run compile` succeeds on 0.8.26.
2. `npm run deploy:testnet` prints an address and writes `deployments/rhTestnet.json`.
3. The chain ID guard fires: point `rhTestnet.url` at the mainnet RPC temporarily
   and confirm the script throws instead of deploying.
4. `npx hardhat verify blockscout --network rhTestnet <ADDRESS> "robinhood-toolkit"` reports
   success, and the explorer address page shows verified source.
5. `npx hardhat console --network rhTestnet` then
   `await (await ethers.getContractAt("Beacon", "<ADDRESS>")).note()` returns the
   constructor string.

## Gotchas

- `chainDescriptors` keys are chain IDs (`4663`, `46630`); `networks` keys are the
  Hardhat network names (`rhTestnet`). A mismatch produces an unhelpful "chain is not supported" error.
- `apiUrl` has no trailing slash in Hardhat's `chainDescriptors`. Foundry's
  `--verifier-url` wants `/api/`. Do not copy one into the other.
- `sourcify` is disabled. Leave it off unless you know Sourcify indexes chain
  4663 — otherwise every verify run gains a failing step.
- Hardhat's default in-process network is chain ID 31337. Forgetting `--network`
  deploys to an ephemeral local chain and prints a real-looking address that does
  not exist on Robinhood Chain. The chain ID guard exists for exactly this.
- Gas is around 0.055 gwei. Do not copy an L1 `gasPrice` override into the
  network config. Leave gas to the provider.
- Blocks are around 101 ms, so `waitForDeployment()` returns almost instantly.
  That is soft sequencer confirmation on an Orbit L2 with a centralized
  sequencer, not Ethereum settlement.

## Files

- [hardhat.config.ts](hardhat.config.ts) — both networks and both `chainDescriptors` Blockscout entries
- [contracts/Beacon.sol](contracts/Beacon.sol) — minimal deploy target
- [scripts/deploy-beacon.ts](scripts/deploy-beacon.ts) — deploy with the chain ID guard
- [deployments/](deployments/) — per-network JSON record (written on deploy)
- [.env.example](.env.example) — environment template
