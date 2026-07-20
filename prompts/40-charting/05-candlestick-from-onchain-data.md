<!--
  robinhood-toolkit · build prompt: sourcing OHLCV candles for Robinhood Chain
  Author: nirholas · https://github.com/nirholas/robinhood-toolkit
  License: MIT (c) 2026 nirholas
-->

# 05 · Candlesticks from on-chain data

## Goal

Get real OHLCV candles for a Robinhood Chain pool, two ways: from
GeckoTerminal's public API, and by aggregating Uniswap `Swap` events straight
from the chain with no third party at all. End state: two `CandleSource`
implementations behind prompt 04's interface, swappable at runtime.

## Prerequisites

- Prompt 04 finished: `src/bars.js`, `src/adapter.js`, `src/sources/index.js`.
- `npm install ethers@^6` for the on-chain path.
- A pool address. This prompt uses live ones from prompt 01.

## Reference facts (verified)

### DexScreener cannot do this

Restating prompt 01 because it is the reason this file exists: **DexScreener has
no OHLCV endpoint.** Every documented endpoint is a current-state snapshot. The
undocumented internal endpoint behind their website charts is unversioned and
calling it runs against their scraping clause. Candles come from elsewhere.

### Option A: GeckoTerminal (verified live)

Verified working on 2026-07-20 against the live USDG/WETH pool.

- Network slug for Robinhood Chain is **`robinhood`**. Confirmed by paginating
  `https://api.geckoterminal.com/api/v2/networks` and finding
  `{"id":"robinhood","name":"Robinhood","coingecko_asset_platform_id":"robinhood"}`.
- Endpoint:

  ```
  GET /api/v2/networks/{network}/pools/{pool_address}/ohlcv/{timeframe}
      ?aggregate={n}&before_timestamp={unix_sec}&limit={n}&currency={usd|token}&token={base|quote}
  ```

- `timeframe` is one of `day`, `hour`, `minute`. Resolution comes from
  `aggregate`: `minute&aggregate=15` is a 15-minute candle, `hour&aggregate=4`
  is 4-hour. There is no `15m` timeframe value.
- Send `Accept: application/json;version=20230302` to pin the response version.
- `limit` maxes at **1000**.
- Response, confirmed shape:

  ```json
  { "data": { "id": "...", "type": "ohlcv_request_response",
      "attributes": { "ohlcv_list": [[1784577600, 3.0039e-05, 3.0039e-05, 2.9996e-05, 2.9996e-05, 8.194], ...] } },
    "meta": { "base": {"name","symbol","address","coingecko_coin_id"},
              "quote": {"name","symbol","address","coingecko_coin_id"} } }
  ```

  Each row is `[timestamp, open, high, low, close, volume]`.

- **Timestamps are UNIX seconds.** Verified: `1784577600`.
- **Rows are DESCENDING, newest first.** Verified. Lightweight Charts requires
  ascending and throws on unsorted input, so this must be reversed. Prompt 04's
  `normaliseBars` handles it, which is exactly why that function exists.
- Rate limit on the free tier is roughly **30 requests/minute** and no API key
  is available or needed. I was hard-429'd during research on this file, so
  treat it as real and enforce a client-side floor.

### Option B: aggregate `Swap` events yourself (verified live)

Fully self-sufficient. No third party, no rate limit but your RPC's, no
possibility of a vendor dropping the chain.

- Uniswap v3 event:

  ```solidity
  event Swap(address indexed sender, address indexed recipient,
             int256 amount0, int256 amount1,
             uint160 sqrtPriceX96, uint128 liquidity, int24 tick)
  ```

  `topic0` = `0xc42079f94a6350d7e6235f29174924f928cc2ac818eb64fed8004e115fbcca67`
  (computed and confirmed).

- Price of token0 denominated in token1:

  ```
  price = (sqrtPriceX96 / 2^96)^2 * 10^(decimals0 - decimals1)
  ```

  Verified against pool `0x52e65B17fB6E5BA00Ed806f37Afcd2DaA50271Ca`
  (token0 = WETH, 18 decimals; token1 = USDG, 6 decimals): the formula yields
  **1902.6 USDG per WETH**, and DexScreener independently reports
  `priceNative` `0.0005249` WETH per USDG. `1 / 1902.6 = 0.0005256`. The two
  agree, which is the check that proves the math.

- RPC behaviour on `https://rpc.mainnet.chain.robinhood.com`, measured:
  - A 2000-block `eth_getLogs` window returned 703 logs without complaint.
  - A full-history window fails with `{"code":-32000,"message":"log query timed out"}`.
    Chunk your requests.
  - Block time measured at roughly **94 ms** (212 blocks spanned 20 seconds),
    consistent with the ~101 ms figure in the toolkit constants. **One hour is
    roughly 36,000 blocks.** Plan ranges accordingly: a day of history is over
    900,000 blocks and hundreds of chunked requests.
  - **`blockTimestamp` appears in log objects but is always `0x0`. Do not use
    it.** Fetch block timestamps separately. Batching 50 `eth_getBlockByNumber`
    calls took 195 ms, so this is cheap if you dedupe block numbers first.

### Other sources, for completeness

- **Birdeye** `/defi/ohlcv`: API key required, free tier available. Confirm
  Robinhood Chain coverage before depending on it.
- **Moralis** token OHLCV: API key required. Same caveat.

Both are reasonable if you already hold a key. Neither is verified for this
chain in this toolkit, so treat them as UNVERIFIED until you check.

## Steps

### 1. Confirm the network slug yourself

Slugs change and networks get added. Never hardcode without checking.

```sh
for p in 1 2 3 4 5 6 7 8 9 10 11 12; do
  curl -s "https://api.geckoterminal.com/api/v2/networks?page=$p" \
    -H 'Accept: application/json;version=20230302'
  sleep 3   # free tier is ~30 req/min; do not skip this
done | grep -o '"id":"[^"]*robinhood[^"]*"'
```

Expect `"id":"robinhood"`. If it returns nothing, the slug changed and every
call in this file needs updating.

### 2. Confirm the OHLCV endpoint

```sh
curl -s -H 'Accept: application/json;version=20230302' \
  "https://api.geckoterminal.com/api/v2/networks/robinhood/pools/0x52e65B17fB6E5BA00Ed806f37Afcd2DaA50271Ca/ohlcv/hour?aggregate=1&limit=5&currency=usd" \
  | jq '{first: .data.attributes.ohlcv_list[0], base: .meta.base.symbol, quote: .meta.quote.symbol}'
```

Look at the first two rows and confirm the first timestamp is **larger** than
the second. That is the descending order you must reverse.

### 3. Implement the GeckoTerminal source

`src/sources/geckoterminal.js`:

```js
/**
 * robinhood-toolkit · GeckoTerminal OHLCV candle source
 * Author: nirholas · https://github.com/nirholas/robinhood-toolkit
 * License: MIT (c) 2026 nirholas
 *
 * Data by GeckoTerminal (https://www.geckoterminal.com). Public API, no key.
 * Free tier is approximately 30 requests/minute; the limiter below enforces it.
 */
import { registerSource } from './index.js';

const BASE = 'https://api.geckoterminal.com/api/v2';
const HEADERS = { Accept: 'application/json;version=20230302' };

/** Our interval labels -> GeckoTerminal's {timeframe, aggregate} pair. */
const TIMEFRAME = {
  '1m':  { timeframe: 'minute', aggregate: 1 },
  '5m':  { timeframe: 'minute', aggregate: 5 },
  '15m': { timeframe: 'minute', aggregate: 15 },
  '1h':  { timeframe: 'hour',   aggregate: 1 },
  '4h':  { timeframe: 'hour',   aggregate: 4 },
  '12h': { timeframe: 'hour',   aggregate: 12 },
  '1d':  { timeframe: 'day',    aggregate: 1 },
};

// 2.1s floor => under 30 req/min. The free tier 429s aggressively.
let gate = Promise.resolve();
let lastCall = 0;
function throttled(fn) {
  const run = async () => {
    const wait = Math.max(0, 2100 - (Date.now() - lastCall));
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastCall = Date.now();
    return fn();
  };
  gate = gate.then(run, run);
  return gate;
}

async function getJson(url, retries = 2) {
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const res = await throttled(() => fetch(url, { headers: HEADERS }));
    if (res.status === 429) {
      const wait = (Number(res.headers.get('retry-after')) || 5 * (attempt + 1)) * 1000;
      if (attempt === retries) throw new Error('GeckoTerminal rate limit exhausted');
      await new Promise((r) => setTimeout(r, wait));
      continue;
    }
    if (res.status === 404) {
      throw new Error(`GeckoTerminal has no data for ${url}. Pool may be unindexed.`);
    }
    if (!res.ok) throw new Error(`GeckoTerminal HTTP ${res.status}`);
    return res.json();
  }
  throw new Error('unreachable');
}

/** Confirm the slug at runtime instead of trusting a hardcoded constant. */
export async function findNetworkSlug(match = /robinhood/i) {
  for (let page = 1; page <= 20; page += 1) {
    const body = await getJson(`${BASE}/networks?page=${page}`);
    const list = body?.data ?? [];
    if (list.length === 0) break;
    const hit = list.find(
      (n) => match.test(n.id) || match.test(n.attributes?.name ?? ''),
    );
    if (hit) return hit.id;
  }
  return null;
}

export const geckoTerminalSource = registerSource({
  id: 'geckoterminal',

  /**
   * @param {{chainId?: string, pairAddress: string}} spec
   * @param {{interval?: string, limit?: number, before?: number, currency?: 'usd'|'token'}} opts
   */
  async fetchBars(spec, { interval = '1h', limit = 500, before = null, currency = 'usd' } = {}) {
    const tf = TIMEFRAME[interval];
    if (!tf) {
      throw new Error(
        `GeckoTerminal cannot serve interval "${interval}". ` +
        `Supported: ${Object.keys(TIMEFRAME).join(', ')}`,
      );
    }

    const network = spec.chainId ?? 'robinhood';
    const params = new URLSearchParams({
      aggregate: String(tf.aggregate),
      limit: String(Math.min(limit, 1000)),   // hard cap is 1000
      currency,
      token: 'base',
    });
    if (before) params.set('before_timestamp', String(before));

    const url = `${BASE}/networks/${network}/pools/${spec.pairAddress}/ohlcv/${tf.timeframe}?${params}`;
    const body = await getJson(url);

    const rows = body?.data?.attributes?.ohlcv_list ?? [];
    // Rows are [ts, o, h, l, c, v] and arrive NEWEST FIRST. normaliseBars in
    // the adapter sorts ascending, so no reverse is needed here, but never
    // hand these straight to series.setData().
    return rows.map(([time, open, high, low, close, volume]) => ({
      time, open, high, low, close, volume,
    }));
  },

  /** Page backwards past the 1000-row cap. */
  async fetchHistory(spec, { interval = '1h', pages = 3 } = {}) {
    const all = [];
    let before = null;
    for (let i = 0; i < pages; i += 1) {
      const batch = await this.fetchBars(spec, { interval, limit: 1000, before });
      if (batch.length === 0) break;
      all.push(...batch);
      before = Math.min(...batch.map((b) => b.time)) - 1;
    }
    return all;
  },
});
```

### 4. Implement the on-chain source

No third party. This is the one that cannot be taken away from you.

`src/sources/onchain.js`:

```js
/**
 * robinhood-toolkit · candles aggregated from Uniswap v3 Swap events
 * Author: nirholas · https://github.com/nirholas/robinhood-toolkit
 * License: MIT (c) 2026 nirholas
 *
 * No third-party data provider. Reads the chain directly.
 */
import { JsonRpcProvider, Interface, Contract } from 'ethers';
import { registerSource } from './index.js';
import { intervalSeconds, bucketStart } from '../bars.js';

export const RH_MAINNET_RPC = 'https://rpc.mainnet.chain.robinhood.com';
export const RH_MAINNET_CHAIN_ID = 4663;

const SWAP_IFACE = new Interface([
  'event Swap(address indexed sender, address indexed recipient, int256 amount0, int256 amount1, uint160 sqrtPriceX96, uint128 liquidity, int24 tick)',
]);
export const SWAP_TOPIC = SWAP_IFACE.getEvent('Swap').topicHash;
// 0xc42079f94a6350d7e6235f29174924f928cc2ac818eb64fed8004e115fbcca67

const POOL_ABI = [
  'function token0() view returns (address)',
  'function token1() view returns (address)',
  'function fee() view returns (uint24)',
];
const ERC20_ABI = [
  'function decimals() view returns (uint8)',
  'function symbol() view returns (string)',
];

// Measured on this chain: ~94ms blocks, and a full-range getLogs times out.
const BLOCK_MS = 94;
const CHUNK_BLOCKS = 2000;   // 703 logs came back cleanly at this width

const Q192 = 2n ** 192n;
const SCALE = 10n ** 36n;

/**
 * Price of token0 in units of token1, from sqrtPriceX96.
 * BigInt throughout: float math on a 2^192 numerator loses precision, and
 * memecoin pools have prices around 1e-21 where that matters.
 */
export function priceFromSqrtX96(sqrtPriceX96, decimals0, decimals1) {
  const numerator = sqrtPriceX96 * sqrtPriceX96 * SCALE * 10n ** BigInt(decimals0);
  const denominator = Q192 * 10n ** BigInt(decimals1);
  return Number(numerator / denominator) / 1e36;
}

export function createOnchainSource({
  rpcUrl = RH_MAINNET_RPC,
  chainId = RH_MAINNET_CHAIN_ID,
  id = 'onchain',
} = {}) {
  const provider = new JsonRpcProvider(rpcUrl, chainId, { staticNetwork: true });
  const metaCache = new Map();

  async function poolMeta(poolAddress) {
    const key = poolAddress.toLowerCase();
    if (metaCache.has(key)) return metaCache.get(key);

    const pool = new Contract(poolAddress, POOL_ABI, provider);
    const [token0, token1] = await Promise.all([pool.token0(), pool.token1()]);
    const t0 = new Contract(token0, ERC20_ABI, provider);
    const t1 = new Contract(token1, ERC20_ABI, provider);
    const [d0, d1, s0, s1] = await Promise.all([
      t0.decimals(), t1.decimals(), t0.symbol(), t1.symbol(),
    ]);

    const meta = {
      token0, token1,
      decimals0: Number(d0), decimals1: Number(d1),
      symbol0: s0, symbol1: s1,
    };
    metaCache.set(key, meta);
    return meta;
  }

  /** Dedupe block numbers, then batch. blockTimestamp on logs is always 0x0. */
  async function blockTimestamps(blockNumbers, batchSize = 50) {
    const unique = [...new Set(blockNumbers)];
    const out = new Map();
    for (let i = 0; i < unique.length; i += batchSize) {
      const slice = unique.slice(i, i + batchSize);
      const blocks = await Promise.all(
        slice.map((bn) => provider.send('eth_getBlockByNumber', [bn, false])),
      );
      blocks.forEach((b, k) => {
        if (b) out.set(slice[k], parseInt(b.timestamp, 16));
      });
    }
    return out;
  }

  async function fetchSwapLogs(poolAddress, fromBlock, toBlock) {
    const logs = [];
    for (let start = fromBlock; start <= toBlock; start += CHUNK_BLOCKS) {
      const end = Math.min(start + CHUNK_BLOCKS - 1, toBlock);
      try {
        const chunk = await provider.send('eth_getLogs', [{
          address: poolAddress,
          topics: [SWAP_TOPIC],
          fromBlock: '0x' + start.toString(16),
          toBlock: '0x' + end.toString(16),
        }]);
        logs.push(...chunk);
      } catch (err) {
        // -32000 "log query timed out" on a dense range: halve and retry once.
        if (/timed out|too many|limit/i.test(err?.message ?? '')) {
          const mid = Math.floor((start + end) / 2);
          logs.push(...await fetchSwapLogs(poolAddress, start, mid));
          logs.push(...await fetchSwapLogs(poolAddress, mid + 1, end));
        } else {
          throw err;
        }
      }
    }
    return logs;
  }

  return registerSource({
    id,

    async fetchBars(spec, { interval = '1h', limit = 200 } = {}) {
      const step = intervalSeconds(interval);
      const meta = await poolMeta(spec.pairAddress);

      const head = await provider.getBlockNumber();
      // Blocks are ~94ms, so an hour is ~36,000 blocks. Be honest about scale.
      const spanSec = step * limit;
      const spanBlocks = Math.ceil((spanSec * 1000) / BLOCK_MS);
      const fromBlock = Math.max(0, head - spanBlocks);

      const logs = await fetchSwapLogs(spec.pairAddress, fromBlock, head);
      if (logs.length === 0) return [];

      const times = await blockTimestamps(logs.map((l) => l.blockNumber));

      const buckets = new Map();
      for (const log of logs) {
        const ts = times.get(log.blockNumber);
        if (ts === undefined) continue;

        const ev = SWAP_IFACE.decodeEventLog('Swap', log.data, log.topics);
        const price = priceFromSqrtX96(ev.sqrtPriceX96, meta.decimals0, meta.decimals1);
        if (!Number.isFinite(price) || price <= 0) continue;

        // Volume in token0 units. amount0 is signed by direction.
        const vol = Number(ev.amount0 < 0n ? -ev.amount0 : ev.amount0) / 10 ** meta.decimals0;

        const slot = bucketStart(ts, step);
        const bar = buckets.get(slot);
        if (!bar) {
          buckets.set(slot, {
            time: slot, open: price, high: price, low: price, close: price, volume: vol,
          });
        } else {
          bar.high = Math.max(bar.high, price);
          bar.low = Math.min(bar.low, price);
          bar.close = price;     // logs arrive in block order
          bar.volume += vol;
        }
      }

      return [...buckets.values()].sort((a, b) => a.time - b.time);
    },

    /** Poll head for new swaps and emit forming bars. */
    subscribe(spec, onBar, { pollMs = 4000, interval = '1h' } = {}) {
      const step = intervalSeconds(interval);
      let cursor = null;
      let stopped = false;
      let timer = null;

      const tick = async () => {
        if (stopped) return;
        try {
          const head = await provider.getBlockNumber();
          if (cursor === null) cursor = head - 100;
          if (head > cursor) {
            const meta = await poolMeta(spec.pairAddress);
            const logs = await fetchSwapLogs(spec.pairAddress, cursor + 1, head);
            if (logs.length > 0) {
              const times = await blockTimestamps(logs.map((l) => l.blockNumber));
              for (const log of logs) {
                const ts = times.get(log.blockNumber);
                if (ts === undefined) continue;
                const ev = SWAP_IFACE.decodeEventLog('Swap', log.data, log.topics);
                const price = priceFromSqrtX96(ev.sqrtPriceX96, meta.decimals0, meta.decimals1);
                if (!Number.isFinite(price) || price <= 0) continue;
                const vol = Number(ev.amount0 < 0n ? -ev.amount0 : ev.amount0) / 10 ** meta.decimals0;
                onBar({
                  time: bucketStart(ts, step),
                  open: price, high: price, low: price, close: price, volume: vol,
                });
              }
            }
            cursor = head;
          }
        } catch {
          // Transient RPC failure: keep polling rather than killing the stream.
        }
        if (!stopped) timer = setTimeout(tick, pollMs);
      };

      timer = setTimeout(tick, 0);
      return () => { stopped = true; if (timer) clearTimeout(timer); };
    },

    poolMeta,
    priceFromSqrtX96,
  });
}

export const onchainSource = createOnchainSource();
```

### 5. Cross-validate the two sources

Two independent derivations agreeing is the only real proof either is right.

`scripts/validate-candles.mjs`:

```js
/**
 * robinhood-toolkit · cross-validate candle sources
 * Author: nirholas · https://github.com/nirholas/robinhood-toolkit
 * License: MIT (c) 2026 nirholas
 */
import { geckoTerminalSource } from '../src/sources/geckoterminal.js';
import { onchainSource } from '../src/sources/onchain.js';
import { normaliseBars } from '../src/bars.js';
import { getPair } from '../src/dexscreener.js';

const spec = {
  chainId: 'robinhood',
  pairAddress: '0x52e65B17fB6E5BA00Ed806f37Afcd2DaA50271Ca', // USDG / WETH
};

const meta = await onchainSource.poolMeta(spec.pairAddress);
console.log(`pool: ${meta.symbol0}(${meta.decimals0}) / ${meta.symbol1}(${meta.decimals1})`);

const gecko = normaliseBars(await geckoTerminalSource.fetchBars(spec, { interval: '1h', limit: 24 }));
const chain = normaliseBars(await onchainSource.fetchBars(spec, { interval: '1h', limit: 6 }));
const ds = await getPair(spec.pairAddress);

console.log('geckoterminal bars:', gecko.length, 'last close:', gecko.at(-1)?.close);
console.log('on-chain bars     :', chain.length, 'last close:', chain.at(-1)?.close);
console.log('dexscreener priceNative:', ds.priceNative, '(1/x =', 1 / ds.priceNative, ')');

// On-chain close is token1-per-token0. DexScreener priceNative is the inverse.
const onchainClose = chain.at(-1)?.close;
if (onchainClose) {
  const implied = 1 / onchainClose;
  const drift = Math.abs(implied - ds.priceNative) / ds.priceNative;
  console.log(`inverse drift vs DexScreener: ${(drift * 100).toFixed(3)}%`);
  if (drift > 0.05) {
    console.error('FAIL: over 5% apart. Check decimals and token0/token1 orientation.');
    process.exit(1);
  }
}
console.log('OK');
```

```sh
node scripts/validate-candles.mjs
```

## Deliverable

- `src/sources/geckoterminal.js` with `fetchBars`, `fetchHistory`, a runtime
  `findNetworkSlug()` check, and a 2.1s request floor.
- `src/sources/onchain.js` with `fetchBars`, `subscribe`, `poolMeta`,
  `priceFromSqrtX96`, chunked `eth_getLogs` with timeout bisection, and batched
  block-timestamp resolution.
- `scripts/validate-candles.mjs` that cross-checks both against DexScreener and
  exits non-zero on divergence.
- A `docs/CANDLES.md` recording which source you defaulted to, why, and what the
  fallback is when it fails.

## How to verify

1. `node scripts/validate-candles.mjs` prints under 5% drift and exits 0.
2. Order check, run it explicitly:
   ```sh
   curl -s -H 'Accept: application/json;version=20230302' \
     "https://api.geckoterminal.com/api/v2/networks/robinhood/pools/0x52e65B17fB6E5BA00Ed806f37Afcd2DaA50271Ca/ohlcv/hour?limit=3" \
     | jq '[.data.attributes.ohlcv_list[] | .[0]]'
   ```
   The array is descending. Confirm `normaliseBars` flips it.
3. Topic hash matches:
   ```sh
   node -e "const {id}=require('ethers');console.log(id('Swap(address,address,int256,int256,uint160,uint128,int24)'))"
   ```
   Expect `0xc42079f94a6350d7e6235f29174924f928cc2ac818eb64fed8004e115fbcca67`.
4. Bisection works: set `CHUNK_BLOCKS` to 5,000,000, run `fetchBars`, and
   confirm it recovers from `-32000 log query timed out` rather than throwing.
5. Feed both sources into prompt 04's adapter and toggle between them. The chart
   shape is the same. Different bar counts are expected, a different shape means
   a bug.
6. Kill your network mid-`subscribe`. Polling resumes when it returns.

## Gotchas

- **GeckoTerminal returns newest-first.** Handing `ohlcv_list` straight to
  `series.setData()` throws `Cannot update oldest data`. Always go through
  `normaliseBars`.
- **There is no `15m` timeframe.** It is `minute` plus `aggregate=15`. Passing
  `15m` as the timeframe 404s.
- **The free tier 429s for real.** I hit it while researching this file. The
  2.1s floor is not decoration. Without it, a dashboard opening eight pairs at
  once gets blocked instantly.
- **`blockTimestamp` on logs is always `0x0` on this RPC.** The field exists,
  which makes it look usable, and it silently pins every bar to 1970. Fetch
  block timestamps separately.
- **Full-range `eth_getLogs` times out** with `-32000 log query timed out`.
  Chunk at roughly 2000 blocks and bisect on failure.
- **Blocks are ~94 ms.** An hour is ~36,000 blocks and a day is over 900,000.
  Deep history from `eth_getLogs` is hundreds of requests. Use GeckoTerminal for
  history and the chain for the live tail. That split is the right default.
- **token0/token1 ordering is by address, not by intuition.** In the USDG pool
  token0 is WETH and token1 is USDG, so the raw price is 1902 USDG per WETH, not
  the sub-cent number you might expect. Always read `token0()` and `token1()`
  and label your axis from them, never from the pair's display name.
- **Do float math on `sqrtPriceX96` and you will lose the answer.** The
  numerator reaches 2^192. Use BigInt until the final divide, which
  `priceFromSqrtX96` does.
- Uniswap **v2** pools emit a completely different `Swap` event with no
  `sqrtPriceX96`. Check the pool's `labels` from DexScreener (`["v3"]`) before
  assuming. A v2 pool needs price derived from reserves instead.
- A pool with no swaps in your window returns zero bars, not an error. Render
  the empty state rather than a blank canvas.
- Do not present on-chain aggregated candles as exchange-grade OHLCV. They are
  swap-execution prices from one pool, so a single large trade can print a wick
  that exists nowhere else. Label the source in the UI.
