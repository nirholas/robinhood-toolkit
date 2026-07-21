/* built by nirholas x.com/nichxbt */
/**
 * robinhood-toolkit · teardown and leak checks
 * Author: nirholas · https://github.com/nirholas/robinhood-toolkit
 * License: All Rights Reserved (c) 2026 nirholas
 */
import test from 'node:test';
import assert from 'node:assert/strict';

// perf/coalesce.js targets the browser and schedules on requestAnimationFrame.
// Node has no rAF, so provide the two globals the module reaches for. The tests
// drive flush() by hand, so this only needs to exist, not to actually paint.
globalThis.requestAnimationFrame ??= (cb) => setTimeout(() => cb(Date.now()), 0);
globalThis.cancelAnimationFrame ??= (id) => clearTimeout(id);

const { coalesceUpdates } = await import('../src/perf/coalesce.js');
const { createRollingWindow } = await import('../src/perf/window.js');

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
/* built by nirholas x.com/nichxbt */
