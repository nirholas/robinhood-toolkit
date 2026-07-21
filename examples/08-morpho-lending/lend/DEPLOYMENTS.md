<!-- built by nirholas x.com/nichxbt -->
<!--
  robinhood-toolkit · verified Morpho deployment record for Robinhood Chain
  Author: nirholas · https://github.com/nirholas/robinhood-toolkit
  License: All Rights Reserved (c) 2026 nirholas
-->

# Morpho on Robinhood Chain — verified deployment record

**Chain:** Robinhood Chain mainnet · chain ID `4663` · RPC
`https://rpc.mainnet.chain.robinhood.com` · explorer
`https://robinhoodchain.blockscout.com` (Blockscout).

**Resolved:** 2026-07-21. Re-verify before you rely on it; a market or vault can
be created or deprecated at any time on a permissionless deployment.

## How these were resolved

1. **Morpho docs address registry** — <https://docs.morpho.org>. Start here.
2. **Morpho API** — <https://blue-api.morpho.org/graphql>. It **does** index
   chain 4663 (it appears in `{ chains { id network } }` as
   `{ id: 4663, network: "Robinhood Chain" }`), so it is the fastest discovery
   source for this chain. Every address it returned was then confirmed on-chain.
3. **Blockscout** — the Morpho Blue address resolves to a **verified** contract
   named `Morpho` (Solidity `v0.8.19`), 31,166 bytecode chars.

The API is a discovery hint. The chain is the truth. Nothing below is trusted
because the API said so; it is trusted because `lend/verify.mjs` proved it.

## Morpho Blue singleton

| Field | Value |
| --- | --- |
| **Address** | `0x9D53d5E3bd5E8d4Cbfa6DB1ca238AEA02E651010` |
| `owner()` | `0x060595638692de6CcD47Ca04094f1772d3D39728` |
| `DOMAIN_SEPARATOR()` | `0xdec2c0a13cb9b2c7a749851d2692c8fd3a7941bf77148fced920e78c99a5fba0` |
| Bytecode | present, 31,166 hex chars |
| Blockscout | verified, name `Morpho` |
| Source URL | Morpho API (chain 4663) + Blockscout address page |

`DOMAIN_SEPARATOR()` is non-zero, which is the load-bearing signal that this is
Morpho Blue and not an unrelated contract that merely answers `owner()`.

## Adaptive Curve IRM

| Field | Value |
| --- | --- |
| **Address** | `0x2BD3d5965B26B51814AC95127B2b80dD6CcC0fa1` |
| `Morpho.isIrmEnabled(irm)` | `true` |

Every non-idle USDG market on this chain references this single IRM. A market
pointing at any other IRM should be treated as suspect until you have read that
IRM's code.

## Asset

| Field | Value |
| --- | --- |
| USDG | `0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168` |
| Decimals | **6** (read at runtime everywhere — never hardcode 18) |

There is also a memecoin squatting the `USDG` ticker on this chain (18 decimals).
Vault selection here is by address and by `asset()`, never by symbol.

## Vaults (ERC-4626)

The classic MetaMorpho V1 `vaults` query returns **empty** for chain 4663. The
USDG vaults here are **Morpho Vault V2** (`vaultV2s` in the API). They are still
ERC-4626 (`deposit` / `redeem` / `asset` / `convertToAssets`), but they do **not**
expose `MORPHO()`, so `verifyVault` treats its absence as normal.

Each row below had its `asset()` read on-chain and equal to the USDG address
above. TVL is `totalAssets()` at resolution time.

| Symbol | Address | `asset()` | TVL (USDG) | Curator |
| --- | --- | --- | --- | --- |
| `steakUSDG` | `0xBeEff033F34C046626B8D0A041844C5d1A5409dd` | USDG ✓ | ~150,137,085 | Steakhouse Financial |
| `ethenaUSDG` | `0xbEeFF0fb1Dc19344A87b8479dAb60A2e16160737` | USDG ✓ | ~50,059,842 | Steakhouse Financial |
| `PurintaUSDG` | `0x37788ff0c1d4e45A7FE06BC7e71e0cc00121d0A8` | USDG ✓ | ~50,077 | unverified |
| `groveUSDG` | `0xBEEff039907422219Fb367e525954DDC092854d9` | USDG ✓ | ~2 | Steakhouse Financial |
| `rhUSDG` | `0xD8722375c8F54C3730212CDA3cdD8EEe722E3EE4` | USDG ✓ | ~1 | unverified |

`asset()` equality is the only thing that makes a vault a "USDG vault". A name is
not evidence. `rhUSDG` ("RH Yield Vault USDG") carries a Robinhood-sounding name
but is seed-funded and its curator is not independently confirmed here — do not
assume it is the production Earn vault on that basis.

The demo's `MORPHO_USDG_VAULT` default is `steakUSDG` because it is the largest
curated vault. That is a starting point, not an endorsement — read the curator
and the vault's market allocations before supplying real funds.

## Markets

- **27** markets total on the singleton; **22** have USDG as the loan asset (you
  supply USDG, borrowers post collateral such as TSLA, SPY, QQQ, USDe, SGOV).
- Earliest `CreateMarket` observed at block **287**, so scan discovery from there
  (not from 0 — at ~101 ms blocks the head is past 15,000,000).
- LLTVs in use across USDG markets: 38.5%, 62.5%, 77%, 91.5%, 94.5%, 96.5%, 98%.
- Live supply APYs at resolution ranged from ~0% (idle) to ~20% (a single
  near-100%-utilization market). The "around 7%" headline is a blended,
  vault-level number, not any one market — read the real rate with `lend/rate.mjs`.

Run `node index.mjs` for the current market table with utilization and computed
supply APY; the machine-readable twin of this file is
`deployments.robinhood-mainnet.json`.

## Gotchas that bit during resolution

- The Morpho API `Market` type has **no** `id`/`uniqueKey`/`state.supplyAssets`
  under those names on this endpoint — the field is `marketId`, and market state
  is nested differently. Introspect (`{ __type(name:"Market"){ fields { name } } }`)
  rather than guessing.
- `vaults` (V1) is empty here; you must query `vaultV2s`. A team that only checks
  V1 concludes "no vaults exist" and is wrong.
- The Morpho Blue address is **not** the canonical mainnet
  `0xBBBB...` address — this is a fresh deployment. Do not copy an address from an
  Ethereum-mainnet tutorial.
<!-- built by nirholas x.com/nichxbt -->
