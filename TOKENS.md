<!-- built by nirholas x.com/nichxbt -->
<!--
  robinhood-toolkit · TOKENS.md — verified token address registry
  Author: nirholas · https://github.com/nirholas/robinhood-toolkit
  License: All Rights Reserved (c) 2026 nirholas
-->

# TOKENS.md — Robinhood Chain address registry

Every token this toolkit charts is listed here by its **full checksummed
contract address**. Resolve by address, never by symbol — symbols collide, even
on a single chain (see the two live `USDG` tokens below). Verify each address on
the explorer once, by hand, before adding it.

Chain: **Robinhood Chain** · EIP-155 id `4663` · DexScreener slug `robinhood`.
Explorer base: `https://explorer.robinhood.com/address/`

| Symbol | Address | Name | Verified on |
|---|---|---|---|
| USDG | `0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168` | Global Dollar (the real stablecoin, ~$1.00) | https://explorer.robinhood.com/address/0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168 |
| USDG | `0x8218d73C00567A01481495Ad6c5143e00D5BB5b4` | Useless Stupid Degen Gamblers (ticker squatter — NOT the stablecoin) | https://explorer.robinhood.com/address/0x8218d73C00567A01481495Ad6c5143e00D5BB5b4 |
| WETH | `0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73` | Wrapped Ether | https://explorer.robinhood.com/address/0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73 |

## Reference pool

| Pool address | Pair | Notes |
|---|---|---|
| `0x95f9B0AF9282A22F7ef57058e65098db3f667f95` | USDG / WETH | Uniswap v3 pool used by the smoke test in [scripts/demo-dexscreener.mjs](scripts/demo-dexscreener.mjs). |

## The ticker-collision warning

A free-text search for `USDG` returns **multiple distinct tokens** on Robinhood
Chain — several legitimate Global Dollar deployments plus at least one deliberate
squatter (`Useless Stupid Degen Gamblers`). A user who types "USDG" and takes
the first search hit can land on the wrong contract. Treat search results as a
candidate list for a human to pick from, never as an identifier.

**Rule: no bare symbols anywhere in config. Address, name, explorer link — for
every token, always.**
