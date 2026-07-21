/**
 * robinhood-toolkit · adaptive log-scan CLI
 * Author: nirholas · https://github.com/nirholas/robinhood-toolkit
 * License: MIT (c) 2026 nirholas
 *
 * Scan WETH Transfer events over a block window, streaming per-chunk progress.
 * The scanner halves its chunk on ANY error and never inspects the message, so
 * it self-tunes to whatever the server cap turns out to be.
 *
 * At ~101ms blocks a 10,000-block window is ~17 MINUTES of chain history, not
 * days. Measured 2026-07-20: ~94k logs in ~11s with ZERO halvings at a 1000-
 * block chunk (the top of the 50,000-matched-log tier).
 *
 * Usage:
 *   node scripts/scan-logs.mjs                  # 10,000 blocks, chunk 1000 (expect 0 halvings)
 *   node scripts/scan-logs.mjs --blocks 3000
 *   node scripts/scan-logs.mjs --chunk 10000    # force the adaptive path: 10k span sits in the
 *                                               # 10,000-log tier, WETH matches far more, so it halves
 * Env:
 *   RH_RPC   override the mainnet RPC URL
 */

import { createPublicClient, http, parseAbiItem } from 'viem'
import { BLOCK_TIME_MS, DEFAULT_CHUNK, WETH, blocksToMs, robinhoodChain, streamLogs } from 'robinhood-chain'

const argv = process.argv.slice(2)
const numFlag = (name, dflt) => {
  const i = argv.indexOf(name)
  return i !== -1 ? BigInt(argv[i + 1]) : dflt
}

const SPAN = numFlag('--blocks', 10_000n)
const CHUNK = numFlag('--chunk', DEFAULT_CHUNK)

const TRANSFER = parseAbiItem('event Transfer(address indexed from, address indexed to, uint256 value)')
const client = createPublicClient({ chain: robinhoodChain, transport: http(process.env.RH_RPC || undefined) })

function fail(message, error) {
  console.error(`\n  ${message}`)
  if (error) console.error(`  ${error.shortMessage || error.message}`)
  process.exit(1)
}

let head
try {
  head = await client.getBlockNumber()
} catch (error) {
  fail('Could not reach Robinhood Chain.', error)
}

const fromBlock = head - SPAN + 1n
const minutes = (blocksToMs(SPAN) / 1000 / 60).toFixed(1)

console.log(`\n  WETH Transfer scan`)
console.log(`  Contract  ${WETH.address}`)
console.log(`  Range     ${fromBlock} .. ${head}  (${SPAN} blocks ≈ ${minutes} min of chain time)`)
console.log(`  Chunk     ${CHUNK} blocks${CHUNK === DEFAULT_CHUNK ? '  (top of the 50,000-log tier)' : '  (forcing adaptive path)'}\n`)

const started = Date.now()
let total = 0
let batches = 0
let lastHalvings = 0

try {
  for await (const batch of streamLogs({
    client,
    address: WETH.address,
    event: TRANSFER,
    fromBlock,
    toBlock: head,
    chunkSize: CHUNK,
  })) {
    batches += 1
    total += batch.logs.length
    const halved = batch.cursor.halvings > lastHalvings
    lastHalvings = batch.cursor.halvings
    const pct = Number(batch.toBlock - fromBlock + 1n) / Number(SPAN)
    console.log(
      `  ${(pct * 100).toFixed(0).padStart(3)}%  ${batch.fromBlock}..${batch.toBlock}  ` +
        `${String(batch.logs.length).padStart(5)} logs  chunk ${String(batch.cursor.chunkSize).padStart(5)}` +
        (halved ? '  <- HALVED after a failed request' : ''),
    )
  }
} catch (error) {
  fail('Scan failed.', error)
}

const elapsed = Date.now() - started
console.log(`\n  ${total.toLocaleString('en-US')} Transfer logs in ${batches} chunks, ${elapsed} ms`)
console.log(`  ${lastHalvings} halvings ${lastHalvings === 0 ? '(a correctly tuned scan)' : '(chunk exceeded the tier — expected with --chunk 10000)'}`)
console.log(`  ${(total / (Number(SPAN) * BLOCK_TIME_MS / 1000)).toFixed(1)} transfers per second of chain time\n`)
