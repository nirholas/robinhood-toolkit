/**
 * robinhood-toolkit · example 10: chunked historical backfill
 * Author: nirholas · https://github.com/nirholas/robinhood-toolkit
 * License: MIT (c) 2026 nirholas
 *
 * The chunking is not reinvented here. It leans on `streamLogs` from the
 * robinhood-chain package, which halves its chunk on ANY error and grows it
 * back on success, converging on whatever the RPC actually allows without a
 * hardcoded constant. Mainnet caps MATCHED logs, tiered by span (measured
 * 2026-07-20: 50,000 within a 1001-block span, 10,000 beyond), and has reworded
 * that error mid-day. A scanner that halves on failure rather than matching a
 * string rode through the reword with no edit. That is the property we want.
 */
import { parseAbiItem } from 'viem'
import { streamLogs } from 'robinhood-chain'

export const transferEvent = parseAbiItem(
  'event Transfer(address indexed from, address indexed to, uint256 value)',
)

/**
 * Find a contract's deployment block by binary search over bytecode presence.
 * At ~855,000 blocks per day this costs about 30 RPC calls even across years of
 * history, which is why scanning from genesis is never the right move.
 */
export async function findDeploymentBlock(client, address, { lo = 0n, hi } = {}) {
  let high = hi ?? (await client.getBlockNumber())
  let low = lo
  const hasCode = async (b) => {
    const code = await client.getCode({ address, blockNumber: b })
    return Boolean(code && code !== '0x')
  }
  if (!(await hasCode(high))) throw new Error('no bytecode at head, wrong address or chain')
  while (low < high) {
    const mid = (low + high) / 2n
    if (await hasCode(mid)) high = mid
    else low = mid + 1n
  }
  return low
}

function rowsFromLogs(logs, token) {
  return logs.map((log) => ({
    block_number: Number(log.blockNumber),
    block_hash: log.blockHash,
    tx_hash: log.transactionHash,
    log_index: log.logIndex,
    token,
    from_addr: log.args.from,
    to_addr: log.args.to,
    value_raw: log.args.value.toString(),
  }))
}

/**
 * Backfill [fromBlock, toBlock] into the transfers table.
 *
 * Rows and the cursor advance together inside a single SQLite transaction per
 * chunk, so a crash can never leave the cursor ahead of the data it claims to
 * cover. That is the one invariant an indexer must never break: advancing the
 * cursor in a separate transaction silently drops events, and the gap is
 * invisible later because the cursor looks healthy.
 */
export async function backfill({ client, db, statements, address, stream, fromBlock, toBlock, onProgress }) {
  let total = 0
  const insertBatch = db.transaction((rows) => {
    for (const row of rows) statements.insertTransfer.run(row)
  })

  for await (const batch of streamLogs({
    client,
    address,
    event: transferEvent,
    fromBlock,
    toBlock,
  })) {
    const rows = rowsFromLogs(batch.logs, address)

    db.transaction(() => {
      insertBatch(rows)
      statements.writeCursor.run({
        stream,
        last_block: Number(batch.toBlock),
        last_block_hash: null,
        updated_at: new Date().toISOString(),
      })
    })()

    total += rows.length
    onProgress?.({ toBlock: batch.toBlock, added: rows.length, total, cursor: batch.cursor })
  }

  return total
}

export { rowsFromLogs }
