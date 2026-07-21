<!--
  robinhood-toolkit · example readme: pool price from sqrtPriceX96
  Author: nirholas · https://github.com/nirholas/robinhood-toolkit
  License: All Rights Reserved (c) 2026 nirholas
-->

# 05 · Price from a Uniswap v3 pool

Read a pool's `slot0`, derive the price from `sqrtPriceX96` using integer math
from end to end, then cross-validate the result against DexScreener's
independently reported `priceNative`. Two sources that computed the same number
by different routes is the only real check on price code.

The program exits non-zero if the two disagree by more than 5%.

## Why BigInt, specifically

The Uniswap v3 price is `sqrtPriceX96^2 / 2^192`, adjusted for the decimals of
both tokens. That numerator is a 384-bit integer. There are two obvious
translations and both are wrong.

**Integer division without scaling truncates the answer to zero:**

```js
sqrtPriceX96 * sqrtPriceX96 / (2n ** 192n)   // 63372214  (fraction discarded)
(2n ** 192n) / (sqrtPriceX96 * sqrtPriceX96) // 0         (the entire answer)
```

Any price below 1 becomes exactly `0`. For this pool one direction of the pair
is `1.58e-8`, so the naive inversion returns zero and takes the answer with it.

**Float math sheds precision silently:**

```js
Number(sqrtPriceX96) ** 2 / Number(2n ** 192n)  // 63372214.98322382
```

That looks fine, which is what makes it dangerous. Everything past the 17th
significant digit is already gone before you notice.

**The fix is to multiply by a scale factor before dividing, never after:**

```js
const SCALE = 10n ** 30n
const numerator = sqrtP * sqrtP * SCALE * 10n ** BigInt(decimals0)
const denominator = (2n ** 192n) * 10n ** BigInt(decimals1)
const price = numerator / denominator   // fixed point, exact to 30 places
```

Both directions, the DexScreener comparison, and the divergence in basis points
are all computed in that fixed point. No float is used anywhere a number matters.

## About the default pool

`0x95f9B0AF9282A22F7ef57058e65098db3f667f95` pairs WETH against the **impostor**
"USDG" at `0x8218d73C00567A01481495Ad6c5143e00D5BB5b4`, whose on-chain name is
"Useless Stupid Degen Gamblers". **It is not the canonical Global Dollar.**

It is a real pool with real volume, which is what makes it a valid price
exercise, and the program labels every token by address rather than by ticker.

The irony is the lesson. A price feed that resolved "USDG" by ticker would have
computed this exact number, correctly, and published a memecoin quote as a dollar
stablecoin price. Every figure in its output would have looked reasonable. See
[example 02](../02-token-safety/) for the four tokens competing for that ticker.

## Run it

```sh
npm install          # from the repository root, once
cd examples/05-price-from-pool
node index.mjs
```

Options:

```sh
node index.mjs --pool 0xPoolAddress
node index.mjs --tolerance 2      # max divergence in percent, default 5
```

## Real output

Captured 2026-07-20. Prices move; the 0-to-6 basis point agreement is the part
that should hold.

```
  Pool  0x95f9B0AF9282A22F7ef57058e65098db3f667f95
  Chain Robinhood Chain (4663)

  Step 1: what is actually in this pool
  -------------------------------------
  token0  0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73
          name     "WETH"
          symbol   "WETH"  <- display only, not an identifier
          decimals 18
          status   canonical WETH
  token1  0x8218d73C00567A01481495Ad6c5143e00D5BB5b4
          name     "Useless Stupid Degen Gamblers"
          symbol   "USDG"  <- display only, not an identifier
          decimals 18
          status   IMPOSTOR, squats the ticker of 0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168

  fee tier  1%
  tick      179654
  sqrtP     630708998387126269638003602369296
            (109 bits; squared it is 218 bits, well past a float's 53)

  Step 2: the two failure modes, shown before the fix
  ---------------------------------------------------
  a) BigInt division without scaling first:
       (sqrtP^2) / 2^192            = 63372214
       (2^192) / (sqrtP^2)          = 0
     Integer division discards the fraction. One direction of this pair
     is below 1 and truncates to exactly 0, taking the answer with it.

  b) float math:
       Number(sqrtP)^2 / Number(2^192) = 63372214.98322382
     It produces a plausible number here, which is what makes it dangerous.
     Precision past the 17th significant digit is already gone, and for a
     small enough price the leading digits go with it.

  Step 3: BigInt from end to end
  ------------------------------
  1 WETH (0x0Bd7D308...) = 63372214.983223819121343913 USDG
  1 USDG (0x8218d73C...) = 0.000000015779786145 WETH

  Step 4: cross-validate against DexScreener
  ------------------------------------------
  base      0x8218d73C00567A01481495Ad6c5143e00D5BB5b4  (token1)
  quote     0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73  (token0)

  ours      0.000000015779786145
  theirs    0.00000001577   (DexScreener priceNative)

  divergence 0.0600%  (6 basis points)
  tolerance  5%

  DexScreener also reports $0.00003006 per base token.
  Pool liquidity $15,761.

  For reference, the unscaled float path gives 1.577978614546966e-8 in this direction.

  Agreement within tolerance. Two independent derivations, the same price.

  Note: 0x8218d73C00567A01481495Ad6c5143e00D5BB5b4
  reports the ticker "USDG" but its on-chain name is
  "Useless Stupid Degen Gamblers". It is not the canonical token at
  0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168.

  The price above is correct. It is the correct price OF A MEMECOIN.
  A feed that resolved this pool by ticker would have published it as a
  dollar stablecoin quote, and nothing in the output would have looked wrong.
```

The divergence path, forced with `--tolerance 0`:

```
  Divergence of 0.0600% exceeds the 0% tolerance.
  Two independent sources disagree about this price. Do not trade on it.
  Likely causes: a stale slot0 on a thin pool, a mid-block read during a large swap,
  or a decimals mismatch between the pool tokens and what was assumed.
```

Exit code `1`.

## Notes

**`priceNative` is the base token priced in the quote token.** Which of `token0`
and `token1` DexScreener calls the base is its choice, not the pool's. This
example matches on address rather than assuming an ordering, which is the same
discipline as everything else here.

**DexScreener keys this chain by the string slug `robinhood`.** Passing the
numeric chain ID `4663` returns nothing, silently.

**Decimals come from both token contracts.** The exponent difference between the
two tokens is the whole calculation. Assuming 18 on a pair where one side uses 6
misprices by 10^12 and still returns a number.

**A stale or thin pool can be genuinely wrong.** The cross-validation exists
because a pool with little liquidity can hold a `slot0` price nobody would trade
at. Two independent sources agreeing is the check; one source is an assertion.

## Read-only

No key, no signing, no spend. Every call is an `eth_call` or an HTTPS GET.
