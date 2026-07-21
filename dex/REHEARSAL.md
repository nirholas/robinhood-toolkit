<!-- built by nirholas x.com/nichxbt -->
<!--
  robinhood-toolkit · fork rehearsal transcript for the Uniswap v3 swap module
  Author: nirholas · https://github.com/nirholas/robinhood-toolkit
  License: All Rights Reserved (c) 2026 nirholas
-->

# Fork rehearsal — swap and slippage revert

Rehearsed against an Anvil fork of Robinhood Chain mainnet before spending any
real value, on 2026-07-21. Uniswap publishes no testnet deployment (chain
46630), so a **mainnet fork** is the safe rehearsal environment.

## Setup

```sh
anvil --fork-url https://rpc.mainnet.chain.robinhood.com --chain-id 4663 --port 8545 --silent
```

No holder impersonation was needed for this pair: the WETH anchor
(`0x0Bd7…AD73`) is a WETH9-style contract with `deposit()`, so the funded Anvil
account #0 wraps ETH into WETH directly. For a Stock Token input you would
impersonate a holder from the explorer instead (prompt 06, step 4).

Addresses came from [dex/.env.example](.env.example); the run used
[dex/swap.mjs](swap.mjs) `swapExactInputSingle` unmodified.

## (1) Successful swap — balances move, `Swap` event from the discovered pool

```
[fund] wrapped 2 ETH -> WETH on fork  |  USDG decimals=6

=== swapExactInputSingle 0.5 WETH -> USDG, fee 100, 0.5% slippage, dryRun:false ===
    quotedOut=965.729274 USDG  minOut=960.900627  gasUsed=178980
    tx=0x38fbf3b514bb44c3da172283cd33e58fdd9f3d9f009ed9f603ec8a41d77a79c0
    balances now: WETH=1.5  USDG=965.729274  (both moved ✓)
    logs from pool 0x52e65b17fb6e5ba00ed806f37afcd2daa50271ca: 1 (Swap event ✓)
```

- Both balances moved: WETH `2 → 1.5`, USDG `0 → 965.729274`.
- The receipt carries a log from `0x52e65b…71Ca` — the exact fee-100 pool
  `findPools(WETH, USDG)` returned in [DEPLOYMENTS.md](DEPLOYMENTS.md). The swap
  went through the pool we proved, not some other venue.
- `minOut` (960.900627) is strictly below `quotedOut` (965.729274), as required.
- USDG really is 6 decimals, so `965729274` raw formats as `965.729274`. Reading
  `decimals()` at runtime is what makes this correct — assuming 18 would have
  mis-scaled the output by 12 orders of magnitude.

## (2) Deliberate slippage revert — `amountOutMinimum` is enforced

The combined quote-and-execute path makes a `slippageBps: 0` order *satisfiable*
(the fresh quote equals what the swap returns on unchanged state), so a plain
0-bps run does **not** revert — a real and reassuring finding, not a failure.
To prove the router enforces the floor, we quote and then submit
`exactInputSingle` demanding **more** than the pool will give (2× the quote):

```
=== slippage protection: demand 2x the quote as amountOutMinimum -> must revert ===
    fresh quote=965.681715 USDG, demanding minOut=1931.363430 USDG
    [revert] Too little received  (amountOutMinimum enforced ✓)
```

The router reverts with **`Too little received`** — SwapRouter02's slippage
guard. An order that would return less than `amountOutMinimum` cannot execute.
This is why passing `0` (unlimited slippage) instead of a quote-derived floor is
never acceptable on the real chain.

## Takeaways carried to mainnet

- Quote and execute in one path; ~101 ms blocks make a quote go stale fast.
- Set `amountOutMinimum` from the quote every time. The sequencer is
  centralized — no L1 mempool to be sandwiched in, but ordering is a trust
  assumption, not slippage protection.
- Approve exactly the input amount, never unlimited, to the router you proved.
<!-- built by nirholas x.com/nichxbt -->
