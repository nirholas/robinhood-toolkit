<!-- built by nirholas x.com/nichxbt -->
<!--
  robinhood-toolkit · Stock Token registry source — discovery record
  Author: nirholas · https://github.com/nirholas/robinhood-toolkit
  License: All Rights Reserved (c) 2026 nirholas
-->

# Stock Token registry — source of truth

**Date checked:** 2026-07-21
**Chain:** Robinhood Chain mainnet, id `4663`, RPC `https://rpc.mainnet.chain.robinhood.com`
**Docs page:** <https://docs.robinhood.com/chain/contracts/>
**Explorer:** <https://robinhoodchain.blockscout.com> (Blockscout)

This file is the evidence behind whatever you set `RH_ASSET_REGISTRY_URL` to.
Record what you *observed*, not what you *concluded*. Everything downstream
trusts this document, so it fails closed until the source is confirmed.

## Status: source is on-chain, exact contract UNVERIFIED

The docs contracts page states verbatim:

> The table below is generated live from the on-chain asset registry. Each
> symbol links to the token's contract on Blockscout.

So the canonical list is an **on-chain asset registry read client-side**, not a
published JSON/HTTP endpoint. Confirmed observations:

- The page (`docs.robinhood.com/chain/contracts/`) is a static Vocs site; the
  address table is rendered by its app bundle
  (`cdn.robinhood.com/assets/generated_assets/hoodchain_docsite/assets/index-*.js`)
  using a wagmi/viem client. A plain HTTP fetch of the page shows only
  `Loading tokens…` — the table needs JS execution to populate.
- No public JSON or GraphQL registry endpoint was found. The only `.json` the
  site loads is its docs search index, not asset data.
- The registry **contract address and selector could not be extracted from the
  static bundle**. Confirming them requires opening the page with browser
  devtools on the Network tab (filter: Fetch/XHR) and reading the actual
  `eth_call` to the registry, then decoding the calldata with
  `cast 4byte-decode <calldata>`. That step needs an interactive browser and is
  **not yet done**. Do not fabricate a contract address to fill this gap.

Two verified infrastructure addresses *are* printed statically on the page and
match `clients/`: WETH `0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73`, USDG
`0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168`.

## Cross-check performed (one entry, on-chain + explorer)

Per step 1, one candidate entry (`AAPL`, address below) was cross-checked
directly against chain 4663 and Blockscout on 2026-07-21:

- `eth_chainId` → `0x1237` = 4663 ✓
- `symbol()` → `AAPL`
- `decimals()` → `18`
- `name()` → `Apple • Robinhood Token`
- Blockscout `/api/v2/tokens/...` → type `ERC-20`, 22,194 holders, icon served
  from `cdn.robinhood.com`, reputation `ok`.

This proves the address is a **real, live, self-consistent ERC-20 branded as a
Robinhood token**. It does **not** prove registry membership — only the registry
does. On-chain metadata consistency and registry canonicity are different
claims; this module treats registry membership as authoritative and on-chain
reads as a liveness/sanity check.

## Candidate addresses — UNVERIFIED, third-party, do NOT hardcode

These came from third-party guides ([QuickNode](https://www.quicknode.com/guides/robinhood/read-stock-tokens-data-onchain),
[SQD](https://sqd.dev/learn/robinhood-tokenized-stocks/)), both of which
*hardcode* their maps — exactly the anti-pattern this module exists to prevent.
They are recorded here only as leads to confirm against the live registry, never
as a source of truth. **Confirm each against the registry before trusting it.**

| Ticker | Candidate address (UNVERIFIED) |
|--------|--------------------------------|
| AAPL   | `0xaF3D76f1834A1d425780943C99Ea8A608f8a93f9` |
| TSLA   | `0x322F0929c4625eD5bAd873c95208D54E1c003b2d` |
| NVDA   | `0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC` |
| MSFT   | `0xe93237C50D904957Cf27E7B1133b510C669c2e74` |
| AMZN   | `0x12f190a9F9d7D37a250758b26824B97CE941bF54` |
| GOOGL  | `0x2e0847E8910a9732eB3fb1bb4b70a580ADAD4FE3` |
| META   | `0xc0D6457C16Cc70d6790Dd43521C899C87ce02f35` |
| COIN   | `0x6330D8C3178a418788dF01a47479c0ce7CCF450b` |
| SPY    | `0x117cc2133c37B721F49dE2A7a74833232B3B4C0C` |
| QQQ    | `0xD5f3879160bc7c32ebb4dC785F8a4F505888de68` |

## Field mapping

`RH_ASSET_REGISTRY_URL` must point at a source that yields, after
`normalizeRegistry()` in `registry/fetch.mjs`, rows carrying:

| Concept | Accepted field names (first match wins) |
|---------|------------------------------------------|
| ticker  | `ticker`, `symbol`, `assetSymbol` |
| address | `address`, `contractAddress`, `tokenAddress` |
| name    | `name`, `assetName` (optional) |

Decimals are **not** taken from the registry — `resolve.mjs` reads `decimals()`
on-chain for every resolution. The payload may be a bare array or an object with
`assets` / `tokens` / `data`. Any other shape throws rather than guessing.

## To finish confirming the source (the remaining work)

1. Open `docs.robinhood.com/chain/contracts/` with devtools → Network → Fetch/XHR, reload.
2. If a JSON endpoint populates the table: record its full URL + a sample body,
   set `RH_ASSET_REGISTRY_URL` to it, and update the field mapping above.
3. If it is an on-chain `eth_call`: record the registry contract address and the
   decoded selector, then swap `loadRegistry()` in `registry/fetch.mjs` for a
   viem `readContract` against that contract (same `Map` return type).
4. Re-run the AAPL cross-check against whatever the confirmed source returns and
   verify its address matches the registry, not just the on-chain symbol.

Until step 2 or 3 is done, `RH_ASSET_REGISTRY_URL` is unset and every command
fails closed with an instructional error — by design.
