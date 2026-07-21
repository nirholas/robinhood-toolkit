/* built by nirholas x.com/nichxbt */
/**
 * robinhood-toolkit · disclosure gate tests
 * Author: nirholas · https://github.com/nirholas/robinhood-toolkit
 * License: All Rights Reserved (c) 2026 nirholas
 *
 * robinhood-toolkit · package: robinhood-risk
 */

import assert from 'node:assert/strict'
import test from 'node:test'

import {
  ACK_STORAGE_KEY,
  clearAcknowledgment,
  gated,
  hasAcknowledged,
  recordAcknowledgment,
  requireDisclosure,
} from '../src/gate.js'
import { disclosureHTML } from '../src/disclosure.js'
import { gateAssumptions, highSeverity } from '../src/assumptions.js'

/** In-memory Storage stand-in. */
function memStorage() {
  const m = new Map()
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, v),
    removeItem: (k) => m.delete(k),
  }
}

test('acknowledgment round-trips through storage', () => {
  const s = memStorage()
  assert.equal(hasAcknowledged(s), false)
  const rec = recordAcknowledgment(s, { at: 1_000 })
  assert.ok(rec)
  assert.deepEqual([...rec.ids].sort(), ['centralized-sequencer', 'withdrawal-latency'])
  assert.equal(rec.at, 1_000)
  assert.equal(hasAcknowledged(s), true)
  assert.match(s.getItem(ACK_STORAGE_KEY), /centralized-sequencer/)

  clearAcknowledgment(s)
  assert.equal(hasAcknowledged(s), false)
})

test('a broken storage is treated as not-acknowledged (fail toward showing)', () => {
  const broken = {
    getItem: () => {
      throw new Error('nope')
    },
    setItem: () => {},
    removeItem: () => {},
  }
  assert.equal(hasAcknowledged(broken), false)
})

test('requireDisclosure resolves true when already acknowledged', async () => {
  const s = memStorage()
  recordAcknowledgment(s, { at: 1 })
  assert.equal(await requireDisclosure({ storage: s }), true)
})

test('requireDisclosure without a DOM and without prior ack does NOT let the action through', async () => {
  const s = memStorage()
  // No document injected and (in Node) no global document: must fail closed.
  assert.equal(await requireDisclosure({ storage: s, document: undefined }), false)
})

test('gated runs the action only when acknowledged', async () => {
  const s = memStorage()
  let ran = 0
  const result = await gated(() => ++ran, { storage: s, document: undefined })
  assert.equal(ran, 0, 'action must not run when the gate is not passed')
  assert.equal(result, undefined)

  recordAcknowledgment(s, { at: 1 })
  const result2 = await gated(() => ++ran, { storage: s })
  assert.equal(ran, 1)
  assert.equal(result2, 1)
})

test('the gate disclosure includes both required items', () => {
  const html = disclosureHTML({ model: gateAssumptions() })
  assert.match(html, /Robinhood operates both the sequencer and the proposer/)
  assert.match(html, /Canonical withdrawals take approximately 7 days/)
})

test('every high-severity item renders without a <details> wrapper', () => {
  const html = disclosureHTML()
  // No collapsed sections at all, so no high-severity item can hide behind a click.
  assert.doesNotMatch(html, /<details/)
  for (const a of highSeverity()) {
    assert.ok(html.includes(`id="risk-${a.id}"`), `${a.id} must be present in the rendered disclosure`)
  }
})

test('severity is conveyed as text, not color alone', () => {
  const html = disclosureHTML()
  assert.match(html, /High severity/)
  assert.match(html, /Medium severity/)
  assert.match(html, /Low severity/)
})
/* built by nirholas x.com/nichxbt */
