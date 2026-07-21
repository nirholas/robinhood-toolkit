/* built by nirholas x.com/nichxbt */
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
