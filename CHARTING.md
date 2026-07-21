<!--
  robinhood-toolkit · charting paths and their limits
  Author: nirholas · https://github.com/nirholas/robinhood-toolkit
  License: All Rights Reserved (c) 2026 nirholas
-->
# Charting on Robinhood Chain

Three ways to put a chart on screen, in order of how much control you get and
how much you own the result.

## 1. Lightweight Charts — the supported path

[`site/src/charts.js`](site/src/charts.js) draws real series from your own data
using TradingView **Lightweight Charts** (Apache 2.0). You own the bundle, the
data, the theming, and the events. This is the path to build on when you need a
DEX pair charted, a multi-pair view, overlays, or realtime updates. Everything
in prompts 04 through 08 extends it.

The library's license requires TradingView be credited as the product creator
with a link to <https://www.tradingview.com/>. The built-in `attributionLogo`
layout option satisfies that and is left **on** deliberately. Do not pass
`attributionLogo: false`.

## 2. TradingView widget — CEX reference only

[`site/src/reference-widget.js`](site/src/reference-widget.js) mounts a free
TradingView embed widget. It is worth exactly one thing: a **reference chart for
the underlying asset** (`COINBASE:ETHUSD` next to your WETH pool) so a user can
tell a pair-specific move from a market-wide one.

**Widgets are CEX-only and there is no workaround.** They accept only
`EXCHANGE:SYMBOL` identifiers resolvable in TradingView's own symbol database.
They cannot render a pool address, a token address, an RPC endpoint, a subgraph,
or your own candles — nothing from Robinhood Chain or any DEX. Not with a custom
symbol string, not with a paid plan, not with a proxy. `mountReferenceWidget`
throws when handed an address rather than silently rendering an empty frame.
[`widget-ceiling-test.html`](widget-ceiling-test.html) demonstrates the limit.

The generated `tradingview-widget-copyright` element is the attribution
condition of free widget use. **Do not remove it or hide it with CSS** — hiding
is the same violation as deleting.

## 3. DexScreener iframe embed — undocumented, may break

[`site/src/dex-embed.js`](site/src/dex-embed.js) frames DexScreener's own page:

```
https://dexscreener.com/{chainId}/{pairAddress}?embed=1&theme=dark
```

This renders a live chart for a Robinhood Chain DEX pair, which is the one thing
widgets cannot do. Understand the trade:

- **Undocumented and unversioned.** DexScreener never promised these parameters
  and can remove them without notice or changelog. It worked on 2026-07-20. Treat
  a working embed as a convenience that may break on any given day.
- The chart inside is TradingView **Advanced Charts** rendered under
  DexScreener's license, which does not extend to you. You are embedding their
  page, not deploying their library. Extracting or replicating the library puts
  you in banned territory (see prompt 02).
- It is an iframe: no data out, no events, no overlays, no theming beyond the
  documented parameters. If you need any of that, build with Lightweight Charts.

`dex-embed.js` always degrades to a plain link rather than leaving an empty
frame. Ship that fallback in the first commit, not after it breaks in
production. Re-run the frameability check when it breaks:

```sh
curl -s -o /dev/null -D - \
  "https://dexscreener.com/robinhood/0x52e65B17fB6E5BA00Ed806f37Afcd2DaA50271Ca?embed=1&theme=dark" \
  | grep -iE 'HTTP/|x-frame-options|content-security-policy'
```

Expect `HTTP/2 200` with no `x-frame-options` and no `frame-ancestors`.

## Routing between them

[`site/src/reference-chart.js`](site/src/reference-chart.js) makes the choice
explicit: `prefer: 'cex'` uses the widget when a reference symbol exists and
falls through to the embed otherwise; the default `prefer: 'dex'` always embeds.

## Rule of thumb

If the requirement is charting a Robinhood Chain pool, the answer is Lightweight
Charts with your own data (supported) or the DexScreener iframe (convenience,
may break). Widgets are for market context only, and their prices are exchange
mid prices — never present a `COINBASE:ETHUSD` line as your pool's price.
<!-- built by nirholas x.com/nichxbt -->
