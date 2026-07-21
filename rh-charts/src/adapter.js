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
