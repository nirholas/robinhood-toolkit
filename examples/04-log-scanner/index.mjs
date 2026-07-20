/**
 * robinhood-toolkit · example 04: adaptive log scanning and resumable cursors
 * Author: nirholas · https://github.com/nirholas/robinhood-toolkit
 * License: MIT (c) 2026 nirholas
 *
 * eth_getLogs on Robinhood Chain mainnet caps the number of logs a query may
 * MATCH, and that cap is tiered by how wide the block range is. Measured live
 * on 2026-07-20:
 *
 *   - Span of 1001 blocks or fewer:  up to 50,000 matched logs.
 *   - Span of 1002 blocks or more:   up to 10,000 matched logs.
 *
 * Both tiers are rejected with "logs matched by query exceeds limit of N".
 *
 * There is NO hard block-span cap: a 500,000-block range is accepted without
 * complaint when its filter matches nothing. Span only decides which allowance
 * applies. Part 2 proves both halves of that claim by probing the boundary.
 *
 * The single most important thing this example teaches: DO NOT classify these
 * failures by matching the error string. Earlier the same day, on the same RPC,
 * this identical condition reported "Missing or invalid parameters", a message
 * that names the wrong problem entirely. The server reworded it with no notice.
 * scanLogs halves on ANY error and never reads the message, which is the only
 * reason that reword required no code change. classifyScanError below is used
 * purely to LABEL the failures printed in Part 2, never to decide anything.
 *
 * This program demonstrates three things against the live chain:
 *
 *   Part 1  A clean scan at the tuned chunk size, with per-chunk progress.
 *   Part 2  The cap and its tier boundary, failing for real.
 *   Part 3  A bounded scan that stops on a chunk budget, serializes its cursor
 *           to disk, and resumes from that file to finish the range.
 *
 * Read-only. No key, no signing, no spend.
 *
 * Usage:
 *   node index.mjs                 # 3000 blocks, about 5 minutes of chain time
 *   node index.mjs --blocks 6000
 *   node index.mjs --skip-failures # skip Part 2 (it makes deliberately failing calls)
 */

import { rm, readFile, writeFile } from 'node:fs/promises'
import { createPublicClient, http, parseAbiItem } from 'viem'
import {
  BLOCK_TIME_MS,
  DEFAULT_CHUNK,
  LogScanError,
  WETH,
  blocksToMs,
  classifyScanError,
  deserializeCursor,
  formatToken,
  robinhoodChain,
  scanLogs,
  serializeCursor,
  streamLogs,
} from 'robinhood-chain'

const TRANSFER = parseAbiItem('event Transfer(address indexed from, address indexed to, uint256 value)')
const CURSOR_FILE = new URL('./.cursor.json', import.meta.url)

const blocksIndex = process.argv.indexOf('--blocks')
const SPAN = BigInt(blocksIndex !== -1 ? process.argv[blocksIndex + 1] : 3000)
const skipFailures = process.argv.includes('--skip-failures')

const client = createPublicClient({ chain: robinhoodChain, transport: http(process.env.RH_RPC || undefined) })

function fail(message, error) {
  console.error(`\n  ${message}`)
  if (error) console.error(`  ${error.shortMessage || error.message}`)
  console.error('')
  process.exit(1)
}

function heading(text) {
  console.log(`\n  ${text}`)
  console.log(`  ${'-'.repeat(text.length)}`)
}

/** Human-readable duration for a block count, since block-count intuition lies here. */
function chainTime(blocks) {
  const seconds = blocksToMs(blocks) / 1000
  if (seconds < 90) return `${seconds.toFixed(0)}s of chain time`
  return `${(seconds / 60).toFixed(1)} minutes of chain time`
}

let head
try {
  head = await client.getBlockNumber()
} catch (error) {
  fail('Could not reach Robinhood Chain.', error)
}

const fromBlock = head - SPAN + 1n
const toBlock = head

console.log(`\n  WETH Transfer scan`)
console.log(`  Contract  ${WETH.address}`)
console.log(`  Range     ${fromBlock} .. ${toBlock}  (${SPAN} blocks, ${chainTime(SPAN)})`)
console.log(`  Chunk     ${DEFAULT_CHUNK} blocks, the widest chunk inside the 50,000-log tier`)

// ---------------------------------------------------------------------------
// Part 1: a clean scan, streaming progress per chunk
// ---------------------------------------------------------------------------

heading('Part 1: streaming scan with live progress')

const started = Date.now()
let batches = 0
let total = 0
let lastHalvings = 0

try {
  for await (const batch of streamLogs({
    client,
    address: WETH.address,
    event: TRANSFER,
    fromBlock,
    toBlock,
  })) {
    batches += 1
    total += batch.logs.length

    // A halving means the previous request failed and the scanner backed off.
    // Surfacing it is the difference between "slow" and "you tuned it wrong".
    const halved = batch.cursor.halvings > lastHalvings
    lastHalvings = batch.cursor.halvings

    const progress = Number(batch.toBlock - fromBlock + 1n) / Number(SPAN)
    const bar = '#'.repeat(Math.round(progress * 24)).padEnd(24, '.')

    console.log(
      `  [${bar}] ${(progress * 100).toFixed(0).padStart(3)}%  ` +
        `blocks ${batch.fromBlock}..${batch.toBlock}  ` +
        `${String(batch.logs.length).padStart(5)} logs  ` +
        `chunk ${String(batch.cursor.chunkSize).padStart(4)}` +
        (halved ? '  <- HALVED after a failed request' : ''),
    )
  }
} catch (error) {
  if (error instanceof LogScanError) {
    fail(
      `Scan could not progress at the minimum chunk size (${classifyScanError(error.cause)}). ` +
        `Resume from block ${error.cursor?.nextBlock}.`,
      error,
    )
  }
  fail('Scan failed.', error)
}

const elapsed = Date.now() - started
console.log(`\n  ${total.toLocaleString('en-US')} Transfer logs in ${batches} chunks, ${elapsed} ms`)
console.log(`  ${lastHalvings} halvings (0 is what a correctly tuned scan looks like)`)
console.log(`  ${(total / (Number(SPAN) * BLOCK_TIME_MS / 1000)).toFixed(1)} transfers per second of chain time`)

// A concrete read on the data, so the scan produces an answer rather than a count.
if (total > 0) {
  const { logs } = await scanLogs({
    client,
    address: WETH.address,
    event: TRANSFER,
    fromBlock: toBlock - 999n,
    toBlock,
  })
  if (logs.length > 0) {
    const largest = logs.reduce((max, log) => (log.args.value > max.args.value ? log : max))
    console.log(
      `\n  Largest transfer in the last 1000 blocks: ` +
        `${formatToken(largest.args.value, WETH.decimals)} WETH`,
    )
    console.log(`  from ${largest.args.from}`)
    console.log(`  to   ${largest.args.to}`)
    console.log(`  tx   ${largest.transactionHash}`)
  }
}

// ---------------------------------------------------------------------------
// Part 2: both caps, failing for real
// ---------------------------------------------------------------------------

if (!skipFailures) {
  heading('Part 2: the matched-log cap and its tier boundary, observed live')

  console.log('  Most of these calls are SUPPOSED to fail. That is the demonstration.\n')

  const DEAD = '0x000000000000000000000000000000000000dEaD'

  // Probe 1: an enormous span whose filter matches nothing. If a hard block-span
  // cap existed, this would fail on the span alone. It does not.
  console.log('  a) 500,000 blocks, filtered to a sender with no WETH transfers')
  try {
    const logs = await client.getLogs({
      address: WETH.address,
      event: TRANSFER,
      args: { from: DEAD },
      fromBlock: head - 500_000n,
      toBlock: head,
    })
    console.log(`     ACCEPTED with ${logs.length} logs.`)
    console.log('     So there is no hard block-span cap. A 500,000-block range is legal')
    console.log('     as long as few enough logs MATCH it.')
  } catch (error) {
    const message = error.details ?? error.shortMessage ?? error.message
    console.log(`     rejected: ${String(message).trim()}`)
    console.log(`     classified as: ${classifyScanError(error)}`)
    console.log('     A hard span cap has been introduced since 2026-07-20.')
  }

  // Probe 2: the same filter, a far narrower span, but a busy contract. The cap
  // is on the number of logs MATCHED, not on the width of the range.
  console.log('\n  b) 3000 blocks against a busy contract (about 40,000 matching logs)')
  try {
    const logs = await client.getLogs({
      address: WETH.address,
      event: TRANSFER,
      fromBlock: head - 3000n,
      toBlock: head,
    })
    console.log(`     ACCEPTED with ${logs.length.toLocaleString('en-US')} logs.`)
    console.log('     Activity is low enough right now to fit under the cap.')
  } catch (error) {
    const message = error.details ?? error.shortMessage ?? error.message
    console.log(`     rejected: ${String(message).trim()}`)
    console.log(`     classified as: ${classifyScanError(error)}`)
    console.log('     A sixth of the block range of probe (a), rejected. Span is not the variable.')
  }

  // Probe 3: the tier boundary. 1001 blocks is accepted while returning far
  // more than 10,000 logs; 1002 blocks is rejected at 10,000. The cap on
  // matched logs is TIERED by span, and 1001 is where the tier changes.
  console.log('\n  c) the tier boundary: 1001 blocks vs 1002 blocks, same contract')
  for (const span of [1001n, 1002n]) {
    try {
      const logs = await client.getLogs({
        address: WETH.address,
        event: TRANSFER,
        fromBlock: head - span + 1n,
        toBlock: head,
      })
      console.log(`     ${span} blocks -> ACCEPTED, ${logs.length.toLocaleString('en-US')} logs`)
    } catch (error) {
      const message = error.details ?? error.shortMessage ?? error.message
      console.log(`     ${span} blocks -> rejected: ${String(message).trim()}`)
    }
  }

  console.log('\n  Measured 2026-07-20: within a span of 1001 blocks or fewer the endpoint')
  console.log('  returns up to 50,000 matched logs. Past 1001 blocks the allowance drops')
  console.log('  to 10,000. That is why DEFAULT_CHUNK is 1000: it sits inside the')
  console.log('  generous tier, so a clean scan makes zero wasted requests.')
  console.log('')
  console.log('  Halving the chunk resolves every one of these, which is why the scanner')
  console.log('  halves on ANY error rather than matching an error string. Classify on')
  console.log('  FAILURE, never on the string. These messages are not a stable contract:')
  console.log('  the rejections above were reported as "Missing or invalid parameters"')
  console.log('  earlier on the same day, by this same RPC, for this same condition.')
  console.log('  A scanner that matched that string would have stopped retrying the')
  console.log('  moment the server reworded it. This one needed no code change.')
}

// ---------------------------------------------------------------------------
// Part 3: stop, persist, resume
// ---------------------------------------------------------------------------

heading('Part 3: a resumable scan across two separate runs')

console.log('  Run A: scan with maxChunks: 1, then write the cursor to disk and stop.\n')

const runA = await scanLogs({
  client,
  address: WETH.address,
  event: TRANSFER,
  fromBlock,
  toBlock,
  maxChunks: 1,
})

console.log(`  Run A  ${runA.logs.length.toLocaleString('en-US')} logs, ` +
  `${runA.stats.chunksScanned} chunk, done=${runA.done}`)

if (runA.done) {
  fail('Run A reported done on a bounded scan. The chunk budget is not being honored.')
}

const serialized = serializeCursor(runA.cursor)
await writeFile(CURSOR_FILE, JSON.stringify(serialized, null, 2))

console.log(`  Cursor written to .cursor.json:`)
console.log(`    ${JSON.stringify(serialized)}`)
console.log(`  Bigints are decimal strings, so the cursor survives JSON round trips.`)
console.log(`  ${toBlock - runA.cursor.nextBlock + 1n} blocks still unscanned.`)

console.log('\n  Run B: read the file back and finish the range.\n')

const restored = deserializeCursor(JSON.parse(await readFile(CURSOR_FILE, 'utf8')))

if (restored.nextBlock !== runA.cursor.nextBlock) {
  fail(`Cursor round trip lost position: ${restored.nextBlock} != ${runA.cursor.nextBlock}`)
}

const runB = await scanLogs({
  client,
  address: WETH.address,
  event: TRANSFER,
  fromBlock,
  toBlock,
  cursor: restored,
})

console.log(`  Run B  ${runB.logs.length.toLocaleString('en-US')} logs, ` +
  `${runB.stats.chunksScanned - runA.stats.chunksScanned} more chunks, done=${runB.done}`)

const resumedTotal = runA.logs.length + runB.logs.length
console.log(`\n  Run A + Run B  ${resumedTotal.toLocaleString('en-US')} logs`)
console.log(`  Part 1 single pass  ${total.toLocaleString('en-US')} logs`)

// The two totals are read at different moments against a chain producing a
// block every ~101 ms, so they are compared over the SAME fixed range and must
// agree exactly. A mismatch means the cursor dropped or double-counted blocks.
if (resumedTotal !== total) {
  fail(
    `Resumed scan returned ${resumedTotal} logs against ${total} for an identical block range. ` +
      'The cursor is dropping or duplicating blocks.',
  )
}

console.log('  Identical over the same fixed range. The cursor neither drops nor duplicates blocks.')

await rm(CURSOR_FILE, { force: true })

console.log(`\n  At approximately ${BLOCK_TIME_MS} ms per block, ${DEFAULT_CHUNK} blocks is about`)
console.log(`  ${(blocksToMs(DEFAULT_CHUNK) / 1000).toFixed(0)} seconds of history, not hours. Range intuition`)
console.log('  carried over from a 12-second L1 is off by two orders of magnitude here.\n')
