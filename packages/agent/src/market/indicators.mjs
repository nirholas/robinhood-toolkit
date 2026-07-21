/**
 * robinhood-toolkit · indicators over closed bars
 * Author: nirholas · https://github.com/nirholas/robinhood-toolkit
 * License: All Rights Reserved (c) 2026 nirholas
 *
 * Pure functions over an array of closed-bar values (usually closes). Each one
 * returns `null` — never a partial value — when there is not enough history.
 * A silent SMA over 3 samples when you asked for 20 is a strategy trading
 * garbage during its warm-up, so the caller must handle `null` as "no opinion".
 */

/** Simple moving average of the last `n` values. `null` if history < n. */
export function sma(values, n) {
  if (!Array.isArray(values) || n <= 0 || values.length < n) return null;
  const window = values.slice(-n);
  return window.reduce((a, b) => a + b, 0) / n;
}

/**
 * Exponential moving average of the last `n` values. Seeded with an SMA over
 * the first `n` samples, then walked forward. `null` if history < n.
 */
export function ema(values, n) {
  if (!Array.isArray(values) || n <= 0 || values.length < n) return null;
  const k = 2 / (n + 1);
  let acc = sma(values.slice(0, n), n);
  for (const v of values.slice(n)) acc = v * k + acc * (1 - k);
  return acc;
}

/**
 * Z-score of the most recent value against the last `n`-sample window.
 * Returns 0 when the window is perfectly flat (sd === 0) — a flat feed is
 * usually broken, not calm, so treat 0 with suspicion upstream. `null` if
 * history < n.
 */
export function zscore(values, n) {
  const mean = sma(values, n);
  if (mean === null) return null;
  const window = values.slice(-n);
  const variance = window.reduce((a, v) => a + (v - mean) ** 2, 0) / n;
  const sd = Math.sqrt(variance);
  if (sd === 0) return 0;
  return (values.at(-1) - mean) / sd;
}
