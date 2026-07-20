<!--
  robinhood-toolkit · build prompt: indexing Robinhood Chain events
  Author: nirholas · https://github.com/nirholas/robinhood-toolkit
  License: MIT (c) 2026 nirholas
-->

# 10 · Index chain events

## Goal

Build an indexer that backfills historical logs in bounded chunks, tails the
head in real time, survives restarts through a persisted cursor, and stores
decoded events idempotently. Around 101 ms blocks means this chain produces
roughly 855,000 blocks per day, so every naive approach to `eth_getLogs` fails
here. The chunking and cursor design is the whole point.

## Prerequisites

- Prompts 04 (viem chain definitions), 05 (registry resolver), and 06 (USDG) completed.
- Node.js 20 with `viem` and `better-sqlite3`.
- A contract to index. USDG works as a live target with real volume.

## Reference facts (verified)

- Mainnet: chain ID `4663`, RPC `https://rpc.mainnet.chain.robinhood.com`,
  explorer `https://robinhoodchain.blockscout.com` (Blockscout).
- Testnet: chain ID `46630`, RPC `https://rpc.testnet.chain.robinhood.com`,
  explorer `https://explorer.testnet.chain.robinhood.com`.
- Around 101 ms block time. That is roughly 594 blocks per minute, 35,600 per
  hour, and 855,000 per day.
- Arbitrum Orbit (Nitro) L2 with a centralized sequencer and proposer. Soft
  confirmation from the sequencer is not Ethereum settlement.
- Fully EVM compatible, so `eth_getLogs`, `eth_getBlockByNumber`, and standard
  topic filtering behave normally.
- USDG `0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168` and WETH
  `0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73`, both proxies with confirmed
  bytecode, are good indexing targets.
- Blockscout means the explorer exposes both a v2 REST API under `/api/v2/` and
  an Etherscan-compatible API under `/api`.

**UNVERIFIED:** the public RPC's per-request limits, specifically the maximum
block range and maximum result count for `eth_getLogs`, and any rate limit.
Step 1 measures them empirically rather than assuming a number.

## Steps

### 1. Measure the RPC's limits before designing around them

```sh
export RH=https://rpc.mainnet.chain.robinhood.com
export USDG=0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168
HEAD=$(cast block-number --rpc-url "$RH")
echo "head $HEAD"

# Transfer(address,address,uint256)
TOPIC=$(cast keccak 'Transfer(address,address,uint256)')

for RANGE in 1000 10000 100000; do
  FROM=$((HEAD - RANGE))
  echo "range $RANGE:"
  cast rpc eth_getLogs \
    "{\"address\":\"$USDG\",\"topics\":[\"$TOPIC\"],\"fromBlock\":\"$(cast to-hex $FROM)\",\"toBlock\":\"$(cast to-hex $HEAD)\"}" \
    --rpc-url "$RH" 2>&1 | head -c 300
  echo
done
```

Record the largest range that succeeds and whether the error names a result cap
or a range cap. Those two failure modes need different handling: a range cap is
fixed, a result cap depends on activity and requires adaptive splitting.

Confirm the block time yourself rather than trusting the number:

```sh
A=$(cast block $((HEAD - 10000)) --rpc-url "$RH" --field timestamp)
B=$(cast block "$HEAD" --rpc-url "$RH" --field timestamp)
python3 -c "print('avg block time:', ($B - $A) / 10000, 'seconds')"
```

### 2. Storage with idempotent writes

`indexer/db.mjs`:

```js
/**
 * robinhood-toolkit · indexer storage
 * Author: nirholas · https://github.com/nirholas/robinhood-toolkit
 * License: MIT (c) 2026 nirholas
 */
import Database from "better-sqlite3";

export function openDb(path = "indexer/events.db") {
  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS transfers (
      block_number INTEGER NOT NULL,
      block_hash   TEXT    NOT NULL,
      tx_hash      TEXT    NOT NULL,
      log_index    INTEGER NOT NULL,
      token        TEXT    NOT NULL,
      from_addr    TEXT    NOT NULL,
      to_addr      TEXT    NOT NULL,
      value_raw    TEXT    NOT NULL,
      PRIMARY KEY (tx_hash, log_index)
    );
    CREATE INDEX IF NOT EXISTS idx_transfers_block ON transfers(block_number);
    CREATE INDEX IF NOT EXISTS idx_transfers_from  ON transfers(from_addr);
    CREATE INDEX IF NOT EXISTS idx_transfers_to    ON transfers(to_addr);

    CREATE TABLE IF NOT EXISTS cursor (
      stream          TEXT PRIMARY KEY,
      last_block      INTEGER NOT NULL,
      last_block_hash TEXT,
      updated_at      TEXT NOT NULL
    );
  `);
  return db;
}

export function makeStatements(db) {
  return {
    insertTransfer: db.prepare(`
      INSERT INTO transfers (block_number, block_hash, tx_hash, log_index, token, from_addr, to_addr, value_raw)
      VALUES (@block_number, @block_hash, @tx_hash, @log_index, @token, @from_addr, @to_addr, @value_raw)
      ON CONFLICT(tx_hash, log_index) DO UPDATE SET
        block_number = excluded.block_number,
        block_hash   = excluded.block_hash
    `),
    readCursor: db.prepare("SELECT last_block, last_block_hash FROM cursor WHERE stream = ?"),
    writeCursor: db.prepare(`
      INSERT INTO cursor (stream, last_block, last_block_hash, updated_at)
      VALUES (@stream, @last_block, @last_block_hash, @updated_at)
      ON CONFLICT(stream) DO UPDATE SET
        last_block = excluded.last_block,
        last_block_hash = excluded.last_block_hash,
        updated_at = excluded.updated_at
    `),
    deleteFromBlock: db.prepare("DELETE FROM transfers WHERE block_number >= ?"),
  };
}
```

The composite primary key on `(tx_hash, log_index)` is what makes reprocessing a
range safe. An indexer that cannot re-run a range without duplicating rows is an
indexer you can never restart with confidence.

### 3. Backfill with adaptive chunking

`indexer/backfill.mjs`:

```js
/**
 * robinhood-toolkit · chunked historical backfill
 * Author: nirholas · https://github.com/nirholas/robinhood-toolkit
 * License: MIT (c) 2026 nirholas
 */
import { parseAbiItem } from "viem";

export const transferEvent = parseAbiItem(
  "event Transfer(address indexed from, address indexed to, uint256 value)",
);

/**
 * Halve the range on failure, grow it back on success. This converges on
 * whatever the RPC actually allows without hardcoding a limit.
 */
export async function* scanLogs(client, { address, event, fromBlock, toBlock, startChunk = 10_000n, minChunk = 100n, maxChunk = 50_000n }) {
  let chunk = startChunk;
  let start = fromBlock;

  while (start <= toBlock) {
    const end = start + chunk - 1n > toBlock ? toBlock : start + chunk - 1n;
    try {
      const logs = await client.getLogs({ address, event, fromBlock: start, toBlock: end });
      yield { fromBlock: start, toBlock: end, logs };
      start = end + 1n;
      if (chunk < maxChunk) chunk = chunk * 2n > maxChunk ? maxChunk : chunk * 2n;
    } catch (err) {
      if (chunk <= minChunk) throw new Error(`getLogs failed at minimum chunk ${minChunk}: ${err.message}`);
      chunk = chunk / 2n < minChunk ? minChunk : chunk / 2n;
    }
  }
}

export async function backfill({ client, db, statements, address, stream, fromBlock, toBlock }) {
  let total = 0;
  const insertBatch = db.transaction((rows) => {
    for (const row of rows) statements.insertTransfer.run(row);
  });

  for await (const { toBlock: end, logs } of scanLogs(client, {
    address,
    event: transferEvent,
    fromBlock,
    toBlock,
  })) {
    const rows = logs.map((log) => ({
      block_number: Number(log.blockNumber),
      block_hash: log.blockHash,
      tx_hash: log.transactionHash,
      log_index: log.logIndex,
      token: address,
      from_addr: log.args.from,
      to_addr: log.args.to,
      value_raw: log.args.value.toString(),
    }));

    // Rows and cursor advance together, so a crash never leaves the cursor
    // ahead of the data it claims to cover.
    db.transaction(() => {
      insertBatch(rows);
      statements.writeCursor.run({
        stream,
        last_block: Number(end),
        last_block_hash: null,
        updated_at: new Date().toISOString(),
      });
    })();

    total += rows.length;
    process.stdout.write(`\r${stream}: block ${end}, ${total} events`);
  }
  process.stdout.write("\n");
  return total;
}
```

### 4. Pick a start block, never zero

Scanning from genesis at 855,000 blocks per day is wasteful and usually
unnecessary. Get the contract's deployment block from Blockscout:

```sh
curl -s "https://robinhoodchain.blockscout.com/api/v2/addresses/0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168" \
  | jq '{creation_tx: .creation_tx_hash, is_contract, proxy_type}'
```

Then resolve that transaction to its block:

```sh
cast tx <creation_tx_hash> --rpc-url "$RH" --field blockNumber
```

If the creation transaction is unavailable, binary search for the first block
with bytecode at the address:

```js
/**
 * robinhood-toolkit · find a contract's deployment block by binary search
 * Author: nirholas · https://github.com/nirholas/robinhood-toolkit
 * License: MIT (c) 2026 nirholas
 */
export async function findDeploymentBlock(client, address, { lo = 0n, hi } = {}) {
  let high = hi ?? (await client.getBlockNumber());
  let low = lo;
  const hasCode = async (b) => {
    const code = await client.getBytecode({ address, blockNumber: b });
    return Boolean(code && code !== "0x");
  };
  if (!(await hasCode(high))) throw new Error("no bytecode at head, wrong address or chain");
  while (low < high) {
    const mid = (low + high) / 2n;
    if (await hasCode(mid)) high = mid;
    else low = mid + 1n;
  }
  return low;
}
```

Around 855,000 blocks per day means this search costs about 30 RPC calls even
across years of history.

### 5. Tail the head

`indexer/tail.mjs`:

```js
/**
 * robinhood-toolkit · live tail with reorg handling
 * Author: nirholas · https://github.com/nirholas/robinhood-toolkit
 * License: MIT (c) 2026 nirholas
 */
import { transferEvent } from "./backfill.mjs";

/**
 * `confirmations` is how far behind head we index. On an Orbit L2 the sequencer
 * gives soft confirmation almost immediately, but that is a trust assumption,
 * not settlement. Choose this number deliberately for your use case.
 */
export async function tail({ client, db, statements, address, stream, confirmations = 20n, pollMs = 1000 }) {
  const insertBatch = db.transaction((rows) => {
    for (const row of rows) statements.insertTransfer.run(row);
  });

  for (;;) {
    const head = await client.getBlockNumber();
    const safeHead = head > confirmations ? head - confirmations : 0n;
    const cursorRow = statements.readCursor.get(stream);
    const last = cursorRow ? BigInt(cursorRow.last_block) : safeHead;

    if (safeHead <= last) {
      await new Promise((r) => setTimeout(r, pollMs));
      continue;
    }

    // Reorg check: the block we last indexed must still hash the same.
    if (cursorRow?.last_block_hash) {
      const block = await client.getBlock({ blockNumber: last });
      if (block.hash !== cursorRow.last_block_hash) {
        const rewind = last > 100n ? last - 100n : 0n;
        console.warn(`reorg detected at ${last}, rewinding to ${rewind}`);
        db.transaction(() => {
          statements.deleteFromBlock.run(Number(rewind));
          statements.writeCursor.run({
            stream,
            last_block: Number(rewind),
            last_block_hash: null,
            updated_at: new Date().toISOString(),
          });
        })();
        continue;
      }
    }

    const from = last + 1n;
    const to = safeHead - from > 5_000n ? from + 5_000n : safeHead;
    const logs = await client.getLogs({ address, event: transferEvent, fromBlock: from, toBlock: to });
    const endBlock = await client.getBlock({ blockNumber: to });

    const rows = logs.map((log) => ({
      block_number: Number(log.blockNumber),
      block_hash: log.blockHash,
      tx_hash: log.transactionHash,
      log_index: log.logIndex,
      token: address,
      from_addr: log.args.from,
      to_addr: log.args.to,
      value_raw: log.args.value.toString(),
    }));

    db.transaction(() => {
      insertBatch(rows);
      statements.writeCursor.run({
        stream,
        last_block: Number(to),
        last_block_hash: endBlock.hash,
        updated_at: new Date().toISOString(),
      });
    })();

    if (rows.length) console.log(`indexed ${rows.length} events through block ${to}`);
  }
}
```

### 6. Runner

`indexer/run.mjs`:

```js
/**
 * robinhood-toolkit · indexer entrypoint
 * Author: nirholas · https://github.com/nirholas/robinhood-toolkit
 * License: MIT (c) 2026 nirholas
 */
import { createPublicClient, getAddress, http } from "viem";
import { robinhoodMainnet } from "../clients/token.mjs";
import { openDb, makeStatements } from "./db.mjs";
import { backfill, findDeploymentBlock } from "./backfill.mjs";
import { tail } from "./tail.mjs";

const address = getAddress(process.env.INDEX_ADDRESS ?? "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168");
const client = createPublicClient({
  chain: robinhoodMainnet,
  transport: http(undefined, { batch: true, retryCount: 5, retryDelay: 250 }),
});
const db = openDb();
const statements = makeStatements(db);
const stream = `transfers:${address}`;

const head = await client.getBlockNumber();
const cursorRow = statements.readCursor.get(stream);
const startFrom = cursorRow
  ? BigInt(cursorRow.last_block) + 1n
  : BigInt(process.env.INDEX_FROM_BLOCK ?? (await findDeploymentBlock(client, address)));

console.log(`head ${head}, backfilling ${address} from ${startFrom}`);
await backfill({ client, db, statements, address, stream, fromBlock: startFrom, toBlock: head });
console.log("backfill complete, tailing head");
await tail({ client, db, statements, address, stream });
```

```sh
npm i viem better-sqlite3
node indexer/run.mjs
```

### 7. Cross-check against Blockscout

Your index must agree with the explorer. Blockscout gives you an independent
view of the same data:

```sh
# v2 REST: token transfers for an address
curl -s "https://robinhoodchain.blockscout.com/api/v2/tokens/$USDG/transfers?limit=10" | jq '.items | length'

# Etherscan-compatible logs endpoint
curl -s "https://robinhoodchain.blockscout.com/api?module=logs&action=getLogs&address=$USDG&fromBlock=1&toBlock=latest" \
  | jq '.status, (.result | length)'
```

Compare a specific block range against your database:

```sh
sqlite3 indexer/events.db \
  "SELECT COUNT(*) FROM transfers WHERE block_number BETWEEN 1000000 AND 1001000;"
```

Use Blockscout as a verification oracle, not as the primary source. It is a
third-party index and can lag or be incomplete. The chain is the truth.

### 8. Query it

```sh
sqlite3 -header -column indexer/events.db "
  SELECT to_addr, COUNT(*) AS transfers, SUM(CAST(value_raw AS REAL)) AS raw_volume
  FROM transfers GROUP BY to_addr ORDER BY transfers DESC LIMIT 10;
"
```

Format `value_raw` with the token's decimals read at runtime (prompt 06). It is
stored as a raw string precisely so no precision is lost at write time, and so
the exponent is never baked into storage.

## Deliverable

- `indexer/db.mjs`, `indexer/backfill.mjs`, `indexer/tail.mjs`, `indexer/run.mjs`.
- `indexer/README.md` documenting the measured RPC range limit from step 1, the
  measured average block time, the deployment block used as the start, the
  confirmation depth chosen and why, and how to reset the cursor.
- A populated `events.db` with at least one full backfill and a live tail
  session, plus a Blockscout cross-check transcript.

## How to verify

1. Step 1 produces a concrete measured range limit, and `scanLogs` converges to
   at or below it without a hardcoded constant.
2. Killing the process mid-backfill and restarting resumes from the cursor and
   does not duplicate rows. Confirm with
   `SELECT COUNT(*) FROM transfers;` before and after re-running a covered range.
3. `SELECT COUNT(*) - COUNT(DISTINCT tx_hash || ':' || log_index) FROM transfers;`
   returns 0.
4. `findDeploymentBlock` returns a block where bytecode is present and where
   `blockNumber - 1` has none. Assert both.
5. A sampled block range matches Blockscout's count for the same range.
6. The tail picks up a transaction you send yourself within a few seconds:
   send a small USDG transfer and confirm the row appears with your address.
7. The reorg branch is reachable. Point the indexer at anvil, write a cursor
   hash, mine a divergent chain with `anvil_reset`, and confirm the rewind fires.

## Gotchas

- Around 101 ms blocks is the defining constraint. One day is roughly 855,000
  blocks. A `fromBlock: 0` full scan with a fixed 10,000-block chunk is tens of
  thousands of requests. Always start at the deployment block.
- Never advance the cursor in a different transaction from the rows it covers.
  A crash between the two silently drops events, and the gap is invisible later
  because the cursor looks healthy.
- `eth_getLogs` limits differ by provider and can differ between the public RPC
  and a paid one. Adaptive chunking makes the indexer portable across both.
- Store `value` as a string. JavaScript numbers lose precision above 2^53, and
  raw token amounts routinely exceed that.
- Reorgs on an Orbit L2 come from the sequencer and from L1 reorganization of
  posted batches. Soft confirmation at around 101 ms is a sequencer promise, not
  settlement. Pick a confirmation depth that reflects what you are willing to be
  wrong about, and handle the rewind rather than assuming it never happens.
- Do not assume a block number maps to a wall clock time by multiplication. Read
  `block.timestamp`.
- Indexing by topic without also filtering by `address` picks up every token's
  `Transfer` events on the chain. That is a legitimate design, but it is a very
  different volume, so decide it deliberately.
- Proxies keep the same address across upgrades, which is convenient here, but
  the event ABI can change with an implementation upgrade. Decode failures after
  a given block usually mean an upgrade, not a bug in your decoder.
- If you index Stock Tokens, resolve their addresses from the runtime registry
  (prompt 05). A hardcoded address in an indexer config is the same mistake as a
  hardcoded address in a trade path, just slower to notice.
