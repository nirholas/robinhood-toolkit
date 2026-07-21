/**
 * robinhood-toolkit · trust model completeness tests
 * Author: nirholas · https://github.com/nirholas/robinhood-toolkit
 * License: All Rights Reserved (c) 2026 nirholas
 *
 * robinhood-toolkit · package: robinhood-risk
 */

import assert from 'node:assert/strict'
import test from 'node:test'

import {
  GATE_ASSUMPTION_IDS,
  TRUST_MODEL,
  assumptionById,
  bySeverity,
  gateAssumptions,
  highSeverity,
  unverified,
} from '../src/assumptions.js'

const SEVERITIES = new Set(['low', 'medium', 'high'])

test('every assumption has the required shape', () => {
  for (const a of TRUST_MODEL) {
    assert.equal(typeof a.id, 'string', `${a.id}: id`)
    assert.ok(SEVERITIES.has(a.severity), `${a.id}: severity`)
    assert.equal(typeof a.verified, 'boolean', `${a.id}: verified`)
    assert.ok(a.statement?.length > 10, `${a.id}: statement`)
    assert.ok(Array.isArray(a.affects) && a.affects.length, `${a.id}: affects`)
  }
})

test('every assumption carries a mitigation — a risk without one is a disclaimer', () => {
  for (const a of TRUST_MODEL) {
    assert.ok(a.mitigation?.length > 10, `${a.id} is missing a mitigation`)
  }
})

test('ids are unique', () => {
  const ids = TRUST_MODEL.map((a) => a.id)
  assert.equal(new Set(ids).size, ids.length)
})

test('unverified items name a primary source in their mitigation', () => {
  const items = unverified()
  assert.ok(items.length > 0, 'expected at least one unverified item to still be present')
  for (const a of items) {
    assert.match(
      a.mitigation,
      /https?:\/\/|L2BEAT|explorer|docs/i,
      `${a.id}: unverified mitigation must point at a primary source`,
    )
  }
})

test('unverified items are kept in the model, never dropped', () => {
  // A regression guard: if someone "cleans up" an unverified item, this fails.
  const ids = new Set(TRUST_MODEL.map((a) => a.id))
  assert.ok(ids.has('escape-hatch'))
  assert.ok(ids.has('proxy-upgrade-control'))
})

test('highSeverity returns exactly the high items', () => {
  const high = highSeverity()
  assert.ok(high.every((a) => a.severity === 'high'))
  assert.equal(high.length, TRUST_MODEL.filter((a) => a.severity === 'high').length)
})

test('bySeverity sorts high first, low last', () => {
  const order = bySeverity().map((a) => a.severity)
  const rank = { high: 0, medium: 1, low: 2 }
  for (let i = 1; i < order.length; i++) {
    assert.ok(rank[order[i - 1]] <= rank[order[i]], 'not sorted by severity')
  }
})

test('the gate surfaces exit-latency and operator-centralization', () => {
  assert.deepEqual([...GATE_ASSUMPTION_IDS].sort(), ['centralized-sequencer', 'withdrawal-latency'])
  const gate = gateAssumptions()
  // High severity first: centralized-sequencer (high) before withdrawal-latency (medium).
  assert.equal(gate[0].id, 'centralized-sequencer')
  assert.equal(gate[0].severity, 'high')
})

test('assumptionById throws on an unknown id', () => {
  assert.throws(() => assumptionById('does-not-exist'), /unknown assumption id/)
  assert.equal(assumptionById('centralized-sequencer').severity, 'high')
})
