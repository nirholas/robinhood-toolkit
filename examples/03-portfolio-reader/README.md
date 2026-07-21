<!--
  robinhood-toolkit · example readme: portfolio reader
  Author: nirholas · https://github.com/nirholas/robinhood-toolkit
  License: All Rights Reserved (c) 2026 nirholas
-->

# 03 · Portfolio reader

Read any address's native ETH balance plus its balance in every known token,
batched through Multicall3 so the whole portfolio costs two round trips instead
of one per token per field.

## What it demonstrates

- **Multicall3 batching.** Balance, decimals, symbol, and name for every token
  travel in a single `aggregate3` call. Nine reads, two round trips.
- **Decimals read at call time**, in the same multicall as the balance, so the
  two can never disagree. Never assumed, never defaulted to 18. USDG uses 6.
- **`allowFailure: true`**, so one unreadable address cannot void the whole
  batch. Tokens that fail to read are reported as unreadable rather than
  silently dropped.
- **Canonical verification before display.** Every known token is proven against
  its constant with `verifyToken` before its balance appears under a trusted
  ticker. See [example 02](../02-token-safety/) for why that matters.
- **A designed empty state.** A fresh address gets an explanation and a next
  step, not a blank screen.

## Run it

```sh
npm install          # from the repository root, once
cd examples/03-portfolio-reader
node index.mjs                                    # a live pool with real balances
node index.mjs 0xYourAddress
node index.mjs 0xYourAddress 0xExtraTokenAddress  # check additional tokens
```

Addresses are accepted in any casing. They do not need a valid EIP-55 checksum,
because addresses get pasted from explorers and chat with the casing mangled.

## Real output

Captured 2026-07-20. The default subject is the WETH/USDG Uniswap v3 pool at
`0x8803c117ccae7B5146297876c2A25DF135141C4d`, a contract rather than a personal
wallet, chosen because it holds a real balance of both known tokens.

```
  Portfolio  0x8803c117ccae7B5146297876c2A25DF135141C4d
  Chain      Robinhood Chain (4663)
  Explorer   https://robinhoodchain.blockscout.com/address/0x8803c117ccae7B5146297876c2A25DF135141C4d

  Block 15,022,962

  ASSET                 BALANCE  DETAIL
  -----  ----------------------  ----------------------------------------
  ETH                         0  native gas token
                                 zero
  WETH   575.828437193598924587  0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73  18 decimals
  USDG           1096947.270145  0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168  6 decimals

  9 reads in 2 round trips (1 eth_getBalance + 1 Multicall3 aggregate).
  Decimals came from the contracts, not from a constant:
    WETH 18, USDG 6 (assuming 18 for USDG understates it by 10^12)
```

The empty-wallet path, on an address with no activity:

```
  Portfolio  0x9f2C4A8B7d6e1F0C3b5a8e7D6c4b2A1f0e9D8c7b
  Chain      Robinhood Chain (4663)
  Explorer   https://robinhoodchain.blockscout.com/address/0x9f2C4A8B7d6e1F0C3b5a8e7D6c4b2A1f0e9D8c7b

  Block 15,022,968

  This address holds no ETH and no balance in any of the tokens checked.

  Tokens checked: WETH, USDG

  That is expected for a fresh address. To see the populated output:

    node index.mjs                       # a live pool with real balances
    node index.mjs 0x9f2C4A8B7d6e1F0C3b5a8e7D6c4b2A1f0e9D8c7b 0xOtherToken   # check additional tokens

  To fund an address on TESTNET, use the faucet:
    https://faucet.testnet.chain.robinhood.com

  Bridging to mainnet is a write action. This example never signs anything.
  Run that from your own terminal with your own key.
```

Note the USDG line in the populated output: `1096947.270145` has six decimal
places, not eighteen. Formatting that same raw integer with an 18 exponent would
have printed `0.000001096947270145` and looked like a rounding artifact rather
than a million dollars.

## Notes

**viem's `multicall()` throws without `contracts.multicall3`.** It raises
`ChainDoesNotSupportContract` before sending anything and does not fall back to
individual `eth_call`s. Both `robinhood-chain` definitions declare it, and this
example confirms the bytecode is deployed with `hasMulticall3()` before relying
on it.

**Adding tokens.** Pass extra addresses on the command line. They are read the
same way, but they are not verified against any constant, so they are labelled
`unverified (not in the curated set, resolve it yourself)`. Resolve unknown
addresses before trusting what they claim to be.

## Read-only

No key, no signing, no spend. Bridging and funding are write actions; this
example prints the faucet URL and stops rather than doing anything with a key.
