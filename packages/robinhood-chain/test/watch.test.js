/**
 * robinhood-chain · head watcher tests
 * Author: nirholas · https://github.com/nirholas/robinhood-toolkit
 * License: MIT (c) 2026 nirholas
 *
 * robinhood-toolkit · package: robinhood-chain
 *
 * Offline. The stub captures the options handed to watchBlockNumber and lets the
 * test drive block emissions by hand, so the polling-interval contract and the
 * prev-block bookkeeping are proven without a network or a timer.
 */

import assert from 'node:assert/strict'
import test from 'node:test'

import { DEFAULT_POLLING_INTERVAL_MS, watchHead } from '../index.js'

function stubClient() {
  const state = {}
  return {
    state,
    watchBlockNumber: (opts) => {
      state.opts = opts
      state.stopped = false
      return () => {
        state.stopped = true
      }
    },
  }
}

test('passes an explicit polling interval and forces poll mode', () => {
  const client = stubClient()
  watchHead(client, () => {}, { pollingIntervalMs: 2500 })
  assert.equal(client.state.opts.pollingInterval, 2500)
  assert.equal(client.state.opts.poll, true, 'poll:true so the interval is honored on any transport')
})

test('defaults to a one-second interval, not the block cadence', () => {
  const client = stubClient()
  watchHead(client, () => {})
  assert.equal(client.state.opts.pollingInterval, DEFAULT_POLLING_INTERVAL_MS)
  assert.equal(DEFAULT_POLLING_INTERVAL_MS, 1000, 'do not poll at ~101ms block cadence')
})

test('invokes onBlock with the new and previous block numbers', () => {
  const client = stubClient()
  const seen = []
  watchHead(client, (block, prev) => seen.push([block, prev]))

  client.state.opts.onBlockNumber(100n)
  client.state.opts.onBlockNumber(110n)
  client.state.opts.onBlockNumber(121n)

  assert.deepEqual(seen, [
    [100n, undefined],
    [110n, 100n],
    [121n, 110n],
  ])
})

test('returns the unsubscribe function from viem', () => {
  const client = stubClient()
  const stop = watchHead(client, () => {})
  assert.equal(typeof stop, 'function')
  stop()
  assert.equal(client.state.stopped, true)
})

test('rejects a non-positive interval rather than hammering the RPC', () => {
  assert.throws(() => watchHead(stubClient(), () => {}, { pollingIntervalMs: 0 }), /positive number of milliseconds/)
})

test('requires a client and a callback', () => {
  assert.throws(() => watchHead(null, () => {}), /requires a viem `client`/)
  assert.throws(() => watchHead(stubClient(), null), /requires an `onBlock` callback/)
})
