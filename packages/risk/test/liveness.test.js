/* built by nirholas x.com/nichxbt */
/**
 * robinhood-toolkit · liveness monitor tests
 * Author: nirholas · https://github.com/nirholas/robinhood-toolkit
 * License: All Rights Reserved (c) 2026 nirholas
 *
 * robinhood-toolkit · package: robinhood-risk
 *
 * A monitor that only ever reports healthy is untested. These exercise the
 * stalled and unreachable branches with a stubbed client — no network — plus the
 * feed-divergence classification and the UI copy.
 */

import assert from 'node:assert/strict'
import test from 'node:test'

import {
  CANONICAL_EXIT,
  canSubmitIn,
  classify,
  classifyDivergence,
  defaultParseFeedMessage,
  monitorLiveness,
} from '../src/liveness.js'
import { livenessMessage } from '../src/liveness-ui.js'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/**
 * A virtual clock that advances a fixed step on every read. Because the monitor
 * reads `now()` once per tick, classification becomes a deterministic function of
 * tick count instead of wall-clock time — so these tests do not flake under load.
 */
function stepClock(stepMs) {
  let t = 0
  return () => (t += stepMs)
}

/** Collect statuses from a stubbed monitor for `durationMs`, then stop. */
async function collect(clientImpl, opts, durationMs = 200) {
  const out = []
  const stop = monitorLiveness((s) => out.push(s), {
    client: clientImpl,
    feed: false,
    intervalMs: 10,
    ...opts,
  })
  await sleep(durationMs)
  stop()
  return out
}

test('classify honors the boundaries', () => {
  assert.equal(classify(0), 'healthy')
  assert.equal(classify(4_999), 'healthy')
  assert.equal(classify(5_000), 'degraded')
  assert.equal(classify(29_999), 'degraded')
  assert.equal(classify(30_000), 'stalled')
  assert.equal(classify(50_000), 'stalled')
})

test('canSubmitIn blocks only stalled/unreachable', () => {
  assert.equal(canSubmitIn('healthy'), true)
  assert.equal(canSubmitIn('degraded'), true)
  assert.equal(canSubmitIn('stalled'), false)
  assert.equal(canSubmitIn('unreachable'), false)
})

test('advancing head stays healthy and submittable', async () => {
  let n = 100n
  const client = { getBlockNumber: async () => n++ }
  // Head advances every tick, so lastAdvanceAt tracks now() and silentFor stays 0.
  const out = await collect(client, { now: stepClock(1) })
  assert.ok(out.length >= 1, 'the monitor must emit at least one status')
  assert.ok(
    out.every((s) => s.status === 'healthy' && s.canSubmit === true),
    'an advancing head must never block submission',
  )
})

test('frozen head reports stalled and disables submission', async () => {
  const client = { getBlockNumber: async () => 4663n } // never advances
  // Virtual clock jumps 100ms per tick; past the 15ms stall threshold on the first.
  const out = await collect(client, { degradedMs: 5, stalledMs: 15, now: stepClock(100) })
  const stalled = out.filter((s) => s.status === 'stalled')
  assert.ok(stalled.length > 0, 'expected the frozen head to be classified stalled')
  for (const s of stalled) {
    assert.equal(s.canSubmit, false)
    assert.ok(s.exit, 'a stalled status must carry the canonical exit path')
    assert.equal(s.exit.periodDays, 7)
  }
})

test('unreachable RPC reports, does not throw, and blocks submission', async () => {
  const client = {
    getBlockNumber: async () => {
      const e = new Error('fetch failed: ECONNREFUSED')
      e.shortMessage = 'HTTP request failed'
      throw e
    },
  }
  const out = await collect(client, {}, 40)
  assert.ok(out.length > 0, 'the monitor must keep ticking through an unreachable host')
  assert.ok(
    out.every((s) => s.status === 'unreachable' && s.canSubmit === false),
    'unreachable must always block submission',
  )
  assert.match(out[0].error, /HTTP request failed/)
  assert.equal(out[0].exit.periodDays, 7)
})

test('classifyDivergence separates a stall-with-live-feed from a silent feed', () => {
  assert.equal(classifyDivergence('stalled', 'live'), 'rpc-stalled-feed-live')
  assert.equal(classifyDivergence('healthy', 'silent'), 'feed-silent-rpc-advancing')
  assert.equal(classifyDivergence('healthy', 'live'), null)
  assert.equal(classifyDivergence('stalled', 'silent'), null)
})

test('feed:false reports feedStatus disabled', async () => {
  let n = 1n
  const out = await collect({ getBlockNumber: async () => n++ }, {})
  assert.ok(out.every((s) => s.feedStatus === 'disabled'))
})

test('defaultParseFeedMessage pulls the max sequenceNumber it can find', () => {
  assert.equal(defaultParseFeedMessage(JSON.stringify({ sequenceNumber: 42 })), 42)
  assert.equal(
    defaultParseFeedMessage(JSON.stringify({ messages: [{ sequenceNumber: 7 }, { sequenceNumber: 9 }] })),
    9,
  )
  assert.equal(defaultParseFeedMessage('not json'), null)
  assert.equal(defaultParseFeedMessage(JSON.stringify({ nothing: true })), null)
})

test('livenessMessage copy blocks and surfaces the exit on stall/unreachable', () => {
  const stalled = livenessMessage({ status: 'stalled', silentForMs: 40_000, exit: CANONICAL_EXIT })
  assert.equal(stalled.canSubmit, false)
  assert.equal(stalled.tone, 'blocked')
  assert.equal(stalled.exit.periodDays, 7)

  const unreachable = livenessMessage({ status: 'unreachable', error: 'boom' })
  assert.equal(unreachable.canSubmit, false)
  assert.match(unreachable.detail, /boom/)

  const ok = livenessMessage({ status: 'healthy' })
  assert.equal(ok.canSubmit, true)
  assert.equal(ok.tone, 'ok')

  const unknown = livenessMessage({ status: 'weird' })
  assert.equal(unknown.canSubmit, false)
})
/* built by nirholas x.com/nichxbt */
