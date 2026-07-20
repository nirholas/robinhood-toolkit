<!--
  robinhood-toolkit · build prompt: Lightweight Charts setup and licensing
  Author: nirholas · https://github.com/nirholas/robinhood-toolkit
  License: MIT (c) 2026 nirholas
-->

# 02 · Lightweight Charts setup

## Goal

Stand up TradingView Lightweight Charts v5 in a Vite project, render a
candlestick series with a volume pane, and ship the attribution the license
requires. End state: a reusable `createPriceChart()` factory that every later
prompt in this track mounts data into.

This prompt also settles the licensing question up front so you do not waste a
week applying for a library you cannot legally use.

## Prerequisites

- Node 20+ and npm.
- A browser. Lightweight Charts renders to canvas and needs a DOM.
- Nothing from TradingView. No account, no application, no key.

## Reference facts (verified)

- Package: `lightweight-charts`, **version 5.2.0**, license **Apache-2.0**,
  author TradingView, Inc. Confirmed against the npm registry on 2026-07-20.
- **This is the only TradingView charting product you can use in a public
  repository.** See the licensing section below.
- v5 changed how series are created. `chart.addCandlestickSeries()` is **gone**.
  The v5 signature, confirmed in the shipped `typings.d.ts`:

  ```ts
  addSeries<T extends SeriesType>(
    definition: SeriesDefinition<T>,
    options?: SeriesPartialOptionsMap[T],
    paneIndex?: number
  ): ISeriesApi<T>
  ```

  Series definitions are named exports: `CandlestickSeries`, `LineSeries`,
  `AreaSeries`, `HistogramSeries`, `BaselineSeries`. Markers moved to a
  standalone `createSeriesMarkers(series, markers)` function.
- Timestamps are **UNIX seconds**, not milliseconds. A business-day string
  (`'2026-07-20'`) is also accepted for daily and slower series.
- `layout.attributionLogo` exists and defaults to `true`. The typings state
  outright that displaying it satisfies the license's linking requirement.

### Licensing: read this before you build

**Lightweight Charts is Apache-2.0, but attribution is still mandatory.** The
project README requires that you name TradingView as the product creator and
link to <https://www.tradingview.com/>. Apache-2.0 separately requires you keep
the `NOTICE` content. Two ways to comply:

1. **Leave `attributionLogo: true`** (the default). The built-in logo links out
   and satisfies the requirement. This is the path of least effort. Do not
   disable it casually.
2. **Disable it and place the notice yourself**, visibly, near the chart:

   ```
   TradingView Lightweight Charts™ Copyright (с) 2025 TradingView, Inc. https://www.tradingview.com/
   ```

Pick one. Shipping with the logo off and no notice anywhere is a license
violation, and it is the default outcome if someone turns the logo off for
aesthetics without reading this.

**TradingView Advanced Charts (the Charting Library) is banned from public
repositories.** Its license, section 2.5, states that the Advanced Charts
Library "shall not be hosted, disclosed, or made accessible in any public code
repository", and further requires that the project using it not be open source.
This toolkit is MIT on public GitHub, so Advanced Charts is categorically
unusable here, and so is any tutorial that tells you to vendor
`charting_library/` into your repo. Consequences that follow, and that you
should internalise now:

- Do not apply for Advanced Charts for an open-source project. It will not help.
- Ignore every tutorial mentioning `charting_library`, `Datafeeds.UDFCompatibleDatafeed`,
  or a `/config`, `/symbols`, `/history` backend. That is the Advanced Charts
  world. None of it applies to Lightweight Charts. See prompt 04, which exists
  specifically because this confusion is so common.
- Lightweight Charts has **no** symbol search, no built-in indicator suite, no
  drawing tools, and no datafeed interface. It draws series you hand it. If you
  need those features you build them or you use a different product.

## Steps

### 1. Scaffold

```sh
npm create vite@latest rh-charts -- --template vanilla
cd rh-charts
npm install
npm install lightweight-charts@^5.2.0
node -e "console.log(require('lightweight-charts/package.json').version)"   # 5.2.0
```

### 2. Ship the NOTICE file

Apache-2.0 requires the notice travel with redistributions. Create `NOTICE` at
your project root:

```
This product includes software developed by TradingView, Inc.

TradingView Lightweight Charts™ Copyright (с) 2025 TradingView, Inc. https://www.tradingview.com/
Licensed under the Apache License, Version 2.0.
```

Do this now, not later. It takes ten seconds and it is the part everyone skips.

### 3. Write the chart factory

`src/chart.js`:

```js
/**
 * robinhood-toolkit · Lightweight Charts factory
 * Author: nirholas · https://github.com/nirholas/robinhood-toolkit
 * License: MIT (c) 2026 nirholas
 *
 * Charting by TradingView Lightweight Charts™ (Apache-2.0).
 * TradingView Lightweight Charts™ Copyright (с) 2025 TradingView, Inc.
 * https://www.tradingview.com/
 */
import {
  createChart,
  CandlestickSeries,
  HistogramSeries,
  CrosshairMode,
} from 'lightweight-charts';

const MONO = {
  bg: '#0a0a0a',
  text: '#a1a1a1',
  grid: '#1a1a1a',
  border: '#262626',
  up: '#d4d4d4',
  down: '#525252',
  volume: 'rgba(115,115,115,0.4)',
};

/**
 * Mount a candlestick chart with an attached volume pane.
 *
 * @param {HTMLElement} container
 * @param {object} [opts]
 * @param {boolean} [opts.volume=true]  render the volume histogram
 * @param {number}  [opts.height=420]
 * @param {number}  [opts.priceDecimals=6]  low-priced tokens need more places
 * @returns {{
 *   chart: import('lightweight-charts').IChartApi,
 *   candles: import('lightweight-charts').ISeriesApi<'Candlestick'>,
 *   volume: import('lightweight-charts').ISeriesApi<'Histogram'>|null,
 *   setData: (bars: Array<object>) => void,
 *   update:  (bar: object) => void,
 *   fit: () => void,
 *   destroy: () => void,
 * }}
 */
export function createPriceChart(container, opts = {}) {
  const { volume = true, height = 420, priceDecimals = 6 } = opts;

  const chart = createChart(container, {
    height,
    // Width 0 makes the chart size itself to the container. Combined with the
    // ResizeObserver below this handles flex/grid layouts correctly.
    width: 0,
    autoSize: true,
    layout: {
      background: { color: MONO.bg },
      textColor: MONO.text,
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
      fontSize: 11,
      // LICENSE: leave this true, or place the NOTICE text visibly yourself.
      attributionLogo: true,
    },
    grid: {
      vertLines: { color: MONO.grid },
      horzLines: { color: MONO.grid },
    },
    rightPriceScale: {
      borderColor: MONO.border,
      scaleMargins: { top: 0.1, bottom: volume ? 0.28 : 0.1 },
    },
    timeScale: {
      borderColor: MONO.border,
      timeVisible: true,
      secondsVisible: false,
    },
    crosshair: {
      mode: CrosshairMode.Normal,
      vertLine: { color: MONO.border, labelBackgroundColor: MONO.border },
      horzLine: { color: MONO.border, labelBackgroundColor: MONO.border },
    },
    localization: {
      priceFormatter: (p) => p.toFixed(priceDecimals),
    },
  });

  const candles = chart.addSeries(CandlestickSeries, {
    upColor: MONO.up,
    downColor: MONO.down,
    borderUpColor: MONO.up,
    borderDownColor: MONO.down,
    wickUpColor: MONO.up,
    wickDownColor: MONO.down,
    priceFormat: { type: 'price', precision: priceDecimals, minMove: 10 ** -priceDecimals },
  });

  let volumeSeries = null;
  if (volume) {
    volumeSeries = chart.addSeries(HistogramSeries, {
      color: MONO.volume,
      priceFormat: { type: 'volume' },
      priceScaleId: 'vol',
    });
    // Pin volume to the bottom quarter, overlaid on the price pane.
    chart.priceScale('vol').applyOptions({
      scaleMargins: { top: 0.78, bottom: 0 },
    });
  }

  // autoSize handles most cases; ResizeObserver covers containers that change
  // size without a window resize event (sidebars, tab panels, CSS grid reflow).
  const ro = new ResizeObserver(([entry]) => {
    const { width, height: h } = entry.contentRect;
    if (width > 0 && h > 0) chart.resize(width, h);
  });
  ro.observe(container);

  return {
    chart,
    candles,
    volume: volumeSeries,
    setData(bars) {
      candles.setData(bars);
      if (volumeSeries) {
        volumeSeries.setData(
          bars.map((b) => ({
            time: b.time,
            value: b.volume ?? 0,
            color: b.close >= b.open ? MONO.volume : 'rgba(82,82,82,0.4)',
          })),
        );
      }
      chart.timeScale().fitContent();
    },
    update(bar) {
      candles.update(bar);
      if (volumeSeries && bar.volume !== undefined) {
        volumeSeries.update({
          time: bar.time,
          value: bar.volume,
          color: bar.close >= bar.open ? MONO.volume : 'rgba(82,82,82,0.4)',
        });
      }
    },
    fit() {
      chart.timeScale().fitContent();
    },
    destroy() {
      ro.disconnect();
      chart.remove();
    },
  };
}
```

### 4. Mount it with synthetic bars first

Prove the chart works before you add a network dependency. Charting bugs and
fetching bugs look identical from the outside, so isolate them.

`src/main.js`:

```js
/**
 * robinhood-toolkit · chart smoke test
 * Author: nirholas · https://github.com/nirholas/robinhood-toolkit
 * License: MIT (c) 2026 nirholas
 */
import { createPriceChart } from './chart.js';

const el = document.querySelector('#chart');
const view = createPriceChart(el, { priceDecimals: 6 });

// 200 hourly bars ending now. UNIX SECONDS, ascending, one bar per timestamp.
const nowSec = Math.floor(Date.now() / 1000);
const hour = 3600;
const bars = [];
let price = 1.0;
for (let i = 199; i >= 0; i -= 1) {
  const open = price;
  const close = open * (1 + (Math.random() - 0.5) * 0.04);
  bars.push({
    time: (nowSec - i * hour) - ((nowSec - i * hour) % hour),
    open,
    high: Math.max(open, close) * 1.005,
    low: Math.min(open, close) * 0.995,
    close,
    volume: Math.random() * 50_000,
  });
  price = close;
}

view.setData(bars);

window.addEventListener('beforeunload', () => view.destroy());
```

`index.html`:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>rh-charts</title>
    <style>
      html, body { margin: 0; background: #0a0a0a; color: #a1a1a1;
                   font-family: ui-monospace, Menlo, monospace; }
      #chart { width: 100%; height: 420px; }
      footer { padding: 8px 12px; font-size: 11px; }
      a { color: #a1a1a1; }
    </style>
  </head>
  <body>
    <div id="chart"></div>
    <footer>
      Charting by
      <a href="https://www.tradingview.com/" target="_blank" rel="noopener">TradingView</a>
      Lightweight Charts™
    </footer>
    <script type="module" src="/src/main.js"></script>
  </body>
</html>
```

```sh
npm run dev
```

## Deliverable

- `src/chart.js` exporting `createPriceChart()` with `setData`, `update`, `fit`,
  and `destroy`, plus the attribution header.
- `NOTICE` at the project root with the TradingView copyright line.
- Visible attribution in the running page: the built-in logo, the footer link,
  or both.
- `index.html` and `src/main.js` rendering 200 synthetic bars with volume.

## How to verify

1. `npm run dev` shows candles and a volume histogram. Zero console errors.
2. `node -e "console.log(require('lightweight-charts/package.json').version)"`
   prints `5.2.0`.
3. Attribution is visible on screen without scrolling or hovering.
4. `NOTICE` exists and contains the TradingView copyright string.
5. Resize the browser window and drag any container split. The chart tracks its
   container with no clipped axis and no blank strip.
6. `grep -rn "charting_library\|UDFCompatibleDatafeed\|addCandlestickSeries" src/`
   returns nothing. The first two are Advanced Charts, banned here. The third is
   the removed v4 API.

## Gotchas

- **`addCandlestickSeries()` does not exist in v5.** It is
  `chart.addSeries(CandlestickSeries, options)` with `CandlestickSeries`
  imported as a named export. Most tutorials online are v3 or v4 and will throw
  `chart.addCandlestickSeries is not a function`. Check the version before you
  trust any snippet.
- **Timestamps are seconds.** Passing milliseconds does not throw. It renders
  your data somewhere around the year 58000 and the chart looks empty because
  the visible range is nowhere near it. If your chart is blank with data loaded,
  check the unit first.
- **Data must be sorted ascending by time and free of duplicates.** v5 throws
  `Cannot update oldest data` on out-of-order input. Sort and dedupe before
  `setData`, never after.
- Do not turn off `attributionLogo` without placing the NOTICE text visibly. It
  is a license requirement, not a preference.
- Default price precision is 2 decimals, which flattens a token priced at
  `0.00003028` into a straight line at `0.00`. Set `priceFormat.precision` and
  `minMove` per pair. Prompt 07 derives them from the price automatically.
- `chart.remove()` is mandatory on unmount. Lightweight Charts holds canvas
  contexts and event listeners that survive a framework unmount, so leaking them
  across route changes will eventually stall the tab. Disconnect the
  `ResizeObserver` in the same teardown.
- A container with `height: 0` (common inside an un-sized flex parent) renders
  nothing and reports no error. Give the container an explicit height.
- There is no built-in symbol search, indicator suite, or drawing toolbar. If a
  requirement needs those, decide now, because Advanced Charts cannot fill the
  gap in an open-source project.
