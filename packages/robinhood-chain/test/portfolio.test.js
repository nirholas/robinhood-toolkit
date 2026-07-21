/**
 * robinhood-chain · batched portfolio read tests
 * Author: nirholas · https://github.com/nirholas/robinhood-toolkit
 * License: MIT (c) 2026 nirholas
 *
 * robinhood-toolkit · package: robinhood-chain
 *
 * Offline stubs. The two behaviors that matter most are proven here without a
 * network: decimals are read, never defaulted to 18 (USDG is 6), and the
 * sequential fallback fires when the multicall aggregate throws.
 */

import assert from 'node:assert/strict'
import test from 'node:test'

import { USDG, WETH, batchRead, readPortfolio } from '../index.js'

const ZERO = '0x0000000000000000000000000000000000000000'

/**
 * A stub PublicClient. `multicallThrows` reproduces the one condition that
 * exercises the sequential fallback: viem throwing ChainDoesNotSupportContract.
 * Per-token metadata is keyed by lowercased address.
 */
function stubClient({ meta, native = 1_000_000_000_000_000_000n, multicallThrows = false } = {}) {
  const seen = { multicall: 0, readContract: 0, getBalance: 0 }

  const answer = (address, functionName, args) => {
    const t = meta[address.toLowerCase()]
    if (!t) throw new Error(`no stub for ${address}`)
    if (t.revert?.includes(functionName)) throw new Error(`${functionName} reverted`)
    if (functionName === 'balanceOf') return t.balance
    if (functionName === 'symbol') return t.symbol
    if (functionName === 'decimals') return t.decimals
    throw new Error(`unexpected call ${functionName}`)
  }

  return {
    seen,
    chain: { id: 4663, blockExplorers: { default: { url: 'https://x' } } },
    getBalance: async () => {
      seen.getBalance += 1
      return native
    },
    multicall: async ({ contracts }) => {
      seen.multicall += 1
      if (multicallThrows) {
        const err = new Error('Chain "Robinhood Chain" does not support contract "multicall3".')
        err.name = 'ChainDoesNotSupportContract'
        throw err
      }
      return contracts.map((c) => {
        try {
          return { status: 'success', result: answer(c.address, c.functionName, c.args) }
        } catch (error) {
          return { status: 'failure', error }
        }
      })
    },
    readContract: async (c) => {
      seen.readContract += 1
      return answer(c.address, c.functionName, c.args)
    },
  }
}

const META = {
  [WETH.address.toLowerCase()]: { balance: 26602506830376085n, symbol: 'WETH', decimals: 18 },
  [USDG.address.toLowerCase()]: { balance: 1_500_000n, symbol: 'USDG', decimals: 6 },
}

test('reads native plus every token in a single multicall', async () => {
  const client = stubClient({ meta: META })
  const p = await readPortfolio(client, ZERO, [WETH.address, USDG.address])

  assert.equal(client.seen.multicall, 1, 'one aggregate for all tokens')
  assert.equal(client.seen.getBalance, 1)
  assert.equal(p.tokens.length, 2)
  assert.equal(p.nativeEth, '1')
})

test('decimals come from the contract and are never defaulted to 18', async () => {
  const client = stubClient({ meta: META })
  const p = await readPortfolio(client, ZERO, [WETH.address, USDG.address])

  const usdg = p.tokens.find((t) => t.address.toLowerCase() === USDG.address.toLowerCase())
  assert.equal(usdg.decimals, 6, 'USDG must read 6, not 18')
  assert.equal(usdg.formatted, '1.5', 'a wrong exponent would render 0.0000000000015')

  const weth = p.tokens.find((t) => t.address.toLowerCase() === WETH.address.toLowerCase())
  assert.equal(weth.decimals, 18)
})

test('a reverting decimals() degrades that row instead of guessing 18', async () => {
  const meta = {
    ...META,
    [USDG.address.toLowerCase()]: { ...META[USDG.address.toLowerCase()], revert: ['decimals'] },
  }
  const p = await readPortfolio(stubClient({ meta }), ZERO, [USDG.address])
  assert.equal(p.tokens[0].error, 'decimals unavailable')
  assert.equal(p.tokens[0].formatted, undefined, 'no formatted amount without real decimals')
})

test('a reverting balanceOf degrades that row, not the whole read', async () => {
  const meta = {
    ...META,
    [USDG.address.toLowerCase()]: { ...META[USDG.address.toLowerCase()], revert: ['balanceOf'] },
  }
  const p = await readPortfolio(stubClient({ meta }), ZERO, [WETH.address, USDG.address])
  const usdg = p.tokens.find((t) => t.address.toLowerCase() === USDG.address.toLowerCase())
  const weth = p.tokens.find((t) => t.address.toLowerCase() === WETH.address.toLowerCase())
  assert.equal(usdg.error, 'balanceOf reverted')
  assert.equal(weth.formatted, '0.026602506830376085', 'the other row still resolves')
})

test('symbol and name are surfaced but a missing symbol never blocks the row', async () => {
  const meta = {
    ...META,
    [WETH.address.toLowerCase()]: { ...META[WETH.address.toLowerCase()], revert: ['symbol'] },
  }
  const p = await readPortfolio(stubClient({ meta }), ZERO, [WETH.address])
  assert.equal(p.tokens[0].symbol, 'UNKNOWN')
  assert.equal(p.tokens[0].decimals, 18, 'decimals still read even when symbol fails')
})

test('the sequential fallback fires when the aggregate throws, and returns correct balances', async () => {
  const client = stubClient({ meta: META, multicallThrows: true })
  const p = await readPortfolio(client, ZERO, [WETH.address, USDG.address])

  assert.equal(client.seen.multicall, 1, 'the aggregate was attempted')
  assert.equal(client.seen.readContract, 6, 'then 3 reads per token, sequentially')
  const usdg = p.tokens.find((t) => t.address.toLowerCase() === USDG.address.toLowerCase())
  assert.equal(usdg.decimals, 6)
  assert.equal(usdg.formatted, '1.5', 'the fallback path is decimals-correct too')
})

test('duplicate token addresses collapse to one row', async () => {
  const client = stubClient({ meta: META })
  const p = await readPortfolio(client, ZERO, [WETH.address, WETH.address.toLowerCase()])
  assert.equal(p.tokens.length, 1)
})

test('batchRead returns [] for an empty contract list without touching the network', async () => {
  const client = stubClient({ meta: META })
  assert.deepEqual(await batchRead(client, []), [])
  assert.equal(client.seen.multicall, 0)
})
