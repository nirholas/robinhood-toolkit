<!--
  robinhood-toolkit · build prompt: multi-pair charting dashboard
  Author: nirholas · https://github.com/nirholas/robinhood-toolkit
  License: All Rights Reserved (c) 2026 nirholas
-->

# 07 · Multi-pair dashboard

## Goal

Build a grid of live pair tiles: sparkline, price, 24h change, liquidity, and
volume, sorted and filterable, backed by batched requests rather than one fetch
per tile. End state: a dashboard that tracks 30+ pairs without hammering any API
and without dropping frames.

## Prerequisites

- Prompts 01, 02, 04 finished. Prompt 05 if you want real candles per tile.
- The batching helper `getTokens()` from prompt 01.

## Reference facts (verified)

### Batch, do not loop

`GET /tokens/v1/{chainId}/{addresses}` accepts **up to 30 comma-separated token
addresses** in one request. Thirty tiles is one request, not thirty. At the
60 req/min limit, a naive per-tile poll on a 30-pair board exceeds the limit
within two refresh cycles.

`GET /token-pairs/v1/{chainId}/{tokenAddress}` returns **every** pool for one
token, which is how you build a board from a token list rather than a pool list.

### Live pairs on Robinhood Chain

Confirmed live on 2026-07-20, sorted by liquidity, all quoted in WETH:

| Pool | Pair | Liquidity | Uniswap |
|---|---|---|---|
| `0xA70fc67C9F69da90B63a0e4C05D229954574E313` | CASHCAT/WETH | ~$3.6M | v3 |
| `0x10CC6BD38112cAc182db90B6a71d8Bb5939526bA` | PONS/WETH | ~$989k | v3 |
| `0x3b054359e248009e797afbcfa975fa4cf5147d503421af53f179be1abf63d46f` | SQUEEZE/WETH | ~$842k | **v4** |
| `0x237609918F330ADD285b8bC5f8f2922283D1C4C5` | TENDIES/WETH | ~$827k | v3 |
| `0x9501A20Bedb8beA0798FE5D4c411f5e270965D49` | WALLET/WETH | ~$580k | v3 |
| `0x52e65B17fB6E5BA00Ed806f37Afcd2DaA50271Ca` | USDG/WETH | deep | v3 |

### Uniswap v4 pools are IDs, not addresses

Note the third row. **A v4 pool identifier is 66 characters (a 32-byte pool ID),
not a 42-character contract address.** Verified: that pool returns
`labels: ["v4"]` and a 66-character `pairAddress`, while the v3 pools return
`labels: ["v3"]` and 42 characters.

This matters concretely:

- **`eth_getLogs` by address does not work for v4.** There is no per-pool
  contract. v4 uses a singleton `PoolManager` and emits swaps keyed by pool ID.
  The on-chain source from prompt 05 will silently return zero bars for a v4
  pool, because filtering logs by a 32-byte value as if it were an address
  matches nothing.
- Detect it and route: v4 tiles use GeckoTerminal or DexScreener, not the
  on-chain source, unless you implement `PoolManager` decoding.
- The check is a length test on `pairAddress`, and it is one line. Skipping it
  produces a tile that is permanently empty with no error, which is one of the
  more annoying bugs to track down.

### Price precision varies by orders of magnitude

On the board above, prices range from `0.001435` to `1902` depending on
denomination. A fixed 2-decimal format renders most of these as `0.00`. Derive
precision per pair from the price, which the code below does.

## Steps

### 1. Define the board as data

`src/dashboard/board.js`:

```js
/**
 * robinhood-toolkit · dashboard configuration
 * Author: nirholas · https://github.com/nirholas/robinhood-toolkit
 * License: All Rights Reserved (c) 2026 nirholas
 *
 * Pools are identified by ADDRESS (v3) or POOL ID (v4). Never by symbol:
 * symbols collide, including on the same chain. See prompt 01.
 */

export const WETH = '0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73';

export const BOARD = [
  { pairAddress: '0xA70fc67C9F69da90B63a0e4C05D229954574E313', label: 'CASHCAT/WETH' },
  { pairAddress: '0x10CC6BD38112cAc182db90B6a71d8Bb5939526bA', label: 'PONS/WETH' },
  { pairAddress: '0x3b054359e248009e797afbcfa975fa4cf5147d503421af53f179be1abf63d46f', label: 'SQUEEZE/WETH' },
  { pairAddress: '0x237609918F330ADD285b8bC5f8f2922283D1C4C5', label: 'TENDIES/WETH' },
  { pairAddress: '0x9501A20Bedb8beA0798FE5D4c411f5e270965D49', label: 'WALLET/WETH' },
  { pairAddress: '0x52e65B17fB6E5BA00Ed806f37Afcd2DaA50271Ca', label: 'USDG/WETH' },
];

/** A v4 pool ID is 32 bytes (66 chars with 0x). A v3 pool is a 20-byte address. */
export function isV4Pool(pairAddress) {
  return typeof pairAddress === 'string' && pairAddress.length === 66;
}

/** On-chain candle aggregation only works for v3 pools. */
export function supportsOnchainCandles(pair) {
  if (isV4Pool(pair.pairAddress)) return false;
  return !pair.labels || pair.labels.includes('v3');
}

/** Decimal places that keep a price legible across six orders of magnitude. */
export function precisionFor(price) {
  const p = Math.abs(Number(price));
  if (!Number.isFinite(p) || p === 0) return 6;
  if (p >= 1000) return 2;
  if (p >= 1) return 4;
  if (p >= 0.01) return 5;
  if (p >= 0.0001) return 6;
  return Math.min(12, Math.ceil(-Math.log10(p)) + 4);
}

export function formatPrice(price) {
  if (price === null || price === undefined || !Number.isFinite(Number(price))) return '--';
  return Number(price).toFixed(precisionFor(price));
}

export function formatUsd(n) {
  if (!Number.isFinite(Number(n))) return '--';
  const v = Number(n);
  if (v >= 1e9) return `$${(v / 1e9).toFixed(2)}B`;
  if (v >= 1e6) return `$${(v / 1e6).toFixed(2)}M`;
  if (v >= 1e3) return `$${(v / 1e3).toFixed(1)}K`;
  return `$${v.toFixed(2)}`;
}

export function formatPct(n) {
  if (!Number.isFinite(Number(n))) return '--';
  const v = Number(n);
  return `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`;
}
```

### 2. Build the batched store

One poll for the whole board, one subscription model, no per-tile fetching.

`src/dashboard/store.js`:

```js
/**
 * robinhood-toolkit · batched multi-pair store
 * Author: nirholas · https://github.com/nirholas/robinhood-toolkit
 * License: All Rights Reserved (c) 2026 nirholas
 *
 * One request per refresh for the whole board, not one per tile.
 */
import { getPair, normalisePair, ROBINHOOD } from '../dexscreener.js';

const BASE = 'https://api.dexscreener.com';

/**
 * DexScreener has no batch-by-pool endpoint, only batch-by-token. Group the
 * board's base tokens, fetch in chunks of 30, then select the pools we track.
 */
async function fetchBoardByTokens(tokenAddresses, chainId) {
  const MAX = 30;
  const out = [];
  for (let i = 0; i < tokenAddresses.length; i += MAX) {
    const chunk = tokenAddresses.slice(i, i + MAX).join(',');
    const res = await fetch(`${BASE}/tokens/v1/${chainId}/${chunk}`, {
      headers: { accept: 'application/json' },
    });
    if (!res.ok) throw new Error(`tokens/v1 HTTP ${res.status}`);
    const body = await res.json();
    out.push(...(Array.isArray(body) ? body : (body?.pairs ?? [])).map(normalisePair));
  }
  return out;
}

export function createBoardStore(board, { chainId = ROBINHOOD, refreshMs = 20_000 } = {}) {
  const wanted = new Set(board.map((b) => b.pairAddress.toLowerCase()));
  const labels = new Map(board.map((b) => [b.pairAddress.toLowerCase(), b.label]));

  /** @type {Map<string, object>} keyed by lowercased pool address/id */
  const state = new Map();
  const history = new Map();      // pool -> number[] of recent prices
  const listeners = new Set();
  let timer = null;
  let stopped = false;
  let tokensResolved = null;
  let lastError = null;

  function emit() {
    const rows = [...state.values()];
    for (const fn of listeners) fn({ rows, error: lastError });
  }

  /**
   * Resolve each pool once to learn its base token, so subsequent refreshes can
   * use the batch-by-token endpoint. One-time cost of N requests, then 1 per
   * refresh forever.
   */
  async function resolveTokens() {
    if (tokensResolved) return tokensResolved;
    const pairs = await Promise.all(
      board.map((b) => getPair(b.pairAddress, chainId).catch(() => null)),
    );
    const tokens = [];
    for (const pair of pairs) {
      if (!pair) continue;
      apply(pair);
      if (!tokens.includes(pair.base.address)) tokens.push(pair.base.address);
    }
    tokensResolved = tokens;
    emit();
    return tokens;
  }

  function apply(pair) {
    const key = pair.pairAddress.toLowerCase();
    if (!wanted.has(key)) return;

    const prev = state.get(key);
    const row = {
      ...pair,
      label: labels.get(key) ?? `${pair.base.symbol}/${pair.quote.symbol}`,
      // Direction of the last tick, for the flash animation.
      tick: prev && Number.isFinite(prev.priceUsd) && Number.isFinite(pair.priceUsd)
        ? Math.sign(pair.priceUsd - prev.priceUsd)
        : 0,
      updatedAt: Date.now(),
    };
    state.set(key, row);

    if (Number.isFinite(pair.priceUsd)) {
      const h = history.get(key) ?? [];
      h.push(pair.priceUsd);
      if (h.length > 120) h.shift();       // bounded: this runs for hours
      history.set(key, h);
    }
  }

  async function refresh() {
    try {
      const tokens = await resolveTokens();
      if (tokens.length === 0) return;
      const pairs = await fetchBoardByTokens(tokens, chainId);
      for (const pair of pairs) apply(pair);
      lastError = null;
    } catch (err) {
      lastError = err;         // keep the last good rows on screen
    }
    emit();
  }

  function start() {
    if (timer) return;
    const tick = async () => {
      if (stopped) return;
      // Do not poll a hidden tab. Saves quota and battery, and the user cannot
      // see it anyway. The visibility handler refreshes immediately on return.
      if (typeof document === 'undefined' || document.visibilityState === 'visible') {
        await refresh();
      }
      if (!stopped) timer = setTimeout(tick, refreshMs);
    };
    timer = setTimeout(tick, 0);
  }

  const onVisibility = () => {
    if (document.visibilityState === 'visible' && !stopped) refresh();
  };
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', onVisibility);
  }

  return {
    start,
    refresh,
    subscribe(fn) { listeners.add(fn); fn({ rows: [...state.values()], error: lastError }); return () => listeners.delete(fn); },
    sparkline: (pairAddress) => history.get(pairAddress.toLowerCase()) ?? [],
    destroy() {
      stopped = true;
      clearTimeout(timer);
      listeners.clear();
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', onVisibility);
      }
    },
  };
}
```

### 3. Render tiles with sparklines

A full candlestick chart per tile is wasteful at this size. Use an area series,
which is cheaper and reads better small.

`src/dashboard/tile.js`:

```js
/**
 * robinhood-toolkit · dashboard tile with sparkline
 * Author: nirholas · https://github.com/nirholas/robinhood-toolkit
 * License: All Rights Reserved (c) 2026 nirholas
 *
 * Charting by TradingView Lightweight Charts™ (Apache-2.0).
 * TradingView Lightweight Charts™ Copyright (с) 2025 TradingView, Inc.
 * https://www.tradingview.com/
 */
import { createChart, AreaSeries } from 'lightweight-charts';
import { formatPrice, formatUsd, formatPct, isV4Pool } from './board.js';

const UP = '#d4d4d4';
const DOWN = '#525252';

export function createTile(row) {
  const el = document.createElement('article');
  el.className = 'tile';
  el.dataset.pair = row.pairAddress;
  el.tabIndex = 0;
  el.setAttribute('role', 'button');
  el.setAttribute('aria-label', `${row.label} chart, price ${formatPrice(row.priceUsd)} US dollars`);

  el.innerHTML = `
    <header class="tile-head">
      <span class="tile-label"></span>
      <span class="tile-badge"></span>
    </header>
    <div class="tile-spark" aria-hidden="true"></div>
    <dl class="tile-stats">
      <div><dt>Price</dt><dd class="s-price"></dd></div>
      <div><dt>24h</dt><dd class="s-change"></dd></div>
      <div><dt>Liquidity</dt><dd class="s-liq"></dd></div>
      <div><dt>Volume 24h</dt><dd class="s-vol"></dd></div>
    </dl>
  `;

  const sparkEl = el.querySelector('.tile-spark');
  // Only one attribution logo is needed per page, not per tile. The page footer
  // carries the required TradingView credit; see index.html below.
  const chart = createChart(sparkEl, {
    width: 0,
    height: 56,
    autoSize: true,
    layout: { background: { color: 'transparent' }, textColor: 'transparent', attributionLogo: false },
    grid: { vertLines: { visible: false }, horzLines: { visible: false } },
    rightPriceScale: { visible: false },
    leftPriceScale: { visible: false },
    timeScale: { visible: false },
    crosshair: { horzLine: { visible: false }, vertLine: { visible: false } },
    handleScroll: false,
    handleScale: false,
  });

  const series = chart.addSeries(AreaSeries, {
    lineColor: UP,
    lineWidth: 1,
    topColor: 'rgba(212,212,212,0.18)',
    bottomColor: 'rgba(212,212,212,0)',
    priceLineVisible: false,
    lastValueVisible: false,
  });

  let flashTimer = null;

  function update(next, sparkValues) {
    el.querySelector('.tile-label').textContent = next.label;

    const badge = el.querySelector('.tile-badge');
    badge.textContent = isV4Pool(next.pairAddress) ? 'v4' : (next.labels?.[0] ?? 'v3');

    el.querySelector('.s-price').textContent = formatPrice(next.priceUsd);
    el.querySelector('.s-liq').textContent = formatUsd(next.liquidityUsd);
    el.querySelector('.s-vol').textContent = formatUsd(next.volume24h);

    const change = el.querySelector('.s-change');
    change.textContent = formatPct(next.priceChange24h);
    change.dataset.dir = Number(next.priceChange24h) >= 0 ? 'up' : 'down';

    const rising = Number(next.priceChange24h) >= 0;
    series.applyOptions({
      lineColor: rising ? UP : DOWN,
      topColor: rising ? 'rgba(212,212,212,0.18)' : 'rgba(82,82,82,0.18)',
      bottomColor: 'rgba(0,0,0,0)',
    });

    if (sparkValues.length > 1) {
      // Synthetic evenly spaced timestamps: the x-axis is hidden, only shape
      // matters, and real poll timestamps produce uneven spacing that reads as
      // noise at 56px tall.
      const base = Math.floor(Date.now() / 1000) - sparkValues.length * 60;
      series.setData(sparkValues.map((v, i) => ({ time: base + i * 60, value: v })));
      chart.timeScale().fitContent();
    }

    if (next.tick !== 0) {
      el.dataset.flash = next.tick > 0 ? 'up' : 'down';
      clearTimeout(flashTimer);
      flashTimer = setTimeout(() => { delete el.dataset.flash; }, 600);
    }
  }

  update(row, []);

  return {
    el,
    update,
    destroy() {
      clearTimeout(flashTimer);
      chart.remove();
      el.remove();
    },
  };
}
```

### 4. Assemble the grid

`src/dashboard/grid.js`:

```js
/**
 * robinhood-toolkit · dashboard grid with sorting and filtering
 * Author: nirholas · https://github.com/nirholas/robinhood-toolkit
 * License: All Rights Reserved (c) 2026 nirholas
 */
import { createTile } from './tile.js';

const SORTS = {
  liquidity: (a, b) => (b.liquidityUsd ?? 0) - (a.liquidityUsd ?? 0),
  volume:    (a, b) => (b.volume24h ?? 0) - (a.volume24h ?? 0),
  gainers:   (a, b) => (b.priceChange24h ?? -Infinity) - (a.priceChange24h ?? -Infinity),
  losers:    (a, b) => (a.priceChange24h ?? Infinity) - (b.priceChange24h ?? Infinity),
  name:      (a, b) => a.label.localeCompare(b.label),
};

export function mountGrid(container, store, { onSelect = () => {} } = {}) {
  const tiles = new Map();
  let sort = 'liquidity';
  let filter = '';

  const controls = document.createElement('div');
  controls.className = 'grid-controls';
  controls.innerHTML = `
    <label class="sr-only" for="pair-filter">Filter pairs</label>
    <input id="pair-filter" type="search" placeholder="Filter pairs" autocomplete="off" />
    <label class="sr-only" for="pair-sort">Sort by</label>
    <select id="pair-sort">
      ${Object.keys(SORTS).map((k) => `<option value="${k}">${k}</option>`).join('')}
    </select>
    <span class="grid-status" role="status" aria-live="polite"></span>
  `;

  const gridEl = document.createElement('div');
  gridEl.className = 'grid';

  const emptyEl = document.createElement('p');
  emptyEl.className = 'grid-empty';
  emptyEl.hidden = true;

  container.append(controls, gridEl, emptyEl);

  const statusEl = controls.querySelector('.grid-status');
  const filterEl = controls.querySelector('#pair-filter');
  const sortEl = controls.querySelector('#pair-sort');

  let debounce = null;
  filterEl.addEventListener('input', (e) => {
    clearTimeout(debounce);
    const value = e.target.value;
    debounce = setTimeout(() => { filter = value.trim().toLowerCase(); render(lastRows); }, 120);
  });
  sortEl.addEventListener('change', (e) => { sort = e.target.value; render(lastRows); });

  gridEl.addEventListener('click', (e) => {
    const tile = e.target.closest('.tile');
    if (tile) onSelect(tile.dataset.pair);
  });
  gridEl.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const tile = e.target.closest('.tile');
    if (!tile) return;
    e.preventDefault();
    onSelect(tile.dataset.pair);
  });

  let lastRows = [];

  function render(rows) {
    lastRows = rows;

    const visible = rows
      .filter((r) => !filter || r.label.toLowerCase().includes(filter)
        || r.base.symbol.toLowerCase().includes(filter)
        || r.pairAddress.toLowerCase().includes(filter))
      .sort(SORTS[sort]);

    if (rows.length === 0) {
      emptyEl.hidden = false;
      emptyEl.textContent = 'Loading pairs from DexScreener…';
      return;
    }
    if (visible.length === 0) {
      emptyEl.hidden = false;
      emptyEl.textContent = `No pairs match "${filter}". Clear the filter to see all ${rows.length}.`;
      gridEl.replaceChildren();
      return;
    }
    emptyEl.hidden = true;

    // Reuse tile instances. Recreating a chart per refresh leaks canvases and
    // is the fastest way to make a 30-tile board unusable.
    const ordered = [];
    for (const row of visible) {
      const key = row.pairAddress.toLowerCase();
      let tile = tiles.get(key);
      if (!tile) {
        tile = createTile(row);
        tiles.set(key, tile);
      }
      tile.update(row, store.sparkline(row.pairAddress));
      ordered.push(tile.el);
    }
    // replaceChildren reorders in one reflow rather than N appends.
    gridEl.replaceChildren(...ordered);

    for (const [key, tile] of tiles) {
      if (!visible.some((r) => r.pairAddress.toLowerCase() === key) && !tile.el.isConnected) {
        // keep the instance for reuse; it is cheap and the board is bounded
      }
    }
  }

  const unsubscribe = store.subscribe(({ rows, error }) => {
    statusEl.textContent = error
      ? `Stale: ${error.message}. Retrying…`
      : `${rows.length} pairs · updated ${new Date().toLocaleTimeString()}`;
    statusEl.dataset.state = error ? 'error' : 'ok';
    render(rows);
  });

  return {
    destroy() {
      unsubscribe();
      clearTimeout(debounce);
      for (const tile of tiles.values()) tile.destroy();
      tiles.clear();
      container.replaceChildren();
    },
  };
}
```

### 5. The page

`dashboard.html`:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Robinhood Chain pairs</title>
    <style>
      :root { --bg:#0a0a0a; --fg:#e5e5e5; --dim:#737373; --line:#262626; --up:#d4d4d4; --down:#525252; }
      * { box-sizing: border-box; }
      body { margin:0; background:var(--bg); color:var(--fg);
             font:13px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace; }
      main { max-width:1400px; margin:0 auto; padding:24px 16px; }
      h1 { font-size:14px; font-weight:500; letter-spacing:.08em; text-transform:uppercase; color:var(--dim); }
      .grid-controls { display:flex; gap:8px; align-items:center; margin:16px 0; flex-wrap:wrap; }
      input, select { background:#111; color:var(--fg); border:1px solid var(--line);
                      padding:6px 10px; font:inherit; border-radius:2px; }
      input:focus-visible, select:focus-visible, .tile:focus-visible {
        outline:2px solid var(--up); outline-offset:2px; }
      .grid-status { margin-left:auto; color:var(--dim); font-size:11px; }
      .grid-status[data-state="error"] { color:#e5e5e5; }
      .grid { display:grid; gap:12px;
              grid-template-columns:repeat(auto-fill,minmax(240px,1fr)); }
      .tile { border:1px solid var(--line); border-radius:3px; padding:12px;
              background:#0d0d0d; cursor:pointer; transition:border-color .15s, transform .15s; }
      .tile:hover { border-color:#404040; transform:translateY(-1px); }
      .tile:active { transform:translateY(0); }
      .tile[data-flash="up"] { border-color:var(--up); }
      .tile[data-flash="down"] { border-color:var(--down); }
      .tile-head { display:flex; justify-content:space-between; align-items:center; }
      .tile-label { font-weight:500; }
      .tile-badge { font-size:10px; color:var(--dim); border:1px solid var(--line);
                    padding:1px 5px; border-radius:2px; }
      .tile-spark { height:56px; margin:8px 0; }
      .tile-stats { display:grid; grid-template-columns:1fr 1fr; gap:6px 12px; margin:0; }
      .tile-stats div { display:flex; justify-content:space-between; gap:8px; }
      dt { color:var(--dim); font-size:11px; }
      dd { margin:0; font-variant-numeric:tabular-nums; }
      .s-change[data-dir="up"] { color:var(--up); }
      .s-change[data-dir="down"] { color:var(--down); }
      .grid-empty { color:var(--dim); padding:32px; text-align:center; }
      footer { padding:24px 16px; color:var(--dim); font-size:11px; }
      a { color:var(--dim); }
      .sr-only { position:absolute; width:1px; height:1px; overflow:hidden; clip:rect(0 0 0 0); }
      @media (prefers-reduced-motion: reduce) { * { transition:none !important; } }
    </style>
  </head>
  <body>
    <main>
      <h1>Robinhood Chain · live pairs</h1>
      <div id="board"></div>
    </main>
    <footer>
      Charting by
      <a href="https://www.tradingview.com/" target="_blank" rel="noopener">TradingView</a>
      Lightweight Charts™ · Pair data by
      <a href="https://dexscreener.com" target="_blank" rel="noopener">DexScreener</a>
    </footer>
    <script type="module" src="/src/dashboard/main.js"></script>
  </body>
</html>
```

`src/dashboard/main.js`:

```js
/**
 * robinhood-toolkit · dashboard entry
 * Author: nirholas · https://github.com/nirholas/robinhood-toolkit
 * License: All Rights Reserved (c) 2026 nirholas
 */
import { BOARD } from './board.js';
import { createBoardStore } from './store.js';
import { mountGrid } from './grid.js';

const store = createBoardStore(BOARD, { refreshMs: 20_000 });

const grid = mountGrid(document.querySelector('#board'), store, {
  onSelect: (pairAddress) => {
    window.location.href = `/pair.html?pair=${encodeURIComponent(pairAddress)}`;
  },
});

store.start();

window.addEventListener('beforeunload', () => { grid.destroy(); store.destroy(); });
```

## Deliverable

- `src/dashboard/board.js`: config, `isV4Pool`, `supportsOnchainCandles`,
  `precisionFor`, formatters.
- `src/dashboard/store.js`: batched polling, bounded sparkline history,
  visibility-aware, keeps last-good data on error.
- `src/dashboard/tile.js`: reusable tile with an area sparkline.
- `src/dashboard/grid.js`: sorting, debounced filtering, keyboard activation,
  designed empty and error states.
- `dashboard.html` with focus-visible styles, reduced-motion support, and the
  TradingView plus DexScreener credits in the footer.

## How to verify

1. Open `dashboard.html`. All six pairs render with live prices, zero console
   errors.
2. **Request count is the point of this prompt.** Open the network tab, wait
   through three refresh cycles, and count `api.dexscreener.com` requests. After
   the initial resolve you should see roughly **one per cycle**, not one per
   tile. If you see six per cycle the batching is not wired.
3. v4 detection:
   ```sh
   curl -s "https://api.dexscreener.com/latest/dex/pairs/robinhood/0x3b054359e248009e797afbcfa975fa4cf5147d503421af53f179be1abf63d46f" \
     | jq '.pairs[0] | {labels, len: (.pairAddress|length)}'
   ```
   Expect `["v4"]` and `66`. The tile badge must read `v4`.
4. Sort by gainers, then losers. Order inverts. Filter for `cash`, one tile.
   Filter for `zzz`, the designed empty state with the pair count.
5. Tab to a tile and press Enter. It navigates. Focus ring is visible throughout.
6. Leave it running 30 minutes with devtools memory profiling. Heap is flat.
   Growth means tiles are being recreated instead of reused, or sparkline
   history is unbounded.
7. Background the tab for 2 minutes. No requests fire. On return, one immediate
   refresh.
8. Go offline. Status shows stale with the error, last-good prices stay on
   screen. The board must never blank out on a failed poll.
9. Resize to 320px. Single column, no horizontal scroll.

## Gotchas

- **A v4 pool ID is 66 characters, not 42.** `eth_getLogs` by address returns
  nothing for it because v4 pools are not contracts. Detect with `isV4Pool` and
  route those tiles to an API source. This fails silently otherwise.
- **Never fetch per tile.** Thirty tiles on a 20-second poll is 90 req/min,
  above the 60 req/min limit. Batch with `/tokens/v1` at 30 addresses per call.
- **Reuse tile instances.** Recreating a Lightweight Charts instance every
  refresh leaks canvas contexts. On a 30-tile board the tab becomes unusable
  within minutes. Update series data, do not rebuild charts.
- **Bound the sparkline history.** An unbounded array on a 20-second poll grows
  all day. The 120-point cap keeps it fixed.
- **One attribution logo per page is enough.** `attributionLogo: false` on tiles
  is correct only because the page footer carries the required credit. Do not
  disable both.
- **Do not blank the board on a failed poll.** Keep the last good rows and show
  a stale indicator. Flashing empty tiles on a transient 429 looks like data loss.
- **Fixed decimal formatting breaks this board.** Prices span `0.001435` to
  `1902`. Derive precision per row.
- **Sparkline x-axis spacing should be synthetic.** Real poll timestamps drift
  with retries and backgrounding, and uneven spacing at 56px tall reads as
  noise rather than signal.
- `replaceChildren` reorders in one reflow. A loop of `appendChild` on sort
  change causes visible thrash at 30 tiles.
- Debounce the filter input. Re-sorting and re-rendering 30 tiles per keystroke
  drops frames on mid-range hardware.
- The store polls DexScreener directly from the client. That is within their
  terms. Do not add a shared proxy to "fix CORS" for other people, which is
  redistribution. See prompt 01.
