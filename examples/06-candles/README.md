<!--
  robinhood-toolkit · example readme: OHLCV candles in the terminal
  Author: nirholas · https://github.com/nirholas/robinhood-toolkit
  License: MIT (c) 2026 nirholas
-->

# 06 · Candles

Fetch OHLCV bars for a Robinhood Chain pool from GeckoTerminal, draw them as a
candlestick chart in the terminal, then confirm the last close against the pool's
live on-chain `slot0` price so the chart is never the only source in the room.

## Five things about this API that cost time to discover

Verified live on 2026-07-20.

**1. Rows come back newest first.** Plot them in the order given and your chart
runs backwards, which still looks like a plausible chart. Reverse them.

**2. Timestamps are in seconds, not milliseconds.** Passing them straight to
`new Date()` lands you in January 1970.

**3. There is no `15m` timeframe.** The path segment is a base timeframe
(`minute`, `hour`, `day`) and the bar width comes from `?aggregate=N`. Fifteen
minute bars are `minute` + `aggregate=15`.

**4. Prices default to USD, not to the quote token.** This one is the trap. For
this pool the USD series reads about `3.0e-5` while the quote-denominated series
reads about `1.58e-8`, roughly 1,900x apart. Compare a USD bar against an
on-chain `slot0` price and you get a ~100% "drift" that looks exactly like a bug
in your price math. It is a unit mismatch. Pass `currency=token` to price in the
quote token, which is what `slot0` gives you.

This example defaults to `currency=token` so the chart and the chain are directly
comparable, and it refuses to run the on-chain check at all under
`--currency usd` rather than printing a meaningless drift figure.

**5. The rate limit is roughly 30 requests per minute** on the free tier. This
program enforces a 2.1 second floor between calls rather than discovering the
limit as a 429 in production, and handles a 429 explicitly if one arrives anyway.

## About the default pool

The default pool pairs WETH against the **impostor** "USDG" at
`0x8218d73C00567A01481495Ad6c5143e00D5BB5b4`, on-chain name "Useless Stupid Degen
Gamblers". **It is not the canonical Global Dollar.** It is chosen because it has
continuous real volume, and the program identifies both tokens on-chain and
labels them by what they verifiably are rather than by their tickers. Note the
`IMPOSTOR` tag in the header line of the output below.

## Run it

```sh
npm install          # from the repository root, once
cd examples/06-candles
node index.mjs
```

Options:

```sh
node index.mjs --pool 0xPoolAddress
node index.mjs --timeframe hour --aggregate 4 --limit 48
node index.mjs --currency usd     # USD bars; skips the on-chain cross-check
```

## Real output

Captured 2026-07-20:

```
  USDG (IMPOSTOR: "Useless Stupid Degen Gamblers") / WETH (canonical WETH)
  Pool 0x95f9B0AF9282A22F7ef57058e65098db3f667f95
  Base 0x8218d73C00567A01481495Ad6c5143e00D5BB5b4
  48 bars of 15 minute, priced in WETH (currency=token)
  2026-07-20T06:15:00.000Z  ..  2026-07-20T21:15:00.000Z

  2.18448e-8 |       |
             |       ||                       |
             |       #@                       #@ ##@
             |       #@@                      #@@# @
  1.90207e-8 |       # @                     |#    @
             |       # @@                    ##    @
             |       #  @                   ##     @@@
             |       #  @@#@@@ |            #|       @@
  1.61966e-8 |   #@###      |@ #@|          #         @@@@  #@
             |#@##@# |       @@#@#@@@@      #            @@@#@
             |                @#     @      #
             |                       @@     #
  1.33725e-8 |                        @     #
             |                        @@    #
             |                         @    #
             |                         @@  ##
  1.05484e-8 |                          @###
  9.84236e-9 |                           |
             +------------------------------------------------
              06:15                                     21:15 UTC

  # rising bar   @ falling bar   | wick

  open    1.53872e-8
  close   1.56471e-8
  high    2.18448e-8
  low     9.84236e-9
  change  +1.69% over 48 bars
  bars    18 rising, 30 falling
  volume  9.74 (quote units, per the feed)

  Last bar close  1.56471e-8  (GeckoTerminal)
  Live pool price 1.57798e-8  (slot0, read just now)
  Drift 0.85%

  The last bar is still open, so some drift is expected and healthy.
  A chart is a convenience. The chain is the source of truth: settle
  every number that moves money against slot0, never against a feed.
```

Sub-1% drift between an aggregator's last bar and a `slot0` read is what healthy
looks like: the last bar is still open, so it lags a live price slightly. Drift
above 25% triggers an explicit unit-mismatch warning, because at that magnitude
the cause is almost never staleness.

## Notes

**Prices here run to `1e-8`.** The axis and summary use significant-figure
formatting rather than fixed decimal places, because `toFixed(4)` renders every
one of these bars as `0.0000`.

**Volume is reported in quote units by the feed**, and is labelled as such rather
than presented as a dollar figure it is not.

**The chart is a convenience, the chain is the source of truth.** Settle anything
that moves money against `slot0`, never against an aggregator's last bar. See
[example 05](../05-price-from-pool/) for deriving that price correctly.

## Read-only

No key, no signing, no spend. One HTTPS GET plus one `eth_call` batch.
