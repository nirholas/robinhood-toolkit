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
