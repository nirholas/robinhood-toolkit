/**
 * robinhood-chain · adaptive log scanner tests
 * Author: nirholas · https://github.com/nirholas/robinhood-toolkit
 * License: MIT (c) 2026 nirholas
 *
 * robinhood-toolkit · package: robinhood-chain
 *
 * The stub RPC below reproduces the caps measured on mainnet 2026-07-20. The
 * primary one is a cap on MATCHED LOGS whose allowance is tiered by span
 * (50,000 within a 1001-block span, 10,000 beyond it), not a cap on span
 * itself: a 500,000-block range is accepted when its filter matches nothing.
 * An independent response-size cap also exists.
 *
 * The stub can report the matched-log rejection with either of the two wordings
 * observed live on the same day, because the scanner must survive both without
 * a code change.
 */

import assert from 'node:assert/strict'
import test from 'node:test'

import {
  DEFAULT_CHUNK,
  LogScanError,
  MIN_CHUNK,
  blocksToMs,
  classifyScanError,
  createCursor,
  deserializeCursor,
  scanLogs,
  serializeCursor,
  streamLogs,
} from '../index.js'

/** The span at which the matched-log allowance drops, measured on mainnet. */
const TIER_BOUNDARY = 1001n
/** Matched-log allowance for a span of TIER_BOUNDARY blocks or fewer. */
const NARROW_SPAN_ALLOWANCE = 50_000
/** Matched-log allowance beyond it. */
const WIDE_SPAN_ALLOWANCE = 10_000

/** The two wordings mainnet has used for the same matched-log rejection. */
const CAP_MESSAGES = {
  current: (allowance) => `logs matched by query exceeds limit of ${allowance}`,
  earlier: () => 'Missing or invalid parameters',
}

/**
 * @param logsPerBlock synthetic log density, which is what the cap actually measures
 * @param sizeCap      maximum logs returnable in one response, independent of the above
 * @param capMessage   which observed wording to reject with
 *
 * Note what this stub does NOT do: reject on span. Span only selects the
 * allowance. A span of any width is served as long as few enough logs match it.
 */
function stubClient({ head = 10_000n, logsPerBlock = 1, sizeCap = Infinity, capMessage = CAP_MESSAGES.current } = {}) {
  const calls = []

  return {
    calls,
    chain: { id: 4663 },
    getBlockNumber: async () => head,
    getLogs: async ({ fromBlock, toBlock }) => {
      const span = toBlock - fromBlock + 1n
      calls.push({ fromBlock, toBlock, span })

      // Cap 1: on MATCHED LOGS, with the allowance tiered by span.
      const allowance = span <= TIER_BOUNDARY ? NARROW_SPAN_ALLOWANCE : WIDE_SPAN_ALLOWANCE
      const count = Number(span) * logsPerBlock
      if (count > allowance) throw new Error(capMessage(allowance))

      // Cap 2: independent of the above, keyed on serialized response volume.
      if (count > sizeCap) throw new Error('HTTP response body exceeded the size limit')

      return Array.from({ length: count }, (_, i) => ({
        blockNumber: fromBlock + BigInt(Math.floor(i / logsPerBlock)),
        logIndex: i,
      }))
    },
  }
}

test('the default chunk is the widest one inside the generous allowance tier', () => {
  assert.equal(DEFAULT_CHUNK, 1000n)
  // A chunk of N blocks queries an inclusive span of N + 1, so 1000 is exactly
  // the largest chunk that still lands on the 50,000-log side of the boundary.
  assert.equal(DEFAULT_CHUNK + 1n, TIER_BOUNDARY, '1000 is not a round number, it is the top of a tier')
  assert.equal(MIN_CHUNK, 10n)
  // 1000 blocks is 101 seconds of chain history here, not hours.
  assert.equal(blocksToMs(1000n), 101_000)
})

// The claim that most directly contradicts the older "1001-block span cap"
// description, which this suite used to encode.
test('an enormous span is accepted outright when little enough matches it', async () => {
  const client = stubClient({ head: 500_000n, logsPerBlock: 0 })
  const logs = await client.getLogs({ fromBlock: 1n, toBlock: 500_000n })

  assert.equal(logs.length, 0, 'a 500,000-block range is legal; span alone is never the rejection')
  assert.equal(client.calls[0].span, 500_000n)
})

test('a clean scan makes no wasted requests at the default chunk', async () => {
  const client = stubClient({ head: 5000n })
  const { logs, stats } = await scanLogs({ client, fromBlock: 1n, toBlock: 5000n })

  assert.equal(logs.length, 5000)
  assert.equal(stats.halvings, 0, 'the default chunk must not trip the allowance')
  assert.equal(stats.chunksScanned, 5)
  assert.equal(client.calls.length, 5, 'no failed request per chunk')
})

test('the scan covers the range exactly once, with no gaps or overlaps', async () => {
  const client = stubClient({ head: 3333n })
  const { logs } = await scanLogs({ client, fromBlock: 1n, toBlock: 3333n })

  const blocks = logs.map((l) => l.blockNumber)
  assert.equal(blocks.length, 3333)
  assert.equal(new Set(blocks.map(String)).size, 3333, 'no duplicated blocks')
  assert.equal(blocks[0], 1n)
  assert.equal(blocks.at(-1), 3333n)
})

// Halving past the reduced allowance: the exact failure a chunk size tuned
// without knowledge of the tier boundary produces on a busy contract.
test('an over-wide chunk halves into the generous tier and still completes', async () => {
  const client = stubClient({ head: 4000n, logsPerBlock: 20 })
  const { logs, stats } = await scanLogs({ client, fromBlock: 1n, toBlock: 4000n, chunkSize: 10_000n })

  assert.equal(logs.length, 80_000, 'no logs lost to the retries')
  assert.ok(stats.halvings > 0, 'the adaptive path must have engaged')
  assert.ok(client.calls.some((c) => c.span > TIER_BOUNDARY), 'the oversized attempt happened')
  assert.ok(
    client.calls.some((c) => c.span <= TIER_BOUNDARY),
    'and it recovered into the tier that could serve the volume',
  )
})

// The scanner never reads the error text, so the wording it receives cannot
// change the outcome. This is the property that survived the live message change.
test('the scan result is identical under either observed cap wording', async () => {
  const results = []
  for (const capMessage of [CAP_MESSAGES.current, CAP_MESSAGES.earlier]) {
    const client = stubClient({ head: 4000n, logsPerBlock: 20, capMessage })
    const { logs, stats } = await scanLogs({ client, fromBlock: 1n, toBlock: 4000n, chunkSize: 10_000n })
    results.push({ logs: logs.length, halvings: stats.halvings, calls: client.calls.length })
  }

  assert.equal(results[0].logs, 80_000)
  assert.deepEqual(results[0], results[1], 'the wording of the rejection changed nothing')
})

// The second, independent cap: an accepted matched-log count that is still too
// large to serialize.
test('a response-size rejection inside an accepted span also halves', async () => {
  const client = stubClient({ head: 2000n, logsPerBlock: 20, sizeCap: 5000 })
  const { logs, stats } = await scanLogs({ client, fromBlock: 1n, toBlock: 2000n })

  assert.equal(logs.length, 40_000)
  assert.ok(stats.halvings > 0, 'the size cap must trigger halving on its own')
})

test('the chunk recovers upward after a hot window, capped at the configured size', async () => {
  const client = stubClient({ head: 6000n, logsPerBlock: 20 })
  const { stats } = await scanLogs({ client, fromBlock: 1n, toBlock: 6000n, chunkSize: 4000n })

  assert.ok(stats.halvings > 0)
  assert.ok(stats.finalChunkSize <= 4000n, 'never grows past the configured chunk')
  assert.ok(stats.finalChunkSize > MIN_CHUNK, 'recovered rather than staying at the floor')
})

test('a scan that cannot progress at the floor throws a resumable LogScanError', async () => {
  const client = {
    chain: { id: 4663 },
    getBlockNumber: async () => 5000n,
    getLogs: async () => {
      throw new Error('HTTP response body exceeded the size limit')
    },
  }

  await assert.rejects(
    () => scanLogs({ client, fromBlock: 1n, toBlock: 5000n }),
    (error) => {
      assert.ok(error instanceof LogScanError)
      assert.equal(error.chunkSize, MIN_CHUNK)
      assert.equal(error.cursor.nextBlock, 1n, 'the cursor is intact for a resume')
      assert.match(error.message, /response-size-cap/)
      return true
    },
  )
})

test('a scan resumes exactly where a bounded run stopped', async () => {
  const client = stubClient({ head: 5000n })

  const first = await scanLogs({ client, fromBlock: 1n, toBlock: 5000n, maxChunks: 2 })
  assert.equal(first.done, false)
  assert.equal(first.logs.length, 2000)
  assert.equal(first.cursor.nextBlock, 2001n)

  // Round-trip the cursor through JSON, the way a real backfill persists it.
  const saved = JSON.parse(JSON.stringify(serializeCursor(first.cursor)))
  const resumed = await scanLogs({ client, toBlock: 5000n, cursor: deserializeCursor(saved) })

  assert.equal(resumed.done, true)
  assert.equal(resumed.logs.length, 3000)
  assert.equal(first.logs.length + resumed.logs.length, 5000, 'the resume neither skipped nor repeated')
})

test('toBlock defaults to the current head', async () => {
  const client = stubClient({ head: 1500n })
  const { logs } = await scanLogs({ client, fromBlock: 1n })
  assert.equal(logs.length, 1500)
})

test('streamLogs yields batches with correct block bounds', async () => {
  const client = stubClient({ head: 2500n })
  const batches = []
  for await (const batch of streamLogs({ client, fromBlock: 1n, toBlock: 2500n })) {
    batches.push([batch.fromBlock, batch.toBlock])
  }
  assert.deepEqual(batches, [
    [1n, 1000n],
    [1001n, 2000n],
    [2001n, 2500n],
  ])
})

test('cursors serialize to JSON-safe values and back', () => {
  const cursor = createCursor({ fromBlock: 12_345n, chunkSize: 500n })
  const plain = serializeCursor(cursor)
  assert.equal(typeof plain.nextBlock, 'string')
  assert.equal(JSON.parse(JSON.stringify(plain)).nextBlock, '12345')
  assert.deepEqual(deserializeCursor(plain), cursor)
})

// Advisory only. The scanner halves on ANY error precisely because none of
// these strings is a stable contract.
test('both observed wordings of the matched-log cap classify as the same cap', () => {
  // The current wording, observed live 2026-07-20.
  assert.equal(classifyScanError(new Error('logs matched by query exceeds limit of 10000')), 'matched-log-cap')
  assert.equal(classifyScanError(new Error('logs matched by query exceeds limit of 50000')), 'matched-log-cap')
  // The earlier wording for the identical condition, observed the same day on
  // the same RPC. It is kept because the server may send it again.
  assert.equal(classifyScanError(new Error('Missing or invalid parameters')), 'matched-log-cap')
})

test('classifyScanError distinguishes the response-size cap and admits ignorance otherwise', () => {
  assert.equal(classifyScanError(new Error('HTTP response body exceeded the size limit')), 'response-size-cap')
  assert.equal(classifyScanError(new Error('socket hang up')), 'unknown')
  assert.equal(classifyScanError(new Error('some future cap nobody has documented yet')), 'unknown')
})

test('an unrecognized error still halves, because caps are not identified by string', async () => {
  let failures = 0
  const client = {
    chain: { id: 4663 },
    getBlockNumber: async () => 2000n,
    getLogs: async ({ fromBlock, toBlock }) => {
      if (toBlock - fromBlock + 1n > 250n) {
        failures += 1
        throw new Error('some future cap nobody has documented yet')
      }
      return []
    },
  }

  const { stats, done } = await scanLogs({ client, fromBlock: 1n, toBlock: 2000n })
  assert.ok(failures > 0)
  assert.ok(stats.halvings >= 2, 'halved past an error string it has never seen')
  assert.equal(stats.chunksScanned, 8)
  assert.equal(done, true, 'and completed the range anyway')
  // The classifier had no idea what this was. The scanner did not need it to.
  assert.equal(classifyScanError(new Error('some future cap nobody has documented yet')), 'unknown')
})
