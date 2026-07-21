/* built by nirholas x.com/nichxbt */
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
/* built by nirholas x.com/nichxbt */
