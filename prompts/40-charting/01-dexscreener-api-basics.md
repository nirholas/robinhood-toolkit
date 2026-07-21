<!--
  robinhood-toolkit · build prompt: DexScreener API basics for Robinhood Chain
  Author: nirholas · https://github.com/nirholas/robinhood-toolkit
  License: All Rights Reserved (c) 2026 nirholas
-->

# 01 · DexScreener API basics

## Goal

Build a typed client for the DexScreener public API that resolves Robinhood
Chain pairs and tokens by address, batches token lookups, and respects the rate
limits and terms of service. End state: a `dexscreener.js` module you reuse in
every later prompt in this track.

No API key. No signup. No approval.

## Prerequisites

- Node 20+ (`node --version`). Uses global `fetch`, no HTTP dependency needed.
- `curl` and `jq` for the verification steps.
- A pair address on Robinhood Chain to test against. This prompt uses live ones.

## Reference facts (verified)

Base URL: `https://api.dexscreener.com`

| Endpoint | Returns |
|---|---|
| `GET /latest/dex/pairs/{chainId}/{pairId}` | One pair, current state |
| `GET /latest/dex/search?q={query}` | Pairs matching a free-text query |
| `GET /token-pairs/v1/{chainId}/{tokenAddress}` | All pools for one token |
| `GET /tokens/v1/{chainId}/{addresses}` | Pools for up to 30 comma-separated tokens |

- **The chainId for Robinhood Chain is the string `robinhood`, not the numeric
  `4663`.** DexScreener uses its own slug namespace, unrelated to EIP-155 chain
  IDs. Passing `4663` returns an empty result, not an error, which is why this
  fails silently. Verified live: `GET /latest/dex/pairs/robinhood/0x95f9B0AF9282A22F7ef57058e65098db3f667f95`
  returns HTTP 200 with a Uniswap v3 pair.
- Rate limits: **60 requests/minute** on the profile, boost, ads, and metas
  endpoints (confirmed). **300 requests/minute** is the commonly cited figure for
  `/latest/dex/*` (UNVERIFIED, treat as a ceiling to stay well under, and read
  the response headers yourself).
- Terms of service, as of 2026-07-20:
  - Commercial use is **explicitly allowed**. Attribution is not contractually
    required. Credit them anyway.
  - **Prohibited:** building a product whose primary purpose competes directly
    with DexScreener.
  - **Prohibited:** redistributing or proxying the API to third parties. Your
    build calls the API directly from your own client or your own server for
    your own use. Do not stand up a public endpoint that relays DexScreener
    responses to other people. This is the rule most often broken by accident,
    usually by adding a "convenience" CORS proxy and then sharing the URL.
- **There is no OHLCV or candles endpoint.** Every documented endpoint is a
  current-state snapshot: price now, volume over trailing windows, liquidity
  now. There is no historical time series of any kind. The charts on
  dexscreener.com are drawn from an undocumented internal endpoint that this
  toolkit does not teach you to call. Candles come from a different source, see
  prompt 05.

### Response shape

Field names confirmed against a live response:

```
chainId, dexId, url, pairAddress, labels[]
baseToken  { address, name, symbol }
quoteToken { address, name, symbol }
priceNative, priceUsd
txns      { m5, h1, h6, h24 } each { buys, sells }
volume    { m5, h1, h6, h24 }
priceChange { m5, h1, h6, h24 }   // percent
liquidity { usd, base, quote }
fdv, marketCap, pairCreatedAt      // pairCreatedAt is ms
info      { imageUrl, header, openGraph, websites[], socials[] }
```

`/latest/dex/pairs/*` returns `{ schemaVersion, pairs: [...] }`. The
`/tokens/v1/*` and `/token-pairs/v1/*` endpoints return a **bare array**, not a
wrapper object. Handle both.

Numeric fields arrive as **strings** for prices (`priceUsd: "1.00067"`) and as
**numbers** for volume and liquidity. Coerce explicitly, never rely on `==`.

## Steps

### 1. Confirm the chainId slug before writing code

```sh
# Works: the string slug
curl -s "https://api.dexscreener.com/latest/dex/pairs/robinhood/0x95f9B0AF9282A22F7ef57058e65098db3f667f95" \
  | jq '.pairs[0] | {chainId, dexId, base: .baseToken.symbol, quote: .quoteToken.symbol, priceUsd}'

# Returns an empty result, NOT an error: the numeric chain ID
curl -s "https://api.dexscreener.com/latest/dex/pairs/4663/0x95f9B0AF9282A22F7ef57058e65098db3f667f95" \
  | jq '.pairs'
```

The second command is the one to internalize. A wrong chainId produces `null`
or `[]` with a 200 status. If your dashboard is blank, check this first.

### 2. Learn the ticker-collision problem before you build anything

Symbols are not unique. They are not unique across chains and they are not
unique **on a single chain**. Run this:

```sh
curl -s "https://api.dexscreener.com/latest/dex/search?q=USDG" \
  | jq -r '.pairs[] | "\(.chainId)\t\(.baseToken.symbol)\t\(.baseToken.address)\t\(.baseToken.name)"' \
  | sort -u
```

Live result on Robinhood Chain, two different tokens both ticking `USDG`:

| Address | Name |
|---|---|
| `0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168` | Global Dollar (the real stablecoin) |
| `0x8218d73C00567A01481495Ad6c5143e00D5BB5b4` | Useless Stupid Degen Gamblers |

The second is a joke memecoin that deliberately squats the ticker of the first.
Both are live, both have pools, both return from a symbol search. A user who
types "USDG" and takes the first search hit can land on either one.

**Rule: resolve by contract address, always. Never by symbol.** Symbols are
user-supplied display strings with no uniqueness guarantee at any layer of the
stack. Treat a search result as a candidate list to show a human, never as an
identifier to trade or chart against. Every address in your config file should
be a full checksummed address that you verified on the explorer once, by hand.

### 3. Write the client

`src/dexscreener.js`:

```js
/**
 * robinhood-toolkit · DexScreener API client
 * Author: nirholas · https://github.com/nirholas/robinhood-toolkit
 * License: All Rights Reserved (c) 2026 nirholas
 *
 * Data source: DexScreener (https://dexscreener.com). Called directly from
 * this client. Per DexScreener terms, responses must not be proxied or
 * redistributed to third parties.
 */

const BASE = 'https://api.dexscreener.com';

/** DexScreener's slug for Robinhood Chain. NOT the EIP-155 id 4663. */
export const ROBINHOOD = 'robinhood';

class DexScreenerError extends Error {
  constructor(message, { status, url }) {
    super(message);
    this.name = 'DexScreenerError';
    this.status = status;
    this.url = url;
  }
}

/** Serialise requests with a floor delay so bursts cannot exceed the limit. */
function rateLimiter(minIntervalMs) {
  let chain = Promise.resolve();
  let last = 0;
  return (fn) => {
    const run = async () => {
      const wait = Math.max(0, minIntervalMs - (Date.now() - last));
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      last = Date.now();
      return fn();
    };
    chain = chain.then(run, run);
    return chain;
  };
}

// 250ms floor => max 240 req/min, comfortably under the documented ceiling.
const limit = rateLimiter(250);

async function get(path, { retries = 3, timeoutMs = 10_000 } = {}) {
  const url = `${BASE}${path}`;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await limit(() =>
        fetch(url, {
          signal: controller.signal,
          headers: { accept: 'application/json' },
        }),
      );

      if (res.status === 429) {
        const retryAfter = Number(res.headers.get('retry-after')) || 2 ** attempt;
        if (attempt === retries) {
          throw new DexScreenerError('Rate limited', { status: 429, url });
        }
        await new Promise((r) => setTimeout(r, retryAfter * 1000));
        continue;
      }

      if (!res.ok) {
        throw new DexScreenerError(`HTTP ${res.status}`, { status: res.status, url });
      }

      return await res.json();
    } catch (err) {
      const retriable = err.name === 'AbortError' || err instanceof TypeError;
      if (!retriable || attempt === retries) throw err;
      await new Promise((r) => setTimeout(r, 2 ** attempt * 500));
    } finally {
      clearTimeout(timer);
    }
  }
  throw new DexScreenerError('Exhausted retries', { status: 0, url });
}

/** Normalise a raw pair into typed numbers. Prices arrive as strings. */
export function normalisePair(raw) {
  if (!raw) return null;
  const num = (v) => (v === undefined || v === null ? null : Number(v));
  return {
    chainId: raw.chainId,
    dexId: raw.dexId,
    pairAddress: raw.pairAddress,
    url: raw.url,
    labels: raw.labels ?? [],
    base: raw.baseToken,
    quote: raw.quoteToken,
    priceUsd: num(raw.priceUsd),
    priceNative: num(raw.priceNative),
    liquidityUsd: num(raw.liquidity?.usd),
    volume24h: num(raw.volume?.h24),
    priceChange24h: num(raw.priceChange?.h24),
    txns24h: raw.txns?.h24 ?? { buys: 0, sells: 0 },
    fdv: num(raw.fdv),
    marketCap: num(raw.marketCap),
    createdAt: raw.pairCreatedAt ? new Date(raw.pairCreatedAt) : null,
    info: raw.info ?? null,
  };
}

/** One pair by its pool address. */
export async function getPair(pairAddress, chainId = ROBINHOOD) {
  const body = await get(`/latest/dex/pairs/${chainId}/${pairAddress}`);
  const raw = body?.pairs?.[0] ?? null;
  return normalisePair(raw);
}

/** Every pool for one token. Returns a bare array from the API. */
export async function getPoolsForToken(tokenAddress, chainId = ROBINHOOD) {
  const body = await get(`/token-pairs/v1/${chainId}/${tokenAddress}`);
  const list = Array.isArray(body) ? body : (body?.pairs ?? []);
  return list.map(normalisePair);
}

/**
 * Pools for many tokens. The endpoint caps at 30 addresses, so chunk.
 * Returns a Map keyed by lowercased token address.
 */
export async function getTokens(addresses, chainId = ROBINHOOD) {
  const MAX = 30;
  const chunks = [];
  for (let i = 0; i < addresses.length; i += MAX) {
    chunks.push(addresses.slice(i, i + MAX));
  }

  const byToken = new Map(addresses.map((a) => [a.toLowerCase(), []]));

  for (const chunk of chunks) {
    const body = await get(`/tokens/v1/${chainId}/${chunk.join(',')}`);
    const list = Array.isArray(body) ? body : (body?.pairs ?? []);
    for (const raw of list) {
      const pair = normalisePair(raw);
      const key = pair.base.address.toLowerCase();
      if (byToken.has(key)) byToken.get(key).push(pair);
    }
  }
  return byToken;
}

/**
 * Free-text search. Results are CANDIDATES FOR A HUMAN TO PICK FROM.
 * Never auto-select index 0 and treat it as the token the user meant:
 * symbols collide, including on the same chain.
 */
export async function search(query, { chainId = null } = {}) {
  const body = await get(`/latest/dex/search?q=${encodeURIComponent(query)}`);
  const list = (body?.pairs ?? []).map(normalisePair);
  return chainId ? list.filter((p) => p.chainId === chainId) : list;
}

/** Pick the deepest pool. Use this, not "the first result". */
export function deepestPool(pairs) {
  return pairs
    .filter((p) => p && Number.isFinite(p.liquidityUsd))
    .sort((a, b) => b.liquidityUsd - a.liquidityUsd)[0] ?? null;
}
```

### 4. Exercise it

`scripts/demo-dexscreener.mjs`:

```js
/**
 * robinhood-toolkit · DexScreener client smoke test
 * Author: nirholas · https://github.com/nirholas/robinhood-toolkit
 * License: All Rights Reserved (c) 2026 nirholas
 */
import { getPair, getPoolsForToken, getTokens, search, deepestPool, ROBINHOOD }
  from '../src/dexscreener.js';

const USDG_REAL = '0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168'; // Global Dollar
const USDG_FAKE = '0x8218d73C00567A01481495Ad6c5143e00D5BB5b4'; // ticker squatter
const WETH      = '0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73';

const pair = await getPair('0x95f9B0AF9282A22F7ef57058e65098db3f667f95');
console.log('pair:', pair.base.symbol, '/', pair.quote.symbol,
            '$' + pair.priceUsd, 'liq $' + pair.liquidityUsd);

const pools = await getPoolsForToken(USDG_REAL);
const best = deepestPool(pools);
console.log(`pools for real USDG: ${pools.length}, deepest ${best.pairAddress} ` +
            `($${best.liquidityUsd.toLocaleString()})`);

const batch = await getTokens([USDG_REAL, USDG_FAKE, WETH]);
for (const [addr, list] of batch) {
  const top = deepestPool(list);
  console.log(addr, '->', top ? `${top.base.name} @ $${top.priceUsd}` : 'no pools');
}

const hits = await search('USDG', { chainId: ROBINHOOD });
const distinct = new Map(hits.map((p) => [p.base.address, p.base.name]));
console.log('distinct tokens on Robinhood Chain ticking USDG:', distinct.size);
for (const [addr, name] of distinct) console.log('  ', addr, name);
```

```sh
node scripts/demo-dexscreener.mjs
```

## Deliverable

- `src/dexscreener.js` exporting `getPair`, `getPoolsForToken`, `getTokens`,
  `search`, `deepestPool`, `normalisePair`, `ROBINHOOD`, with the attribution
  header, request serialisation, 429 backoff, and timeout handling.
- `scripts/demo-dexscreener.mjs` that runs clean against the live API.
- A `TOKENS.md` in your project listing every token address you chart, with the
  full checksummed address, the name, and the explorer link you verified it on.
  Addresses only. No bare symbols anywhere in your config.

## How to verify

1. `node scripts/demo-dexscreener.mjs` prints a live price for the pair and
   exits 0.
2. The distinct-token count for `USDG` on Robinhood Chain is 2 or more. If it is
   1, your filter is broken.
3. Wrong-chainId check returns empty rather than throwing:
   `curl -s "https://api.dexscreener.com/latest/dex/pairs/4663/0x95f9B0AF9282A22F7ef57058e65098db3f667f95" | jq '.pairs'`
4. Batching works past the cap: call `getTokens` with 35 addresses and confirm
   two upstream requests fire (log inside `get`) and the returned Map has 35 keys.
5. Grep your own repo for a proxy you did not mean to publish:
   `grep -rn "api.dexscreener.com" --include=*.js .` should only show
   `src/dexscreener.js`, never a route handler that re-serves the response.

## Gotchas

- **`robinhood`, not `4663`.** The single most common failure in this track. A
  wrong chainId is a 200 with an empty body, so nothing throws and your chart
  just renders blank. Assert on the result, not on the status code.
- **No candles endpoint exists.** If you are here looking for OHLCV, stop and go
  to prompt 05. Do not reverse-engineer the internal chart endpoint the website
  uses. It is unversioned, undocumented, can change without notice, and calling
  it sits squarely against the scraping clause in their terms.
- **Do not proxy the API.** Calling it from your own frontend or your own
  backend for your own product is fine. Standing up an endpoint that returns
  DexScreener data to other people is redistribution and is prohibited. This
  includes a "public CORS helper" you share with anyone.
- Prices are strings, volumes are numbers. `priceUsd: "1.00067"`. Coerce at the
  boundary, which `normalisePair` does, and never let a raw response object
  reach your chart code.
- `/tokens/v1` and `/token-pairs/v1` return bare arrays. `/latest/dex/pairs`
  returns `{ pairs: [...] }`. Writing one parser for both is a bug generator.
- `/tokens/v1` caps at 30 addresses. Over the cap it does not error clearly, it
  just gives you less than you asked for. Chunk on the client, always.
- One token has many pools. A token with a v3 pool at three fee tiers appears
  three times with three different prices and wildly different liquidity. Pick
  by depth (`deepestPool`), never by array position.
- `pairCreatedAt` is milliseconds. Nearly every other timestamp you will meet in
  this track, including Lightweight Charts and GeckoTerminal, is **seconds**.
  Convert at the boundary and label your variables with the unit.
- A brand-new pool can return `null` for `fdv`, `marketCap`, and even
  `priceUsd`. Guard before formatting or you will render `$NaN`.
