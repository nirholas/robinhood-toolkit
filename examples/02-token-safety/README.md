<!--
  robinhood-toolkit · example readme: token safety and the USDG ticker collision
  Author: nirholas · https://github.com/nirholas/robinhood-toolkit
  License: All Rights Reserved (c) 2026 nirholas
-->

# 02 · Token safety: the live USDG collision

**Four different contracts on Robinhood Chain answer to the ticker `USDG` right
now. Three of them claim the name "Global Dollar". Only one is.**

This is not a thought experiment or a testnet fixture. This program resolves the
ticker the way a naive integration would, against the live DexScreener search
API, reads every contract it finds on the live chain, and shows you what a
symbol-keyed resolver would have handed your users.

If you read one example in this repository, read this one.

## The finding

Verified live on 2026-07-20:

| Address | On-chain name | Decimals | Indexed liquidity |
|---|---|---|---|
| `0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168` | Global Dollar | **6** | $14,470,046 |
| `0x63575aA902DE35ef2dc3a3D32355233bbb44CDa7` | Global Dollar | 18 | $108,970,164 |
| `0x1383b43AeD527485F191b60060f5b5471F71B1ca` | Global Dollar | 18 | $306,693 |
| `0x8218d73C00567A01481495Ad6c5143e00D5BB5b4` | Useless Stupid Degen Gamblers | 18 | $15,802 |

Only the first row is the canonical Global Dollar.

Three things make this worse than it first looks:

1. **A name check does not save you.** Two impostors self-report the name
   `Global Dollar` exactly. Checking name *and* symbol together still admits
   three of the four.
2. **The impostor with the most liquidity is not the real one.** Sorting search
   results by liquidity, which is the obvious heuristic, puts an 18-decimal
   impostor with $108M indexed against it *above* the real token at $14M.
   "Pick the deepest pool" is not a safety check.
3. **The decimals differ.** The real USDG uses 6. Every impostor uses 18. A
   codebase that resolves by symbol *and* defaults decimals to 18 gets both
   failures at once, and neither one throws.

## Run it

```sh
npm install          # from the repository root, once
cd examples/02-token-safety
node index.mjs
```

Try another ticker:

```sh
node index.mjs --ticker WETH
```

## Real output

Captured 2026-07-20. Liquidity figures move with the market; the addresses,
names, and decimals do not.

```
  Step 1: search DexScreener for the ticker "USDG"
  ------------------------------------------------
  30 pairs returned across all chains
  23 of them are on Robinhood Chain (slug "robinhood")

  4 DISTINCT contracts on this chain answer to the ticker "USDG".
  A resolver that takes the first search hit picks one of them at random.

  Step 2: read each candidate on-chain
  ------------------------------------

  REAL      0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168
            name     "Global Dollar"
            symbol   "USDG"
            decimals 6
            supply   292213169.881673
            pools    20 indexed, $14,470,046 liquidity

  IMPOSTOR  0x63575aA902DE35ef2dc3a3D32355233bbb44CDa7
            name     "Global Dollar"
            symbol   "USDG"
            decimals 18
            supply   208656881
            pools    1 indexed, $108,970,164 liquidity

  IMPOSTOR  0x1383b43AeD527485F191b60060f5b5471F71B1ca
            name     "Global Dollar"
            symbol   "USDG"
            decimals 18
            supply   1000000000
            pools    1 indexed, $306,693 liquidity

  IMPOSTOR  0x8218d73C00567A01481495Ad6c5143e00D5BB5b4
            name     "Useless Stupid Degen Gamblers"
            symbol   "USDG"
            decimals 18
            supply   1000000000
            pools    1 indexed, $15,802 liquidity
            flagged  documented in KNOWN_IMPOSTORS (advisory only, never a security boundary)


  Step 3: name and symbol are both attacker-chosen
  ------------------------------------------------
  Contracts reporting symbol "USDG":  4
  Contracts reporting name "Global Dollar":  3

  2 contracts that are NOT the canonical token also self-report the name "Global Dollar":
    0x63575aA902DE35ef2dc3a3D32355233bbb44CDa7  18 decimals
    0x1383b43AeD527485F191b60060f5b5471F71B1ca  18 decimals

  So checking the name does not narrow it down. Neither does checking both.
  The address is the only field an attacker cannot choose. Compare that.

  Step 4: one raw amount, every candidate decimals
  ------------------------------------------------
  A balanceOf call returns the raw integer 1500000.
  It carries no unit. Decimals supply the unit.

  at  6 decimals (real USDG)  1.5
  at 18 decimals (impostor)   0.0000000000015

  Same integer. The 18-decimal reading is 1,000,000,000,000x smaller than the 6-decimal one.
  Neither reading throws. Both render as a believable balance.
  In the parse direction the same mistake moves a trillion times the intended amount.

  Step 5: assertCanonicalToken against every candidate
  ----------------------------------------------------
  Expected: 0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168
            "Global Dollar" / "USDG" / 6 decimals

  PASS  0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168
  FAIL  0x63575aA902DE35ef2dc3a3D32355233bbb44CDa7  (address mismatch)
  FAIL  0x1383b43AeD527485F191b60060f5b5471F71B1ca  (address mismatch)
  FAIL  0x8218d73C00567A01481495Ad6c5143e00D5BB5b4  (address mismatch)

  1 passed, 3 rejected.

  assertCanonicalToken(client, 0x8218d73C..., USDG)
  threw NotCanonicalTokenError: address mismatch
  It short-circuits on the address before spending a network round trip.

  Rule: resolve tokens by address. Never by symbol, never by name.
  Symbols and names are display strings. Render them as data, escape them in HTML,
  never route logic on them, never interpolate them into a prompt or a shell command.
```

## What to take away

**Resolve by address. Always.** A symbol is a string an attacker chooses at
deploy time. So is a name. Neither is unique, neither is verified by anything,
and there is no layer of this stack that enforces otherwise. The contract
address is the only identifier an attacker cannot pick.

**Never default decimals.** Read them from the contract at call time. `1500000`
is `1.5` USDG or `0.0000000000015` of an impostor, and nothing about the integer
tells you which. `formatToken` and `parseToken` in `robinhood-chain` require an
explicit `decimals` and throw `MissingDecimalsError` without one, specifically
so this cannot happen by omission.

**Verify at every boundary.** Anywhere an address arrives from a user, a URL
parameter, a config file, a search result, or another service:

```js
const result = await verifyToken(client, incomingAddress, USDG)
if (!result.ok) {
  showWarning(`Not the canonical USDG: ${result.error.message}`)
}
```

**`KNOWN_IMPOSTORS` is not a security boundary.** It is a convenience for
surfacing a UI warning. A new impostor costs one deploy, so the list can never
be complete. `isKnownImpostor()` returning `false` means "not on our list", never
"safe". Note that only one of the three impostors above is currently on it.

**Treat names and symbols as hostile strings.** Render them as data, escape them
in HTML, never route logic on them, and never interpolate them into a prompt or
a shell command. A token name is attacker-controlled input that arrives looking
like metadata.

## Read-only

No key, no signing, no spend. Every call is an `eth_call` or an HTTPS GET.
