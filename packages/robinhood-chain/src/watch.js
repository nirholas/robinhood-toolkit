/**
 * robinhood-chain · live head watcher with a deliberate polling interval
 * Author: nirholas · https://github.com/nirholas/robinhood-toolkit
 * License: All Rights Reserved (c) 2026 nirholas
 *
 * robinhood-toolkit · package: robinhood-chain
 *
 * At approximately 101 ms block times, Robinhood Chain mainnet produces around
 * 10 blocks per second. Do NOT poll at that cadence: a tight getBlockNumber loop
 * generates thousands of requests per minute and trips a rate limit you have not
 * measured. Poll no faster than you consume, and if you need pre-settlement
 * visibility, prefer the sequencer WebSocket feed (wss://feed.mainnet.chain.robinhood.com)
 * declared on the chain definition — it emits sequenced batches before
 * settlement and is lower latency than any poll. Treat feed data as provisional
 * until it is confirmed against a settled block.
 */

import { RobinhoodChainError } from './errors.js'

/** Default poll interval. One sample per second is ~10 blocks of movement per tick. */
export const DEFAULT_POLLING_INTERVAL_MS = 1000

/**
 * Watch the chain head, invoking `onBlock(blockNumber, prevBlockNumber)` each
 * time a new block number is observed. Built on viem's watchBlockNumber with an
 * explicit pollingInterval so the request rate is a decision, not an accident.
 *
 * Returns the unsubscribe function viem gives you. Call it to stop watching.
 *
 * @param client                     a viem PublicClient
 * @param onBlock                    (blockNumber: bigint, prev?: bigint) => void
 * @param options.pollingIntervalMs  ms between polls (default 1000). Never set
 *                                   this below the block time in a bid to "keep
 *                                   up" — you cannot, and you will rate-limit
 *                                   yourself. Consume batches instead.
 * @param options.emitOnBegin        fire once immediately with the current head
 *                                   (default true)
 * @param options.onError            (err: Error) => void; defaults to console.error
 *
 * @example
 * import { createPublicClient, http } from 'viem'
 * import { watchHead, robinhoodChain } from 'robinhood-chain'
 * const client = createPublicClient({ chain: robinhoodChain, transport: http() })
 * const stop = watchHead(client, (block, prev) => {
 *   const advanced = prev === undefined ? 0n : block - prev
 *   console.log(`head ${block} (+${advanced} blocks since last sample)`)
 * })
 * // ... later
 * stop()
 */
export function watchHead(client, onBlock, options = {}) {
  if (!client) throw new RobinhoodChainError('watchHead requires a viem `client`.')
  if (typeof onBlock !== 'function') throw new RobinhoodChainError('watchHead requires an `onBlock` callback.')

  const {
    pollingIntervalMs = DEFAULT_POLLING_INTERVAL_MS,
    emitOnBegin = true,
    onError = (err) => console.error('[watch]', err?.shortMessage ?? err?.message ?? err),
  } = options

  if (!(pollingIntervalMs > 0)) {
    throw new RobinhoodChainError('watchHead `pollingIntervalMs` must be a positive number of milliseconds.')
  }

  let prev
  return client.watchBlockNumber({
    // poll:true forces HTTP polling even on a WebSocket transport, so the
    // pollingInterval below is actually honored and the rate stays bounded.
    poll: true,
    emitOnBegin,
    pollingInterval: pollingIntervalMs,
    onBlockNumber: (blockNumber) => {
      const previous = prev
      prev = blockNumber
      onBlock(blockNumber, previous)
    },
    onError,
  })
}
