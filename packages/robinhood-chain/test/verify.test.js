/**
 * robinhood-chain · ticker-collision verification tests
 * Author: nirholas · https://github.com/nirholas/robinhood-toolkit
 * License: All Rights Reserved (c) 2026 nirholas
 *
 * robinhood-toolkit · package: robinhood-chain
 *
 * The metadata in the stub below is not invented. It is what these three
 * addresses actually return on Robinhood Chain mainnet, read 2026-07-20 and
 * re-confirmed by test/live.test.js against the live RPC.
 */

import assert from 'node:assert/strict'
import test from 'node:test'

import {
  NotCanonicalTokenError,
  RobinhoodChainError,
  USDG,
  WETH,
  assertCanonicalToken,
  readTokenMetadata,
  verifyToken,
} from '../index.js'

/** Address of the live memecoin squatting the USDG ticker. */
const FAKE_USDG = '0x8218d73C00567A01481495Ad6c5143e00D5BB5b4'

const ON_CHAIN = {
  [USDG.address.toLowerCase()]: { name: 'Global Dollar', symbol: 'USDG', decimals: 6 },
  [FAKE_USDG.toLowerCase()]: { name: 'Useless Stupid Degen Gamblers', symbol: 'USDG', decimals: 18 },
  [WETH.address.toLowerCase()]: { name: 'WETH', symbol: 'WETH', decimals: 18 },
}

/** Minimal viem-shaped client. `mode` selects the multicall or sequential path. */
function stubClient({ mode = 'multicall' } = {}) {
  const read = ({ address, functionName }) => {
    const meta = ON_CHAIN[String(address).toLowerCase()]
    if (!meta) throw new Error(`no stub entry for ${address}`)
    return meta[functionName]
  }

  return {
    chain: { id: 4663 },
    getCode: async ({ address }) => (ON_CHAIN[String(address).toLowerCase()] ? '0x60806040' : '0x'),
    readContract: async (call) => read(call),
    multicall: async ({ contracts }) => {
      if (mode === 'unsupported') {
        // What viem actually does on a chain definition without contracts.multicall3.
        throw new Error('ChainDoesNotSupportContract: multicall3')
      }
      return contracts.map((c) => ({ status: 'success', result: read(c) }))
    },
  }
}

test('the real USDG passes verification against the USDG constant', async () => {
  const meta = await assertCanonicalToken(stubClient(), USDG.address, USDG)
  assert.equal(meta.name, 'Global Dollar')
  assert.equal(meta.symbol, 'USDG')
  assert.equal(meta.decimals, 6)
})

// The headline test: a live token with the correct symbol that is not the token.
test('the USDG ticker collision is caught', async () => {
  await assert.rejects(
    () => assertCanonicalToken(stubClient(), FAKE_USDG, USDG),
    (error) => {
      assert.ok(error instanceof NotCanonicalTokenError)
      assert.equal(error.address, FAKE_USDG)

      const fields = error.mismatches.map((m) => m.field).sort()
      // The symbol matches, which is exactly why symbol is not an identifier.
      assert.deepEqual(fields, ['address'])
      return true
    },
  )
})

test('the collision is caught on metadata alone, with no canonical address to compare', async () => {
  // A caller who only knows "it should be the Global Dollar stablecoin with 6
  // decimals" still gets a rejection, from the on-chain read.
  await assert.rejects(
    () => assertCanonicalToken(stubClient(), FAKE_USDG, { name: USDG.name, symbol: USDG.symbol, decimals: USDG.decimals }),
    (error) => {
      assert.ok(error instanceof NotCanonicalTokenError)
      const fields = error.mismatches.map((m) => m.field).sort()
      assert.deepEqual(fields, ['decimals', 'name'], 'symbol matches; name and decimals do not')
      assert.equal(error.actual.name, 'Useless Stupid Degen Gamblers')
      assert.equal(error.actual.decimals, 18)
      return true
    },
  )
})

test('a symbol-only check is NOT enough to catch the impostor', async () => {
  // Documents the failure mode rather than hiding it: both tickers are 'USDG',
  // so a symbol comparison passes for the wrong token. Verify by address.
  const meta = await assertCanonicalToken(stubClient(), FAKE_USDG, { symbol: 'USDG' })
  assert.equal(meta.symbol, 'USDG')
  assert.equal(meta.name, 'Useless Stupid Degen Gamblers')
})

test('verification falls back to sequential reads when multicall is unavailable', async () => {
  const meta = await readTokenMetadata(stubClient({ mode: 'unsupported' }), USDG.address)
  assert.equal(meta.decimals, 6)
  assert.equal(meta.name, 'Global Dollar')
})

test('an address with no bytecode is rejected before any metadata read', async () => {
  await assert.rejects(
    () => readTokenMetadata(stubClient(), '0x0000000000000000000000000000000000000001'),
    /No contract bytecode/,
  )
})

test('assertCanonicalToken refuses to verify against nothing', async () => {
  await assert.rejects(() => assertCanonicalToken(stubClient(), USDG.address, {}), RobinhoodChainError)
  await assert.rejects(() => assertCanonicalToken(stubClient(), USDG.address, null), RobinhoodChainError)
})

test('case-insensitive comparison is opt-in', async () => {
  const lowered = { name: 'global dollar', symbol: 'usdg', decimals: 6 }
  await assert.rejects(() => assertCanonicalToken(stubClient(), USDG.address, lowered), NotCanonicalTokenError)
  const meta = await assertCanonicalToken(stubClient(), USDG.address, lowered, { caseInsensitive: true })
  assert.equal(meta.symbol, 'USDG')
})

test('verifyToken reports instead of throwing', async () => {
  const good = await verifyToken(stubClient(), USDG.address, USDG)
  assert.equal(good.ok, true)
  assert.equal(good.error, null)

  const bad = await verifyToken(stubClient(), FAKE_USDG, { name: USDG.name, decimals: USDG.decimals })
  assert.equal(bad.ok, false)
  assert.ok(bad.error instanceof NotCanonicalTokenError)
  assert.equal(bad.metadata.name, 'Useless Stupid Degen Gamblers')
})
