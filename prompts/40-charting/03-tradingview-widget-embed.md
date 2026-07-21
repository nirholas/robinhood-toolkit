<!-- built by nirholas x.com/nichxbt -->
<!--
  robinhood-toolkit · build prompt: TradingView widget embeds and their hard ceiling
  Author: nirholas · https://github.com/nirholas/robinhood-toolkit
  License: All Rights Reserved (c) 2026 nirholas
-->

# 03 · TradingView widget embed

## Goal

Embed a free TradingView widget for centralized-exchange reference prices,
understand exactly where it stops working, and wire the correct fallback for
Robinhood Chain DEX pairs, which widgets cannot render at all.

End state: a `<ReferenceChart>` component that renders a TradingView widget when
a CEX symbol exists and a DEX embed otherwise, with the routing decision made
explicitly rather than by accident.

## Prerequisites

- Prompt 01 finished, so you can resolve a Robinhood Chain pair address.
- A static page or any frontend framework. Widgets are script tags.
- No TradingView account. Widgets are free and need no application.

## Reference facts (verified)

### What widgets are

Free embeddable charts from TradingView, injected with a `<script>` tag that
builds an iframe. No signup, no key, no license application. Distinct from both
Lightweight Charts (prompt 02) and Advanced Charts (banned, see prompt 02).

### The hard ceiling: widgets are CEX-only

**A TradingView widget accepts only `EXCHANGE:SYMBOL` identifiers resolvable in
TradingView's own symbol database.** For crypto that means centralized exchange
listings:

```
COINBASE:BTCUSD      BINANCE:ETHUSDT      KRAKEN:SOLUSD      BITSTAMP:BTCUSD
```

You **cannot** feed a widget:

- a pool address (`0x95f9B0AF9282A22F7ef57058e65098db3f667f95`)
- a token address
- an RPC endpoint, a subgraph, or a JSON array of your own candles
- anything at all from Robinhood Chain, or from any DEX on any chain, unless
  TradingView has independently indexed that specific pool

There is no configuration flag, no paid tier of the widget, and no documented
override that changes this. The widget fetches its data from TradingView's
servers. It never calls yours. **For Robinhood Chain DEX pairs, widgets are
useless.** Do not spend time trying to make one work. The correct paths are
Lightweight Charts with your own data (prompts 04 through 08) or the DexScreener
iframe below.

Widgets are still worth having for one thing: a **reference chart for the
underlying asset**. Charting `COINBASE:ETHUSD` next to your WETH pool gives a
user real context about whether a move is pair-specific or market-wide. That is
the legitimate use, and it is the only one.

### Widget attribution

The generated snippet includes a `tradingview-widget-copyright` div linking back
to TradingView. **It must not be removed.** It is the attribution condition
attached to free widget use. Leave the div, its link, and its `rel` attributes
exactly as generated.

### The DexScreener iframe embed (undocumented)

Empirically working as of 2026-07-20, and **not a supported API**:

```
https://dexscreener.com/{chainId}/{pairAddress}?embed=1&theme=dark
```

Verified: returns HTTP 200 with no `X-Frame-Options` header and no CSP
`frame-ancestors` directive, so it frames successfully. Query parameters
observed in use:

| Param | Values | Effect |
|---|---|---|
| `embed` | `1` | Required. Strips site chrome. |
| `theme` | `dark`, `light` | Page theme |
| `trades` | `0`, `1` | Hide/show the trade feed |
| `info` | `0`, `1` | Hide/show the token info panel |
| `chartLeftToolbar` | `0`, `1` | Hide/show the drawing toolbar |
| `chartTheme` | `dark`, `light` | Chart theme, separate from page theme |
| `chartType` | `usd`, `price`, `mcap` | Y-axis denomination |
| `interval` | `1`, `5`, `15`, `60`, `240`, `720`, `1D` | Candle interval, minutes |

Understand what you are taking on:

- **Undocumented and unversioned.** DexScreener never promised these parameters
  and can change or remove them without notice or changelog. Treat a working
  embed as a convenience that may break on any given day, and make sure your
  page degrades to a link rather than an empty box.
- **The chart inside that iframe is TradingView Advanced Charts, rendered under
  DexScreener's license, which does not extend to you.** You are embedding their
  page, not deploying their library. That distinction is what keeps this
  acceptable. The moment you try to extract the library or replicate the chart
  in your own bundle, you are in the section 2.5 territory described in prompt 02.
- It is an iframe. You get no data out of it, no theming beyond the parameters
  above, no events, and no way to draw your own overlays. If you need any of
  that, build with Lightweight Charts instead.

## Steps

### 1. Confirm the widget ceiling yourself

Do not take it on faith. Build the two-minute test that proves it, because
someone on your team will ask.

`widget-ceiling-test.html`:

```html
<!doctype html>
<html lang="en">
  <head><meta charset="utf-8" /><title>widget ceiling</title></head>
  <body style="background:#0a0a0a;color:#a1a1a1;font-family:ui-monospace,monospace">
    <h3>Works: a CEX symbol</h3>
    <div class="tradingview-widget-container" style="height:300px">
      <div id="w-good" style="height:100%"></div>
    </div>

    <h3>Fails: a Robinhood Chain pool address</h3>
    <div class="tradingview-widget-container" style="height:300px">
      <div id="w-bad" style="height:100%"></div>
    </div>

    <script src="https://s3.tradingview.com/tv.js"></script>
    <script>
      new TradingView.widget({
        container_id: 'w-good', symbol: 'COINBASE:ETHUSD',
        interval: '60', theme: 'dark', autosize: true, hide_side_toolbar: true,
      });
      new TradingView.widget({
        container_id: 'w-bad',
        symbol: 'ROBINHOOD:0x95f9B0AF9282A22F7ef57058e65098db3f667f95',
        interval: '60', theme: 'dark', autosize: true,
      });
    </script>
  </body>
</html>
```

Open it. The first chart renders ETH. The second renders TradingView's
"Invalid symbol" state. That is the ceiling, demonstrated. There is no
workaround below it.

### 2. Build the reference widget (CEX only)

`src/reference-widget.js`:

```js
/**
 * robinhood-toolkit · TradingView reference widget (centralized exchanges only)
 * Author: nirholas · https://github.com/nirholas/robinhood-toolkit
 * License: All Rights Reserved (c) 2026 nirholas
 *
 * Charts by TradingView (https://www.tradingview.com/). The copyright element
 * rendered below is an attribution condition of free widget use. Do not remove.
 */

const TV_SRC = 'https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js';

/** Symbols this project charts. Extend deliberately; a wrong one renders empty. */
export const CEX_SYMBOLS = {
  ETH: 'COINBASE:ETHUSD',
  BTC: 'COINBASE:BTCUSD',
  SOL: 'COINBASE:SOLUSD',
};

/** Map a Robinhood Chain token to a CEX reference symbol, or null if none. */
export function referenceSymbolFor(tokenSymbol) {
  const key = String(tokenSymbol || '').toUpperCase().replace(/^W/, ''); // WETH -> ETH
  return CEX_SYMBOLS[key] ?? null;
}

/**
 * Mount a TradingView advanced-chart widget.
 * @param {HTMLElement} container
 * @param {string} symbol  EXCHANGE:SYMBOL, e.g. 'COINBASE:ETHUSD'
 * @returns {{ destroy: () => void }}
 */
export function mountReferenceWidget(container, symbol, { interval = '60' } = {}) {
  if (!/^[A-Z0-9_]+:[A-Z0-9._]+$/i.test(symbol)) {
    throw new Error(
      `TradingView widgets require EXCHANGE:SYMBOL, got "${symbol}". ` +
      'Pool and token addresses are not supported. Use a DEX embed or ' +
      'Lightweight Charts instead.',
    );
  }

  container.innerHTML = '';

  const wrap = document.createElement('div');
  wrap.className = 'tradingview-widget-container';
  wrap.style.height = '100%';

  const target = document.createElement('div');
  target.className = 'tradingview-widget-container__widget';
  target.style.height = 'calc(100% - 32px)';
  wrap.appendChild(target);

  // ATTRIBUTION: required by TradingView's free widget terms. Do not remove.
  const credit = document.createElement('div');
  credit.className = 'tradingview-widget-copyright';
  credit.innerHTML =
    '<a href="https://www.tradingview.com/" rel="noopener nofollow" target="_blank">' +
    '<span class="blue-text">Track all markets on TradingView</span></a>';
  wrap.appendChild(credit);

  const script = document.createElement('script');
  script.src = TV_SRC;
  script.async = true;
  script.type = 'text/javascript';
  script.innerHTML = JSON.stringify({
    autosize: true,
    symbol,
    interval,
    timezone: 'Etc/UTC',
    theme: 'dark',
    style: '1',
    locale: 'en',
    hide_side_toolbar: true,
    allow_symbol_change: false,
    save_image: false,
  });
  wrap.appendChild(script);

  container.appendChild(wrap);

  return {
    destroy() {
      container.innerHTML = '';
    },
  };
}
```

### 3. Build the DEX embed fallback

`src/dex-embed.js`:

```js
/**
 * robinhood-toolkit · DexScreener iframe embed
 * Author: nirholas · https://github.com/nirholas/robinhood-toolkit
 * License: All Rights Reserved (c) 2026 nirholas
 *
 * UNDOCUMENTED, UNVERSIONED. DexScreener publishes no embed API. These
 * parameters worked on 2026-07-20 and may change without notice. Always
 * degrade to a plain link rather than leaving an empty frame on screen.
 */

const DEFAULTS = {
  embed: '1',
  theme: 'dark',
  chartTheme: 'dark',
  chartType: 'usd',
  interval: '15',
  trades: '0',
  info: '0',
  chartLeftToolbar: '0',
};

export function dexEmbedUrl(pairAddress, { chainId = 'robinhood', ...overrides } = {}) {
  const params = new URLSearchParams({ ...DEFAULTS, ...overrides });
  return `https://dexscreener.com/${chainId}/${pairAddress}?${params}`;
}

/**
 * Mount the embed with a link fallback shown until the frame loads.
 * @returns {{ destroy: () => void }}
 */
export function mountDexEmbed(container, pairAddress, opts = {}) {
  const url = dexEmbedUrl(pairAddress, opts);
  const plain = `https://dexscreener.com/${opts.chainId ?? 'robinhood'}/${pairAddress}`;

  container.innerHTML = '';
  container.style.position = 'relative';

  const fallback = document.createElement('div');
  fallback.style.cssText =
    'position:absolute;inset:0;display:grid;place-items:center;' +
    'font:11px ui-monospace,monospace;color:#a1a1a1;background:#0a0a0a';
  fallback.innerHTML =
    `<a href="${plain}" target="_blank" rel="noopener" style="color:#a1a1a1">` +
    'Open chart on DexScreener</a>';
  container.appendChild(fallback);

  const frame = document.createElement('iframe');
  frame.src = url;
  frame.title = `DexScreener chart for ${pairAddress}`;
  frame.loading = 'lazy';
  frame.style.cssText = 'position:relative;width:100%;height:100%;border:0;display:block';
  frame.addEventListener('load', () => { fallback.style.display = 'none'; });
  container.appendChild(frame);

  // If it has not loaded in 8s, assume the undocumented embed changed and
  // leave the link visible rather than showing an empty box.
  const timer = setTimeout(() => {
    if (!frame.contentWindow) fallback.style.display = 'grid';
  }, 8000);

  return {
    destroy() {
      clearTimeout(timer);
      container.innerHTML = '';
    },
  };
}
```

### 4. Route between them explicitly

`src/reference-chart.js`:

```js
/**
 * robinhood-toolkit · chart router: CEX widget vs DEX embed
 * Author: nirholas · https://github.com/nirholas/robinhood-toolkit
 * License: All Rights Reserved (c) 2026 nirholas
 */
import { mountReferenceWidget, referenceSymbolFor } from './reference-widget.js';
import { mountDexEmbed } from './dex-embed.js';

/**
 * @param {HTMLElement} container
 * @param {{ pairAddress: string, baseSymbol: string, prefer?: 'dex'|'cex' }} spec
 */
export function mountChart(container, spec) {
  const { pairAddress, baseSymbol, prefer = 'dex' } = spec;

  if (prefer === 'cex') {
    const symbol = referenceSymbolFor(baseSymbol);
    if (symbol) return mountReferenceWidget(container, symbol);
    // No CEX listing exists. Fall through rather than rendering "Invalid symbol".
  }
  return mountDexEmbed(container, pairAddress);
}
```

Usage, with the two live pairs from prompt 01:

```js
import { mountChart } from './reference-chart.js';

// DEX pair on Robinhood Chain: only the embed can render this.
mountChart(document.querySelector('#pair'), {
  pairAddress: '0x52e65B17fB6E5BA00Ed806f37Afcd2DaA50271Ca',
  baseSymbol: 'USDG',
});

// Market context for the quote asset: this is what a widget is good for.
mountChart(document.querySelector('#context'), {
  pairAddress: '',
  baseSymbol: 'WETH',
  prefer: 'cex',
});
```

## Deliverable

- `src/reference-widget.js` that throws a clear, actionable error when handed an
  address instead of an `EXCHANGE:SYMBOL`, and that renders the
  `tradingview-widget-copyright` element unmodified.
- `src/dex-embed.js` with a documented parameter map and a link fallback.
- `src/reference-chart.js` routing between them.
- `widget-ceiling-test.html` demonstrating the limitation, kept in the repo as
  evidence for the next person who asks whether widgets can chart a DEX pair.
- A `CHARTING.md` note recording that the DexScreener embed is undocumented and
  may break, with Lightweight Charts named as the supported path.

## How to verify

1. Open `widget-ceiling-test.html`. Chart one renders ETH, chart two shows
   "Invalid symbol". Screenshot it for your docs.
2. `mountReferenceWidget(el, '0x95f9...')` throws with the address in the
   message. It must never silently render an empty frame.
3. The DEX embed renders a live chart for
   `0x52e65B17fB6E5BA00Ed806f37Afcd2DaA50271Ca` on chain `robinhood`.
4. Confirm the embed still frames (this is the check to re-run when it breaks):
   ```sh
   curl -s -o /dev/null -D - \
     "https://dexscreener.com/robinhood/0x52e65B17fB6E5BA00Ed806f37Afcd2DaA50271Ca?embed=1&theme=dark" \
     | grep -iE 'HTTP/|x-frame-options|content-security-policy'
   ```
   Expect `HTTP/2 200` and no `x-frame-options`, no `frame-ancestors`.
5. `grep -rn "tradingview-widget-copyright" src/` finds the element and it is
   not display-none'd or removed anywhere in your CSS.
6. Block `dexscreener.com` in devtools and reload. The fallback link is visible.
   You must never ship a blank rectangle.

## Gotchas

- **Widgets cannot chart DEX pairs. There is no workaround.** Not with a custom
  symbol string, not with a paid TradingView plan, not with a proxy. If your
  requirement is charting a Robinhood Chain pool, widgets are off the table and
  the answer is Lightweight Charts with your own data, or the iframe.
- **Do not remove the `tradingview-widget-copyright` div.** It is the
  attribution condition on free widgets. Hiding it with CSS is the same
  violation as deleting it.
- Widget config goes in the script tag's **`innerHTML` as JSON**, not as
  attributes. Setting `script.src` and then expecting props to apply gives you a
  default BTC chart and a confusing debugging session.
- `autosize: true` needs a container with a real height. In a flex or grid
  parent with no explicit height the widget collapses to zero and renders
  nothing, with no error.
- Widget prices are exchange mid prices, not your pool's price. Never present a
  `COINBASE:ETHUSD` line as the price of your WETH pair. Label reference charts
  as reference charts.
- The DexScreener embed can break any day. It is undocumented. Build the
  fallback path in the first commit, not after it breaks in production.
- Do not try to read data out of the DexScreener iframe. Cross-origin framing
  gives you no DOM access, and scraping the frame is both technically blocked
  and against their terms. Use the JSON API from prompt 01 for data.
- One iframe per pair is fine. A grid of twelve is not: each one loads a full
  third-party page. For multi-pair views use prompt 07, which draws real series
  and stays responsive.
<!-- built by nirholas x.com/nichxbt -->
