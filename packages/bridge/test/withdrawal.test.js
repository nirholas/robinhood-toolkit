/**
 * robinhood-toolkit · tests for the withdrawal cost model and route builder
 * Author: nirholas · https://github.com/nirholas/robinhood-toolkit
 * License: All Rights Reserved (c) 2026 nirholas
 *
 * robinhood-toolkit · package: bridge
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { bridgeRoutes, estimateDeposit, estimateWithdrawal } from '../src/withdrawal.js'

test('estimateWithdrawal surfaces challengePeriodDays: 7 at the top level', () => {
  const est = estimateWithdrawal({ amount: 1_000_000n, symbol: 'USDG' })
  assert.equal(est.challengePeriodDays, 7)
  assert.equal(est.direction, 'withdraw')
  assert.equal(est.canonical.challengePeriodDays, 7)
})

test('estimateWithdrawal marks every partner route as live-quote, zero challenge period', () => {
  const est = estimateWithdrawal()
  assert.ok(est.partners.length >= 5)
  for (const p of est.partners) {
    assert.equal(p.feeQuote, 'live')
    assert.equal(p.challengePeriodDays, 0)
    assert.equal(p.depositMinutes, 'quote-required')
    assert.match(p.trust, /third-party/)
  }
})

test('estimateWithdrawal never quotes a stored fee', () => {
  const est = estimateWithdrawal()
  assert.equal(est.feesAreLive, true)
  assert.equal(est.canonical.feeQuote, 'live')
})

test('deposit direction carries no challenge period', () => {
  const { canonical } = bridgeRoutes({ direction: 'deposit' })
  assert.equal(canonical.challengePeriodDays, 0)
  assert.equal(canonical.depositMinutes, 10)
})

test('withdraw direction carries the challenge period and no deposit latency', () => {
  const { canonical } = bridgeRoutes({ direction: 'withdraw' })
  assert.equal(canonical.challengePeriodDays, 7)
  assert.equal(canonical.depositMinutes, null)
})

test('bridgeRoutes rejects an unknown direction', () => {
  assert.throws(() => bridgeRoutes({ direction: 'sideways' }), /must be 'deposit' or 'withdraw'/)
})

test('partner ids are clean slugs', () => {
  const { partners } = bridgeRoutes({ direction: 'withdraw' })
  const ids = partners.map((p) => p.id)
  assert.deepEqual(ids, ['layerzero-stargate', 'chainlink-ccip', 'relay', 'across', 'lifi'])
})

test('estimateDeposit reminds the caller to bridge ETH first', () => {
  const est = estimateDeposit({ symbol: 'USDG' })
  assert.equal(est.direction, 'deposit')
  assert.equal(est.challengePeriodDays, 0)
  assert.match(est.note, /Bridge ETH before you bridge tokens/)
})
