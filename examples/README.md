<!--
  robinhood-toolkit · examples index
  Author: nirholas · https://github.com/nirholas/robinhood-toolkit
  License: MIT (c) 2026 nirholas
-->

# Examples

Six runnable programs that read Robinhood Chain mainnet. Not snippets: each one
is its own package with its own README, runs against the live chain, and prints
real output. Every README shows output actually captured from a real run.

```sh
git clone https://github.com/nirholas/robinhood-toolkit
cd robinhood-toolkit
npm install

cd examples/01-hello-chain && node index.mjs
```

`npm install` from the repository root links `robinhood-chain` into every
example through npm workspaces. No per-example install step.

| # | Example | What it does |
|---|---|---|
| 01 | [hello-chain](01-hello-chain/) | Connect and print chain ID, head block, gas price, and client version. The 30-second "it works". |
| 02 | [token-safety](02-token-safety/) | **Start here.** Four live contracts answer to the ticker `USDG` and three claim the name "Global Dollar". Resolves the collision end to end and shows what survives verification. |
| 03 | [portfolio-reader](03-portfolio-reader/) | Native ETH plus token balances for any address in one Multicall3 batch, with decimals read at call time. |
| 04 | [log-scanner](04-log-scanner/) | Scan WETH `Transfer` events with the adaptive scanner, hit the endpoint's matched-log cap on purpose, and resume a stopped scan from a serialized cursor. |
| 05 | [price-from-pool](05-price-from-pool/) | Derive a Uniswap v3 price from `sqrtPriceX96` in pure BigInt math and cross-validate it against DexScreener within 5%. |
| 06 | [candles](06-candles/) | Fetch OHLCV from GeckoTerminal, draw a candlestick chart in the terminal, and confirm the last close against `slot0`. |

## Every example is read-only

No example signs a transaction, sends funds, or accepts a private key. There is
no code path in this directory that touches a key. Where showing a write would
help, the example prints the command for you to run in your own terminal instead.

You can run all six against mainnet with no wallet, no funding, and no risk.

## What they collectively teach

These six exist because each encodes a trap that is expensive to rediscover on
this chain:

- **A ticker identifies nothing.** Four contracts answer to `USDG`. Three call
  themselves "Global Dollar". The one with the most indexed liquidity is not the
  real one. Only the address is authoritative. (02, and labelled honestly in 05
  and 06.)
- **Never default decimals.** Real USDG uses 6; every impostor uses 18. A wrong
  exponent misreads a balance by 10^12 and still renders a believable number.
  (02, 03.)
- **`eth_getLogs` caps matched logs, tiered by span.** 50,000 within 1001 blocks,
  10,000 beyond it, and the error string has already changed once. Adapt to
  failure, never to a message. (04.)
- **Float math loses prices.** A 384-bit numerator does not fit in a double, and
  unscaled integer division truncates small prices to exactly zero. Scale before
  dividing. (05.)
- **Cross-validate anything that moves money.** One source is an assertion; two
  independent sources agreeing is a check. (05, 06.)
- **Read the units.** GeckoTerminal prices in USD by default while `slot0` prices
  in the quote token, and comparing them looks like a math bug rather than the
  unit mismatch it is. (06.)

## Verified facts these depend on

All read from the live chain on 2026-07-20.

| Fact | Value |
|---|---|
| Mainnet chain ID | `4663` (`0x1237`) |
| RPC | `https://rpc.mainnet.chain.robinhood.com` |
| Client | `nitro/v3.11.3-rc.4-4bed0c5` |
| Block cadence | approximately 101 ms, about 855,000 blocks per day |
| Gas price | approximately 0.056 gwei |
| WETH | `0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73`, 18 decimals |
| USDG (canonical) | `0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168`, **6 decimals**, "Global Dollar" |
| Multicall3 | `0xcA11bde05977b3631167028862bE2a173976CA11`, bytecode confirmed |
| `eth_getLogs` cap | 50,000 matched logs within 1001 blocks; 10,000 beyond |
| DexScreener chain key | `robinhood` (string, not `4663`) |
| GeckoTerminal network | `robinhood` |

## Requirements

Node 20 or newer. Every example depends only on `robinhood-chain` and `viem`.

## Related

- [`packages/robinhood-chain`](../packages/robinhood-chain/) the SDK these are built on
- [`prompts/`](../prompts/) 64 build prompts across nine tracks
- [CONTRIBUTING.md](../CONTRIBUTING.md) every code sample must run as written
