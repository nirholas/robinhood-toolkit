<!--
  robinhood-toolkit · build prompt: the append-only decision journal
  Author: nirholas · https://github.com/nirholas/robinhood-toolkit
  License: All Rights Reserved (c) 2026 nirholas
-->

# 04 · Audit logging

## Goal

Build an append-only, tamper-evident decision journal that ties the agent's
**reasoning** to each order and each fill. Given any transaction hash or order
ID, you must be able to reconstruct what the agent saw, what it concluded, which
policy verdict it received, and what actually happened. This is the artifact you
need for a post-mortem, for a tax filing, and for the moment somebody asks why
the bot bought.

## Prerequisites

- `prompts/50-autonomous/01-strategy-loop-architecture.md`. The loop already
  calls `journal.write()` on every tick; this prompt implements it.
- Node 20+. No dependency required. Optional: an object store or a managed log
  sink for offsite shipping.

## Reference facts (verified)

| | Mainnet | Testnet |
|---|---|---|
| Chain ID | 4663 | 46630 |
| Explorer | `https://robinhoodchain.blockscout.com` | `https://explorer.testnet.chain.robinhood.com` |

- Crypto REST API docs: <https://docs.robinhood.com/crypto/trading>
- The chain and the venue both keep their own records, but neither records *why*
  you traded. A block explorer shows a swap; it does not show that the swap was
  triggered by a 12/26 EMA crossover on stale data. Only your journal has that,
  and only if you wrote it at decision time.
- Crypto trades 24/7, so there is no end-of-day batch boundary to reconcile
  against. Rotate the journal on a UTC day key and reconcile continuously
  instead of at a session close that does not exist.
- Robinhood does not audit connected agents. No third party is retaining a
  record of your agent's reasoning on your behalf.

## What every record must contain

A journal entry that records only the order is nearly useless six months later.
Each entry carries:

- `ts`, `seq`, `mode` (paper or live), `agentVersion`, `policyVersion`,
  `strategy` with its parameters.
- **Inputs**: the exact quote, bar timestamps, and indicator values the decision
  was made from. Include the age of the data, not just the data.
- **Reasoning**: the strategy's `reason` string, its confidence, and the
  alternatives it rejected if it evaluated any.
- **Verdict**: the full policy result, violations included, and whether the
  engine failed closed.
- **Simulation**: the predicted asset deltas and gas cost from `80-safety/03`.
- **Action**: the intent, the client order ID, and the venue or chain
  identifier returned.
- **Outcome**: the fill price, quantity, fee, and the delta between predicted
  and actual. Written as a linked follow-up entry, since it arrives later.
- `prevHash` and `hash`, forming a chain so a deleted or edited entry is
  detectable.

## Steps

1. Create `src/journal.mjs`. Write NDJSON with `fs.appendFile` and the `a` flag.
   One JSON object per line, no wrapping array, so the file remains readable
   after a crash mid-write and streams without loading into memory.
2. Hash-chain the entries: `hash = sha256(prevHash + canonicalJson(entry))`.
   Store `prevHash` on each record. This does not prevent tampering, it makes
   tampering detectable, which is the achievable property for a local file.
   Anchoring the daily terminal hash somewhere external (a chain transaction, a
   witnessed log service) upgrades it to a real integrity guarantee.
3. Enforce append-only at the filesystem level where you can: a dedicated
   directory, restrictive permissions, and on Linux `chattr +a` so even root
   tooling that overwrites will fail rather than silently truncate.
4. Make writes non-blocking for the trading path but never silently dropped.
   Buffer in memory, flush on an interval and on shutdown, and if the buffer
   exceeds a bound, **halt trading** rather than discarding records. An agent
   that trades without a journal is an agent you cannot reconstruct.
5. Redact secrets on the way in with an allowlist of fields, not a denylist of
   patterns. Denylists miss the field somebody adds next month. Never journal
   API keys, signatures, or raw signed transactions.
6. Rotate daily on the UTC day key, write a manifest with the day's first hash,
   last hash, and entry count, and ship both offsite. A journal that lives only
   on the host that failed is not evidence.
7. Build `scripts/journal-verify.mjs` to walk the chain and report the first
   broken link, and `scripts/journal-query.mjs` to answer the question this
   whole file exists for: given an order ID or transaction hash, print the full
   decision trace.
8. Build `scripts/tax-export.mjs` producing a per-disposal CSV: date, asset,
   quantity, proceeds, cost basis with the lot method stated, fees, and the
   journal sequence numbers that back each row. Every figure must be traceable
   to a journal entry.

```js
/**
 * robinhood-toolkit · append-only hash-chained decision journal
 * Author: nirholas · https://github.com/nirholas/robinhood-toolkit
 * License: All Rights Reserved (c) 2026 nirholas
 */
import { appendFile, mkdir, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';

const SAFE_FIELDS = new Set([
  'type', 'ts', 'seq', 'mode', 'agentVersion', 'policyVersion', 'strategy', 'params',
  'symbol', 'side', 'orderType', 'quantity', 'limitPrice', 'notional', 'clientOrderId',
  'quote', 'quoteAgeMs', 'indicators', 'reason', 'confidence', 'rejectedAlternatives',
  'verdict', 'violations', 'failedClosed', 'requiresConfirmation',
  'simulation', 'predictedDeltas', 'gasEstimate',
  'venueOrderId', 'txHash', 'blockNumber', 'explorer',
  'filledQuantity', 'filledPrice', 'fee', 'slippageVsPredicted',
  'error', 'durationMs', 'state', 'linkedSeq',
]);

/** Allowlist redaction. Anything not explicitly safe is dropped, not masked. */
function redact(obj) {
  if (obj === null || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map(redact);
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (!SAFE_FIELDS.has(k)) continue;
    out[k] = typeof v === 'object' ? redact(v) : v;
  }
  return out;
}

/** Stable key order so the same entry always hashes identically. */
function canonical(obj) {
  if (obj === null || typeof obj !== 'object') return JSON.stringify(obj);
  if (Array.isArray(obj)) return `[${obj.map(canonical).join(',')}]`;
  return `{${Object.keys(obj).sort().map((k) => `${JSON.stringify(k)}:${canonical(obj[k])}`).join(',')}}`;
}

export default function createJournal({
  dir = process.env.JOURNAL_DIR ?? './journal',
  flushMs = 1000,
  maxBufferedEntries = 5000,
  onOverflow,
} = {}) {
  let buffer = [];
  let seq = 0;
  let prevHash = '0'.repeat(64);
  let currentDay = null;
  let timer = null;

  const dayKey = () => new Date().toISOString().slice(0, 10);
  const filePath = (day) => join(dir, `journal-${day}.ndjson`);

  async function flush() {
    if (buffer.length === 0) return;
    const batch = buffer;
    buffer = [];
    const day = dayKey();
    await mkdir(dir, { recursive: true });
    await appendFile(filePath(day), batch.map((e) => JSON.stringify(e)).join('\n') + '\n', { flag: 'a' });
    currentDay = day;
  }

  return {
    async write(entry) {
      const record = {
        ...redact(entry),
        seq: seq += 1,
        ts: entry.ts ?? new Date().toISOString(),
        mode: entry.mode ?? process.env.AGENT_MODE ?? 'paper',
        prevHash,
      };
      record.hash = createHash('sha256').update(prevHash + canonical(record)).digest('hex');
      prevHash = record.hash;

      buffer.push(record);

      if (buffer.length > maxBufferedEntries) {
        // Never drop audit records. Halt trading instead.
        const err = new Error(`journal buffer overflow at ${buffer.length} entries. Halting.`);
        await onOverflow?.(err);
        throw err;
      }

      timer ??= setInterval(() => flush().catch((e) => console.error('[journal] flush failed', e)), flushMs);
      timer.unref?.();
      return record;
    },

    flush,

    async close() {
      if (timer) clearInterval(timer);
      timer = null;
      await flush();
      return { lastHash: prevHash, entries: seq, day: currentDay };
    },
  };
}

/** Walks a journal file and reports the first broken hash link. */
export async function verifyJournal(path) {
  const lines = (await readFile(path, 'utf8')).trim().split('\n').filter(Boolean);
  let prev = '0'.repeat(64);

  for (const [i, line] of lines.entries()) {
    const entry = JSON.parse(line);
    const { hash, ...rest } = entry;
    if (rest.prevHash !== prev) {
      return { ok: false, brokenAtLine: i + 1, seq: entry.seq, reason: 'prevHash mismatch' };
    }
    const recomputed = createHash('sha256').update(prev + canonical(rest)).digest('hex');
    if (recomputed !== hash) {
      return { ok: false, brokenAtLine: i + 1, seq: entry.seq, reason: 'entry was modified' };
    }
    prev = hash;
  }

  return { ok: true, entries: lines.length, terminalHash: prev };
}
```

Example of a complete decision trace, which is the shape you are aiming for:

```json
{"type":"decision","seq":1841,"ts":"2026-07-20T14:22:09.114Z","mode":"live","strategy":"ema-crossover","params":{"fast":12,"slow":26},"symbol":"BTC-USD","quote":{"bid":64210.5,"ask":64213.0},"quoteAgeMs":840,"indicators":{"fast":64188.2,"slow":64150.9},"reason":"ema12=64188.20 crossed above ema26=64150.90","confidence":0.58,"prevHash":"9f2c…","hash":"3a71…"}
{"type":"policy_evaluation","seq":1842,"linkedSeq":1841,"verdict":{"allow":true,"requiresConfirmation":false},"violations":[],"policyVersion":"2026-07-14","prevHash":"3a71…","hash":"c04d…"}
{"type":"order_sent","seq":1843,"linkedSeq":1841,"clientOrderId":"BTC-USD-1753021329114-1841","side":"buy","quantity":0.0015,"limitPrice":64213.0,"notional":96.32,"prevHash":"c04d…","hash":"77be…"}
{"type":"fill","seq":1847,"linkedSeq":1843,"filledQuantity":0.0015,"filledPrice":64216.4,"fee":0.29,"slippageVsPredicted":0.0053,"prevHash":"77be…","hash":"e1a2…"}
```

## Deliverable

- `src/journal.mjs` with `createJournal` and `verifyJournal`.
- `scripts/journal-verify.mjs`, `scripts/journal-query.mjs`,
  `scripts/tax-export.mjs`.
- Offsite shipping configured, with the daily manifest (first hash, last hash,
  entry count) written alongside each rotated file.
- `test/journal.test.js` asserting: an edited line is detected, a deleted line
  is detected, redaction drops an unknown field carrying a secret, and buffer
  overflow throws rather than dropping records.

## How to verify

```sh
cd packages/agent
node --test test/journal.test.js

node scripts/journal-verify.mjs journal/journal-2026-07-20.ndjson
# { ok: true, entries: 4213, terminalHash: '…' }

# tamper with one entry and re-verify
sed -i 's/"filledPrice":64216.4/"filledPrice":64000.0/' journal/journal-2026-07-20.ndjson
node scripts/journal-verify.mjs journal/journal-2026-07-20.ndjson
# { ok: false, brokenAtLine: 1847, reason: 'entry was modified' }

# the question this file exists to answer
node scripts/journal-query.mjs --order BTC-USD-1753021329114-1841
```

The query must print the decision, its inputs, the policy verdict, the
simulation, the order, and the fill as one trace. If reconstructing that
requires you to cross-reference a separate log file, the journal is incomplete.

## Gotchas

- **Logging the order without the reasoning is the failure this prompt exists to
  prevent.** In six months you will know the bot bought 0.0015 BTC and you will
  have no way to determine whether it was correct to. Write the indicator values
  and the quote age, not just the conclusion.
- Never let a journal write failure be swallowed. If the journal cannot record,
  the agent must stop trading. This is the one place where a hard halt on an IO
  error is the right call.
- Hash chaining detects tampering, it does not prevent it. Anyone with write
  access can rewrite the whole file and recompute the chain. Offsite shipping and
  external anchoring of the daily terminal hash are what make it evidential.
- Use an allowlist for redaction. A denylist of secret-looking patterns will
  miss the field a future change adds, and by then the secret is in the log
  archive.
- Canonical JSON matters. If key order varies between the write and the verify,
  every hash mismatches and the tool becomes noise you learn to ignore.
- Rotate on UTC. A local-midnight rotation shifts twice a year under daylight
  saving and produces one 23-hour file and one 25-hour file that no downstream
  tool expects.
- The tax export must state its lot method (FIFO, specific identification, or
  other) in the output header. A cost basis figure without its method is not a
  number anyone can act on, and changing the method between exports produces two
  contradictory filings from the same data.
