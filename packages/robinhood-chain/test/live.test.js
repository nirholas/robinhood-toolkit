/**
 * robinhood-chain · live-chain tests
 * Author: nirholas · https://github.com/nirholas/robinhood-toolkit
 * License: MIT (c) 2026 nirholas
 *
 * robinhood-toolkit · package: robinhood-chain
 *
 * These hit the public Robinhood Chain mainnet RPC. They are skipped unless
 * RH_LIVE_TESTS=1 so that `npm test` works offline and in CI without network.
 *
 *   RH_LIVE_TESTS=1 npm run test:live
 *
 * Everything asserted here is read-only. No key, no funded account, no spend.
 */

import assert from 'node:assert/strict'
import test from 'node:test'

import { createPublicClient, http, parseAbiItem } from 'viem'

import {
  MULTICALL3_ADDRESS,
  NotCanonicalTokenError,
  USDG,
  WETH,
  assertCanonicalToken,
  formatToken,
  hasMulticall3,
  readDecimals,
  readTokenMetadata,
  robinhoodChain,
  scanLogs,
} from '../index.js'

const LIVE = process.env.RH_LIVE_TESTS === '1'
const RPC = process.env.RH_MAINNET_RPC ?? robinhoodChain.rpcUrls.default.http[0]
const FAKE_USDG = '0x8218d73C00567A01481495Ad6c5143e00D5BB5b4'

const options = { skip: LIVE ? false : 'set RH_LIVE_TESTS=1 to run live-chain tests' }

const client = createPublicClient({
  chain: robinhoodChain,
  transport: http(RPC, { timeout: 20_000, retryCount: 2 }),
})

test('the RPC reports chain ID 4663', options, async () => {
  assert.equal(await client.getChainId(), 4663)
})

test('USDG really does have 6 decimals on chain', options, async () => {
  const decimals = await readDecimals(client, USDG.address)
  assert.equal(decimals, 6, 'if this is 18 you are reading the wrong token')
  assert.equal(decimals, USDG.decimals, 'the shipped constant matches the live contract')
})

test('WETH really does have 18 decimals on chain', options, async () => {
  assert.equal(await readDecimals(client, WETH.address), WETH.decimals)
})

test('the shipped token constants match live on-chain metadata', options, async () => {
  for (const token of [USDG, WETH]) {
    const meta = await readTokenMetadata(client, token.address)
    assert.equal(meta.name, token.name)
    assert.equal(meta.symbol, token.symbol)
    assert.equal(meta.decimals, token.decimals)
  }
})

test('Multicall3 is deployed at the canonical address', options, async () => {
  assert.equal(await hasMulticall3(client), true)
  const code = await client.getCode({ address: MULTICALL3_ADDRESS })
  assert.ok(code.length > 100, 'expected real bytecode, not 0x')
})

// The ticker collision, against the live chain rather than a stub.
test('the live USDG ticker collision is caught', options, async () => {
  const impostor = await readTokenMetadata(client, FAKE_USDG)
  assert.equal(impostor.symbol, 'USDG', 'the impostor genuinely shares the ticker')
  assert.notEqual(impostor.name, USDG.name)

  await assert.rejects(() => assertCanonicalToken(client, FAKE_USDG, USDG), NotCanonicalTokenError)
  await assert.rejects(
    () => assertCanonicalToken(client, FAKE_USDG, { name: USDG.name, symbol: USDG.symbol, decimals: USDG.decimals }),
    NotCanonicalTokenError,
  )

  // And the real one still passes.
  const real = await assertCanonicalToken(client, USDG.address, USDG)
  assert.equal(real.decimals, 6)
})

test('formatting the same raw amount for both USDG tokens diverges by 10^12', options, async () => {
  const raw = 1_500_000n
  const realDecimals = await readDecimals(client, USDG.address)
  const impostorDecimals = await readDecimals(client, FAKE_USDG)

  assert.equal(formatToken(raw, realDecimals), '1.5')
  assert.equal(formatToken(raw, impostorDecimals), '0.0000000000015')
})

test('a log scan over live blocks completes and covers the range at the default chunk', options, async () => {
  const head = await client.getBlockNumber()
  const fromBlock = head - 2000n
  const { logs, stats, done } = await scanLogs({ client, address: WETH.address, fromBlock, toBlock: head })

  assert.ok(logs.length > 0, 'WETH is active; expected at least one log')
  assert.equal(done, true)
  assert.ok(
    logs.every((log) => log.blockNumber >= fromBlock && log.blockNumber <= head),
    'every log falls inside the requested range',
  )
  // Deliberately not an exact chunk count. This is an unfiltered scan of a live
  // contract, so a volume spike can legitimately trip the response-size cap and
  // add a halving. Asserting 3 chunks here made the suite fail on chain activity
  // rather than on a defect.
  assert.ok(stats.chunksScanned >= 3, 'a 2001-block range needs at least three 1000-block chunks')
  assert.ok(stats.finalChunkSize <= 1000n, 'the chunk never grows past the configured default')
})

// The tuning claim, isolated to a single request so live volume cannot add
// chunks: one default-sized chunk sits inside the 50,000-log allowance.
test('a single default-sized chunk is served without a halving', options, async () => {
  const head = await client.getBlockNumber()
  const { logs, stats } = await scanLogs({
    client,
    address: WETH.address,
    event: parseAbiItem('event Transfer(address indexed from, address indexed to, uint256 value)'),
    fromBlock: head - 999n,
    toBlock: head,
  })

  assert.equal(stats.chunksScanned, 1)
  assert.equal(stats.halvings, 0, 'a 1000-block chunk must not need to back off')
  assert.ok(logs.length > 0)
})

// Proves the adaptive path against the real cap rather than a simulated one.
// WETH runs at roughly 11 Transfers per block, so a 5000-block chunk matches far
// more than the 10,000-log allowance that applies past the tier boundary.
test('an over-wide chunk trips the real matched-log cap and recovers', options, async () => {
  const head = await client.getBlockNumber()
  const { logs, stats } = await scanLogs({
    client,
    address: WETH.address,
    fromBlock: head - 2000n,
    toBlock: head,
    chunkSize: 5000n,
  })

  assert.ok(stats.halvings > 0, 'a 5000-block chunk of WETH must exceed the allowance')
  assert.ok(logs.length > 0, 'and the scan must still complete')
})

// The claim that replaced the old "1001-block span cap" description. If a hard
// span cap existed, this call would fail on width alone. It does not.
test('a 500,000-block span is accepted when its filter matches nothing', options, async () => {
  const head = await client.getBlockNumber()
  const logs = await client.getLogs({
    address: WETH.address,
    event: parseAbiItem('event Transfer(address indexed from, address indexed to, uint256 value)'),
    args: { from: '0x000000000000000000000000000000000000dEaD' },
    fromBlock: head - 500_000n,
    toBlock: head,
  })

  assert.deepEqual(logs, [], 'span alone is never the rejection; matched volume is')
})

// The tier boundary itself, one block apart, against the same busy contract.
// 1001 blocks returns well past 10,000 logs, which is only possible if the
// allowance below the boundary is higher than the allowance above it.
test('the matched-log allowance drops one block past a 1001-block span', options, async () => {
  const head = await client.getBlockNumber()
  const transfer = parseAbiItem('event Transfer(address indexed from, address indexed to, uint256 value)')
  const query = (span) =>
    client.getLogs({ address: WETH.address, event: transfer, fromBlock: head - span + 1n, toBlock: head })

  const narrow = await query(1001n)
  assert.ok(narrow.length > 10_000, `1001 blocks returned ${narrow.length} logs, expected the 50,000 tier`)

  await assert.rejects(() => query(1002n), (error) => {
    const message = String(error?.details ?? error?.shortMessage ?? error?.message)
    // Deliberately loose. The endpoint has already changed this wording once,
    // and no shipped code path may depend on which one comes back.
    assert.ok(message.length > 0, 'the rejection carries some message')
    return true
  })
})
