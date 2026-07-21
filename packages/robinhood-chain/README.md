<!--
  robinhood-toolkit · package readme: robinhood-chain
  Author: nirholas · https://github.com/nirholas/robinhood-toolkit
  License: All Rights Reserved (c) 2026 nirholas
-->

# robinhood-chain

**The chain SDK for [Robinhood Chain](https://docs.robinhood.com/chain/): viem chain definitions, verified token constants, decimals-safe formatting, on-chain address verification, and log scanning that survives mainnet.**

Robinhood Chain is an Arbitrum Orbit L2 (mainnet `4663`, testnet `46630`) that went to permissionless public mainnet on 2026-07-01. Deploying to it is easy. Reading from it correctly is where people lose a day.

Every constant in this package was read from the live chain, not copied from documentation. Every helper exists because of a specific trap that is expensive to rediscover.

```sh
npm install robinhood-chain viem
```

ESM only, Node 20+. `viem` is a peer dependency and the only dependency of any kind.

---

## The two traps this package exists for

### 1. USDG has 6 decimals, not 18

USDG (Global Dollar) is the settlement asset for Stock Tokens. It is a dollar stablecoin, and it uses **6** decimals. WETH on the same chain uses 18.

An 18 default does not throw. It returns a number that looks fine:

```js
formatToken(1_500_000n, 6)   // '1.5'          <- correct
formatToken(1_500_000n, 18)  // '0.0000000000015'  <- wrong by 10^12, still renders
```

In the parse direction the same mistake attempts to move a trillion times the intended amount.

So **nothing in this package ever defaults decimals**. `formatToken` and `parseToken` require an explicit value and throw `MissingDecimalsError` without one. `readDecimals` reads from the contract at call time and throws if the read fails rather than falling back.

### 2. Two live tokens on mainnet answer to "USDG"

| Address | Name | Decimals |
|---|---|---|
| `0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168` | Global Dollar | 6 |
| `0x8218d73C00567A01481495Ad6c5143e00D5BB5b4` | Useless Stupid Degen Gamblers | 18 |

Both are live right now. Both have pools. Both return from a symbol search on DexScreener. The second is a memecoin deliberately squatting the ticker of the first, and it carries 18 decimals, so a codebase that resolves by symbol *and* defaults decimals gets both failures at once.

Symbols are attacker-controlled strings with no uniqueness guarantee at any layer of this stack. **Resolve by contract address, always.** `assertCanonicalToken` proves an address is what it claims by reading `name`/`symbol`/`decimals` on-chain:

```js
await assertCanonicalToken(client, USDG.address, USDG)  // resolves
await assertCanonicalToken(client, FAKE, USDG)          // throws NotCanonicalTokenError
```

Two further traps, less dramatic but just as costly:

- **viem's `multicall()` throws without `contracts.multicall3` on the chain definition.** Not a degraded read, not a fall back to individual `eth_call`s: `ChainDoesNotSupportContract`, thrown before anything is sent. The address is deployed on both networks; viem just refuses without the declaration. Both chain definitions here declare it.
- **`eth_getLogs` on mainnet caps how many logs a query may MATCH, not how wide its block range is**, and it has reported that rejection under two different error messages on the same day. See [Log scanning](#log-scanning).

---

## Quick start

```js
import { createPublicClient, http } from 'viem'
import { robinhoodChain, USDG, assertCanonicalToken, readBalance } from 'robinhood-chain'

const client = createPublicClient({
  chain: robinhoodChain,
  transport: http(),
})

// Prove the token is the real Global Dollar before touching it.
const meta = await assertCanonicalToken(client, USDG.address, USDG)
console.log(meta.name, meta.decimals)  // 'Global Dollar' 6

// Balance formatted with decimals read from the same contract.
const balance = await readBalance(client, {
  token: USDG.address,
  account: '0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73',
})
console.log(balance.formatted, balance.decimals)
```

The chain definition supplies the RPC URL, so bare `http()` works. Pass your own endpoint for anything production-shaped.

---

## Runnable example: catch the collision yourself

Save as `collision.mjs` and run it. No key, no funded account, read-only.

```js
import { createPublicClient, http } from 'viem'
import {
  robinhoodChain, USDG, formatToken, readTokenMetadata,
  assertCanonicalToken, NotCanonicalTokenError,
} from 'robinhood-chain'

const client = createPublicClient({ chain: robinhoodChain, transport: http() })
const IMPOSTOR = '0x8218d73C00567A01481495Ad6c5143e00D5BB5b4'

for (const address of [USDG.address, IMPOSTOR]) {
  const t = await readTokenMetadata(client, address)
  console.log(`${t.symbol}  ${t.address}  ${JSON.stringify(t.name)}  ${t.decimals} decimals`)
}

// Identical raw amount, wildly different meaning.
const raw = 1_500_000n
console.log(`\n1500000n as real USDG:     ${formatToken(raw, 6)}`)
console.log(`1500000n at 18 decimals:  ${formatToken(raw, 18)}`)

try {
  await assertCanonicalToken(client, IMPOSTOR, USDG)
  console.log('\nthis line never runs')
} catch (error) {
  if (!(error instanceof NotCanonicalTokenError)) throw error
  console.log(`\nrejected: ${error.mismatches.map((m) => m.field).join(', ')} mismatch`)
}
```

Actual output, run against `https://rpc.mainnet.chain.robinhood.com`:

```
USDG  0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168  "Global Dollar"  6 decimals
USDG  0x8218d73C00567A01481495Ad6c5143e00D5BB5b4  "Useless Stupid Degen Gamblers"  18 decimals

1500000n as real USDG:     1.5
1500000n at 18 decimals:  0.0000000000015

rejected: address mismatch
```

The package ships this as `scripts/smoke.mjs`. Run `npm run smoke` from the package directory.

---

## API

### Chains

| Export | Description |
|---|---|
| `robinhoodChain` | viem `Chain` for mainnet (`4663`), Multicall3 declared |
| `robinhoodTestnet` | viem `Chain` for testnet (`46630`), Multicall3 declared |
| `CHAINS` | both, mainnet first |
| `chainsById` | `{ 4663: …, 46630: … }` |
| `getChain(id)` | resolve by ID; throws `UnsupportedChainError` rather than returning `undefined` |
| `isRobinhoodChain(id)` | boolean |
| `MULTICALL3_ADDRESS` | `0xcA11bde05977b3631167028862bE2a173976CA11` |
| `hasMulticall3(client)` | confirms the bytecode is still deployed |
| `addChainParams` | EIP-3085 `wallet_addEthereumChain` payloads |
| `ROBINHOOD_MAINNET_ID` / `ROBINHOOD_TESTNET_ID` | `4663` / `46630` |

Both definitions carry `rpcUrls`, `blockExplorers` (Blockscout, with `apiUrl`), `nativeCurrency` ETH, and `contracts.multicall3`.

`addChainParams` uses hex **string** chain IDs (`'0x1237'`, `'0xb626'`). EIP-3085 requires this; passing the decimal `4663` fails with an opaque wallet error.

```js
await window.ethereum.request({
  method: 'wallet_addEthereumChain',
  params: [addChainParams.mainnet],
})
```

### Tokens

| Export | Description |
|---|---|
| `USDG` | Global Dollar. `decimals: 6` |
| `WETH` | Wrapped Ether. `decimals: 18` |
| `KNOWN_TOKENS` | `{ USDG, WETH }`, for compile-time use in your own source |
| `KNOWN_IMPOSTORS` | documented ticker squatters observed live |
| `knownTokenAt(address)` | resolve by address, or `null` |
| `isKnownImpostor(address)` | advisory flag |

Both real tokens are proxies. Interact through the addresses above and never cache an implementation address; it can change on upgrade.

`KNOWN_IMPOSTORS` is a convenience for surfacing a warning in a UI, **not a security boundary**. A new impostor costs one deploy, so the list can never be complete. `isKnownImpostor` returning `false` means "not on our list", never "safe". Verify by address.

Do not feed user input into `KNOWN_TOKENS`: keying a lookup on a symbol is the exact bug the collision exploits.

### Formatting

| Export | Description |
|---|---|
| `formatToken(amount, decimals)` | raw bigint to decimal string. `decimals` **required** |
| `parseToken(value, decimals)` | decimal string to raw bigint. `decimals` **required** |
| `readDecimals(client, address, { cache })` | read `decimals()` on-chain; throws rather than defaulting |
| `readBalance(client, { token, account, cache })` | `{ raw, decimals, formatted }` |
| `assertDecimals(decimals, context)` | validate; throws `MissingDecimalsError` when absent |

`readDecimals` caches only when you pass a `Map`, so it never quietly serves a stale value you did not ask it to keep.

```js
const cache = new Map()
const decimals = await readDecimals(client, USDG.address, { cache })
const amount = parseToken('250.75', decimals)  // 250750000n
```

### Verification

| Export | Description |
|---|---|
| `assertCanonicalToken(client, address, expected, opts?)` | prove identity on-chain; throws `NotCanonicalTokenError` |
| `verifyToken(client, address, expected, opts?)` | non-throwing: `{ ok, metadata, error }` |
| `readTokenMetadata(client, address)` | `{ address, chainId, name, symbol, decimals, readAt }` |

`expected` is a token constant or any subset of `{ address, name, symbol, decimals }`. Supply at least one field; verifying against nothing verifies nothing, and the function throws if you try.

Checks run in order of trustworthiness. Address is compared first because it is the only field an attacker cannot choose, and a mismatch there short-circuits without a network round trip. `readTokenMetadata` rejects an address with no bytecode before reading anything, and uses Multicall3 with a genuine sequential fallback.

`opts.caseInsensitive` relaxes `name`/`symbol` comparison. Off by default.

Use it at every boundary that accepts an address from a user, a URL parameter, a config file, a search result, or another service:

```js
const result = await verifyToken(client, userSuppliedAddress, USDG)
if (!result.ok) {
  showWarning(`Not the canonical USDG: ${result.error.message}`)
}
```

`name` and `symbol` in the returned metadata are attacker-controlled strings. Render them as data, escape them in HTML, never route logic on them, and never interpolate them into a prompt or a shell command.

### Portfolio

| Export | Description |
|---|---|
| `readPortfolio(client, address, tokenAddresses?, opts?)` | native ETH plus a balance row per token, batched |
| `batchRead(client, contracts, opts?)` | Multicall3 with a genuine sequential fallback, viem's `allowFailure` shape from both paths |

One `eth_getBalance` plus one Multicall3 aggregate cover the whole portfolio, regardless of token count. Decimals are read in the **same batch** as the balance, so the two can never disagree — nothing here defaults to 18. `symbol` rides along for display only; identity is the address.

```js
import { createPublicClient, http } from 'viem'
import { readPortfolio, robinhoodChain, WETH, USDG } from 'robinhood-chain'

const client = createPublicClient({ chain: robinhoodChain, transport: http() })
const portfolio = await readPortfolio(client, '0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73', [
  WETH.address,
  USDG.address,
])

console.log(portfolio.nativeEth)          // '21044.62...'
console.log(portfolio.tokens[1].decimals) // 6  — read on-chain, never assumed
```

Each token row is `{ address, symbol, decimals, raw, formatted, known }` on success, `{ address, raw, error: 'decimals unavailable' }` when balance read but decimals did not, or `{ address, error: 'balanceOf reverted' }` when the address is not a readable ERC-20 here. One bad token degrades its own row; it never voids the response. `known` is the advisory curated-set match — `null` means "not in our list", never "safe".

`opts.multicallAddress` is `undefined` (use the canonical Multicall3 explicitly, the default), an address, or `null` (omit it, forcing viem to resolve `contracts.multicall3` from the chain definition — which throws `ChainDoesNotSupportContract` when absent, the one condition that reliably exercises the sequential fallback). Try it: `node scripts/portfolio.mjs --fallback` logs the fallback warning and still returns correct balances.

### Head watcher

| Export | Description |
|---|---|
| `watchHead(client, onBlock, opts?)` | poll the head at an explicit interval; returns viem's unsubscribe fn |
| `DEFAULT_POLLING_INTERVAL_MS` (`1000`) | one sample per second, ~10 blocks of movement per tick |

```js
import { watchHead } from 'robinhood-chain'

const stop = watchHead(client, (block, prev) => {
  const advanced = prev === undefined ? 0n : block - prev
  console.log(`head ${block} (+${advanced} since last sample)`)
})
// ... later: stop()
```

At ~101 ms blocks the head advances ~10 blocks per second, so a 1000 ms poll observes ~600 blocks per minute. **Do not poll at the block cadence** to "keep up" — you cannot, and a tight `getBlockNumber` loop generates thousands of requests per minute and trips a rate limit you have not measured. When you need pre-settlement visibility, the sequencer WebSocket feed (`wss://feed.mainnet.chain.robinhood.com`, declared on the chain definition) is lower latency than any poll; treat its data as provisional until confirmed against a settled block.

### Blockscout explorer

| Export | Description |
|---|---|
| `BlockscoutClient` / `blockscoutFor(chain?, opts?)` | thin Blockscout v2 REST client |
| `ExplorerError` | non-retryable explorer HTTP failure; carries `status`, `url`, `body` |

JSON-RPC does not give you verified source, holder lists, decoded address history, or aggregated token metadata. The explorer's REST API (`/api/v2`) does.

```js
import { BlockscoutClient, robinhoodChain, WETH } from 'robinhood-chain'

const explorer = new BlockscoutClient({ chain: robinhoodChain })
const info = await explorer.tokenInfo(WETH.address)
// Observed shape 2026-07-21 (log your own with { debug: true } before trusting it):
// { address_hash, name, symbol, decimals: '18', holders_count: '206509',
//   total_supply, exchange_rate, type: 'ERC-20', ... }  — note decimals is a STRING
```

Methods: `tokenInfo`, `tokenHolders`, `addressTransactions`, `addressInfo`, `contractSource`, and the raw `get(path, params)` they all funnel through. Every request retries on `429` and transient `5xx` with exponential backoff, honoring `Retry-After` when present — the `429` path exists **because whether this instance rate-limits, or requires an API key, is unverified.** Response shapes are likewise unverified per endpoint: this client passes parsed JSON through untouched. Log one real response (`{ debug: true }`) and write your types from what you observed, not from another chain's Blockscout. A token's `name`/`symbol` from these endpoints is as attacker-controlled as it is on-chain.

### Log scanning

| Export | Description |
|---|---|
| `scanLogs(options)` | collect logs over a range: `{ logs, cursor, done, stats }` |
| `streamLogs(options)` | async generator, one batch per successful chunk |
| `createCursor` / `serializeCursor` / `deserializeCursor` | resumable cursor, JSON-safe |
| `DEFAULT_CHUNK` (`1000n`) / `MIN_CHUNK` (`10n`) | tuned to measured mainnet limits |
| `BLOCK_TIME_MS` (`101`) / `blocksToMs(n)` | convert block counts to real time |
| `classifyScanError(error)` | advisory cap classifier, for reporting only |

**Mainnet `eth_getLogs` caps the number of logs a query may MATCH. It does not cap block span.** Measured live 2026-07-20:

| Block span | Matched-log allowance |
|---|---|
| 1001 blocks or fewer | 50,000 |
| 1002 blocks or more | 10,000 |

**There is no hard block-span cap.** A 500,000-block range is accepted without complaint when its filter matches little enough: filtered to an address with no WETH transfers, that range returns `[]`. Span only selects which allowance applies. On the busy WETH contract the boundary is one block wide: a 1001-block span returned 14,517 logs successfully, while 1002 blocks of the same contract was rejected at the 10,000 limit. Returning 14,517 logs from the narrower query is the proof that the higher tier is real, not a rounding artifact. That count moves with live activity (11,508 on a re-run minutes later); the boundary does not.

A second, independent cap is on response size, reported as `HTTP response body exceeded the size limit`. A high-volume query can trip it while staying under the matched-log allowance.

**The error strings are not a stable contract, and this is the important lesson.** The matched-log rejection currently reads `logs matched by query exceeds limit of N`. Earlier the same day, on the same RPC, the identical condition reported `Missing or invalid parameters`, a message that names the wrong problem entirely and costs an hour chasing a parameter bug that does not exist. The server changed its wording with no warning.

The scanner **halves on any error rather than matching an error string**, so that change required no code change here: a string-matching scanner would have silently stopped retrying the moment the server reworded. `classifyScanError` recognizes both wordings, but it is for reporting only. Never branch on it.

Testnet is materially more permissive; a 1501-block span succeeds there. **Constants tuned on testnet fail immediately on mainnet.** `DEFAULT_CHUNK` is `1000n` because a chunk of 1000 blocks queries an inclusive span of 1001, exactly the widest chunk that still earns the 50,000-log allowance. One more block would drop the allowance to 10,000, so 1001 is a strictly worse chunk size than 1000 despite being wider.

At approximately 101 ms blocks, mainnet produces roughly 850,000 blocks per day. `DEFAULT_CHUNK` is about 101 seconds of chain history, not hours. Convert block counts to time in your own comments and UI copy; every range intuition from a 12-second L1 is off by two orders of magnitude here.

```js
import { parseAbiItem } from 'viem'
import { scanLogs, WETH } from 'robinhood-chain'

const head = await client.getBlockNumber()
const { logs, stats } = await scanLogs({
  client,
  address: WETH.address,
  event: parseAbiItem('event Transfer(address indexed from, address indexed to, uint256 value)'),
  fromBlock: head - 2000n,
  toBlock: head,
})

console.log(logs.length, stats)
// 23906 { chunksScanned: 3, halvings: 0, finalChunkSize: 1000n, logsFound: 23906, elapsedMs: 1524 }
```

That is a real run against mainnet on 2026-07-20. The log count moves with live
activity; `chunksScanned: 3` and `halvings: 0` are the parts that should not.

`halvings: 0` is what a correctly tuned scan looks like. Halvings in the stats usually mean you set `chunkSize` past the tier boundary and are paying a failed request per chunk. On an unfiltered scan of a very busy contract they can also mean a genuine volume spike tripped a cap at the default chunk, which is exactly the case the adaptive path exists for.

Bounded, resumable backfill, for keeping work inside a cron window or a request timeout:

```js
let cursor = savedCursor ? deserializeCursor(savedCursor) : undefined

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

`LogScanError` carries the cursor too, so a scan that dies at the floor can be resumed rather than restarted.

### Errors

All extend `RobinhoodChainError`, so one `catch` covers the package.

| Error | Thrown when |
|---|---|
| `UnsupportedChainError` | a chain ID is not 4663 or 46630. Carries `supported` |
| `MissingDecimalsError` | decimals were needed and not supplied. Never a silent 18 |
| `NotCanonicalTokenError` | an address is not the token it claims. Carries `mismatches` and `actual` |
| `LogScanError` | a scan cannot progress at the minimum chunk. Carries `cursor` |

---

## Testing

```sh
npm test        # 65 offline tests, no network
npm run test:live   # 12 additional tests against mainnet, read-only
npm run smoke       # the live smoke script
```

Live tests are gated behind `RH_LIVE_TESTS=1` so the default run works offline and in CI. They are read-only: no key, no funded account, no spend. Override the endpoint with `RH_MAINNET_RPC`.

The offline suite includes a stub RPC that reproduces the `eth_getLogs` caps as the endpoint actually implements them: a matched-log allowance tiered by span, plus an independent response-size cap. The stub can reject with either observed wording, and one test asserts the scan result is byte-identical under both, which is the property that let the library survive the live message change untouched. The read layer is covered offline too: `readPortfolio` proves it reads decimals rather than defaulting to 18 and that the sequential fallback fires when the aggregate throws, `watchHead` proves the polling interval is a decision and not the block cadence, and `BlockscoutClient` drives the `429`/`5xx` backoff through an injected fetch. The live suite re-confirms every shipped constant against the chain, probes the 1001/1002 tier boundary directly, and proves the collision is caught for real rather than against a fixture.

---

## Verified facts and their dates

Everything below was read from the live chain, most recently 2026-07-20.

| Fact | Value |
|---|---|
| Mainnet chain ID | `4663` (`0x1237`) |
| Testnet chain ID | `46630` (`0xb626`) |
| Client version | `nitro/v3.11.3-rc.4-4bed0c5`, both networks |
| Mainnet cadence | approximately 101 ms at approximately 0.056 gwei |
| Testnet cadence | approximately 432 ms at a flat 0.01 gwei |
| Multicall3 | deployed at `0xcA11bde05977b3631167028862bE2a173976CA11` on both, bytecode confirmed |
| USDG | `0x5fc5…d168`, name `Global Dollar`, 6 decimals, proxy |
| WETH | `0x0Bd7…AD73`, name `WETH`, 18 decimals, proxy |
| USDG impostor | `0x8218…B5b4`, name `Useless Stupid Degen Gamblers`, symbol `USDG`, 18 decimals |
| `eth_getLogs` block span cap | none; a 500,000-block range is accepted when its filter matches nothing |
| `eth_getLogs` matched-log cap | 50,000 within a span of 1001 blocks or fewer, 10,000 beyond it |
| `eth_getLogs` cap error text | UNSTABLE. `logs matched by query exceeds limit of N` and `Missing or invalid parameters` both observed for the same condition on the same day |
| `eth_getLogs` size cap | separate from the above; reported as `HTTP response body exceeded the size limit` |

Public RPC rate limits are **UNVERIFIED**. Measure under your own load or use a keyed provider where the limit is contractual. Build backoff on 429 from day one.

USDG's testnet deployment is **UNVERIFIED**. The address above is confirmed on mainnet only. Do not copy it to testnet and assume it works.

## Related

- [robinhood-toolkit](https://github.com/nirholas/robinhood-toolkit): the parent repo, 64 build prompts, examples, and the docs site
- [`prompts/00-foundations`](https://github.com/nirholas/robinhood-toolkit/tree/main/prompts/00-foundations): network setup, wallets, bridging, trust assumptions
- [`prompts/10-chain`](https://github.com/nirholas/robinhood-toolkit/tree/main/prompts/10-chain): contract deploys, the Stock Token registry, Uniswap, indexing

## Disclaimer

Not affiliated with, endorsed by, or sponsored by Robinhood Markets, Inc. or any of its subsidiaries. "Robinhood" is used nominatively to identify the network this package targets.

Robinhood Chain is centralized today: Robinhood operates both the sequencer and the proposer. Canonical bridge withdrawals take about 7 days. On-chain balances are not brokerage balances. Nothing here is financial advice.

## License

All Rights Reserved © 2026 [nirholas](https://github.com/nirholas)
