/* built by nirholas x.com/nichxbt */
/**
 * robinhood-toolkit · bar aggregation tests
 * Author: nirholas · https://github.com/nirholas/robinhood-toolkit
 * License: All Rights Reserved (c) 2026 nirholas
 *
 * Volume is the field with no idempotent guard. Open, high, low and close all
 * survive being applied twice; a sum does not. These pin the accumulation so a
 * tick cannot be folded into a bar more than once.
 */
import assert from 'node:assert/strict'
import test from 'node:test'

import { createBarAggregator } from './bars.mjs'

const MINUTE = 60_000

/** Push ticks, then roll into the next bucket to close and return the bar. */
function barFrom(ticks, { bucketMs = MINUTE } = {}) {
  const agg = createBarAggregator({ bucketMs })
  for (const t of ticks) agg.push(t)
  return agg.push({ ts: bucketMs, price: ticks.at(-1).price, size: 0 })
}

test('bar volume is the sum of its tick sizes', () => {
  const bar = barFrom([
    { ts: 0, price: 100, size: 10 },
    { ts: 10_000, price: 101, size: 10 },
    { ts: 20_000, price: 102, size: 10 },
  ])
  assert.equal(bar.volume, 30)
  assert.equal(bar.ticks, 3)
})

test('a single-tick bar reports that tick size once', () => {
  const bar = barFrom([{ ts: 0, price: 100, size: 5 }])
  assert.equal(bar.volume, 5)
  assert.equal(bar.ticks, 1)
})

test('every bar in a run accumulates independently', () => {
  const agg = createBarAggregator({ bucketMs: MINUTE })
  const closed = []
  for (let i = 0; i < 4; i += 1) {
    for (const offset of [0, 10_000, 20_000]) {
      const bar = agg.push({ ts: i * MINUTE + offset, price: 100 + i, size: 2 })
      if (bar) closed.push(bar)
    }
  }
  assert.equal(closed.length, 3)
  for (const bar of closed) {
    assert.equal(bar.volume, 6)
    assert.equal(bar.ticks, 3)
  }
})

test('ticks with no size leave volume at zero', () => {
  const bar = barFrom([
    { ts: 0, price: 100 },
    { ts: 10_000, price: 101 },
  ])
  assert.equal(bar.volume, 0)
  assert.equal(bar.ticks, 2)
})

test('open, high, low and close track the bucket', () => {
  const bar = barFrom([
    { ts: 0, price: 100, size: 1 },
    { ts: 10_000, price: 105, size: 1 },
    { ts: 20_000, price: 95, size: 1 },
    { ts: 30_000, price: 102, size: 1 },
  ])
  assert.equal(bar.open, 100)
  assert.equal(bar.high, 105)
  assert.equal(bar.low, 95)
  assert.equal(bar.close, 102)
  assert.equal(bar.start, 0)
  assert.equal(bar.duration, MINUTE)
})

test('the forming bar is never exposed', () => {
  const agg = createBarAggregator({ bucketMs: MINUTE })
  assert.equal(agg.push({ ts: 0, price: 100, size: 1 }), null)
  assert.deepEqual(agg.closed(), [])
  assert.equal(agg.lastClosed(), null)

  const closed = agg.push({ ts: MINUTE, price: 101, size: 1 })
  assert.equal(closed.volume, 1)
  assert.equal(agg.closed().length, 1)
  assert.equal(agg.lastClosed(), closed)
})

test('closed bars are capped at maxBars', () => {
  const agg = createBarAggregator({ bucketMs: MINUTE, maxBars: 2 })
  for (let i = 0; i < 5; i += 1) agg.push({ ts: i * MINUTE, price: 100 + i, size: 1 })
  const bars = agg.closed()
  assert.equal(bars.length, 2)
  assert.deepEqual(bars.map((b) => b.start), [2 * MINUTE, 3 * MINUTE])
  for (const bar of bars) assert.equal(bar.volume, 1)
})
