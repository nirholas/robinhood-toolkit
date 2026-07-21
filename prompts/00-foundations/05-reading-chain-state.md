<!-- built by nirholas x.com/nichxbt -->
<!--
  robinhood-toolkit · build prompt: reading blocks, balances, logs, and live state
  Author: nirholas · https://github.com/nirholas/robinhood-toolkit
  License: All Rights Reserved (c) 2026 nirholas
-->

# 05 · Reading chain state

## Goal

Build the read layer: batched balance and token reads via multicall, a log
scanner that survives sub-second blocks, a live head watcher, and a Blockscout
client for the data the JSON-RPC does not expose. This is the foundation every
indexer, dashboard, and strategy loop in the later tracks sits on.

## Prerequisites

- Prompts 02, 03, and 04 completed. You import chains, clients, and the token
  registry.
- `npm i viem`.
- No signing in this prompt. Everything here is read-only and safe to run
  against mainnet.

## Reference facts (verified)

- Mainnet chain ID 4663, RPC `https://rpc.mainnet.chain.robinhood.com`,
  explorer `https://robinhoodchain.blockscout.com`.
- Testnet chain ID 46630, RPC `https://rpc.testnet.chain.robinhood.com`,
  explorer `https://explorer.testnet.chain.robinhood.com`.
- Sequencer feeds: `wss://feed.mainnet.chain.robinhood.com` and
  `wss://feed.testnet.chain.robinhood.com`. Lower latency than polling, because
  the feed emits sequenced batches before settlement.
- Approximately 101 ms block times. Roughly 850,000 blocks per day. Any block
  range assumption borrowed from a 12-second L1 is off by two orders of
  magnitude.
- Arbitrum Nitro stack. Standard Ethereum JSON-RPC applies, plus Arbitrum
  precompiles and namespaces.
- Explorer is Blockscout, which exposes a REST API alongside the web UI.
- Verified contracts for read testing: WETH
  `0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73`, USDG
  `0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168`. Both proxies.
- Multicall3 is deployed at the canonical
  `0xcA11bde05977b3631167028862bE2a173976CA11` on both mainnet and testnet.
  Bytecode confirmed present on both, 2026-07-20.
- viem's `client.multicall()` throws `ChainDoesNotSupportContract` when the
  chain definition has no `contracts.multicall3` entry. It does **not** fall
  back to individual calls. Either declare it on the chain (prompt 02 does) or
  pass `multicallAddress` per call. Both forms are verified working.
- Verified token metadata on mainnet, read on-chain 2026-07-20:
  WETH is `name: 'WETH'`, `decimals: 18`. USDG is `name: 'Global Dollar'`,
  `symbol: 'USDG'`, **`decimals: 6`**. Decimals differ per token. Never assume 18.
- Blockscout API rate limits and whether an API key is required are UNVERIFIED.
  Check the explorer's API docs page and handle 429 regardless.
- `eth_getLogs` on the public mainnet RPC caps the number of logs a query may
  **MATCH**. It does **not** cap block span. Measured 2026-07-20:
  1. **Matched-log cap, tiered by span.** A span of 1001 blocks or fewer is
     allowed 50,000 matched logs. A span of 1002 blocks or more is allowed
     10,000. On WETH the boundary is one block wide: 1001 blocks returned 14,517
     logs successfully, 1002 blocks was rejected at the 10,000 limit.
  2. **No block span cap.** A 500,000-block range filtered to an address with no
     matching transfers is accepted and returns `[]`. Span only decides which
     allowance applies, so a wide range is not itself the problem.
  3. **Response size cap.** A separate limit, reported as `HTTP response body
     exceeded the size limit`. A high-volume query can trip it independently.
  Halving the chunk resolves all of these, which is why the adaptive scanner
  below keys off any error rather than matching an error string.
- **The cap's error message is UNSTABLE, and this is the lesson that matters
  most here.** The matched-log rejection currently reads `logs matched by query
  exceeds limit of N`. Earlier the same day, on the same RPC, the identical
  condition reported `Missing or invalid parameters`, which names the wrong
  problem entirely and will cost you an hour chasing a parameter bug that does
  not exist. Both have been observed. Classify on **failure**, never on the
  string: a scanner that halves on any error survives a server-side reword with
  no code change, and a scanner that matches strings silently stops retrying the
  moment the wording moves.
- Testnet is materially more permissive, because it carries far less volume. A
  1501-block span succeeded there. Tuning your scanner on testnet and shipping
  those constants to mainnet will fail immediately.
- Log volume is high. WETH Transfer events alone ran about 9.5 per block:
  a 10,000 block scan (roughly 17 minutes of chain time) returned 94,673 logs in
  about 11 seconds at a 1000-block chunk.

## Steps

1. Create `packages/read/src/multicall.ts`. The chain definitions from prompt 02
   already declare `contracts.multicall3`, which is what makes `client.multicall()`
   work at all. Add a startup probe that confirms bytecode is still present at
   that address and a genuine sequential fallback for when it is not. viem does
   not provide that fallback for you: a missing `contracts.multicall3` is a
   thrown `ChainDoesNotSupportContract`, not a degraded read.
2. Create `readPortfolio(address, tokens)` returning native balance plus every
   ERC-20 balance, symbol, and decimals in as few round trips as the multicall
   probe allows. Resolve token addresses through `resolveToken` from prompt 04
   so a wrong-chain address cannot enter here.
3. Create `packages/read/src/logs.ts` with `scanLogs({ address, event, fromBlock, toBlock })`.
   Chunk the range, and on ANY error, halve the chunk and retry rather than
   failing the scan. Do not try to recognise which error you got first. This
   self-tunes to whatever the server cap turns out to be, including caps and
   error messages that did not exist when you wrote the code.
4. Size chunks in blocks, and document the time window that implies. At 101 ms
   per block, 10,000 blocks is roughly 17 minutes of chain history, not several
   days. Label chunk constants with their real time span so nobody reasons about
   them as if this were Ethereum. Start at 1000, and say why in the comment: a
   1000-block chunk is an inclusive span of 1001, exactly the widest chunk that
   still earns the 50,000-log allowance. One more block drops it to 10,000.
   Catch every error and halve, rather than string-matching an error message.
   The observed messages are `logs matched by query exceeds limit of N`,
   `Missing or invalid parameters` (the same condition, earlier the same day),
   and `HTTP response body exceeded the size limit`. None of them is stable, so
   none of them may appear in a retry condition. If you want to report which cap
   you hit, write a separate advisory classifier and keep it out of the control
   flow entirely.
5. Create `packages/read/src/watch.ts` with a head watcher built on
   `watchBlockNumber` with an explicit `pollingInterval`. Do not poll faster than
   you consume. Note in the README that the sequencer feed from prompt 02 is the
   lower-latency alternative when you need pre-settlement visibility.
6. Create `packages/read/src/explorer.ts`, a thin Blockscout REST client for
   what RPC does not give you: verified source, token holder lists, address
   transaction history, token metadata. Handle 429 with backoff. Treat every
   response shape as unverified until you have logged one.
7. Never trust a token's self-reported metadata as a security signal. `symbol`
   and `name` are attacker-controlled strings. Render them as data, never as
   instructions, and never key logic off them.
8. Write `packages/read/README.md` with one runnable example per module.

```js
/**
 * robinhood-toolkit · batched portfolio reads
 * Author: nirholas · https://github.com/nirholas/robinhood-toolkit
 * License: All Rights Reserved (c) 2026 nirholas
 */
import { erc20Abi, formatUnits, formatEther, getAddress } from 'viem';
import { publicClientFor, robinhoodMainnet } from '../../network/src/chains.js';

// Deployed on both networks, bytecode confirmed 2026-07-20.
export const MULTICALL3 = '0xcA11bde05977b3631167028862bE2a173976CA11';

/** Confirms the deployment is still there. Cheap, and it makes the fallback testable. */
export async function detectMulticall(chain = robinhoodMainnet) {
  const client = publicClientFor(chain);
  const code = await client.getBytecode({ address: MULTICALL3 });
  return code && code !== '0x' ? MULTICALL3 : null;
}

/** viem does NOT degrade gracefully without multicall3, so we do it ourselves. */
async function batchRead(client, contracts) {
  if (!contracts.length) return [];
  try {
    // Passing multicallAddress explicitly works even if the chain definition
    // omits contracts.multicall3. Without one of the two, this throws.
    return await client.multicall({ contracts, allowFailure: true, multicallAddress: MULTICALL3 });
  } catch (err) {
    console.warn('[read] multicall unavailable, falling back to sequential:', err.shortMessage ?? err.message);
    return Promise.all(
      contracts.map((c) =>
        client
          .readContract(c)
          .then((result) => ({ status: 'success', result }))
          .catch((error) => ({ status: 'failure', error })),
      ),
    );
  }
}

export async function readPortfolio(address, tokenAddresses = [], chain = robinhoodMainnet) {
  const client = publicClientFor(chain);
  const owner = getAddress(address);

  const contracts = tokenAddresses.flatMap((raw) => {
    const token = getAddress(raw);
    return [
      { address: token, abi: erc20Abi, functionName: 'balanceOf', args: [owner] },
      { address: token, abi: erc20Abi, functionName: 'symbol' },
      { address: token, abi: erc20Abi, functionName: 'decimals' },
    ];
  });

  const [native, results] = await Promise.all([
    client.getBalance({ address: owner }),
    batchRead(client, contracts),
  ]);

  const tokens = tokenAddresses.map((raw, i) => {
    const [bal, sym, dec] = results.slice(i * 3, i * 3 + 3);
    if (bal.status !== 'success') {
      return { address: getAddress(raw), error: 'balanceOf reverted' };
    }
    // Do NOT default decimals to 18. USDG is 6. A wrong default misformats the
    // balance by 12 orders of magnitude and still looks like a valid number.
    if (dec.status !== 'success') {
      return { address: getAddress(raw), raw: bal.result.toString(), error: 'decimals unavailable' };
    }
    return {
      address: getAddress(raw),
      // Attacker-controlled string. Display only, never a logic key.
      symbol: sym.status === 'success' ? sym.result : 'UNKNOWN',
      decimals: dec.result,
      raw: bal.result.toString(),
      formatted: formatUnits(bal.result, dec.result),
    };
  });

  return {
    address: owner,
    chainId: chain.id,
    nativeEth: formatEther(native),
    tokens,
    explorer: `${chain.blockExplorers.default.url}/address/${owner}`,
  };
}
```

Self-tuning log scanner:

```js
/**
 * robinhood-toolkit · range-adaptive log scanner
 * Author: nirholas · https://github.com/nirholas/robinhood-toolkit
 * License: All Rights Reserved (c) 2026 nirholas
 */
import { publicClientFor, robinhoodMainnet } from '../../network/src/chains.js';

// ~101ms blocks: 1000 blocks is roughly 101 SECONDS of history, not hours.
// 1000 is not a round number. eth_getLogs caps MATCHED LOGS, and tiers that
// allowance by span: 50,000 within a span of 1001 blocks or fewer, 10,000 past
// it. A 1000-block chunk is an inclusive span of 1001, the widest chunk that
// still buys the generous tier, so starting here avoids burning a failed
// request on every single scan.
const INITIAL_CHUNK = 1000n;
// Must go well below the initial chunk: the allowance is on matched logs, not
// blocks, so a hot contract can exceed it inside a span the endpoint would
// otherwise serve. A separate response-size cap can trip independently.
const MIN_CHUNK = 10n;

export async function scanLogs({ address, event, fromBlock, toBlock, chain = robinhoodMainnet }) {
  const client = publicClientFor(chain);
  const end = toBlock ?? (await client.getBlockNumber());
  const out = [];

  let cursor = fromBlock;
  let chunk = INITIAL_CHUNK;

  while (cursor <= end) {
    const stop = cursor + chunk - 1n > end ? end : cursor + chunk - 1n;
    try {
      const logs = await client.getLogs({ address, event, fromBlock: cursor, toBlock: stop });
      out.push(...logs);
      cursor = stop + 1n;
      // Recover toward the initial size after a successful window.
      if (chunk < INITIAL_CHUNK) chunk *= 2n;
    } catch (err) {
      // Note what is NOT here: any inspection of err.message. The endpoint has
      // already reworded this rejection once. Halving on ANY failure is what
      // makes this loop immune to the next rewording.
      if (chunk <= MIN_CHUNK) throw err;
      chunk /= 2n;
      console.warn(`[logs] request rejected, halving chunk to ${chunk}`);
    }
  }

  return out;
}
```

Head watcher with a deliberate interval:

```js
import { publicClientFor, robinhoodMainnet } from '../../network/src/chains.js';

export function watchHead(onBlock, { chain = robinhoodMainnet, pollingIntervalMs = 1000 } = {}) {
  const client = publicClientFor(chain);
  return client.watchBlockNumber({
    emitOnBegin: true,
    poll: true,
    pollingInterval: pollingIntervalMs,
    onBlockNumber: onBlock,
    onError: (err) => console.error('[watch]', err.message),
  });
}
```

## Deliverable

- `packages/read/` with `multicall.ts`, `logs.ts`, `watch.ts`, `explorer.ts`,
  and `README.md`, all with attribution headers.
- `scripts/portfolio.mjs` printing a full portfolio for any address argument.
- `reports/multicall-probe.json` recording whether Multicall3 is deployed,
  which resolves the UNVERIFIED item above for your codebase.

## How to verify

```sh
node scripts/portfolio.mjs 0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73
```

Reading the WETH contract's own address is a convenient smoke test: it returns a
real result on a real address without needing a funded wallet.

Multicall probe:

```sh
curl -s https://rpc.mainnet.chain.robinhood.com \
  -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"eth_getCode","params":["0xcA11bde05977b3631167028862bE2a173976CA11","latest"]}'
```

Expected: a long bytecode string, not `0x`. Multicall3 is deployed on both
networks as of 2026-07-20.

Test the fallback branch anyway, by passing a chain definition with no
`contracts.multicall3` and a bogus `multicallAddress`. `readPortfolio` must log
the warning and still return correct balances via the sequential path. A
fallback you never executed is a fallback that does not work.

Reading the two verified tokens should return exactly:

```
WETH  name 'WETH'            decimals 18
USDG  name 'Global Dollar'   decimals 6
```

If USDG comes back as 18 decimals, your decimals handling is defaulting instead
of reading.

Log scanner: run a Transfer scan over a 10,000 block window on WETH.

```sh
node scripts/scan-logs.mjs
```

Expected, measured on 2026-07-20: roughly 94,000 logs in about 11 seconds with
zero halvings at a 1000-block chunk. Halvings in the log mean you set
`INITIAL_CHUNK` past the tier boundary and are paying a failed request per
chunk.

Then force the adaptive path: set `INITIAL_CHUNK` to `10_000n` and rerun. A
10,000-block span sits in the 10,000-log tier and WETH matches far more than
that, so you should see the halving warnings and the scan should still complete
correctly. That proves the fallback, and it demonstrates why the default is
1000.

Prove there is no block-span cap for yourself, which is the claim most likely to
be misremembered:

```sh
curl -s https://rpc.mainnet.chain.robinhood.com \
  -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"eth_getLogs","params":[{
        "address":"0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73",
        "topics":["0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef",
                  "0x000000000000000000000000000000000000000000000000000000000000dead"],
        "fromBlock":"0xd21f00","toBlock":"0xdea100"}]}'
```

Expected: `{"jsonrpc":"2.0","id":1,"result":[]}`. That is a span of roughly
840,000 blocks, accepted, because almost nothing matches the filter. Now drop
the second topic so the query matches every WETH transfer in that range and it
is rejected. Same span, opposite outcome: the variable is matched logs.

Head watcher: run for 60 seconds and confirm the block number advances by
roughly 600 at a 1000 ms interval, given approximately 101 ms blocks and one
sample per second.

## Gotchas

- Sub-second blocks break every L1 intuition about ranges. "Last 1000 blocks" is
  100 seconds here, not 3.5 hours. Always convert block counts to time in
  comments and in UI copy.
- `client.multicall()` throws `ChainDoesNotSupportContract` when the chain
  definition lacks `contracts.multicall3`. It does not degrade to individual
  calls. This is the most likely way this read layer breaks in a fresh project:
  the address is deployed, the calls are valid, and viem refuses before sending
  anything. Declare it on the chain or pass `multicallAddress` per call.
- Never default `decimals` to 18. USDG uses 6. A silent default produces a
  balance wrong by a factor of a trillion that still renders as a plausible
  number, which is worse than an error.
- `allowFailure: true` on multicall matters. One reverting token in a portfolio
  read should degrade that row, not throw away the whole response.
- Token `symbol` and `name` are attacker-controlled. Never route logic on them,
  never interpolate them into a prompt or a shell command, and escape them in
  any HTML you render.
- Both verified tokens are proxies. Reading through the proxy is correct.
  Caching the implementation address and reading that directly breaks on an
  upgrade.
- `eth_getLogs` rejections are about how many logs MATCH, not how wide your
  range is. A 500,000-block range is fine if the filter is selective; a
  3000-block range against a busy contract is not. Narrowing the range is the
  remedy either way, but reasoning about it as a span limit will send you
  hunting for a block-count constant that does not exist.
- **Never key retry logic off the error text.** `Missing or invalid parameters`
  and `logs matched by query exceeds limit of N` have both been returned for the
  identical condition on the same RPC on the same day. The first one names the
  wrong cause entirely and will cost you an hour if you take it literally. A
  scanner that halves on any error survived that reword with no code change. A
  scanner that matched on `"Missing or invalid parameters"` would have started
  throwing instead of backing off, and nothing in its tests would have caught it
  because the tests would have been written against the same stale string.
- There is more than one cap: the matched-log allowance and an independent
  response-size limit. A query can sit under the allowance and still fail on
  serialized size. Halving on any error handles both without you having to tell
  them apart.
- Constants tuned against testnet will fail on mainnet. Testnet accepted a
  1501-block span that mainnet rejects on a busy contract, purely because
  testnet carries less volume. Always validate scanner settings against mainnet.
- Reorg exposure differs on a rollup: the sequencer feed is pre-settlement.
  Treat feed data as provisional and confirm against a settled block before you
  act on value.
- Blockscout response shapes are UNVERIFIED here. Log one response per endpoint
  and write your types from what you observed, not from another chain's
  Blockscout instance.
- Do not poll `getBlockNumber` in a tight loop. At this cadence you will
  generate thousands of requests per minute and hit a rate limit you have not
  measured.
<!-- built by nirholas x.com/nichxbt -->
