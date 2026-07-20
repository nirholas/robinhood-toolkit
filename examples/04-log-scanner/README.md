<!--
  robinhood-toolkit · example readme: adaptive log scanner
  Author: nirholas · https://github.com/nirholas/robinhood-toolkit
  License: MIT (c) 2026 nirholas
-->

# 04 · Log scanner

Scan WETH `Transfer` events over a block range with the adaptive `eth_getLogs`
scanner, watch the endpoint's caps reject the queries that exceed them, and stop
a scan mid-range to resume it from a serialized cursor.

## The lesson: never classify an RPC failure by its error string

This example exists to demonstrate one thing above all else. On 2026-07-20,
against `rpc.mainnet.chain.robinhood.com`, **the same query rejected for the
same reason under two different error messages within the same day**:

```
logs matched by query exceeds limit of 10000     <- what it says now
Missing or invalid parameters                    <- what it said earlier
```

The second one names the wrong problem entirely. The parameters were valid; too
many logs matched. Taking it literally costs an hour hunting a parameter bug
that does not exist, and it is the reason the earlier version of these docs
described a block-span cap that turned out not to exist at all.

The rule that follows is the whole point: **classify on failure, never on the
string.** `scanLogs` halves its chunk and retries on ANY error and never reads
the message. That is why a server-side reword needed zero code changes here. A
scanner that matched on `"Missing or invalid parameters"` would have silently
stopped retrying the day the wording moved, and its tests would have kept
passing because they would have asserted the same stale string.

`classifyScanError` recognizes both wordings, and it is advisory only. Use it to
label a log line. Never branch on it.

## What the endpoint actually enforces

Measured live on 2026-07-20. The cap is on how many logs a query MATCHES, and
the allowance is tiered by span:

| Block span | Matched-log allowance |
|---|---|
| 1001 blocks or fewer | 50,000 |
| 1002 blocks or more | 10,000 |

**There is no hard block-span cap.** A 500,000-block range is accepted without
complaint when its filter matches nothing. Span only decides which allowance
applies. Part 2 proves both halves of that claim by probing the boundary
directly: 1001 blocks returns well over 10,000 logs successfully, and 1002
blocks of the same contract is rejected at the 10,000 limit.

That boundary is exactly why `DEFAULT_CHUNK` is `1000n`, and it is not a round
number. A chunk of 1000 blocks queries an inclusive span of 1001, the widest
chunk that still earns the 50,000-log allowance. Widening it to 1001 blocks
would cut the allowance to 10,000, so the slightly larger chunk is strictly
worse.

A second, independent cap on response size also exists, reported as
`HTTP response body exceeded the size limit`. Halving resolves that one too,
which is convenient precisely because the scanner never had to tell them apart.

## What it demonstrates

- **Part 1**: a clean streaming scan with per-chunk progress, a live chunk-size
  readout, and a flag whenever the scanner halves after a failed request.
- **Part 2**: the cap and its tier boundary, failing for real, with the exact
  error text printed so you can recognise it in your own logs.
- **Part 3**: a bounded scan that stops on a `maxChunks` budget, serializes its
  cursor to disk, and resumes from that file to finish the range. The two totals
  are compared over an identical block range and must match exactly; the program
  exits non-zero if the cursor ever drops or duplicates a block.

## Run it

```sh
npm install          # from the repository root, once
cd examples/04-log-scanner
node index.mjs
```

Options:

```sh
node index.mjs --blocks 6000     # wider range
node index.mjs --skip-failures   # skip Part 2's deliberately failing calls
```

## Real output

Captured 2026-07-20. Log counts move with live activity; `chunksScanned: 3`,
`0 halvings`, `classified as: matched-log-cap`, and the 1001/1002 boundary
should not.

```
  WETH Transfer scan
  Contract  0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73
  Range     15029551 .. 15032550  (3000 blocks, 5.0 minutes of chain time)
  Chunk     1000 blocks, the widest chunk inside the 50,000-log tier

  Part 1: streaming scan with live progress
  -----------------------------------------
  [########................]  33%  blocks 15029551..15030550  12714 logs  chunk 1000
  [################........]  67%  blocks 15030551..15031550  11568 logs  chunk 1000
  [########################] 100%  blocks 15031551..15032550  11085 logs  chunk 1000

  35,367 Transfer logs in 3 chunks, 3121 ms
  0 halvings (0 is what a correctly tuned scan looks like)
  116.7 transfers per second of chain time

  Largest transfer in the last 1000 blocks: 3.599123038672696784 WETH
  from 0x52e65B17fB6E5BA00Ed806f37Afcd2DaA50271Ca
  to   0x37E44a04c05e7cda4Bcf17F748b7F823C73E3Fe0
  tx   0x20a28a240b09097952809b77a2d651f30911af72b45bd68f6782789adb78d94e

  Part 2: the matched-log cap and its tier boundary, observed live
  ----------------------------------------------------------------
  Most of these calls are SUPPOSED to fail. That is the demonstration.

  a) 500,000 blocks, filtered to a sender with no WETH transfers
     ACCEPTED with 0 logs.
     So there is no hard block-span cap. A 500,000-block range is legal
     as long as few enough logs MATCH it.

  b) 3000 blocks against a busy contract (about 40,000 matching logs)
     rejected: logs matched by query exceeds limit of 10000
     classified as: matched-log-cap
     A sixth of the block range of probe (a), rejected. Span is not the variable.

  c) the tier boundary: 1001 blocks vs 1002 blocks, same contract
     1001 blocks -> ACCEPTED, 11,101 logs
     1002 blocks -> rejected: logs matched by query exceeds limit of 10000

  Measured 2026-07-20: within a span of 1001 blocks or fewer the endpoint
  returns up to 50,000 matched logs. Past 1001 blocks the allowance drops
  to 10,000. That is why DEFAULT_CHUNK is 1000: it sits inside the
  generous tier, so a clean scan makes zero wasted requests.

  Halving the chunk resolves every one of these, which is why the scanner
  halves on ANY error rather than matching an error string. Classify on
  FAILURE, never on the string. These messages are not a stable contract:
  the rejections above were reported as "Missing or invalid parameters"
  earlier on the same day, by this same RPC, for this same condition.
  A scanner that matched that string would have stopped retrying the
  moment the server reworded it. This one needed no code change.

  Part 3: a resumable scan across two separate runs
  -------------------------------------------------
  Run A: scan with maxChunks: 1, then write the cursor to disk and stop.

  Run A  12,714 logs, 1 chunk, done=false
  Cursor written to .cursor.json:
    {"nextBlock":"15030551","chunkSize":"1000","chunksScanned":1,"halvings":0,"logsFound":12714}
  Bigints are decimal strings, so the cursor survives JSON round trips.
  2000 blocks still unscanned.

  Run B: read the file back and finish the range.

  Run B  22,653 logs, 2 more chunks, done=true

  Run A + Run B  35,367 logs
  Part 1 single pass  35,367 logs
  Identical over the same fixed range. The cursor neither drops nor duplicates blocks.

  At approximately 101 ms per block, 1000 blocks is about
  101 seconds of history, not hours. Range intuition
  carried over from a 12-second L1 is off by two orders of magnitude here.
```

## Notes

**1000 blocks is 101 seconds, not hours.** At roughly 101 ms per block this chain
produces about 855,000 blocks per day. `DEFAULT_CHUNK` covers about a minute and
a half of history. Convert block counts to wall time in your own comments and UI
copy with `blocksToMs()`; every range intuition from a 12-second L1 is off by two
orders of magnitude here.

**`halvings: 0` is what correct looks like.** Halvings in the stats mean you set
`chunkSize` past the 1001-block tier boundary and are paying a guaranteed failed
request per chunk.

**Testnet is more permissive than mainnet.** Constants tuned on testnet fail
immediately on mainnet. Tune against the network you will run against.

**Resumable backfill.** `LogScanError` carries the cursor too, so a scan that
dies at the minimum chunk size can be resumed rather than restarted:

```js
let cursor = saved ? deserializeCursor(saved) : undefined

const { logs, cursor: next, done } = await scanLogs({
  client,
  address: WETH.address,
  fromBlock: 15_000_000n,
  toBlock: 15_100_000n,
  cursor,
  maxChunks: 20,
})

await persist(serializeCursor(next))
if (!done) scheduleNextRun()
```

## Read-only

No key, no signing, no spend. Part 3 writes a `.cursor.json` scratch file next to
the script and deletes it on completion.
