---
name: robinhood-chain-sdk
description: Build on Robinhood Chain with the robinhood-chain npm SDK (viem chain definitions, verified token constants, decimals-safe formatting, address verification, portfolio reads, log scanning) and the toolkit's 64 build prompts. Use when writing code that reads Robinhood Chain.
---

# robinhood-chain SDK and build prompts

## Install

```bash
npm install robinhood-chain viem
```

ESM only, Node 20+. `viem` is a peer dependency. Networks: mainnet chain ID 4663 (RPC `https://rpc.mainnet.chain.robinhood.com`), testnet 46630 (RPC `https://rpc.testnet.chain.robinhood.com`).

## Exports

- Chains: `robinhoodChain`, `robinhoodTestnet`, `CHAINS`, `getChain`, `chainsById`, `isRobinhoodChain`, `hasMulticall3`, `addChainParams`, `MULTICALL3_ADDRESS`, `ROBINHOOD_MAINNET_ID`, `ROBINHOOD_TESTNET_ID`.
- Tokens: `USDG`, `WETH`, `KNOWN_TOKENS`, `KNOWN_IMPOSTORS`, `isKnownImpostor`, `knownTokenAt`.
- Formatting: `formatToken`, `parseToken`, `readDecimals`, `readBalance`, `assertDecimals`. Decimals are never defaulted; omitting them throws `MissingDecimalsError`.
- Verification: `assertCanonicalToken`, `verifyToken`, `readTokenMetadata`. A wrong address throws `NotCanonicalTokenError`.
- Portfolio and batching: `readPortfolio(client, address, tokenAddresses)`, `batchRead`.
- Streaming and logs: `watchHead`, `scanLogs`, `streamLogs`, `createCursor`, `serializeCursor`, `deserializeCursor`, `classifyScanError`.
- Explorer: `BlockscoutClient`, `blockscoutFor`.

## Traps it handles

- USDG has 6 decimals; WETH has 18.
- viem `multicall()` throws without `contracts.multicall3` on the chain definition. The exported chains declare it.
- Mainnet `eth_getLogs` caps how many logs a query may match, not the block range, and reports the cap under more than one error message. Use `scanLogs` or `streamLogs`, which adapt.

## Worked example

```js
import { createPublicClient, http } from 'viem'
import { robinhoodChain, USDG, assertCanonicalToken, readBalance } from 'robinhood-chain'

const client = createPublicClient({ chain: robinhoodChain, transport: http() })
await assertCanonicalToken(client, USDG.address, USDG)
const { raw, decimals, formatted } = await readBalance(client, { token: USDG.address, account: '0xYourAddress' })
```

`readBalance(client, { token, account })` returns `{ token, account, raw, decimals, formatted }`, with decimals read from the contract.

## Build prompts

The repo's `prompts/` directory holds 64 self-contained build tasks in nine tracks: `00-foundations`, `10-chain`, `20-crypto-api`, `30-agentic-mcp`, `40-charting`, `50-autonomous`, `60-site`, `70-deploy`, `80-safety`. Each states goal, prerequisites, verified facts, steps, deliverable and verification. Clone `https://github.com/nirholas/robinhood-toolkit`, open the relevant file, and follow it. Read `prompts/80-safety` before building anything that places orders unattended.
