<!-- built by nirholas x.com/nichxbt -->
<!--
  robinhood-toolkit · build prompt: chart performance and memory
  Author: nirholas · https://github.com/nirholas/robinhood-toolkit
  License: All Rights Reserved (c) 2026 nirholas
-->

# 08 · Chart performance

## Goal

Make the charts from prompts 02 through 07 hold 60fps with large datasets, many
instances, and a live feed running for hours. End state: a measured benchmark, a
lazy-mount strategy, coalesced updates, and a leak-free teardown, with numbers
proving each one.

Measure first. Every fix in this file should be justified by a number you took
yourself, not by this document.

## Prerequisites

- Prompts 02, 04, 06, 07 finished.
- Chrome or Firefox devtools. Performance and Memory panels.
- `npm install --save-dev vitest@^2` for the benchmark harness, or use
  `node --test`.

## Reference facts (verified)

- Lightweight Charts v5.2.0 renders to a **single canvas**, not DOM nodes per
  bar. Bar count affects data handling and hit-testing, not node count. This is
  why it outperforms SVG charting libraries at scale.
- Blocks on Robinhood Chain are roughly **94 ms** (measured, prompt 05). A live
  feed can therefore fire **10+ update opportunities per second**. Chart updates
  must be coalesced to the frame, or you do redundant work between paints.
- **`chart.remove()` is the only complete teardown.** Removing the container
  element does not release the canvas contexts or the internal listeners.
  Combined with the `ResizeObserver` from prompt 02, both must be disposed.
- `setData()` replaces the entire dataset and forces a full recompute.
  `update()` touches one bar. On a live chart, calling `setData` per tick is the
  single most expensive mistake available.
- GeckoTerminal caps `limit` at **1000** bars per request (prompt 05). A year of
  hourly candles is 8,760 bars and needs pagination, so "just load everything"
  is a decision with a real cost.

## Steps

### 1. Benchmark before optimising

`bench/chart-bench.mjs`:

```js
/**
 * robinhood-toolkit · chart benchmark harness
 * Author: nirholas · https://github.com/nirholas/robinhood-toolkit
 * License: All Rights Reserved (c) 2026 nirholas
 *
 * Run in a browser (npm run dev, then open /bench). Canvas rendering needs a
 * real DOM, so a headless Node run measures data handling only.
 */
import { createPriceChart } from '../src/chart.js';

function makeBars(n, stepSec = 60) {
  const end = Math.floor(Date.now() / 1000 / stepSec) * stepSec;
  const bars = new Array(n);
  let price = 100;
  for (let i = 0; i < n; i += 1) {
    const open = price;
    const close = open * (1 + (Math.sin(i / 13) + Math.random() - 0.5) * 0.01);
    bars[i] = {
      time: end - (n - 1 - i) * stepSec,
      open,
      high: Math.max(open, close) * 1.002,
      low: Math.min(open, close) * 0.998,
      close,
      volume: 1000 + (i % 97) * 10,
    };
    price = close;
  }
  return bars;
}

function time(label, fn) {
  const t0 = performance.now();
  const out = fn();
  const ms = performance.now() - t0;
  console.log(`${label.padEnd(38)} ${ms.toFixed(1)} ms`);
  return { ms, out };
}

async function measureFps(ms = 3000) {
  return new Promise((resolve) => {
    let frames = 0;
    const start = performance.now();
    const tick = () => {
      frames += 1;
      if (performance.now() - start < ms) requestAnimationFrame(tick);
      else resolve((frames / (performance.now() - start)) * 1000);
    };
    requestAnimationFrame(tick);
  });
}

export async function runBench(host) {
  for (const n of [1_000, 10_000, 100_000]) {
    const el = document.createElement('div');
    el.style.cssText = 'width:900px;height:400px';
    host.appendChild(el);

    const bars = makeBars(n);
    const view = time(`create chart (${n} bars)`, () => createPriceChart(el, { volume: true })).out;
    time(`setData ${n}`, () => view.setData(bars));
    time(`fitContent ${n}`, () => view.fit());

    const last = bars[bars.length - 1];
    time(`1000x update() ${n}`, () => {
      for (let i = 0; i < 1000; i += 1) {
        view.update({ ...last, close: last.close * (1 + (i % 7) * 1e-4) });
      }
    });

    const fps = await measureFps(2000);
    console.log(`${`idle fps (${n} bars)`.padEnd(38)} ${fps.toFixed(1)}`);

    view.destroy();
    el.remove();
  }

  // Many small charts: the dashboard case from prompt 07.
  const tiles = [];
  time('create 30 sparkline charts', () => {
    for (let i = 0; i < 30; i += 1) {
      const el = document.createElement('div');
      el.style.cssText = 'width:240px;height:56px';
      host.appendChild(el);
      const view = createPriceChart(el, { volume: false, height: 56 });
      view.setData(makeBars(120));
      tiles.push({ view, el });
    }
  });
  const gridFps = await measureFps(2000);
  console.log(`${'idle fps (30 charts)'.padEnd(38)} ${gridFps.toFixed(1)}`);
  time('destroy 30 charts', () => {
    for (const t of tiles) { t.view.destroy(); t.el.remove(); }
  });
}
```

Record the numbers. Optimise what is actually slow on your hardware.

### 2. Coalesce updates to the animation frame

At ~94 ms blocks with several swaps each, ticks arrive faster than the display
refreshes. Batch them.

`src/perf/coalesce.js`:

```js
/**
 * robinhood-toolkit · frame-coalesced chart updates
 * Author: nirholas · https://github.com/nirholas/robinhood-toolkit
 * License: All Rights Reserved (c) 2026 nirholas
 */

/**
 * Collapse many update() calls into one per animation frame. Only the newest
 * bar per timestamp survives, which is exactly right for a forming candle.
 *
 * @param {(bar: object) => void} apply
 */
export function coalesceUpdates(apply) {
  /** @type {Map<number, object>} */
  const pending = new Map();
  let frame = null;
  let dropped = 0;

  function flush() {
    frame = null;
    if (pending.size === 0) return;
    // Ascending: update() throws on a timestamp before the last applied one.
    const bars = [...pending.values()].sort((a, b) => a.time - b.time);
    pending.clear();
    for (const bar of bars) apply(bar);
  }

  return {
    push(bar) {
      if (pending.has(bar.time)) dropped += 1;
      pending.set(bar.time, bar);
      // A hidden tab never fires rAF. Without this the map grows unbounded
      // for as long as the tab stays backgrounded.
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
        if (pending.size > 64) flush();
        return;
      }
      if (frame === null) frame = requestAnimationFrame(flush);
    },
    flush,
    get stats() { return { pending: pending.size, dropped }; },
    destroy() {
      if (frame !== null) cancelAnimationFrame(frame);
      frame = null;
      pending.clear();
    },
  };
}
```

Wire it into the adapter from prompt 04 by routing `view.update` through it:

```js
import { coalesceUpdates } from './perf/coalesce.js';

const coalescer = coalesceUpdates((bar) => view.update(bar));
const adapter = createAdapter({ ...view, update: (bar) => coalescer.push(bar) });
// remember coalescer.destroy() in teardown
```

### 3. Cap the in-memory series

An unbounded chart on a live feed grows forever. Trim as you go.

`src/perf/window.js`:

```js
/**
 * robinhood-toolkit · rolling bar window
 * Author: nirholas · https://github.com/nirholas/robinhood-toolkit
 * License: All Rights Reserved (c) 2026 nirholas
 */

/**
 * Keep at most `max` bars in the series. Trimming requires setData (update()
 * cannot remove bars), so amortise: only trim once the overflow is worth the
 * full recompute.
 *
 * @param {{setData:(b:any[])=>void, update:(b:any)=>void}} view
 * @param {{max?:number, slack?:number}} [opts]
 */
export function createRollingWindow(view, { max = 5000, slack = 500 } = {}) {
  let bars = [];

  return {
    set(next) {
      bars = next.length > max ? next.slice(next.length - max) : next.slice();
      view.setData(bars);
    },
    push(bar) {
      const last = bars[bars.length - 1];
      if (last && bar.time === last.time) bars[bars.length - 1] = bar;
      else if (!last || bar.time > last.time) bars.push(bar);
      else return;                       // stale, update() would throw

      view.update(bar);

      if (bars.length > max + slack) {
        bars = bars.slice(bars.length - max);
        view.setData(bars);              // one recompute per `slack` bars
      }
    },
    get length() { return bars.length; },
    get bars() { return bars; },
  };
}
```

### 4. Lazy-mount off-screen charts

On the prompt 07 dashboard, most tiles are below the fold. Do not build charts
nobody is looking at.

`src/perf/lazy-mount.js`:

```js
/**
 * robinhood-toolkit · viewport-gated chart mounting
 * Author: nirholas · https://github.com/nirholas/robinhood-toolkit
 * License: All Rights Reserved (c) 2026 nirholas
 */

/**
 * Build a chart when its container nears the viewport; tear it down when it is
 * far away. Data keeps flowing into the store either way, so a remounted tile
 * repaints instantly with current data.
 *
 * @param {{ mount:(el:HTMLElement)=>object, unmount:(inst:object)=>void, rootMargin?:string }} opts
 */
export function createLazyMounter({ mount, unmount, rootMargin = '200px' }) {
  const instances = new Map();

  const observer = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      const el = entry.target;
      if (entry.isIntersecting && !instances.has(el)) {
        instances.set(el, mount(el));
      } else if (!entry.isIntersecting && instances.has(el)) {
        unmount(instances.get(el));
        instances.delete(el);
      }
    }
  }, { rootMargin });

  return {
    observe(el) { observer.observe(el); },
    unobserve(el) {
      observer.unobserve(el);
      const inst = instances.get(el);
      if (inst) { unmount(inst); instances.delete(el); }
    },
    get mounted() { return instances.size; },
    destroy() {
      observer.disconnect();
      for (const inst of instances.values()) unmount(inst);
      instances.clear();
    },
  };
}
```

### 5. Prove there is no leak

Leaks in charting code show up as a tab that dies after an hour, which nobody
catches in a 30-second manual test. Automate it.

`test/leak.test.mjs`:

```js
/**
 * robinhood-toolkit · teardown and leak checks
 * Author: nirholas · https://github.com/nirholas/robinhood-toolkit
 * License: All Rights Reserved (c) 2026 nirholas
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { coalesceUpdates } from '../src/perf/coalesce.js';
import { createRollingWindow } from '../src/perf/window.js';

function fakeView() {
  const calls = { setData: 0, update: 0 };
  let data = [];
  return {
    calls,
    get data() { return data; },
    setData(d) { calls.setData += 1; data = d; },
    update(b) {
      calls.update += 1;
      const last = data[data.length - 1];
      // Mirror the real throw so tests catch ordering bugs.
      if (last && b.time < last.time) throw new Error('Cannot update oldest data');
      if (last && b.time === last.time) data[data.length - 1] = b;
      else data.push(b);
    },
  };
}

test('coalescer collapses same-timestamp updates into one apply', () => {
  const applied = [];
  const c = coalesceUpdates((bar) => applied.push(bar));
  for (let i = 0; i < 100; i += 1) c.push({ time: 1000, close: i });
  c.flush();
  assert.equal(applied.length, 1, 'one apply for 100 pushes');
  assert.equal(applied[0].close, 99, 'newest wins');
  assert.equal(c.stats.dropped, 99);
  c.destroy();
});

test('coalescer flushes in ascending time order', () => {
  const applied = [];
  const c = coalesceUpdates((bar) => applied.push(bar.time));
  c.push({ time: 3000 });
  c.push({ time: 1000 });
  c.push({ time: 2000 });
  c.flush();
  assert.deepEqual(applied, [1000, 2000, 3000]);
  c.destroy();
});

test('rolling window caps memory and amortises setData', () => {
  const view = fakeView();
  const w = createRollingWindow(view, { max: 100, slack: 20 });
  w.set(Array.from({ length: 100 }, (_, i) => ({ time: i * 60, close: 1 })));

  const setDataAfterSeed = view.calls.setData;
  for (let i = 100; i < 400; i += 1) w.push({ time: i * 60, close: 2 });

  assert.ok(w.length <= 120, `window bounded, got ${w.length}`);
  const trims = view.calls.setData - setDataAfterSeed;
  assert.ok(trims <= 300 / 20 + 1, `amortised trims, got ${trims}`);
  assert.ok(trims >= 1, 'did trim at least once');
});

test('rolling window drops stale bars instead of throwing', () => {
  const view = fakeView();
  const w = createRollingWindow(view, { max: 50 });
  w.set([{ time: 6000, close: 1 }]);
  assert.doesNotThrow(() => w.push({ time: 60, close: 9 }));
  assert.equal(w.length, 1);
});
```

Browser-side leak check, run it by hand once:

1. Devtools, Memory, take a heap snapshot.
2. Navigate to the chart route and back 20 times.
3. Force GC, take a second snapshot, filter for `Detached`.
4. Detached canvases or `IChartApi` instances should be **zero**. Any growth
   means a missing `chart.remove()`, a live `ResizeObserver`, or a retained
   `IntersectionObserver`.

### 6. Budget your data

Bar counts, and what they cost:

| Range | Interval | Bars | Verdict |
|---|---|---|---|
| 1 day | 1m | 1,440 | fine |
| 1 week | 5m | 2,016 | fine |
| 1 month | 15m | 2,880 | fine |
| 1 year | 1h | 8,760 | 9 paginated GeckoTerminal requests |
| 1 year | 1m | 525,600 | do not |

Load the interval that matches the range. Prompt 04's `resample` handles zooming
in on data you already have, but never build a long range out of fine bars.

## Deliverable

- `bench/chart-bench.mjs` plus a `/bench` route, with your measured numbers
  committed in `docs/PERFORMANCE.md`.
- `src/perf/coalesce.js`, `src/perf/window.js`, `src/perf/lazy-mount.js`.
- `test/leak.test.mjs`, green.
- The prompt 07 dashboard using the lazy mounter, with a documented before and
  after for mounted-chart count and idle fps.
- Teardown paths verified: every `createChart` has a matching `remove()`, every
  observer a `disconnect()`, every timer a `clear`.

## How to verify

1. `node --test test/` passes.
2. Run the browser benchmark and record: `setData` at 100k bars, idle fps at
   100k bars, idle fps with 30 charts, and time to destroy 30 charts. If idle
   fps with 30 sparklines is below 55, the lazy mounter is not doing its job.
3. Coalescing, measured not assumed. Log `coalescer.stats.dropped` after 60
   seconds on a live pair. On an active pool it should be well above zero,
   proving redundant paints were skipped.
4. Heap snapshot test from step 5. Zero detached canvases after 20 navigations.
5. Scroll the dashboard to the bottom and back. `mounted` stays near the visible
   count rather than climbing to the board size.
6. Run a live chart for one hour. `window.length` stays at the cap. Heap is flat.
7. Background the tab for 10 minutes with a live feed, then return. The
   coalescer's pending map is bounded (the 64 cap), not thousands of entries.
8. Throttle CPU to 6x in devtools and interact. Panning and zooming stay usable.

## Gotchas

- **Never call `setData` on a tick.** It recomputes the whole series. On a live
  feed it is the difference between 60fps and single digits. `update()` for
  ticks, `setData` only for a full replacement or an amortised trim.
- **`requestAnimationFrame` does not fire in a hidden tab.** A naive coalescer
  accumulates pending bars for the entire time a tab is backgrounded. The size
  cap in `push` is what prevents that unbounded map.
- **Coalesced bars must be flushed in ascending time order.** A `Map` preserves
  insertion order, not time order, and a feed can hand you a bucket rollover
  before a late tick for the previous bucket. Sort before applying or `update()`
  throws.
- **`chart.remove()` is mandatory, and removing the DOM node is not enough.**
  Canvas contexts and internal listeners survive. Twenty route changes without
  it will noticeably degrade the tab.
- **`ResizeObserver` and `IntersectionObserver` hold strong references to their
  targets.** Not disconnecting them keeps every tile and its chart alive even
  after the DOM node is gone. This is the most common leak in dashboard code.
- **Do not resample a long range from fine bars.** A year at 1m is 525,600 bars.
  Request the coarse interval from the source instead.
- Trim with slack. Calling `setData` on every push past the cap turns a cheap
  `update` into a full recompute on every tick, which is worse than not trimming
  at all.
- `autoSize: true` plus a `ResizeObserver` that calls `chart.resize()` can loop
  if your resize handler changes the container's size. Only resize from measured
  `contentRect` values, and never write layout inside the observer callback.
- Volume as a second series roughly doubles per-update work. On 56px sparklines
  (prompt 07) skip it entirely, which the tile code already does.
- Benchmark on the hardware your users have. A 100k-bar chart is smooth on a
  developer laptop and unusable on a low-end phone. Throttle CPU before you
  declare a target met.
<!-- built by nirholas x.com/nichxbt -->
