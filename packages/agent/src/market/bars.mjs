/**
 * robinhood-toolkit · streaming bar aggregation
 * Author: nirholas · https://github.com/nirholas/robinhood-toolkit
 * License: All Rights Reserved (c) 2026 nirholas
 *
 * Aggregates raw (ts, price, size) ticks into fixed-duration OHLCV bars. A bar
 * is only ever exposed once its bucket is entirely in the past. The bar still
 * filling is never returned — an in-progress bar is the single most common
 * source of a live-versus-backtest mismatch, because an indicator computed over
 * it changes within the bucket and cannot reproduce on replay.
 */
export function createBarAggregator({ bucketMs = 60_000, maxBars = 500 } = {}) {
  const bars = [];
  let current = null;

  function bucketStart(ts) {
    return Math.floor(ts / bucketMs) * bucketMs;
  }

  return {
    /** Push a tick. Returns a newly closed bar when one completes, else null. */
    push({ ts, price, size = 0 }) {
      const start = bucketStart(ts);
      let closed = null;

      if (current && start > current.start) {
        closed = current;
        bars.push(closed);
        if (bars.length > maxBars) bars.shift();
        current = null;
      }
      if (!current) {
        current = {
          start,
          duration: bucketMs,
          ts: start,
          open: price,
          high: price,
          low: price,
          close: price,
          volume: size,
          ticks: 0,
        };
      }
      current.high = Math.max(current.high, price);
      current.low = Math.min(current.low, price);
      current.close = price;
      current.volume += size;
      current.ticks += 1;
      return closed;
    },

    /** Closed bars only. The in-progress bar is never included. */
    closed() {
      return bars.slice();
    },

    lastClosed() {
      return bars.at(-1) ?? null;
    },
  };
}
