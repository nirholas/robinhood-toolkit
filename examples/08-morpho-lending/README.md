<!--
  robinhood-toolkit · example 08: Morpho lending on Robinhood Chain
  Author: nirholas · https://github.com/nirholas/robinhood-toolkit
  License: All Rights Reserved (c) 2026 nirholas
-->

# 08 · Morpho lending on Robinhood Chain

Supply USDG into Morpho on Robinhood Chain from your own code, the honest way:
resolve the deployment from an official source, **prove it on-chain**, discover
markets and vaults by querying instead of hardcoding, read the **real** current
rate from the IRM, then supply and withdraw — after rehearsing on a fork.

No Morpho address, market id, or APY is a literal in any source file here. The
resolver reads addresses from the environment and refuses to guess; the verified
record lives in [lend/DEPLOYMENTS.md](lend/DEPLOYMENTS.md) and its machine twin
[lend/deployments.robinhood-mainnet.json](lend/deployments.robinhood-mainnet.json).

## Layout

| File | What it does |
| --- | --- |
| [lend/resolve.mjs](lend/resolve.mjs) | Env-only address resolver. Throws with instructions when `MORPHO_BLUE` is unset. |
| [lend/verify.mjs](lend/verify.mjs) | On-chain proof: `owner()` + `DOMAIN_SEPARATOR()` for Morpho Blue; `asset() == USDG` for a vault. |
| [lend/discover.mjs](lend/discover.mjs) | `marketId()`, `CreateMarket` log discovery (adaptive scanner), USDG-market filtering with live state. |
| [lend/rate.mjs](lend/rate.mjs) | Reads the IRM's borrow rate and derives supply APY. Never a hardcoded number. |
| [lend/vault.mjs](lend/vault.mjs) | `depositToVault` / `redeemFromVault` (ERC-4626) and a direct-Blue `supplyToMarket`. All default to `dryRun`. |
| [index.mjs](index.mjs) | Read-only harness: resolve → prove → discover → real rates → verify vault. |
| [fork-rehearse.mjs](fork-rehearse.mjs) | Deposit → advance time → accrue → redeem, on an anvil fork. |

## Run it (read-only, no key, no spend)

```sh
npm install          # from the repo root; this is a workspace
node index.mjs           # resolve, prove, discover, read real rates
node index.mjs --top 8   # more USDG markets
node index.mjs --full    # scan CreateMarket from block 0
```

You should see `owner()` and a non-zero `DOMAIN_SEPARATOR()`, every discovered
market id recomputing from its params (the encoding proof), a table of USDG
markets with live utilization and IRM-derived supply APY, and the configured
vault verified by `asset()`.

### Addresses

`index.mjs` loads the verified record for convenience and says so. In production,
set them yourself and verify them:

```sh
export MORPHO_BLUE=0x...          # resolved from https://docs.morpho.org, proven on Blockscout
export MORPHO_IRM=0x...           # the Adaptive Curve IRM
export MORPHO_USDG_VAULT=0x...    # a curated USDG vault you chose
```

`resolveMorpho(4663)` throws if `MORPHO_BLUE` is unset — the toolkit will not
lend into an address it cannot name.

## Rehearse a supply on a fork (the only safe first spend)

```sh
anvil --fork-url https://rpc.mainnet.chain.robinhood.com --chain-id 4663 --port 8545
# in another shell:
node fork-rehearse.mjs           # AMOUNT=1000 ADVANCE_DAYS=30 by default
```

Or the bundled runner, which starts and stops anvil for you:

```sh
bash run-fork.sh
```

It funds a test account by impersonating a real USDG holder, supplies with
`dryRun:false`, advances time and calls `accrueInterest`, confirms the position's
USDG value rose, then withdraws the full share position and confirms principal +
interest came back.

**Why the direct path, not the vault path:** the curated USDG Vault V2s on this
chain gate deposits (`maxDeposit` returns `0` for an arbitrary address), so an
unwhitelisted forked account cannot use the ERC-4626 vault path. Morpho Blue's
`supply` is permissionless, so that is what the rehearsal exercises. The vault
path in `lend/vault.mjs` is the one you use once you hold a vault that admits you.
See [lend/DEPLOYMENTS.md](lend/DEPLOYMENTS.md).

## What this chain actually looks like (resolved 2026-07-21)

- **Morpho Blue** is deployed and Blockscout-verified. It is **not** the
  canonical Ethereum-mainnet address — do not copy an address from a mainnet
  tutorial.
- The USDG vaults are **Morpho Vault V2** (`vaultV2s` in the Morpho API). The
  classic MetaMorpho V1 `vaults` query is **empty** for chain 4663 — a team that
  only checks V1 wrongly concludes there are no vaults.
- **22** of 27 markets take USDG as the loan asset (collateral: TSLA, SPY, QQQ,
  USDe, SGOV, and more). Live supply APYs span ~0%–20% per market; the "around
  7%" figure is a blended headline, not any single market and not a guarantee.

See [lend/DEPLOYMENTS.md](lend/DEPLOYMENTS.md) for the full evidence.

## Safety notes

- **Morpho Blue is permissionless.** A market existing says nothing about it
  being safe — anyone can create one with a malicious oracle or IRM. Check the
  oracle, IRM, and LLTV, and prefer curated vaults whose curator you can identify.
- **Market id = `keccak256(abi.encode(marketParams))`.** Field order is
  load-bearing; `index.mjs` recomputes every id as a proof the encoding is right.
- **`supply` takes assets and shares; exactly one must be zero.** `supplyToMarket`
  pins shares to `0n` so it can only ever supply by assets.
- **USDG has 6 decimals.** Read at runtime everywhere; never hardcode 18. Vault
  *share* decimals (often 18) are unrelated and never size a deposit.
- **Shares are not assets.** Show `convertToAssets(shares)`. Redemption can be
  liquidity-limited even when your share balance is intact.
- **Lending is a spend.** Fork first, always. The plan prints before `dryRun:false`.
