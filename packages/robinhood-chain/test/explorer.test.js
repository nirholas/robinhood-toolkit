/* built by nirholas x.com/nichxbt */
/**
 * robinhood-chain · Blockscout client tests
 * Author: nirholas · https://github.com/nirholas/robinhood-toolkit
 * License: All Rights Reserved (c) 2026 nirholas
 *
 * robinhood-toolkit · package: robinhood-chain
 *
 * Offline. A fetch stub drives the retry policy. baseDelayMs is 0 so backoff is
 * exercised without real sleeps. The point under test is that a 429 retries
 * regardless of whether we have confirmed a rate limit exists — because we have
 * not — and that a non-retryable status throws ExplorerError.
 */

import assert from 'node:assert/strict'
import test from 'node:test'

import { BlockscoutClient, ExplorerError, WETH, robinhoodChain } from '../index.js'

function jsonResponse(body, { status = 200, headers = {} } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (k) => headers[k.toLowerCase()] ?? null },
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
  }
}

/** A fetch that returns each queued response in turn, recording every URL. */
function stubFetch(queue) {
  const urls = []
  const fetchImpl = async (url) => {
    urls.push(url)
    const next = queue.shift()
    if (!next) throw new Error('stubFetch ran out of responses')
    return next
  }
  return { fetchImpl, urls }
}

function client(queue, opts = {}) {
  const { fetchImpl, urls } = stubFetch(queue)
  const c = new BlockscoutClient({ chain: robinhoodChain, fetch: fetchImpl, baseDelayMs: 0, ...opts })
  return { c, urls }
}

test('builds the v2 API base from the chain explorer URL', () => {
  const c = new BlockscoutClient({ chain: robinhoodChain, fetch: async () => jsonResponse({}) })
  assert.equal(c.baseUrl, 'https://robinhoodchain.blockscout.com/api/v2')
})

test('returns parsed JSON verbatim on success', async () => {
  const { c } = client([jsonResponse({ symbol: 'WETH', decimals: '18' })])
  const info = await c.tokenInfo(WETH.address)
  assert.equal(info.symbol, 'WETH')
  assert.equal(info.decimals, '18', 'shapes are passed through untouched, decimals stays a string here')
})

test('checksums the address into the path', async () => {
  const { c, urls } = client([jsonResponse({})])
  await c.tokenInfo(WETH.address.toLowerCase())
  assert.match(urls[0], new RegExp(`/tokens/${WETH.address}$`), 'lowercased input is re-checksummed')
})

test('retries on 429 then succeeds', async () => {
  const { c, urls } = client([
    jsonResponse('rate limited', { status: 429 }),
    jsonResponse('rate limited', { status: 429 }),
    jsonResponse({ ok: true }),
  ])
  const out = await c.get('/anything')
  assert.deepEqual(out, { ok: true })
  assert.equal(urls.length, 3, 'two backoffs then a win')
})

test('honors a Retry-After header of 0 without hanging', async () => {
  const { c } = client([jsonResponse('slow down', { status: 429, headers: { 'retry-after': '0' } }), jsonResponse({ done: 1 })])
  const out = await c.get('/x')
  assert.deepEqual(out, { done: 1 })
})

test('retries transient 5xx as well', async () => {
  const { c, urls } = client([jsonResponse('bad gateway', { status: 502 }), jsonResponse({ ok: 1 })])
  await c.get('/x')
  assert.equal(urls.length, 2)
})

test('gives up after maxRetries and throws ExplorerError carrying the status', async () => {
  const { c } = client([
    jsonResponse('nope', { status: 429 }),
    jsonResponse('nope', { status: 429 }),
  ], { maxRetries: 1 })
  await assert.rejects(() => c.get('/x'), (err) => {
    assert.ok(err instanceof ExplorerError)
    assert.equal(err.status, 429)
    return true
  })
})

test('a non-retryable 404 throws immediately without retrying', async () => {
  const { c, urls } = client([jsonResponse('not found', { status: 404 })])
  await assert.rejects(() => c.get('/missing'), (err) => {
    assert.ok(err instanceof ExplorerError)
    assert.equal(err.status, 404)
    return true
  })
  assert.equal(urls.length, 1, 'a 404 is not retried')
})

test('appends an api key when provided', async () => {
  const { c, urls } = client([jsonResponse({})], { apiKey: 'k3y' })
  await c.get('/x')
  assert.match(urls[0], /[?&]apikey=k3y/)
})
/* built by nirholas x.com/nichxbt */
