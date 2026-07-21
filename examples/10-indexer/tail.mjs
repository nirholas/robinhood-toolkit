/* built by nirholas x.com/nichxbt */
/**
 * robinhood-toolkit · example 10: live tail with reorg handling
 * Author: nirholas · https://github.com/nirholas/robinhood-toolkit
 * License: All Rights Reserved (c) 2026 nirholas
 *
 * `confirmations` is how far behind head we index. On an Orbit L2 the sequencer
 * gives soft confirmation almost immediately, but that is a trust assumption,
 * not settlement. It is a sequencer promise at ~101 ms, and batches posted to
 * L1 can still reorganize. Choose this depth for what you are willing to be
 * wrong about, then actually handle the rewind rather than pretending it can't
 * happen.
 */
import { streamLogs } from 'robinhood-chain'
import { transferEvent, rowsFromLogs } from './backfill.mjs'

/** Cap the per-poll catch-up window so a long absence can't blow the log caps. */
const MAX_WINDOW = 1000n

export async function tail({
  client,
  db,
  statements,
  address,
  stream,
  confirmations = 20n,
  pollMs = 1000,
  reorgRewind = 100n,
  signal,
} = {}) {
  const insertBatch = db.transaction((rows) => {
    for (const row of rows) statements.insertTransfer.run(row)
  })

  while (!signal?.aborted) {
    const head = await client.getBlockNumber()
    const safeHead = head > confirmations ? head - confirmations : 0n
    const cursorRow = statements.readCursor.get(stream)
    const last = cursorRow ? BigInt(cursorRow.last_block) : safeHead

    if (safeHead <= last) {
      await new Promise((r) => setTimeout(r, pollMs))
      continue
    }

    // Reorg check: the block we last indexed must still hash the same. Only
    // possible when the cursor carries a hash (the backfill writes null).
    if (cursorRow?.last_block_hash) {
      const block = await client.getBlock({ blockNumber: last })
      if (block.hash !== cursorRow.last_block_hash) {
        const rewind = last > reorgRewind ? last - reorgRewind : 0n
        console.warn(`reorg detected at block ${last}, rewinding to ${rewind}`)
        db.transaction(() => {
          statements.deleteFromBlock.run(Number(rewind))
          statements.writeCursor.run({
            stream,
            last_block: Number(rewind),
            last_block_hash: null,
            updated_at: new Date().toISOString(),
          })
        })()
        continue
      }
    }

    const from = last + 1n
    const to = safeHead - from >= MAX_WINDOW ? from + MAX_WINDOW - 1n : safeHead

    // Adaptive fetch even here: a burst of activity in the window must not trip
    // the matched-log cap. Collect the whole window, then commit it atomically.
    const logs = []
    for await (const batch of streamLogs({ client, address, event: transferEvent, fromBlock: from, toBlock: to })) {
      logs.push(...batch.logs)
    }
    const endBlock = await client.getBlock({ blockNumber: to })
    const rows = rowsFromLogs(logs, address)

    db.transaction(() => {
      insertBatch(rows)
      statements.writeCursor.run({
        stream,
        last_block: Number(to),
        last_block_hash: endBlock.hash,
        updated_at: new Date().toISOString(),
      })
    })()

    if (rows.length) console.log(`indexed ${rows.length} events through block ${to}`)
  }
}
/* built by nirholas x.com/nichxbt */
