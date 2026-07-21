<!--
  robinhood-toolkit · Uniswap deployment audit trail for Robinhood Chain
  Author: nirholas · https://github.com/nirholas/robinhood-toolkit
  License: All Rights Reserved (c) 2026 nirholas
-->

# Uniswap deployments on Robinhood Chain — resolved and proven

Every address below was **resolved from an official Uniswap source** and then
**proven on-chain** with [dex/check.mjs](check.mjs) against the public RPC. None
of these were taken from a blog post, a chat message, or a generated snippet. Do
not add an address here you have not put through the step-2 checks yourself.

- **Resolved:** 2026-07-21
- **On-chain verification:** 2026-07-21T06:22:54Z (mainnet, chain 4663)
- **RPC:** `https://rpc.mainnet.chain.robinhood.com` → `eth_chainId` = `0x1237` (4663)
- **Explorer:** <https://robinhoodchain.blockscout.com>

## Source of truth

Uniswap's published documentation lists Robinhood Chain among its supported v3
and v4 deployment chains. The machine-readable source-of-truth is the Uniswap
docs repository, whose per-chain deployment tables render at
developers.uniswap.org:

- v3 (core + periphery + swap-router): `Uniswap/docs` →
  `content/protocols/v3/deployments/v3-robinhood-chain-deployments.mdx`
  — renders at
  <https://developers.uniswap.org/contracts/v3/reference/deployments/robinhood-deployments>
- v4 (PoolManager + periphery): `Uniswap/docs` →
  `content/protocols/v4/deployments.mdx`, section **“Robinhood Chain: 4663”**
  — renders at <https://developers.uniswap.org/contracts/v4/deployments>
- Universal Router deploy-addresses index:
  <https://github.com/Uniswap/universal-router/tree/main/deploy-addresses>

The `@uniswap/sdk-core` npm package does **not** carry chain 4663 in its address
maps (expected — the chain is newer than the published SDK), so
[dex/resolve.mjs](resolve.mjs) falls back to the env overrides in
[dex/.env.example](.env.example), which hold the docs-confirmed values below.

## Mainnet — chain 4663

The docs note these were deployed from `@uniswap/v3-core@1.0.0`,
`@uniswap/v3-periphery@1.0.0`, and `@uniswap/swap-router-contracts@1.1.0`.

### v3 (core + periphery)

| Contract | Address | Env var |
| --- | --- | --- |
| UniswapV3Factory | `0x1f7d7550b1b028f7571e69a784071f0205fd2efa` | `UNI_V3_FACTORY` |
| SwapRouter02 | `0xcaf681a66d020601342297493863e78c959e5cb2` | `UNI_SWAP_ROUTER_02` |
| QuoterV2 | `0x33e885ed0ec9bf04ecfb19341582aadcb4c8a9e7` | `UNI_QUOTER_V2` |
| NonfungiblePositionManager | `0x73991a25c818bf1f1128deaab1492d45638de0d3` | — |
| UniswapInterfaceMulticall | `0x282a3c4d320cc7f0d5eaf56b8029e4b88338f0a3` | — |
| TickLens | `0x7dfd4f31be6814d2906bde155c3e1b146eac1468` | — |
| NonfungibleTokenPositionDescriptor | `0x6f84dae9c064ff453e5c8af51efb819f8f610225` | — |
| NFTDescriptor | `0x2e9d45bb7b30549f5216813ada9a6b7982c5b3ed` | — |

### v4 + shared

| Contract | Address | Env var |
| --- | --- | --- |
| Universal Router | `0x8876789976decbfcbbbe364623c63652db8c0904` | `UNI_UNIVERSAL_ROUTER` |
| Permit2 | `0x000000000022D473030F116dDEE9F6B43aC78BA3` | `UNI_PERMIT2` |
| v4 PoolManager | `0x8366a39cc670b4001a1121b8f6a443a643e40951` | `UNI_V4_POOL_MANAGER` |
| v4 PositionManager | `0x58daec3116aae6d93017baaea7749052e8a04fa7` | — |
| v4 Quoter | `0x8dc178efb8111bb0973dd9d722ebeff267c98f94` | — |
| v4 StateView | `0xf3334192d15450cdd385c8b70e03f9a6bd9e673b` | — |
| v4 PositionDescriptor | `0x9639443158e8c5efa35bd45287bf2effd3d8dc06` | — |

The Universal Router address is identical on the v3 and v4 docs pages, an
independent cross-check. Permit2 is at its canonical cross-chain address.

> **v4 is a different animal.** These v4 addresses are recorded for completeness.
> The swap code in this toolkit is **v3 only** (SwapRouter02 + QuoterV2). v4
> routes through the PoolManager and the Universal Router with Permit2
> approvals — a different calldata and approval model entirely. A verified v3
> address tells you nothing about how to call v4.

## Anchors (not Uniswap addresses)

These are the fixed points [dex/verify.mjs](verify.mjs) checks a resolved router
against. Both were independently verified on chain 4663 by prompts 04 and 06.

| Token | Address | Decimals |
| --- | --- | --- |
| WETH | `0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73` | 18 |
| USDG | `0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168` | **6** |

USDG is 6 decimals, WETH is 18. This is exactly why the swap module reads
`decimals()` for both tokens at runtime and never assumes an exponent.

## Step-2 on-chain proof (output of `node --env-file=dex/.env dex/check.mjs`)

All checks passed against the live mainnet RPC on 2026-07-21:

```
resolved: {
  "chainId": 4663,
  "v3Factory": "0x1f7d7550B1b028f7571E69A784071F0205FD2EfA",
  "swapRouter02": "0xCaf681a66D020601342297493863E78C959E5cb2",
  "quoterV2": "0x33e885eD0Ec9bF04EcfB19341582aADCb4c8A9E7",
  "v2Factory": null,
  "universalRouter": "0x8876789976dEcBfCbBbe364623C63652db8C0904",
  "permit2": "0x000000000022D473030F116dDEE9F6B43aC78BA3",
  "v4PoolManager": "0x8366a39CC670B4001A1121B8F6A443A643e40951"
}

verified ✓ (bytecode, router.factory(), router.WETH9())
  verifiedAt: 2026-07-21T06:22:54.077Z

WETH/USDG pools (4):
  fee 100:   pool 0x52e65B17fB6E5BA00Ed806f37Afcd2DaA50271Ca  liquidity 833940720674558884
  fee 500:   pool 0x69BfaF19C9f377BB306a89aEd9F6B07e2c1a8d9a  liquidity 418872598211232713
  fee 3000:  pool 0xa9188730Fe85Be88ad499D7d52B099e800fB0334  liquidity 41705536824429230
  fee 10000: pool 0x5f009E071F07e92B6C624e83F52F17bBDa34680D  liquidity 0
```

What each line proves:

1. **Bytecode present** at v3Factory, SwapRouter02, and QuoterV2 (`getCode` ≠ `0x`).
2. **`router.factory()`** returned `0x1f7d…2EfA`, equal to the resolved
   UniswapV3Factory. The router and factory belong to the same deployment.
3. **`router.WETH9()`** returned `0x0Bd7…AD73`, equal to the WETH anchor
   independently verified for chain 4663. This is the strongest single signal
   that this is the real router for this chain.
4. **`findPools(WETH, USDG)`** returned four pools; every one has `token0` =
   WETH anchor and `token1` = USDG anchor. Three fee tiers (100, 500, 3000) carry
   liquidity; the 10000 tier exists but is empty — do not assume a tier, discover it.

## No Uniswap address is a literal in the code

Verified: no Uniswap address appears hardcoded in any `dex/*.mjs` source file.
resolve.mjs pulls from env (or the SDK); the addresses live only in
[dex/.env.example](.env.example) and in this document. The only hardcoded
addresses in code are the WETH/USDG anchors in verify.mjs, which are not Uniswap
addresses.

```
$ grep -rIn "0x[0-9a-fA-F]\{40\}" dex/*.mjs
dex/verify.mjs: WETH_ROBINHOOD_MAINNET = getAddress("0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73")
dex/verify.mjs: USDG_ROBINHOOD_MAINNET = getAddress("0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168")
```

## Testnet — chain 46630

Uniswap publishes **no** deployment for the Robinhood testnet as of 2026-07-21.
There is no `v3-robinhood-testnet` docs page and no `46630` row in the v4
deployments table. `resolveUniswap(46630)` therefore throws by design — do not
invent testnet addresses. Rehearse on a **mainnet fork** instead — see
[dex/REHEARSAL.md](REHEARSAL.md) for a transcript.
