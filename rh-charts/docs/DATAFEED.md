<!-- built by nirholas x.com/nichxbt -->
<!--
  robinhood-toolkit · why Lightweight Charts has no datafeed protocol
  Author: nirholas · https://github.com/nirholas/robinhood-toolkit
  License: All Rights Reserved (c) 2026 nirholas
-->
# Datafeed: there isn't one

**Lightweight Charts has no datafeed protocol.** There is no `Datafeed` class, no
subscription contract, no `resolveSymbol`/`getBars`/`subscribeBars`/`onReady`
callback, and no concept of a symbol. The entire data surface is two methods on a
series: `series.setData(bars)` replaces everything, and `series.update(bar)`
appends or replaces the last bar. A bar is `{ time, open, high, low, close }` (or
`{ time, value }` for line-family series), with `time` in **UNIX seconds**. That
is the whole contract. **UDF — the Universal Data Feed with its `/config`,
`/symbols`, `/search`, `/history` endpoints and `UDFCompatibleDatafeed` adapter —
belongs exclusively to TradingView Advanced Charts (the Charting Library), which
is license-banned from public repositories and is not in this toolkit.** Do not
build those endpoints, install `@tradingview/datafeed*`, or implement those
callbacks; nothing here will ever call them. Our "adapter" (`src/adapter.js`) is
entirely our own interface: a `CandleSource` fetches data, `normaliseBars` maps it
to sorted `{ time, o, h, l, c }` in seconds, and it calls `setData`/`update`.
