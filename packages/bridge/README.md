<!--
  robinhood-toolkit · package: bridge · README
  Author: nirholas · https://github.com/nirholas/robinhood-toolkit
  License: MIT (c) 2026 nirholas
-->

# bridge

Bridging value onto **Robinhood Chain** (Arbitrum Orbit, mainnet `4663` /
testnet `46630`) and getting the token accounting right. Three things this
package refuses to let you get wrong:

1. **Bridged ERC-20s have chain-specific addresses.** A token's Ethereum address
   is *not* its address here. `resolveToken()` throws rather than fall back.
2. **Decimals are read, never assumed.** WETH is 18, USDG is 6. A UI that
   hardcodes 18 misformats USDG by a factor of a trillion.
3. **Canonical withdrawals wait ~7 days.** That is the optimistic-rollup
   challenge period, a protocol property, not a queue. It is surfaced as a
   required field so a withdrawal UI cannot ignore it.

## Install

Part of the `robinhood-toolkit` workspace; depends on the `robinhood-chain`
package and `viem`.

```sh
npm install
```

## Token registry and resolver

```js
import { resolveToken, resolveTokenEntry, verifyToken } from 'bridge'

resolveToken('WETH')          // '0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73'
resolveToken('USDG')          // '0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168'
resolveTokenEntry('USDG')     // { address, name: 'Global Dollar', symbol, decimals: 6, verifiedAt }

resolveToken('USDC')          // throws: no verified address on this chain — look it up, verify, add it
```

`resolveToken(symbol, chainId?)` returns the checksummed address for a **verified**
symbol on that chain, and throws an explicit, actionable error otherwise. It never
falls back to an Ethereum address — that silent fallback is the single
highest-frequency bug in bridge integrations, and preventing it is the reason this
module exists.

### Verifying an address before you add it

Every address must pass `verifyToken()` before it enters `TOKENS`. It confirms
bytecode exists and the ERC-20 surface responds, and returns the metadata read
from the chain:

```js
const v = await verifyToken('0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168')
// { address, name: 'Global Dollar', symbol: 'USDG', decimals: 6,
//   totalSupply, bytecodeSize, chainId, explorer, readAt }
```

An address with no code throws — that is what an Ethereum address pasted onto
Robinhood Chain looks like.

> Both verified tokens are **proxy** contracts. Interact with the proxy address;
> never cache an implementation address as if it were the token. USDG's small
> bytecode (`bytecodeSize` ~170) is the proxy stub — expected, not a red flag.

## Withdrawal cost model

```js
import { estimateWithdrawal } from 'bridge'

const est = estimateWithdrawal({ amount: 1_000_000n, symbol: 'USDG' })
est.challengePeriodDays        // 7  ← top-level, impossible to miss
est.canonical                  // canonical bridge route, feeQuote: 'live'
est.partners                   // LayerZero/Stargate, CCIP, Relay, Across, LiFi — all live-quote
```

- **Canonical route:** rollup-native, waits the full ~7-day challenge period.
  Cannot be escalated.
- **Partner routes:** front liquidity to exit sooner, under a *different* trust
  model, for a market-driven fee. `feeQuote: 'live'` — quote at request time; a
  cached fee is a misquote.

Show `challengePeriodDays` to the user **before they sign**, not on the
confirmation screen. Users who learn about a 7-day lock after signing file
support tickets.

## Regenerating the token report

```sh
npm run report --workspace bridge   # writes reports/bridge-tokens.json (live read)
```

## Tests

```sh
npm test --workspace bridge                       # unit tests, no network
RH_LIVE_TESTS=1 npm run test:live --workspace bridge   # live on-chain checks
```

## Deposit / withdrawal runbook

See [`RUNBOOK.md`](./RUNBOOK.md) for the rehearse-on-testnet-first procedure and
where to record your own **measured** L1→L2 latency (which should replace the
approximate ~10-minute figure once you have it).

## What is NOT in this package

- **Orbit bridge contract addresses** (inbox, outbox, gateway router). Every
  Orbit chain has its own deployment — do **not** copy Arbitrum One addresses.
  Read them from <https://docs.robinhood.com/chain/contracts/> or from the
  bridge UI's transaction targets.
- **Stored fee estimates.** Every route's fee is live and market-driven.
