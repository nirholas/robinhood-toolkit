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
