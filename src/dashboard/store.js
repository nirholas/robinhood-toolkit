/* built by nirholas x.com/nichxbt */
/**
 * robinhood-toolkit · batched multi-pair store
 * Author: nirholas · https://github.com/nirholas/robinhood-toolkit
 * License: All Rights Reserved (c) 2026 nirholas
 *
 * One request per refresh for the whole board, not one per tile.
 */
import { getPair, normalisePair, ROBINHOOD } from '../dexscreener.js';

const BASE = 'https://api.dexscreener.com';

/**
 * DexScreener has no batch-by-pool endpoint, only batch-by-token. Group the
 * board's base tokens, fetch in chunks of 30, then select the pools we track.
 */
async function fetchBoardByTokens(tokenAddresses, chainId) {
  const MAX = 30;
  const out = [];
  for (let i = 0; i < tokenAddresses.length; i += MAX) {
    const chunk = tokenAddresses.slice(i, i + MAX).join(',');
    const res = await fetch(`${BASE}/tokens/v1/${chainId}/${chunk}`, {
      headers: { accept: 'application/json' },
    });
    if (!res.ok) throw new Error(`tokens/v1 HTTP ${res.status}`);
    const body = await res.json();
    out.push(...(Array.isArray(body) ? body : (body?.pairs ?? [])).map(normalisePair));
  }
  return out;
}

export function createBoardStore(board, { chainId = ROBINHOOD, refreshMs = 20_000 } = {}) {
  const wanted = new Set(board.map((b) => b.pairAddress.toLowerCase()));
  const labels = new Map(board.map((b) => [b.pairAddress.toLowerCase(), b.label]));

  /** @type {Map<string, object>} keyed by lowercased pool address/id */
  const state = new Map();
  const history = new Map();      // pool -> number[] of recent prices
  const listeners = new Set();
  let timer = null;
  let stopped = false;
  let tokensResolved = null;
  let lastError = null;

  function emit() {
    const rows = [...state.values()];
    for (const fn of listeners) fn({ rows, error: lastError });
  }

  /**
   * Resolve each pool once to learn its base token, so subsequent refreshes can
   * use the batch-by-token endpoint. One-time cost of N requests, then 1 per
   * refresh forever.
   */
  async function resolveTokens() {
    if (tokensResolved) return tokensResolved;
    const pairs = await Promise.all(
      board.map((b) => getPair(b.pairAddress, chainId).catch(() => null)),
    );
    const tokens = [];
    for (const pair of pairs) {
      if (!pair) continue;
      apply(pair);
      if (!tokens.includes(pair.base.address)) tokens.push(pair.base.address);
    }
    tokensResolved = tokens;
    emit();
    return tokens;
  }

  function apply(pair) {
    const key = pair.pairAddress.toLowerCase();
    if (!wanted.has(key)) return;

    const prev = state.get(key);
    const row = {
      ...pair,
      label: labels.get(key) ?? `${pair.base.symbol}/${pair.quote.symbol}`,
      // Direction of the last tick, for the flash animation.
      tick: prev && Number.isFinite(prev.priceUsd) && Number.isFinite(pair.priceUsd)
        ? Math.sign(pair.priceUsd - prev.priceUsd)
        : 0,
      updatedAt: Date.now(),
    };
    state.set(key, row);

    if (Number.isFinite(pair.priceUsd)) {
      const h = history.get(key) ?? [];
      h.push(pair.priceUsd);
      if (h.length > 120) h.shift();       // bounded: this runs for hours
      history.set(key, h);
    }
  }

  async function refresh() {
    try {
      const tokens = await resolveTokens();
      if (tokens.length === 0) return;
      const pairs = await fetchBoardByTokens(tokens, chainId);
      for (const pair of pairs) apply(pair);
      lastError = null;
    } catch (err) {
      lastError = err;         // keep the last good rows on screen
    }
    emit();
  }

  function start() {
    if (timer) return;
    const tick = async () => {
      if (stopped) return;
      // Do not poll a hidden tab. Saves quota and battery, and the user cannot
      // see it anyway. The visibility handler refreshes immediately on return.
      if (typeof document === 'undefined' || document.visibilityState === 'visible') {
        await refresh();
      }
      if (!stopped) timer = setTimeout(tick, refreshMs);
    };
    timer = setTimeout(tick, 0);
  }

  const onVisibility = () => {
    if (document.visibilityState === 'visible' && !stopped) refresh();
  };
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', onVisibility);
  }

  return {
    start,
    refresh,
    subscribe(fn) { listeners.add(fn); fn({ rows: [...state.values()], error: lastError }); return () => listeners.delete(fn); },
    sparkline: (pairAddress) => history.get(pairAddress.toLowerCase()) ?? [],
    destroy() {
      stopped = true;
      clearTimeout(timer);
      listeners.clear();
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', onVisibility);
      }
    },
  };
}
/* built by nirholas x.com/nichxbt */
