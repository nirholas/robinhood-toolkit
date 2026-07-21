/* built by nirholas x.com/nichxbt */
/**
 * robinhood-toolkit · live on-chain verification of the seeded registry
 * Author: nirholas · https://github.com/nirholas/robinhood-toolkit
 * License: All Rights Reserved (c) 2026 nirholas
 *
 * robinhood-toolkit · package: bridge
 *
 * Network-touching. Skipped unless RH_LIVE_TESTS=1:
 *   npm run test:live --workspace bridge
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { resolveToken, verifyToken } from '../src/tokens.js'

const LIVE = process.env.RH_LIVE_TESTS === '1'

test('WETH verifies on-chain: name WETH, decimals 18', { skip: !LIVE }, async () => {
  const v = await verifyToken(resolveToken('WETH'))
  assert.equal(v.name, 'WETH')
  assert.equal(v.decimals, 18)
  assert.ok(v.bytecodeSize > 0)
})

test('USDG verifies on-chain: name Global Dollar, symbol USDG, decimals 6', { skip: !LIVE }, async () => {
  const v = await verifyToken(resolveToken('USDG'))
  assert.equal(v.name, 'Global Dollar')
  assert.equal(v.symbol, 'USDG')
  assert.equal(v.decimals, 6)
})

test('an address with no code throws rather than becoming a registry entry', { skip: !LIVE }, async () => {
  // Zero address: guaranteed to have no bytecode on any chain.
  await assert.rejects(
    () => verifyToken('0x0000000000000000000000000000000000000000'),
    /No contract deployed/,
  )
})
/* built by nirholas x.com/nichxbt */
