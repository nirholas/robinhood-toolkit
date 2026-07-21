<!--
  robinhood-toolkit · rh-first-deploy
  Author: nirholas · https://github.com/nirholas/robinhood-toolkit
  License: All Rights Reserved (c) 2026 nirholas
-->

# rh-first-deploy

Minimal Foundry project that deploys the `Beacon` contract to Robinhood Chain
(Arbitrum Orbit / Nitro L2, EVM-compatible), verifies its source on Blockscout,
and reads its state back over RPC.

Implements [prompts/10-chain/01-deploy-first-contract.md](../prompts/10-chain/01-deploy-first-contract.md).

## Layout

- `src/Beacon.sol` — the contract (note, deployer, deployedAtBlock, ping()).
- `test/Beacon.t.sol` — unit tests (state, increment, event).
- `foundry.toml` — pinned compiler/optimizer + Robinhood RPC & Blockscout config.
- `deploy-testnet.sh` — the key-gated deploy + verify step.
- `DEPLOY.md` — the deploy record (fill in address/tx/gas after running).
- `deploy.json` — written by the broadcast (gitignored).

## Quick start

```sh
forge build          # compile (solc 0.8.24, pinned)
forge test           # 3 tests, no key or network needed

# one-time: import your funded testnet key into an encrypted keystore
cast wallet import rh-deployer --interactive

./deploy-testnet.sh  # deploy → confirm code → verify on Blockscout
```

Gas is paid in ETH. The deployer must hold testnet ETH on chain `46630` first.
Never put a private key in a file or a shell command — `cast wallet import`
stores it encrypted under `~/.foundry/keystores`.
