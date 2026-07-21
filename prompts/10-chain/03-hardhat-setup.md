<!-- built by nirholas x.com/nichxbt -->
<!--
  robinhood-toolkit · build prompt: Hardhat configured for Robinhood Chain
  Author: nirholas · https://github.com/nirholas/robinhood-toolkit
  License: All Rights Reserved (c) 2026 nirholas
-->

# 03 · Hardhat setup for Robinhood Chain

## Goal

Configure a Hardhat project that compiles, deploys, and verifies on both
Robinhood Chain networks. Blockscout is not a built-in Hardhat network, so the
deliverable includes a working `customChains` entry for `@nomicfoundation/hardhat-verify`
for chain IDs 4663 and 46630. Use this track when your team is TypeScript-first
or already has Hardhat tooling. Foundry (prompt 02) is the default elsewhere in
this toolkit.

## Prerequisites

- Node.js 20 or newer, and npm.
- A funded testnet EOA on chain 46630.
- A secrets store you trust. This prompt uses Hardhat's encrypted keystore
  (`npx hardhat keystore set`), not a plaintext key in `.env`.

## Reference facts (verified)

- Mainnet: chain ID `4663`, RPC `https://rpc.mainnet.chain.robinhood.com`,
  explorer `https://robinhoodchain.blockscout.com`.
- Testnet: chain ID `46630`, RPC `https://rpc.testnet.chain.robinhood.com`,
  explorer `https://explorer.testnet.chain.robinhood.com`.
- Both explorers run Blockscout. Blockscout exposes an Etherscan-compatible API
  at `<host>/api`, which is what `customChains.apiURL` must point at.
- Arbitrum Orbit (Nitro), fully EVM compatible. Gas token ETH, around
  0.055 gwei, around 101 ms blocks. Permissionless deployment.
- Docs: <https://docs.robinhood.com/chain/connecting/> and
  <https://docs.robinhood.com/chain/deploy-smart-contracts/>.

## Steps

### 1. Scaffold

```sh
mkdir rh-hardhat && cd rh-hardhat
npm init -y
npm i -D hardhat @nomicfoundation/hardhat-toolbox @nomicfoundation/hardhat-verify dotenv
npx hardhat init      # choose the TypeScript project
```

### 2. Store the deployer key encrypted

```sh
npx hardhat keystore set RH_DEPLOYER_KEY
```

If your Hardhat version predates the keystore plugin, use a `.env` file that is
gitignored and read it with `dotenv`, and treat that as a known downgrade in
security posture rather than the intended path.

### 3. hardhat.config.ts

```ts
/**
 * robinhood-toolkit · Hardhat config for Robinhood Chain
 * Author: nirholas · https://github.com/nirholas/robinhood-toolkit
 * License: All Rights Reserved (c) 2026 nirholas
 */
import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
import "@nomicfoundation/hardhat-verify";
import "dotenv/config";

const RH_MAINNET_RPC =
  process.env.RH_MAINNET_RPC ?? "https://rpc.mainnet.chain.robinhood.com";
const RH_TESTNET_RPC =
  process.env.RH_TESTNET_RPC ?? "https://rpc.testnet.chain.robinhood.com";

const accounts = process.env.RH_DEPLOYER_KEY ? [process.env.RH_DEPLOYER_KEY] : [];

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.26",
    settings: {
      optimizer: { enabled: true, runs: 200 },
      metadata: { bytecodeHash: "none" },
      evmVersion: "cancun",
    },
  },
  networks: {
    rhMainnet: { url: RH_MAINNET_RPC, chainId: 4663, accounts },
    rhTestnet: { url: RH_TESTNET_RPC, chainId: 46630, accounts },
  },
  etherscan: {
    // Blockscout does not validate the key, but the field must be present.
    apiKey: {
      rhMainnet: "blockscout",
      rhTestnet: "blockscout",
    },
    customChains: [
      {
        network: "rhMainnet",
        chainId: 4663,
        urls: {
          apiURL: "https://robinhoodchain.blockscout.com/api",
          browserURL: "https://robinhoodchain.blockscout.com",
        },
      },
      {
        network: "rhTestnet",
        chainId: 46630,
        urls: {
          apiURL: "https://explorer.testnet.chain.robinhood.com/api",
          browserURL: "https://explorer.testnet.chain.robinhood.com",
        },
      },
    ],
  },
  sourcify: { enabled: false },
};

export default config;
```

`evmVersion: "cancun"` is an assumption. Which hardfork chain 4663 currently
targets is UNVERIFIED here. Check <https://docs.robinhood.com/chain/> and drop
to `"shanghai"` if a deploy reverts with an invalid opcode.

### 4. Contract

`contracts/Beacon.sol`:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/// robinhood-toolkit · minimal deploy target
/// Author: nirholas · https://github.com/nirholas/robinhood-toolkit
/// License: All Rights Reserved (c) 2026 nirholas
contract Beacon {
    string public note;
    address public immutable deployer;
    uint256 public pings;

    event Pinged(address indexed from, uint256 count, uint256 timestamp);

    constructor(string memory note_) {
        note = note_;
        deployer = msg.sender;
    }

    function ping() external returns (uint256) {
        pings += 1;
        emit Pinged(msg.sender, pings, block.timestamp);
        return pings;
    }
}
```

### 5. Deploy script

`scripts/deploy-beacon.ts`:

```ts
/**
 * robinhood-toolkit · Beacon deploy script
 * Author: nirholas · https://github.com/nirholas/robinhood-toolkit
 * License: All Rights Reserved (c) 2026 nirholas
 */
import { ethers, network } from "hardhat";
import { mkdir, writeFile } from "node:fs/promises";

const EXPECTED_CHAIN_IDS: Record<string, bigint> = {
  rhMainnet: 4663n,
  rhTestnet: 46630n,
};

async function main() {
  const net = await ethers.provider.getNetwork();
  const expected = EXPECTED_CHAIN_IDS[network.name];
  if (expected !== undefined && net.chainId !== expected) {
    throw new Error(
      `network ${network.name} expected chainId ${expected}, RPC reported ${net.chainId}`,
    );
  }

  const [signer] = await ethers.getSigners();
  const balance = await ethers.provider.getBalance(signer.address);
  console.log("deployer", signer.address, "balance", ethers.formatEther(balance), "ETH");
  if (balance === 0n) throw new Error("deployer has zero ETH, fund it before deploying");

  const note = process.env.BEACON_NOTE ?? "robinhood-toolkit";
  const beacon = await (await ethers.getContractFactory("Beacon")).deploy(note);
  await beacon.waitForDeployment();

  const address = await beacon.getAddress();
  const tx = beacon.deploymentTransaction();
  console.log("Beacon deployed at", address, "tx", tx?.hash);

  await mkdir("deployments", { recursive: true });
  await writeFile(
    `deployments/${network.name}.json`,
    JSON.stringify(
      {
        contract: "Beacon",
        address,
        chainId: net.chainId.toString(),
        txHash: tx?.hash ?? null,
        constructorArgs: [note],
        deployedAt: new Date().toISOString(),
      },
      null,
      2,
    ),
  );
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
```

```sh
npx hardhat run scripts/deploy-beacon.ts --network rhTestnet
```

### 6. Verify

```sh
npx hardhat verify --network rhTestnet <ADDRESS> "robinhood-toolkit"
```

Constructor args must match exactly, including the string written to
`deployments/rhTestnet.json`. Read them from that file rather than retyping.

### 7. Mainnet

Identical commands with `--network rhMainnet`. Do not run them until the testnet
deploy is verified and the contract has been exercised.

## Deliverable

A Hardhat project with `hardhat.config.ts` carrying both networks and both
`customChains` verification entries, `contracts/Beacon.sol`,
`scripts/deploy-beacon.ts` with the chain ID guard, a `deployments/` directory
holding the JSON record per network, `.env.example`, a `.gitignore` covering
`.env` and `deployments/*.local.json`, and a `README.md` documenting both
network names. Attribution header on every file.

## How to verify

1. `npx hardhat compile` succeeds on 0.8.26.
2. `npx hardhat run scripts/deploy-beacon.ts --network rhTestnet` prints an
   address and writes `deployments/rhTestnet.json`.
3. The chain ID guard fires correctly: point `rhTestnet.url` at the mainnet RPC
   temporarily and confirm the script throws instead of deploying.
4. `npx hardhat verify --network rhTestnet <ADDRESS> "robinhood-toolkit"` reports
   success, and the explorer address page shows verified source.
5. `npx hardhat console --network rhTestnet` then
   `await (await ethers.getContractAt("Beacon", "<ADDRESS>")).note()` returns the
   constructor string.

## Gotchas

- The `etherscan.apiKey` map keys must be the Hardhat network names
  (`rhTestnet`), not the chain IDs. Mismatch produces an unhelpful
  "chain is not supported" error.
- `apiURL` has no trailing slash in Hardhat's `customChains`, unlike Foundry's
  `--verifier-url` which wants `/api/`. Do not copy one into the other.
- Disable `sourcify` unless you know Sourcify indexes chain 4663. Leaving it on
  adds a failing step to every verify run.
- Hardhat's default in-process network is chain ID 31337. Forgetting `--network`
  deploys to an ephemeral local chain and prints a perfectly real looking address
  that does not exist on Robinhood Chain. The chain ID guard in the script exists
  for exactly this failure.
- Gas is around 0.055 gwei. Do not copy an L1 `gasPrice` override into the
  network config. Leave gas to the provider.
- Blocks are around 101 ms. `waitForDeployment()` returns almost instantly, which
  is soft sequencer confirmation on an Orbit L2 with a centralized sequencer, not
  Ethereum settlement.
- Keep the private key out of the repo. If you fall back to `.env`, confirm it is
  gitignored before the first commit, not after.
<!-- built by nirholas x.com/nichxbt -->
