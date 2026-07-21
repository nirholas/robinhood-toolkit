/* built by nirholas x.com/nichxbt */
/**
 * robinhood-toolkit · market data reads for the Robinhood Crypto Trading API
 * Author: nirholas · https://github.com/nirholas/robinhood-toolkit
 * License: All Rights Reserved (c) 2026 nirholas
 */

/** All tradable pairs, following cursor pagination to exhaustion. */
export async function listTradingPairs(rh, { symbols, limit = 100 } = {}) {
  const results = [];
  let page = await rh.get('/api/v1/crypto/trading/trading_pairs/', {
    symbol: symbols,
    limit,
  });
  for (;;) {
    results.push(...(page.results ?? []));
    if (!page.next) break;
    // `next` is a full URL; re-sign the path plus query it points at.
    const url = new URL(page.next);
    page = await rh.get(url.pathname, Object.fromEntries(url.searchParams));
  }
  return results;
}

/** Best bid/ask for one or more symbols. Returns a Map keyed by symbol. */
export async function bestBidAsk(rh, symbols) {
  const list = Array.isArray(symbols) ? symbols : [symbols];
  const page = await rh.get('/api/v1/crypto/marketdata/best_bid_ask/', { symbol: list });
  return new Map((page.results ?? []).map((r) => [r.symbol, r]));
}

/**
 * Size-aware quote. `side` is 'bid' (you are selling), 'ask' (you are buying),
 * or 'both'. `quantities` is at most 10 values.
 */
export async function estimatedPrice(rh, { symbol, side, quantities }) {
  const list = Array.isArray(quantities) ? quantities : [quantities];
  if (list.length > 10) throw new Error('estimated_price accepts at most 10 quantities');
  return rh.get('/api/v1/crypto/marketdata/estimated_price/', {
    symbol,
    side,
    quantity: list.join(','),
  });
}

/** v2 quote, which includes the fee under your current fee tier. */
export async function estimatedPriceV2(rh, { symbol, side, quantities }) {
  const list = Array.isArray(quantities) ? quantities : [quantities];
  if (list.length > 10) throw new Error('estimated_price accepts at most 10 quantities');
  return rh.get('/api/v2/crypto/trading/estimated_price/', {
    symbol,
    side,
    quantity: list.join(','),
  });
}

/**
 * Slippage between the size-agnostic top of book and the size-aware quote,
 * expressed in basis points. Positive means the size-aware price is worse.
 */
export function slippageBps({ topOfBook, sized, side }) {
  const reference = side === 'ask' ? topOfBook.ask_inclusive_of_buy_spread : topOfBook.bid_inclusive_of_sell_spread;
  if (!reference) return null;
  const delta = side === 'ask' ? sized.price - reference : reference - sized.price;
  return (delta / reference) * 10_000;
}
/* built by nirholas x.com/nichxbt */
