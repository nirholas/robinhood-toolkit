<!--
  robinhood-toolkit · toolkit-token package readme
  Author: nirholas · https://github.com/nirholas/robinhood-toolkit
  License: All Rights Reserved (c) 2026 nirholas
-->

# toolkit-token

A capped, mintable ERC-20 with EIP-2612 permit, plus the Foundry project that
deploys and verifies it on Robinhood Chain. This is the reference answer to
"deploy a real token on chain 4663 and have Blockscout show verified source".

`ToolkitToken` composes four OpenZeppelin pieces:

| Piece | Why it is here |
|---|---|
| `ERC20` | The token itself. |
| `ERC20Permit` | Gasless approvals via signature (EIP-2612), so a spender can pull without the holder sending a prior `approve` transaction. |
| `ERC20Burnable` | Holders can destroy their own supply. Burned supply does not free cap headroom, because `cap` is checked against `totalSupply()`. |
| `Ownable2Step` | Ownership transfer is two-step, so a mistyped address cannot strand the mint key. |

Minting is `onlyOwner` and reverts with `CapExceeded(requested, remaining)` once
the cap is reached. A zero cap is rejected at construction with `ZeroCap()`.

## Layout

| Path | What it is |
|---|---|
| `src/ToolkitToken.sol` | The contract. |
| `script/DeployToken.s.sol` | Forge deploy script, configured entirely from environment variables. |
| `test/ToolkitToken.t.sol` | Forge tests. |
| `clients/token.mjs` | A viem reader for the deployed token: chain definitions for 4663 and 46630, and a `readToken` helper that reads decimals on chain instead of assuming 18. |
| `foundry.toml` | Build profile, the `rh_testnet` / `rh_mainnet` RPC aliases, and the Blockscout verifier endpoints. |

## Requirements

[Foundry](https://book.getfoundry.sh/) and the OpenZeppelin submodule. From the
repository root:

```sh
git submodule update --init --recursive
```

That populates `lib/openzeppelin-contracts`, which `remappings.txt` maps to
`@openzeppelin/`. Without it the build fails on the first import.

## Build and test

```sh
cd packages/toolkit-token
forge build
forge test
```

## Deploy

The deploy script reads four optional environment variables and falls back to a
sensible default for each, so a bare run still produces a valid token.

| Variable | Default |
|---|---|
| `TOKEN_NAME` | `Toolkit Token` |
| `TOKEN_SYMBOL` | `TKT` |
| `TOKEN_CAP` | `1_000_000 ether` (1,000,000 with 18 decimals) |
| `TOKEN_OWNER` | the broadcasting address |

Import your deployer key once into an encrypted Foundry keystore, so no
plaintext key ever reaches a shell history or a script:

```sh
cast wallet import rh-deployer --interactive
```

Then deploy to testnet (chain 46630) and verify in the same command:

```sh
TOKEN_NAME="Toolkit Token" TOKEN_SYMBOL="TKT" \
forge script script/DeployToken.s.sol:DeployToken \
  --rpc-url rh_testnet \
  --account rh-deployer \
  --broadcast \
  --verify --verifier blockscout \
  --etherscan-api-key blockscout
```

Swap `rh_testnet` for `rh_mainnet` to deploy to chain 4663. Both aliases and
both Blockscout verifier URLs are already declared in `foundry.toml`, so no
raw URL belongs on the command line.

Blockscout ignores the API key value, but `--etherscan-api-key` must be
non-empty, which is why the literal `blockscout` is passed.

## Read the deployed token

`clients/token.mjs` exports the two chain definitions and a reader that never
assumes decimals:

```js
import { createPublicClient, http } from 'viem'
import { robinhoodMainnet, readToken } from './clients/token.mjs'

const client = createPublicClient({ chain: robinhoodMainnet, transport: http() })
const info = await readToken(client, '0xYourTokenAddress', '0xHolderAddress')
console.log(info)
```

Decimals are read from the contract on every call. On Robinhood Chain that is
not pedantry: USDG uses 6 decimals while WETH uses 18, and a hardcoded 18 would
misreport a USDG balance by a factor of a trillion.

## Related

- [`packages/robinhood-chain/`](../robinhood-chain/) for the chain SDK, verified
  token constants, and address verification against ticker collisions.
- [`../../prompts/10-chain/04-erc20-on-robinhood-chain.md`](../../prompts/10-chain/04-erc20-on-robinhood-chain.md)
  for the build prompt this package is the finished form of.
