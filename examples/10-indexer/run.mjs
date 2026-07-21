/* built by nirholas x.com/nichxbt */
/**
 * robinhood-toolkit · example 10: indexer entrypoint
 * Author: nirholas · https://github.com/nirholas/robinhood-toolkit
 * License: All Rights Reserved (c) 2026 nirholas
 *
 * Backfill USDG Transfer history into SQLite, then tail the head live. State
 * lives entirely in events.db: kill this at any point and it resumes from the
 * persisted cursor without duplicating a row.
 *
 * Read-only against the chain. No key, no signing, no spend.
 *
 * Usage:
 *   node run.mjs                                  # index USDG from its deployment block
 *   INDEX_ADDRESS=0x... node run.mjs              # index another contract
 *   INDEX_FROM_BLOCK=1000000 node run.mjs         # force a start block
 *   INDEX_BACKFILL_BLOCKS=20000 node run.mjs      # cap the backfill span (demo/CI)
 *   INDEX_NO_TAIL=1 node run.mjs                  # backfill only, then exit
 */
import { createPublicClient, getAddress, http } from 'viem'
import { USDG, formatToken, robinhoodChain } from 'robinhood-chain'
import { openDb, makeStatements } from './db.mjs'
import { backfill, findDeploymentBlock } from './backfill.mjs'
import { tail } from './tail.mjs'

const address = getAddress(process.env.INDEX_ADDRESS ?? USDG.address)
const decimals = address === getAddress(USDG.address) ? USDG.decimals : undefined

const client = createPublicClient({
  chain: robinhoodChain,
  transport: http(process.env.RH_RPC || undefined, { batch: true, retryCount: 5, retryDelay: 250 }),
})

const db = openDb()
const statements = makeStatements(db)
const stream = `transfers:${address}`

const head = await client.getBlockNumber()
const cursorRow = statements.readCursor.get(stream)

let startFrom
if (cursorRow) {
  startFrom = BigInt(cursorRow.last_block) + 1n
  console.log(`resuming ${stream} from cursor at block ${cursorRow.last_block}`)
} else if (process.env.INDEX_FROM_BLOCK) {
  startFrom = BigInt(process.env.INDEX_FROM_BLOCK)
} else {
  process.stdout.write('locating deployment block by binary search... ')
  startFrom = await findDeploymentBlock(client, address)
  console.log(`block ${startFrom}`)
}

// Optional cap so demos and CI don't backfill years of history at 855k
// blocks/day. Omit it to backfill the full range to head.
const backfillBlocks = process.env.INDEX_BACKFILL_BLOCKS ? BigInt(process.env.INDEX_BACKFILL_BLOCKS) : null
const toBlock = backfillBlocks && head - startFrom > backfillBlocks ? startFrom + backfillBlocks : head

console.log(`head ${head}, backfilling ${address} from ${startFrom} to ${toBlock}`)

const total = await backfill({
  client,
  db,
  statements,
  address,
  stream,
  fromBlock: startFrom,
  toBlock,
  onProgress: ({ toBlock: end, total }) => {
    process.stdout.write(`\r${stream}: block ${end}, ${total} events   `)
  },
})
process.stdout.write('\n')
console.log(`backfill complete: ${total} events`)

const dups = statements.countDuplicates.get().dups
console.log(`integrity: ${statements.countTransfers.get().n} rows, ${dups} duplicates (must be 0)`)

if (decimals !== undefined && total > 0) {
  const top = db
    .prepare(
      'SELECT to_addr, COUNT(*) AS n, SUM(CAST(value_raw AS REAL)) AS raw FROM transfers GROUP BY to_addr ORDER BY n DESC LIMIT 1',
    )
    .get()
  if (top) {
    console.log(`busiest recipient ${top.to_addr}: ${top.n} transfers, ~${formatToken(BigInt(Math.round(top.raw)), decimals)} ${USDG.symbol}`)
  }
}

if (process.env.INDEX_NO_TAIL) {
  console.log('INDEX_NO_TAIL set, exiting after backfill')
  db.close()
  process.exit(0)
}

console.log('tailing head (ctrl-c to stop)')
const controller = new AbortController()
process.on('SIGINT', () => {
  console.log('\nstopping, cursor is persisted')
  controller.abort()
  db.close()
  process.exit(0)
})
await tail({ client, db, statements, address, stream, signal: controller.signal })
/* built by nirholas x.com/nichxbt */
