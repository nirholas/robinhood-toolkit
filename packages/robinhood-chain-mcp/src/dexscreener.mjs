/**
 * robinhood-toolkit · DexScreener client for Robinhood Chain pairs
 * Author: nirholas · https://github.com/nirholas/robinhood-toolkit
 * License: MIT (c) 2026 nirholas
 *
 * Data source: DexScreener (https://dexscreener.com).
 *
 * This module runs inside an MCP server on the END USER'S OWN MACHINE and calls
 * the DexScreener API directly on that user's behalf, exactly as if they had
 * opened dexscreener.com themselves. It is not a hosted service and it does not
 * relay responses to any third party. DexScreener's terms prohibit proxying or
 * redistributing their API, so do not deploy this server as a shared remote
 * endpoint that answers DexScreener queries for other people.
 */

const BASE = 'https://api.dexscreener.com';

/**
 * DexScreener's slug for Robinhood Chain. It is the string "robinhood", NOT the
 * EIP-155 id 4663. Passing the numeric id returns HTTP 200 with an empty body
 * rather than an error, so the failure is silent and looks like "no pairs".
 */
export const ROBINHOOD_SLUG = 'robinhood';

export class DexScreenerError extends Error {
  constructor(message, { status, url } = {}) {
    super(message);
    this.name = 'DexScreenerError';
    this.status = status;
    this.url = url;
  }
}

/** Serialise requests behind a floor delay so a burst cannot exceed the limit. */
function rateLimiter(minIntervalMs) {
  let chain = Promise.resolve();
  let last = 0;
  return (fn) => {
    const run = async () => {
      const wait = Math.max(0, minIntervalMs - (Date.now() - last));
      if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
      last = Date.now();
      return fn();
    };
    chain = chain.then(run, run);
    return chain;
  };
}

// 250ms floor => at most 240 req/min, comfortably under the cited ceiling.
const limit = rateLimiter(250);

async function get(path, { retries = 2, timeoutMs = 10_000, fetchImpl = fetch } = {}) {
  const url = `${BASE}${path}`;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await limit(() =>
        fetchImpl(url, { signal: controller.signal, headers: { accept: 'application/json' } }),
      );

      if (res.status === 429) {
        if (attempt === retries) {
          throw new DexScreenerError(
            'DexScreener rate limited this request (HTTP 429). Wait about a minute before retrying.',
            { status: 429, url },
          );
        }
        const retryAfter = Number(res.headers.get('retry-after')) || 2 ** attempt;
        await new Promise((resolve) => setTimeout(resolve, retryAfter * 1000));
        continue;
      }

      if (!res.ok) {
        throw new DexScreenerError(`DexScreener returned HTTP ${res.status} for ${path}`, {
          status: res.status,
          url,
        });
      }

      return await res.json();
    } catch (error) {
      if (error instanceof DexScreenerError) throw error;
      const retriable = error?.name === 'AbortError' || error instanceof TypeError;
      if (!retriable || attempt === retries) {
        throw new DexScreenerError(
          `Could not reach the DexScreener API: ${error?.message ?? String(error)}`,
          { status: 0, url },
        );
      }
      await new Promise((resolve) => setTimeout(resolve, 2 ** attempt * 500));
    } finally {
      clearTimeout(timer);
    }
  }

  throw new DexScreenerError('Exhausted retries against the DexScreener API', { status: 0, url });
}

/**
 * Normalise a raw pair. Prices arrive as STRINGS, volume and liquidity as
 * numbers, and a brand-new pool can return null for price, fdv, and marketCap.
 * Coerce here so nothing downstream renders "$NaN".
 */
export function normalisePair(raw) {
  if (!raw) return null;
  const num = (value) => (value === undefined || value === null ? null : Number(value));

  return {
    chainId: raw.chainId,
    dexId: raw.dexId,
    pairAddress: raw.pairAddress,
    url: raw.url,
    labels: raw.labels ?? [],
    // Token names and symbols are attacker-controlled display strings.
    baseToken: raw.baseToken,
    quoteToken: raw.quoteToken,
    priceUsd: num(raw.priceUsd),
    priceNative: num(raw.priceNative),
    liquidityUsd: num(raw.liquidity?.usd),
    volume24h: num(raw.volume?.h24),
    priceChange24h: num(raw.priceChange?.h24),
    txns24h: raw.txns?.h24 ?? { buys: 0, sells: 0 },
    fdv: num(raw.fdv),
    marketCap: num(raw.marketCap),
    // pairCreatedAt is MILLISECONDS. Most other timestamps in charting are seconds.
    createdAt: raw.pairCreatedAt ? new Date(raw.pairCreatedAt).toISOString() : null,
  };
}

/** One pair by its pool address. `/latest/dex/pairs/*` wraps results in { pairs }. */
export async function getPair(pairAddress, { chainId = ROBINHOOD_SLUG, fetchImpl } = {}) {
  const body = await get(`/latest/dex/pairs/${chainId}/${pairAddress}`, { fetchImpl });
  return normalisePair(body?.pairs?.[0] ?? null);
}

/**
 * Free-text search. Results are CANDIDATES FOR A HUMAN TO PICK FROM, never an
 * identifier. Symbols collide, including on a single chain.
 */
export async function search(query, { chainId = ROBINHOOD_SLUG, fetchImpl } = {}) {
  const body = await get(`/latest/dex/search?q=${encodeURIComponent(query)}`, { fetchImpl });
  const list = (body?.pairs ?? []).map(normalisePair).filter(Boolean);
  return chainId ? list.filter((pair) => pair.chainId === chainId) : list;
}

/** Every pool for one token. This endpoint returns a BARE ARRAY, not a wrapper. */
export async function getPoolsForToken(tokenAddress, { chainId = ROBINHOOD_SLUG, fetchImpl } = {}) {
  const body = await get(`/token-pairs/v1/${chainId}/${tokenAddress}`, { fetchImpl });
  const list = Array.isArray(body) ? body : (body?.pairs ?? []);
  return list.map(normalisePair).filter(Boolean);
}

/**
 * Pick the deepest pool. Use this, never "the first result".
 *
 * SCOPE: choosing among pools that trade a token address you have ALREADY
 * verified. Never use liquidity to decide WHICH token a symbol refers to.
 * Liquidity is purchasable, so it ranks impostors above real tokens whenever
 * someone is willing to fund the pool. On Robinhood Chain right now the
 * impostor USDG at 0x63575aA9 holds roughly 108M USD of indexed liquidity
 * against the canonical Global Dollar's 14M. Anyone resolving "USDG" by
 * picking the deepest pool selects the impostor, with more conviction the
 * deeper it gets.
 *
 * Resolve the address first (see tokensBySymbol and verify_token_address),
 * then call this to pick among that address's pools.
 */
export function deepestPool(pairs) {
  return (
    pairs
      .filter((pair) => pair && Number.isFinite(pair.liquidityUsd))
      .sort((a, b) => b.liquidityUsd - a.liquidityUsd)[0] ?? null
  );
}

/**
 * Distinct tokens on Robinhood Chain trading under one symbol, keyed by address.
 * This is the collision detector behind verify_token_address: a symbol with more
 * than one address is a live ticker collision.
 */
export async function distinctTokensBySymbol(symbol, { fetchImpl } = {}) {
  const pairs = await search(symbol, { fetchImpl });
  const wanted = String(symbol).trim().toUpperCase();
  const byAddress = new Map();

  for (const pair of pairs) {
    for (const token of [pair.baseToken, pair.quoteToken]) {
      if (!token?.address || !token?.symbol) continue;
      if (token.symbol.trim().toUpperCase() !== wanted) continue;
      const key = token.address.toLowerCase();
      if (!byAddress.has(key)) {
        byAddress.set(key, { address: token.address, name: token.name ?? null, symbol: token.symbol });
      }
    }
  }

  return [...byAddress.values()];
}
