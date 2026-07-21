<!--
  robinhood-toolkit · build prompt: custom data adapter for Lightweight Charts
  Author: nirholas · https://github.com/nirholas/robinhood-toolkit
  License: All Rights Reserved (c) 2026 nirholas
-->

# 04 · Custom datafeed adapter

## Goal

Build the adapter layer that sits between any data source and Lightweight
Charts: fetch, normalise, validate, and hand off. End state: a
`createAdapter()` factory with a source-agnostic interface, so swapping
GeckoTerminal for on-chain aggregation for your own backend touches one file.

**Read the first section before writing code.** Most of the time lost on this
task is spent implementing a protocol that does not exist.

## Prerequisites

- Prompt 02 finished: `createPriceChart()` renders synthetic bars.
- Prompt 01 finished if your source is DexScreener.
- Node 20+ for the test harness.

## Reference facts (verified)

### Lightweight Charts has no datafeed protocol

This is the single most important fact in this prompt. **Lightweight Charts has
no datafeed interface, no `Datafeed` class, no subscription contract, and no
concept of a symbol.** Confirmed against the v5.2.0 typings: the entire data
surface is two methods on a series.

```js
series.setData(arrayOfBars);  // replace everything
series.update(oneBar);        // append or replace the last bar
```

Bar shapes, and there are only two that matter:

```js
// Candlestick / Bar series
{ time: 1784577600, open: 1.02, high: 1.05, low: 1.01, close: 1.04 }

// Line / Area / Histogram / Baseline series
{ time: 1784577600, value: 1.04 }
```

`time` is **UNIX seconds** (or a `'YYYY-MM-DD'` string for daily and slower).
That is the whole contract. Anything else you have read is about a different
product.

### UDF is not this. Ignore it.

Searching "TradingView datafeed" returns an overwhelming volume of material
about **UDF**, the Universal Data Feed: an HTTP convention where your server
exposes `/config`, `/symbols`, `/search`, and `/history`, and a
`UDFCompatibleDatafeed` adapter consumes it. You will find tutorials,
boilerplates, and Stack Overflow answers, and almost none of them say which
library they are for.

**UDF belongs exclusively to TradingView Advanced Charts (the Charting
Library).** Advanced Charts is banned from public repositories by its license,
section 2.5 (see prompt 02). It is not in this toolkit and you cannot use it in
an open-source project.

Consequences:

- **Do not build `/config`, `/symbols`, or `/history` endpoints.** Nothing in
  your stack will ever call them. This is a genuinely common multi-day detour.
- Do not install `@tradingview/datafeed*` packages or vendor a `datafeeds/`
  directory.
- Do not implement `resolveSymbol`, `getBars`, `subscribeBars`, or
  `onReady`. Those are Advanced Charts callbacks. Lightweight Charts calls none
  of them.

What you build instead is smaller and entirely yours: a function that fetches
data, maps it to `{time, open, high, low, close}`, sorts it, and calls
`setData`. That is the "adapter" in this prompt's title. There is no framework
to satisfy, so define an interface that suits your app.

### The interface worth defining

Every source in this track fits one shape:

```ts
interface CandleSource {
  id: string;
  fetchBars(spec: PairSpec, opts: { interval: string, limit: number }): Promise<Bar[]>;
  subscribe?(spec: PairSpec, onBar: (bar: Bar) => void): () => void;  // optional
}
```

Standardising here is what lets prompt 05 swap GeckoTerminal for on-chain
aggregation without touching a line of chart code.

## Steps

### 1. Write the bar utilities

Validation belongs in one place. Every source will hand you unsorted bars,
duplicate timestamps, millisecond timestamps, or nulls at least once.

`src/bars.js`:

```js
/**
 * robinhood-toolkit · OHLCV bar normalisation
 * Author: nirholas · https://github.com/nirholas/robinhood-toolkit
 * License: All Rights Reserved (c) 2026 nirholas
 */

/** Interval label -> seconds. The one place this mapping lives. */
export const INTERVAL_SECONDS = {
  '1m': 60, '5m': 300, '15m': 900, '30m': 1800,
  '1h': 3600, '4h': 14400, '12h': 43200,
  '1d': 86400, '1w': 604800,
};

export function intervalSeconds(interval) {
  const s = INTERVAL_SECONDS[interval];
  if (!s) {
    throw new Error(
      `Unknown interval "${interval}". Known: ${Object.keys(INTERVAL_SECONDS).join(', ')}`,
    );
  }
  return s;
}

/**
 * Coerce a timestamp to UNIX SECONDS.
 * Heuristic: anything past ~year 2286 in seconds is really milliseconds.
 * This catches the single most common charting bug in the wild.
 */
export function toSeconds(t) {
  const n = Number(t);
  if (!Number.isFinite(n)) throw new Error(`Bad timestamp: ${t}`);
  return n > 1e10 ? Math.floor(n / 1000) : Math.floor(n);
}

/** Floor a timestamp to the start of its bucket. */
export function bucketStart(tsSec, stepSec) {
  return Math.floor(tsSec / stepSec) * stepSec;
}

/**
 * Sort ascending, drop invalid bars, collapse duplicate timestamps.
 * Lightweight Charts throws "Cannot update oldest data" on unsorted input and
 * renders duplicates unpredictably, so this is not optional.
 *
 * On a duplicate timestamp the LAST bar wins: sources that stream a forming
 * bar emit the same timestamp repeatedly with a more current close.
 */
export function normaliseBars(bars) {
  const byTime = new Map();

  for (const b of bars) {
    if (!b) continue;
    const time = toSeconds(b.time);
    const open = Number(b.open);
    const high = Number(b.high);
    const low = Number(b.low);
    const close = Number(b.close);
    if (![open, high, low, close].every(Number.isFinite)) continue;
    if (open <= 0 || close <= 0) continue;

    byTime.set(time, {
      time,
      open,
      // Repair sources that report a high below the body, which happens when a
      // provider computes extremes from a different trade set than open/close.
      high: Math.max(high, open, close),
      low: Math.min(low, open, close),
      close,
      volume: Number.isFinite(Number(b.volume)) ? Number(b.volume) : 0,
    });
  }

  return [...byTime.values()].sort((a, b) => a.time - b.time);
}

/** Candles -> line points, for a Line/Area series. */
export function toLine(bars, field = 'close') {
  return bars.map((b) => ({ time: b.time, value: b[field] }));
}

/**
 * Insert whitespace for gaps so a thin pair does not draw a straight line
 * across hours with no trades. Lightweight Charts renders a bar with only a
 * `time` key as a gap.
 */
export function withGaps(bars, stepSec) {
  if (bars.length < 2) return bars;
  const out = [];
  for (let i = 0; i < bars.length; i += 1) {
    out.push(bars[i]);
    const next = bars[i + 1];
    if (!next) break;
    const missing = (next.time - bars[i].time) / stepSec - 1;
    // Cap the fill so a month-long gap does not allocate a huge array.
    if (missing > 0 && missing <= 500) {
      for (let k = 1; k <= missing; k += 1) {
        out.push({ time: bars[i].time + k * stepSec });
      }
    }
  }
  return out;
}

/** Aggregate fine bars into coarser ones. 1m -> 15m without a second request. */
export function resample(bars, targetSec) {
  const buckets = new Map();
  for (const b of bars) {
    const key = bucketStart(b.time, targetSec);
    const acc = buckets.get(key);
    if (!acc) {
      buckets.set(key, { ...b, time: key });
    } else {
      acc.high = Math.max(acc.high, b.high);
      acc.low = Math.min(acc.low, b.low);
      acc.close = b.close;                 // bars arrive ascending
      acc.volume = (acc.volume ?? 0) + (b.volume ?? 0);
    }
  }
  return [...buckets.values()].sort((a, b) => a.time - b.time);
}
```

### 2. Define the source interface and a null source

`src/sources/index.js`:

```js
/**
 * robinhood-toolkit · candle source registry
 * Author: nirholas · https://github.com/nirholas/robinhood-toolkit
 * License: All Rights Reserved (c) 2026 nirholas
 *
 * A CandleSource implements:
 *   id: string
 *   fetchBars(spec, { interval, limit }) -> Promise<Bar[]>
 *   subscribe?(spec, onBar) -> unsubscribe()
 *
 * `spec` is { chainId, pairAddress, baseSymbol?, quoteSymbol? }.
 * This is OUR interface, not a TradingView one. Lightweight Charts defines no
 * datafeed protocol; see the prompt body.
 */

const registry = new Map();

export function registerSource(source) {
  if (!source?.id || typeof source.fetchBars !== 'function') {
    throw new Error('A CandleSource needs an id and a fetchBars(spec, opts) method');
  }
  registry.set(source.id, source);
  return source;
}

export function getSource(id) {
  const s = registry.get(id);
  if (!s) {
    throw new Error(`No candle source "${id}". Registered: ${[...registry.keys()].join(', ') || 'none'}`);
  }
  return s;
}

export function listSources() {
  return [...registry.keys()];
}
```

### 3. Write the adapter

This is the piece that owns the chart's data lifecycle: load, swap pair, swap
interval, live-update, tear down.

`src/adapter.js`:

```js
/**
 * robinhood-toolkit · data adapter for Lightweight Charts
 * Author: nirholas · https://github.com/nirholas/robinhood-toolkit
 * License: All Rights Reserved (c) 2026 nirholas
 */
import { getSource } from './sources/index.js';
import { normaliseBars, intervalSeconds, withGaps, bucketStart } from './bars.js';

/**
 * @param {ReturnType<import('./chart.js').createPriceChart>} view
 * @param {object} [opts]
 * @param {boolean} [opts.fillGaps=true]
 */
export function createAdapter(view, opts = {}) {
  const { fillGaps = true } = opts;

  let current = null;        // { sourceId, spec, interval }
  let unsubscribe = null;
  let generation = 0;        // guards against out-of-order responses
  let lastBar = null;
  const listeners = new Set();

  function emit(event) {
    for (const fn of listeners) fn(event);
  }

  async function load({ sourceId, spec, interval = '1h', limit = 500 }) {
    const gen = ++generation;

    if (unsubscribe) { unsubscribe(); unsubscribe = null; }

    current = { sourceId, spec, interval };
    emit({ type: 'loading', spec, interval });

    let bars;
    try {
      const source = getSource(sourceId);
      const raw = await source.fetchBars(spec, { interval, limit });
      // A newer load() started while this was in flight. Discard: applying it
      // would paint the previous pair's data onto the current chart.
      if (gen !== generation) return null;
      bars = normaliseBars(raw);
    } catch (err) {
      if (gen !== generation) return null;
      emit({ type: 'error', error: err, spec, interval });
      throw err;
    }

    if (bars.length === 0) {
      view.setData([]);
      lastBar = null;
      emit({ type: 'empty', spec, interval });
      return [];
    }

    const step = intervalSeconds(interval);
    view.setData(fillGaps ? withGaps(bars, step) : bars);
    lastBar = bars[bars.length - 1];
    emit({ type: 'loaded', count: bars.length, spec, interval, last: lastBar });

    const source = getSource(sourceId);
    if (typeof source.subscribe === 'function') {
      unsubscribe = source.subscribe(spec, (bar) => {
        if (gen !== generation) return;
        pushBar(bar, step);
      });
    }

    return bars;
  }

  /**
   * Apply one bar. Handles the three real cases: same bucket (replace),
   * next bucket (append), stale bucket (ignore).
   */
  function pushBar(raw, stepSec) {
    const [bar] = normaliseBars([raw]);
    if (!bar) return;

    if (lastBar && bar.time < lastBar.time) return;   // stale, would throw

    view.update(bar);
    lastBar = bar;
    emit({ type: 'bar', bar });
  }

  /**
   * Fold a single trade or price tick into the forming bar. Use this when the
   * source gives you prices rather than candles (see prompt 06).
   */
  function pushPrice(priceUsd, tsSec = Math.floor(Date.now() / 1000), volume = 0) {
    if (!current) return;
    const step = intervalSeconds(current.interval);
    const slot = bucketStart(tsSec, step);
    const price = Number(priceUsd);
    if (!Number.isFinite(price) || price <= 0) return;

    if (lastBar && slot === lastBar.time) {
      pushBar({
        time: slot,
        open: lastBar.open,
        high: Math.max(lastBar.high, price),
        low: Math.min(lastBar.low, price),
        close: price,
        volume: (lastBar.volume ?? 0) + volume,
      }, step);
    } else if (!lastBar || slot > lastBar.time) {
      pushBar({ time: slot, open: lastBar?.close ?? price, high: price, low: price, close: price, volume }, step);
    }
  }

  return {
    load,
    pushBar: (bar) => pushBar(bar, intervalSeconds(current?.interval ?? '1h')),
    pushPrice,
    /** Reload the same pair at a different interval. */
    setInterval: (interval) => load({ ...current, interval }),
    /** Load a different pair at the same interval. */
    setPair: (spec) => load({ ...current, spec }),
    on: (fn) => { listeners.add(fn); return () => listeners.delete(fn); },
    get state() { return current ? { ...current, lastBar } : null; },
    destroy() {
      generation += 1;
      if (unsubscribe) unsubscribe();
      unsubscribe = null;
      listeners.clear();
    },
  };
}
```

### 4. Prove it with a deterministic fixture source

Test the adapter without a network. If the adapter is correct here, every real
source reduces to writing one `fetchBars`.

`src/sources/fixture.js`:

```js
/**
 * robinhood-toolkit · deterministic fixture candle source
 * Author: nirholas · https://github.com/nirholas/robinhood-toolkit
 * License: All Rights Reserved (c) 2026 nirholas
 */
import { registerSource } from './index.js';
import { intervalSeconds, bucketStart } from '../bars.js';

/** Deliberately returns hostile data: descending, duplicated, ms timestamps. */
export const fixtureSource = registerSource({
  id: 'fixture',
  async fetchBars(spec, { interval = '1h', limit = 200 } = {}) {
    const step = intervalSeconds(interval);
    const end = bucketStart(Math.floor(Date.now() / 1000), step);
    const bars = [];
    let price = 1;
    for (let i = 0; i < limit; i += 1) {
      const close = price * (1 + (Math.sin(i / 7) * 0.02));
      bars.push({
        time: (end - i * step) * 1000,          // milliseconds, on purpose
        open: price,
        high: Math.max(price, close) * 1.004,
        low: Math.min(price, close) * 0.996,
        close,
        volume: 1000 + (i % 13) * 250,
      });
      price = close;
    }
    bars.push({ ...bars[0] });                   // duplicate, on purpose
    return bars;                                 // descending, on purpose
  },
});
```

`test/adapter.test.mjs` (node's built-in runner, no dependency):

```js
/**
 * robinhood-toolkit · adapter tests
 * Author: nirholas · https://github.com/nirholas/robinhood-toolkit
 * License: All Rights Reserved (c) 2026 nirholas
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createAdapter } from '../src/adapter.js';
import '../src/sources/fixture.js';
import { normaliseBars, resample, toSeconds } from '../src/bars.js';

/** Stand-in for createPriceChart(); records what the chart would receive. */
function fakeView() {
  const state = { data: [], updates: [] };
  return {
    state,
    setData: (d) => { state.data = d; },
    update: (b) => { state.updates.push(b); },
    fit() {}, destroy() {},
  };
}

test('normaliseBars sorts, dedupes, and converts ms to seconds', () => {
  const out = normaliseBars([
    { time: 1784577600000, open: 1, high: 2, low: 0.5, close: 1.5 },
    { time: 1784574000000, open: 1, high: 2, low: 0.5, close: 1.2 },
    { time: 1784577600000, open: 1, high: 2, low: 0.5, close: 1.9 },
  ]);
  assert.equal(out.length, 2);
  assert.ok(out[0].time < out[1].time, 'ascending');
  assert.ok(out[1].time < 1e10, 'seconds not milliseconds');
  assert.equal(out[1].close, 1.9, 'last duplicate wins');
});

test('normaliseBars repairs a high below the body', () => {
  const [bar] = normaliseBars([{ time: 1784577600, open: 5, high: 3, low: 6, close: 4 }]);
  assert.equal(bar.high, 5);
  assert.equal(bar.low, 4);
});

test('adapter loads hostile fixture data in chart-ready order', async () => {
  const view = fakeView();
  const adapter = createAdapter(view, { fillGaps: false });
  const bars = await adapter.load({
    sourceId: 'fixture',
    spec: { chainId: 'robinhood', pairAddress: '0xtest' },
    interval: '1h',
    limit: 50,
  });

  assert.equal(bars.length, 50, 'duplicate collapsed');
  for (let i = 1; i < view.state.data.length; i += 1) {
    assert.ok(view.state.data[i].time > view.state.data[i - 1].time, 'strictly ascending');
  }
  adapter.destroy();
});

test('pushPrice folds ticks into the forming bar then rolls over', async () => {
  const view = fakeView();
  const adapter = createAdapter(view, { fillGaps: false });
  await adapter.load({
    sourceId: 'fixture', spec: { pairAddress: '0xtest' }, interval: '1h', limit: 10,
  });

  const t = adapter.state.lastBar.time;
  adapter.pushPrice(999, t + 10);
  assert.equal(view.state.updates.at(-1).high, 999, 'extends the current bar');
  assert.equal(view.state.updates.at(-1).time, t, 'same bucket');

  adapter.pushPrice(500, t + 3600);
  assert.equal(view.state.updates.at(-1).time, t + 3600, 'new bucket');

  const before = view.state.updates.length;
  adapter.pushPrice(1, t - 7200);
  assert.equal(view.state.updates.length, before, 'stale tick ignored');
  adapter.destroy();
});

test('resample folds 1m bars into 15m', () => {
  const base = Math.floor(Date.now() / 1000 / 900) * 900;
  const mins = Array.from({ length: 15 }, (_, i) => ({
    time: base + i * 60, open: 1 + i, high: 2 + i, low: i * 0.5, close: 1.5 + i, volume: 10,
  }));
  const [bar] = resample(mins, 900);
  assert.equal(bar.time, base);
  assert.equal(bar.open, 1);
  assert.equal(bar.close, 15.5);
  assert.equal(bar.volume, 150);
});

test('toSeconds distinguishes seconds from milliseconds', () => {
  assert.equal(toSeconds(1784577600), 1784577600);
  assert.equal(toSeconds(1784577600000), 1784577600);
});
```

```sh
node --test test/
```

## Deliverable

- `src/bars.js`: `normaliseBars`, `toSeconds`, `bucketStart`, `intervalSeconds`,
  `resample`, `withGaps`, `toLine`.
- `src/sources/index.js`: the `CandleSource` registry.
- `src/sources/fixture.js`: a deliberately hostile fixture source.
- `src/adapter.js`: `createAdapter()` with `load`, `pushBar`, `pushPrice`,
  `setInterval`, `setPair`, `on`, `destroy`, and generation guarding.
- `test/adapter.test.mjs`, green under `node --test`.
- A `docs/DATAFEED.md` stating in one paragraph that Lightweight Charts has no
  datafeed protocol and that UDF is Advanced Charts only. Future-you will search
  for this.

## How to verify

1. `node --test test/` passes every case.
2. Wire the adapter to prompt 02's real chart with the fixture source. Candles
   render despite the fixture returning descending, duplicated, millisecond data.
3. Race check: call `load()` for two pairs back to back with an artificial delay
   in the slower one. The chart shows the second pair. The first response is
   discarded, not painted.
4. `adapter.setInterval('15m')` redraws without a page reload and without
   leaking the previous subscription (log inside `unsubscribe`).
5. `grep -rn "UDFCompatibleDatafeed\|resolveSymbol\|getBars\|/history" src/`
   returns nothing. If it finds something, you built the wrong protocol.

## Gotchas

- **There is no datafeed protocol to implement.** If you find yourself writing a
  `/history` endpoint or a `resolveSymbol` callback, stop. That is Advanced
  Charts, which this project cannot use.
- **Milliseconds are the default bug.** Most APIs return ms, Lightweight Charts
  wants seconds, and the failure mode is a silently empty chart rather than an
  error. `toSeconds` guards it. Run every timestamp through it at the boundary.
- **Unsorted data throws.** v5 raises `Cannot update oldest data` when
  `setData` or `update` receives a timestamp before the current last bar.
  Sources that return newest-first (GeckoTerminal does, see prompt 05) will hit
  this immediately.
- **Duplicate timestamps must collapse, last write wins.** A forming bar is
  re-sent with the same timestamp and a newer close. Keeping both corrupts the
  series.
- **Guard against out-of-order responses.** A user clicking three pairs quickly
  fires three fetches that can resolve in any order. Without the generation
  counter you paint pair A's candles on pair C's chart, and it looks like a data
  bug rather than a race.
- `update()` only accepts a bar at or after the last one. To rewrite history you
  must call `setData` with the full corrected array.
- Do not fill gaps by repeating the previous close. That invents trades that
  never happened and distorts every indicator computed downstream. Emit
  whitespace (`{ time }` only) so the chart shows a real gap.
- Keep `resample` on the client for interval switching, but do not build a 1d
  view by resampling 1m bars. Fetch the coarse interval from the source. You
  would need 500k bars to cover a year at 1m.
