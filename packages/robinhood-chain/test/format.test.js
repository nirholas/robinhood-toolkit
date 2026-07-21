/* built by nirholas x.com/nichxbt */
/**
 * robinhood-chain · decimals-safety tests
 * Author: nirholas · https://github.com/nirholas/robinhood-toolkit
 * License: All Rights Reserved (c) 2026 nirholas
 *
 * robinhood-toolkit · package: robinhood-chain
 */

import assert from 'node:assert/strict'
import test from 'node:test'

import {
  KNOWN_IMPOSTORS,
  MissingDecimalsError,
  RobinhoodChainError,
  USDG,
  WETH,
  assertDecimals,
  formatToken,
  isKnownImpostor,
  knownTokenAt,
  parseToken,
  readDecimals,
} from '../index.js'

test('USDG is six decimals, WETH is eighteen', () => {
  assert.equal(USDG.decimals, 6, 'USDG has 6 decimals on Robinhood Chain, not 18')
  assert.equal(USDG.name, 'Global Dollar')
  assert.equal(USDG.address, '0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168')
  assert.equal(WETH.decimals, 18)
  assert.equal(WETH.name, 'WETH')
  assert.equal(WETH.address, '0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73')
})

// The whole reason this package exists in one test: an 18 default turns
// 1.5 USDG into 0.0000000000015 and still renders as a valid number.
test('formatToken with the wrong exponent is off by a trillion, which is why it is required', () => {
  const oneAndAHalfUsdg = 1_500_000n
  assert.equal(formatToken(oneAndAHalfUsdg, USDG.decimals), '1.5')
  assert.equal(formatToken(oneAndAHalfUsdg, 18), '0.0000000000015')
})

test('formatToken throws instead of defaulting decimals', () => {
  assert.throws(() => formatToken(1_500_000n), MissingDecimalsError)
  assert.throws(() => formatToken(1_500_000n, undefined), MissingDecimalsError)
  assert.throws(() => formatToken(1_500_000n, null), MissingDecimalsError)
  assert.throws(() => formatToken(1_500_000n), /never defaults to 18/)
})

test('parseToken throws instead of defaulting decimals', () => {
  assert.throws(() => parseToken('1.5'), MissingDecimalsError)
  assert.equal(parseToken('1.5', USDG.decimals), 1_500_000n)
  assert.equal(parseToken('1.5', WETH.decimals), 1_500_000_000_000_000_000n)
})

test('parseToken and formatToken round-trip at USDG precision', () => {
  for (const value of ['0', '0.000001', '1', '1.5', '250.75', '1000000']) {
    assert.equal(formatToken(parseToken(value, USDG.decimals), USDG.decimals), value === '0' ? '0' : value)
  }
})

test('assertDecimals rejects non-integers and out-of-range values', () => {
  assert.equal(assertDecimals(6), 6)
  assert.equal(assertDecimals(0), 0)
  assert.throws(() => assertDecimals(6.5), RobinhoodChainError)
  assert.throws(() => assertDecimals(-1), RobinhoodChainError)
  assert.throws(() => assertDecimals(256), RobinhoodChainError)
  assert.throws(() => assertDecimals('six'), RobinhoodChainError)
})

test('formatToken refuses unsafe JS numbers rather than losing precision', () => {
  assert.throws(() => formatToken(Number.MAX_SAFE_INTEGER + 2, 6), /unsafe number/)
  assert.equal(formatToken(1500000, 6), '1.5')
})

test('parseToken rejects empty and non-finite input', () => {
  assert.throws(() => parseToken('', 6), RobinhoodChainError)
  assert.throws(() => parseToken(null, 6), RobinhoodChainError)
  assert.throws(() => parseToken(Number.NaN, 6), RobinhoodChainError)
})

test('readDecimals surfaces a read failure rather than assuming 18', async () => {
  const client = {
    chain: { id: 4663 },
    readContract: async () => {
      throw new Error('execution reverted')
    },
  }
  await assert.rejects(() => readDecimals(client, USDG.address), /will not fall back to 18/)
})

test('readDecimals caches only when a cache is supplied', async () => {
  let calls = 0
  const client = {
    chain: { id: 4663 },
    readContract: async () => {
      calls += 1
      return 6
    },
  }

  await readDecimals(client, USDG.address)
  await readDecimals(client, USDG.address)
  assert.equal(calls, 2, 'no implicit caching')

  const cache = new Map()
  await readDecimals(client, USDG.address, { cache })
  await readDecimals(client, USDG.address, { cache })
  assert.equal(calls, 3, 'one extra call, the second served from cache')
})

test('known tokens resolve by address, and the impostor is flagged', () => {
  assert.equal(knownTokenAt(USDG.address)?.name, 'Global Dollar')
  // Lowercase input must resolve identically. Address comparison is normalized.
  assert.equal(knownTokenAt(USDG.address.toLowerCase())?.name, 'Global Dollar')
  assert.equal(knownTokenAt('0x0000000000000000000000000000000000000001'), null)

  const impostor = KNOWN_IMPOSTORS[0]
  assert.equal(impostor.address, '0x8218d73C00567A01481495Ad6c5143e00D5BB5b4')
  assert.equal(impostor.symbol, USDG.symbol, 'the collision is that the symbols are identical')
  assert.notEqual(impostor.decimals, USDG.decimals, 'and the decimals are not')
  assert.equal(isKnownImpostor(impostor.address), true)
  assert.equal(isKnownImpostor(USDG.address), false)
})
/* built by nirholas x.com/nichxbt */
