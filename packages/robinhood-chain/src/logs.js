/**
 * robinhood-chain · eth_getLogs scanning that survives the mainnet caps
 * Author: nirholas · https://github.com/nirholas/robinhood-toolkit
 * License: MIT (c) 2026 nirholas
 *
 * robinhood-toolkit · package: robinhood-chain
 */

import { LogScanError, RobinhoodChainError } from './errors.js'

/**
 * Default chunk, in blocks.
 *
 * At approximately 101 ms block times this is roughly 101 SECONDS of chain
 * history, not hours. Robinhood Chain mainnet produces around 850,000 blocks per
 * day, so any range constant carried over from a 12-second L1 is off by two
 * orders of magnitude.
 *
 * 1000 is not a round number, it is the top of a tier. eth_getLogs caps how many
 * logs a query may MATCH, and that allowance is tiered by span (measured on
 * mainnet 2026-07-20):
 *
 *   - span of 1001 blocks or fewer: 50,000 matched logs
 *   - span of 1002 blocks or more:  10,000 matched logs
 *
 * A chunk of 1000 blocks is a span of 1001 (fromBlock..toBlock inclusive), which
 * is exactly the widest chunk that still buys the 50,000-log allowance. One more
 * block drops the allowance by 40,000, so 1001 is a strictly worse chunk size
 * than 1000 despite being wider.
 */
export const DEFAULT_CHUNK = 1000n

/**
 * Floor for the adaptive halving. Must sit well below the default chunk, because
 * the allowance is on MATCHED LOGS, not on blocks: a hot contract can exceed
 * 50,000 matched logs inside a span the endpoint is otherwise happy to serve.
 */
export const MIN_CHUNK = 10n

/** Approximate mainnet block cadence, for converting block counts to wall time. */
export const BLOCK_TIME_MS = 101

/** Convert a block count to approximate milliseconds of chain history. */
export function blocksToMs(blocks) {
  return Number(blocks) * BLOCK_TIME_MS
}

/**
 * Advisory classifier for the two known mainnet caps, both measured 2026-07-20.
 *
 *   1. Matched-log cap, tiered by span: 50,000 matched logs within a span of
 *      1001 blocks or fewer, 10,000 beyond it. There is NO hard block-span cap;
 *      a 500,000-block range is accepted when its filter matches little enough.
 *   2. Response size cap, reported as "HTTP response body exceeded the size
 *      limit". Independent of how many logs matched.
 *
 * REPORTING ONLY. This function must never gate retry behavior, and no caller
 * inside this package branches on its result. The reason is cap 1: on the same
 * RPC on the same day it has reported BOTH "logs matched by query exceeds limit
 * of N" and "Missing or invalid parameters" for the identical condition. The
 * second names the wrong problem entirely, and the server changed which one it
 * sends without notice. Because the scanner halves on ANY error instead of
 * matching a string, that server-side message change required no code change
 * here. A string-matching scanner would have silently stopped retrying.
 *
 * Both strings are recognized below precisely because both have been observed.
 * Treat every one of them as a label for a human reading a log line, not as a
 * branch condition.
 */
export function classifyScanError(error) {
  const message = String(error?.details ?? error?.shortMessage ?? error?.message ?? error).toLowerCase()
  // The current wording, observed live 2026-07-20.
  if (message.includes('logs matched by query') || message.includes('exceeds limit')) return 'matched-log-cap'
  // The earlier wording for the SAME condition, observed live the same day.
  if (message.includes('missing or invalid parameters') || message.includes('range')) return 'matched-log-cap'
  if (message.includes('size limit') || message.includes('response body')) return 'response-size-cap'
  return 'unknown'
}

function toBigInt(value, field) {
  if (value === undefined || value === null) {
    throw new RobinhoodChainError(`scanLogs requires \`${field}\`.`)
  }
  try {
    return BigInt(value)
  } catch {
    throw new RobinhoodChainError(`scanLogs \`${field}\` must be a block number, got ${JSON.stringify(value)}.`)
  }
}

/**
 * Create a resumable scan cursor. Persist it between runs to pick a scan back up
 * exactly where it stopped, including the chunk size it had self-tuned to.
 */
export function createCursor({ fromBlock, chunkSize = DEFAULT_CHUNK } = {}) {
  return {
    nextBlock: toBigInt(fromBlock, 'fromBlock'),
    chunkSize: toBigInt(chunkSize, 'chunkSize'),
    chunksScanned: 0,
    halvings: 0,
    logsFound: 0,
  }
}

/** Cursor to a JSON-safe object (bigints become decimal strings). */
export function serializeCursor(cursor) {
  return {
    nextBlock: cursor.nextBlock.toString(),
    chunkSize: cursor.chunkSize.toString(),
    chunksScanned: cursor.chunksScanned,
    halvings: cursor.halvings,
    logsFound: cursor.logsFound,
  }
}

/** Inverse of serializeCursor. */
export function deserializeCursor(plain) {
  return {
    nextBlock: BigInt(plain.nextBlock),
    chunkSize: BigInt(plain.chunkSize),
    chunksScanned: plain.chunksScanned ?? 0,
    halvings: plain.halvings ?? 0,
    logsFound: plain.logsFound ?? 0,
  }
}

/**
 * Stream logs chunk by chunk, adapting the chunk size to whatever the endpoint
 * actually accepts.
 *
 * Yields one batch per successful chunk: { logs, fromBlock, toBlock, cursor }.
 * The cursor is live and resumable, so a consumer that stops iterating early
 * (break, throw, or a bounded batch budget) can serialize it and resume later.
 *
 * On any error the chunk halves and the same range is retried. Every mainnet cap
 * resolves this way, which is why the scanner keys off failure rather than off
 * an error message. That choice is load bearing: the endpoint has already
 * changed the wording it uses for the matched-log cap, and this scanner kept
 * working across that change without an edit. When the chunk cannot halve any
 * further the scan throws LogScanError carrying the cursor, so no progress is
 * lost.
 *
 * @example
 * for await (const batch of streamLogs({ client, address: WETH.address, fromBlock: 0n, toBlock: 5000n })) {
 *   console.log(batch.fromBlock, batch.logs.length)
 * }
 */
export async function* streamLogs({
  client,
  address,
  event,
  events,
  args,
  fromBlock,
  toBlock,
  chunkSize = DEFAULT_CHUNK,
  minChunkSize = MIN_CHUNK,
  cursor: resumeFrom,
  onChunk,
} = {}) {
  if (!client) throw new RobinhoodChainError('streamLogs requires a viem `client`.')

  const minChunk = toBigInt(minChunkSize, 'minChunkSize')
  if (minChunk < 1n) throw new RobinhoodChainError('`minChunkSize` must be at least 1.')

  const cursor = resumeFrom ?? createCursor({ fromBlock, chunkSize })
  const maxChunk = toBigInt(chunkSize, 'chunkSize')
  const end = toBlock === undefined || toBlock === null ? await client.getBlockNumber() : toBigInt(toBlock, 'toBlock')

  while (cursor.nextBlock <= end) {
    const start = cursor.nextBlock
    const candidateEnd = start + cursor.chunkSize - 1n
    const stop = candidateEnd > end ? end : candidateEnd

    let logs
    try {
      logs = await client.getLogs({
        ...(address === undefined ? {} : { address }),
        ...(event === undefined ? {} : { event }),
        ...(events === undefined ? {} : { events }),
        ...(args === undefined ? {} : { args }),
        fromBlock: start,
        toBlock: stop,
      })
    } catch (error) {
      if (cursor.chunkSize <= minChunk) {
        throw new LogScanError(
          `eth_getLogs failed at the minimum chunk size of ${minChunk} block(s) ` +
            `over ${start}..${stop} (${classifyScanError(error)}). ` +
            'The cursor on this error can be serialized and resumed.',
          { cursor, chunkSize: cursor.chunkSize, cause: error },
        )
      }
      const halved = cursor.chunkSize / 2n
      cursor.chunkSize = halved < minChunk ? minChunk : halved
      cursor.halvings += 1
      continue
    }

    cursor.nextBlock = stop + 1n
    cursor.chunksScanned += 1
    cursor.logsFound += logs.length

    // Recover toward the configured chunk after a success, so one hot window
    // does not permanently slow the rest of the scan.
    if (cursor.chunkSize < maxChunk) {
      const doubled = cursor.chunkSize * 2n
      cursor.chunkSize = doubled > maxChunk ? maxChunk : doubled
    }

    const batch = { logs, fromBlock: start, toBlock: stop, cursor }
    onChunk?.(batch)
    yield batch
  }
}

/**
 * Scan a block range and collect every matching log.
 *
 * Returns { logs, cursor, done, stats }. Pass the returned cursor back in to
 * resume, and use `maxChunks` to bound the work done in one call, which is how
 * you keep a backfill inside a request timeout or a cron window.
 *
 * @example
 * const { logs, stats } = await scanLogs({
 *   client,
 *   address: WETH.address,
 *   event: parseAbiItem('event Transfer(address indexed from, address indexed to, uint256 value)'),
 *   fromBlock: head - 5000n,
 * })
 */
export async function scanLogs({ maxChunks, ...options } = {}) {
  const started = Date.now()
  const collected = []
  let cursor = options.cursor ?? null
  let chunks = 0
  let exhausted = true

  const stream = streamLogs(options)
  for await (const batch of stream) {
    collected.push(...batch.logs)
    cursor = batch.cursor
    chunks += 1
    if (maxChunks !== undefined && chunks >= maxChunks) {
      // Stopped on the chunk budget, not because the range ran out. The caller
      // resumes by passing `cursor` straight back in.
      exhausted = false
      await stream.return?.()
      break
    }
  }

  return {
    logs: collected,
    cursor,
    done: exhausted,
    stats: {
      chunksScanned: cursor?.chunksScanned ?? 0,
      halvings: cursor?.halvings ?? 0,
      finalChunkSize: cursor?.chunkSize ?? null,
      logsFound: collected.length,
      elapsedMs: Date.now() - started,
    },
  }
}
