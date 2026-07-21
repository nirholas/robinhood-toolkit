/* built by nirholas x.com/nichxbt */
/**
 * robinhood-toolkit · tests for the bridged token registry and resolver
 * Author: nirholas · https://github.com/nirholas/robinhood-toolkit
 * License: All Rights Reserved (c) 2026 nirholas
 *
 * robinhood-toolkit · package: bridge
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { ROBINHOOD_MAINNET_ID, ROBINHOOD_TESTNET_ID } from 'robinhood-chain'
import { TOKENS, resolveToken, resolveTokenEntry } from '../src/tokens.js'

test('resolveToken returns the verified checksummed address for a mapped symbol', () => {
  assert.equal(resolveToken('WETH'), '0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73')
  assert.equal(resolveToken('USDG'), '0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168')
})

test('resolveToken is case-insensitive on the symbol', () => {
  assert.equal(resolveToken('weth'), resolveToken('WETH'))
  assert.equal(resolveToken('usdg'), resolveToken('USDG'))
})

test('resolveToken throws the explicit unmapped-symbol error for USDC', () => {
  assert.throws(
    () => resolveToken('USDC'),
    (err) => {
      assert.match(err.message, /No verified address for USDC/)
      assert.match(err.message, /chain-specific addresses/)
      assert.match(err.message, /Ethereum address is NOT its address/)
      return true
    },
  )
})

test('resolveToken never falls back — it returns nothing for an unknown symbol', () => {
  // The whole point of the module: no silent fallback to any address.
  assert.throws(() => resolveToken('NOPE'), /No verified address for NOPE/)
})

test('registry stores decimals alongside the address, and they differ per token', () => {
  const weth = resolveTokenEntry('WETH')
  const usdg = resolveTokenEntry('USDG')
  assert.equal(weth.decimals, 18)
  assert.equal(usdg.decimals, 6)
  assert.notEqual(weth.decimals, usdg.decimals)
})

test('testnet registry is empty, so resolveToken throws there too', () => {
  assert.deepEqual(TOKENS[ROBINHOOD_TESTNET_ID], {})
  assert.throws(() => resolveToken('WETH', ROBINHOOD_TESTNET_ID), /chain 46630/)
})

test('unknown chain id throws rather than resolving', () => {
  assert.throws(() => resolveToken('WETH', 1), /No verified address for WETH on chain 1/)
})

test('mainnet registry contains exactly the two verified tokens', () => {
  assert.deepEqual(Object.keys(TOKENS[ROBINHOOD_MAINNET_ID]).sort(), ['USDG', 'WETH'])
})
/* built by nirholas x.com/nichxbt */
