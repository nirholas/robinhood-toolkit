<!--
  robinhood-toolkit · build prompt: first contract deploy on Robinhood Chain
  Author: nirholas · https://github.com/nirholas/robinhood-toolkit
  License: MIT (c) 2026 nirholas
-->

# 01 · Deploy your first contract on Robinhood Chain

## Goal

Deploy a real Solidity contract to Robinhood Chain testnet, verify its source on
the Blockscout explorer, and read its state back over RPC. End state: a live
contract address you can link to, plus a repeatable deploy command.

No Robinhood approval is required. Deployment on this chain is permissionless.

## Prerequisites

- Foundry installed (`curl -L https://foundry.paradigm.xyz | bash && foundryup`).
  Verify with `forge --version`.
- An EOA private key you control, funded with testnet ETH on chain 46630. Gas is
  paid in ETH, not in a custom token.
- `jq` for reading JSON output in the verification steps.

## Reference facts (verified)

| | Mainnet | Testnet |
|---|---|---|
| Chain ID | `4663` | `46630` |
| RPC | `https://rpc.mainnet.chain.robinhood.com` | `https://rpc.testnet.chain.robinhood.com` |
| Explorer | `https://robinhoodchain.blockscout.com` | `https://explorer.testnet.chain.robinhood.com` |
| Gas token | ETH | ETH |

- Stack: Arbitrum Orbit (Nitro) L2. Fully EVM compatible. Solidity and Vyper
  deploy unmodified and standard Ethereum tooling works without patches.
- Typical gas price is around `0.055 gwei`. Block time is around `101 ms`.
- Mainnet explorer is Blockscout, so Blockscout verification APIs apply
  (`--verifier blockscout` in Foundry, `customChains` in Hardhat).
- Docs: <https://docs.robinhood.com/chain/>, subpages `/connecting/`,
  `/deploy-smart-contracts/`, `/contracts/`.

## Steps

### 1. Confirm the network answers before you write any code

```sh
export RH_TESTNET_RPC=https://rpc.testnet.chain.robinhood.com
export RH_MAINNET_RPC=https://rpc.mainnet.chain.robinhood.com

cast chain-id  --rpc-url "$RH_TESTNET_RPC"   # expect 46630
cast chain-id  --rpc-url "$RH_MAINNET_RPC"   # expect 4663
cast gas-price --rpc-url "$RH_TESTNET_RPC"
cast block-number --rpc-url "$RH_TESTNET_RPC"
```

If `cast chain-id` returns anything other than the values above, stop. You are
pointed at the wrong network and every later step will be wrong.

### 2. Scaffold the project

```sh
mkdir -p rh-first-deploy && cd rh-first-deploy
forge init --no-git .
rm -f src/Counter.sol test/Counter.t.sol script/Counter.s.sol
```

### 3. Write the contract

`src/Beacon.sol`:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// robinhood-toolkit · minimal deploy target
/// Author: nirholas · https://github.com/nirholas/robinhood-toolkit
/// License: MIT (c) 2026 nirholas
contract Beacon {
    string public note;
    address public immutable deployer;
    uint256 public immutable deployedAtBlock;
    uint256 public pings;

    event Pinged(address indexed from, uint256 count, uint256 timestamp);

    constructor(string memory note_) {
        note = note_;
        deployer = msg.sender;
        deployedAtBlock = block.number;
    }

    function ping() external returns (uint256) {
        pings += 1;
        emit Pinged(msg.sender, pings, block.timestamp);
        return pings;
    }
}
```

### 4. Load the deployer key without putting it in a file

Use a Foundry keystore account rather than a plaintext `PRIVATE_KEY` env var.

```sh
cast wallet import rh-deployer --interactive   # paste the private key once
cast wallet list
export RH_DEPLOYER=$(cast wallet address --account rh-deployer)
echo "$RH_DEPLOYER"
cast balance "$RH_DEPLOYER" --rpc-url "$RH_TESTNET_RPC" --ether
```

Balance must be greater than zero before the next step.

### 5. Deploy to testnet

```sh
forge create src/Beacon.sol:Beacon \
  --rpc-url "$RH_TESTNET_RPC" \
  --account rh-deployer \
  --constructor-args "robinhood-toolkit first deploy" \
  --broadcast \
  --json | tee deploy.json

export BEACON=$(jq -r .deployedTo deploy.json)
echo "$BEACON"
```

### 6. Verify the source on Blockscout

```sh
forge verify-contract "$BEACON" src/Beacon.sol:Beacon \
  --chain-id 46630 \
  --verifier blockscout \
  --verifier-url https://explorer.testnet.chain.robinhood.com/api/ \
  --constructor-args "$(cast abi-encode 'constructor(string)' 'robinhood-toolkit first deploy')" \
  --watch
```

Blockscout ignores the API key, but some Foundry versions still demand the flag
be present. If it errors on a missing key, append `--etherscan-api-key blockscout`.

### 7. Exercise it

```sh
cast call "$BEACON" 'note()(string)'   --rpc-url "$RH_TESTNET_RPC"
cast call "$BEACON" 'pings()(uint256)' --rpc-url "$RH_TESTNET_RPC"

cast send "$BEACON" 'ping()' \
  --rpc-url "$RH_TESTNET_RPC" --account rh-deployer

cast call "$BEACON" 'pings()(uint256)' --rpc-url "$RH_TESTNET_RPC"   # now 1
```

### 8. Promote to mainnet only after testnet is green

Same commands with `--rpc-url "$RH_MAINNET_RPC"`, `--chain-id 4663`, and
`--verifier-url https://robinhoodchain.blockscout.com/api/`.

## Deliverable

A `rh-first-deploy/` project containing:

- `src/Beacon.sol` with the attribution header.
- `deploy.json` from the broadcast (address, tx hash, deployer).
- A `DEPLOY.md` recording: contract address, tx hash, chain ID, explorer link,
  the exact deploy and verify commands, and gas actually paid.

## How to verify

1. `cast code "$BEACON" --rpc-url "$RH_TESTNET_RPC" | wc -c` returns more than 2.
   A bare `0x` means nothing deployed there.
2. The explorer page `https://explorer.testnet.chain.robinhood.com/address/$BEACON`
   shows a green "Contract" verification tab with your source.
3. `cast call "$BEACON" 'pings()(uint256)'` reflects the number of `ping()` calls
   you sent.
4. Receipt confirms the chain: `cast receipt <txhash> --rpc-url "$RH_TESTNET_RPC" --json | jq '.status, .gasUsed'`
   with `status` equal to `"0x1"`.

## Gotchas

- Two different chain IDs, one character apart. `4663` is mainnet, `46630` is
  testnet. Export both RPCs as separate variables and never reuse one shell var.
- Gas price is around `0.055 gwei`, roughly three orders of magnitude below L1.
  A hardcoded L1-scale `--gas-price` overpays massively. Let the node estimate.
- Around 101 ms blocks means confirmations land almost immediately. Do not read
  a fast receipt as proof of L1 finality. This is an Orbit L2 with a centralized
  sequencer and proposer, so soft confirmation is a sequencer promise, not
  settlement on Ethereum.
- `forge create` in recent Foundry requires the explicit `--broadcast` flag. If
  you get an address back but `cast code` is empty, you ran a simulation.
- Blockscout verification needs the same compiler version and optimizer settings
  used to build. If it fails, pin them in `foundry.toml` (see prompt 02) and
  rerun rather than trying to match by hand.
- Never paste a private key into a shell command or a `.env` that gets committed.
  `cast wallet import` stores it encrypted in `~/.foundry/keystores`.
