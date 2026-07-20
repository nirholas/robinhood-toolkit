<!--
  robinhood-toolkit · build prompt: fetching Robinhood crypto market data
  Author: nirholas · https://github.com/nirholas/robinhood-toolkit
  License: MIT (c) 2026 nirholas
-->

# 02 · Fetch market data

## Goal

Build a market data module that lists tradable pairs, reads best bid/ask, and
prices a hypothetical order size before you commit to it. This is the read layer
every strategy in track 50 depends on.

## Prerequisites

- `packages/rh-crypto/client.mjs` from prompt 01.
- Credentials in `.env` with read permission.

## Reference facts

Verified against the live OpenAPI spec on 2026-07-20. Base URL
`https://trading.robinhood.com`.

| Endpoint | Method | Query params |
|---|---|---|
| `/api/v1/crypto/trading/trading_pairs/` | GET | `symbol` (repeatable), `limit`, `cursor` |
| `/api/v1/crypto/marketdata/best_bid_ask/` | GET | `symbol` (repeatable) |
| `/api/v1/crypto/marketdata/estimated_price/` | GET | `symbol`, `side`, `quantity` (all required) |
| `/api/v2/crypto/trading/trading_pairs/` | GET | `symbol`, `limit`, `cursor` |
| `/api/v2/crypto/marketdata/best_bid_ask/` | GET | `symbol` (required) |
| `/api/v2/crypto/trading/estimated_price/` | GET | `symbol`, `side`, `quantity` (all required) |

`side` is one of `bid`, `ask`, `both`. `quantity` is a comma-separated list, max
10 values per request, each between the pair's `min_order_size` and
`max_order_size`.

### Response shapes

`TradingPair` (v1): `asset_code`, `quote_code`, `quote_increment`,
`asset_increment`, `max_order_size`, `min_order_size`, `status`
(`tradable` | `untradable` | `sellonly`), `symbol`.

`V2TradingPair`: `symbol`, `asset_code`, `quote_code`, `asset_increment`,
`quote_increment`, `max_order_size`, `min_order_amount`, `status`,
`is_api_tradable`. Note v2 renames `min_order_size` to `min_order_amount` and
adds `is_api_tradable`.

`BidAskPrice` (v1): `symbol`, `price`, `bid_inclusive_of_sell_spread`,
`sell_spread`, `ask_inclusive_of_buy_spread`, `buy_spread`, `timestamp`.

`V2BestBidAsk`: `symbol`, `bid`, `ask`. Much thinner; no spread breakdown.

`EstimatedPrice` (v1): `symbol`, `side`, `price`, `quantity`,
`bid_inclusive_of_sell_spread`, `sell_spread`, `ask_inclusive_of_buy_spread`,
`buy_spread`, `timestamp`.

`V2EstimatedPrice`: `symbol`, `side`, `quantity`, `timestamp`, `bid`, `ask`,
`fee_ratio`, `est_fee`, `est_total_cost`, `est_total_credit`. Use v2 when you
need the fee included in the quote.

### Pricing semantics, quoted from the spec

The bid and ask prices include a spread. The buy spread is the percent
difference between the ask and the mid price; the sell spread is the percent
difference between the bid and the mid price. To estimate the cost of a **buy**,
request an **ask** quote. To estimate the credit from a **sell**, request a
**bid** quote. `best_bid_ask` does not account for order size and may not be the
execution price; `estimated_price` does account for size.

In v1, prices come from partner market makers. In v2, partner exchanges provide
prices and orders are routed accordingly.

## Steps

1. Write `packages/rh-crypto/marketdata.mjs`:

```js
/**
 * robinhood-toolkit · market data reads for the Robinhood Crypto Trading API
 * Author: nirholas · https://github.com/nirholas/robinhood-toolkit
 * License: MIT (c) 2026 nirholas
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
```

2. Write `examples/rh-quote.mjs`:

```js
/**
 * robinhood-toolkit · print a size-aware quote for a symbol
 * Author: nirholas · https://github.com/nirholas/robinhood-toolkit
 * License: MIT (c) 2026 nirholas
 */
import { RobinhoodCrypto } from '../packages/rh-crypto/client.mjs';
import { bestBidAsk, estimatedPrice, listTradingPairs, slippageBps } from '../packages/rh-crypto/marketdata.mjs';

const symbol = process.argv[2] ?? 'BTC-USD';
const rh = new RobinhoodCrypto();

const [pair] = await listTradingPairs(rh, { symbols: [symbol] });
if (!pair) throw new Error(`no such trading pair: ${symbol}`);
console.log(`${pair.symbol} status=${pair.status} min=${pair.min_order_size} max=${pair.max_order_size} step=${pair.asset_increment}`);

const top = (await bestBidAsk(rh, symbol)).get(symbol);
console.log(`top of book: bid=${top.bid_inclusive_of_sell_spread} ask=${top.ask_inclusive_of_buy_spread} mid=${top.price}`);

const size = Number(pair.min_order_size) * 10;
const quote = await estimatedPrice(rh, { symbol, side: 'ask', quantities: [size] });
const sized = quote.results[0];
console.log(`buying ${size}: price=${sized.price} slippage=${slippageBps({ topOfBook: top, sized, side: 'ask' }).toFixed(1)}bps`);
```

3. Cache tradable pairs. `min_order_size`, `asset_increment`, and
   `quote_increment` change rarely but every order you place must respect them.
   Fetch once at process start, refresh on an interval, and validate order sizes
   against the cache before you ever hit the order endpoint.

## Deliverable

- `packages/rh-crypto/marketdata.mjs` exporting `listTradingPairs`,
  `bestBidAsk`, `estimatedPrice`, `estimatedPriceV2`, `slippageBps`
- `examples/rh-quote.mjs`
- A section in `packages/rh-crypto/README.md` documenting the v1 and v2 field
  differences, since they are not interchangeable

## How to verify

```sh
node --env-file=.env examples/rh-quote.mjs BTC-USD
node --env-file=.env examples/rh-quote.mjs ETH-USD
```

Both must print a pair line, a top-of-book line, and a sized quote. Assert
manually that the ask is above the bid and that the sized ask price for a large
quantity is worse than for a small one. Compare a `BTC-USD` mid against any
public spot price; a deviation beyond roughly a percent means you are reading
the wrong field.

## Gotchas

- **The published curl sample for v1 `estimated_price` uses a different path**
  than the spec. The sample shows
  `https://trading.robinhood.com/marketdata/api/v1/estimated_price/` while the
  spec path key is `/api/v1/crypto/marketdata/estimated_price/`, which is what
  Robinhood's own reference Python client uses. Use the spec path. If it 404s,
  try the sample path and record which one your account actually accepts.
- **`price` in `EstimatedPrice` is the field to use**, not the spread-inclusive
  bid/ask fields. Those describe top of book, not your size.
- **v1 and v2 pair objects are not drop-in compatible.** v1 has
  `min_order_size`; v2 has `min_order_amount` and adds `is_api_tradable`. Code
  reading `min_order_size` off a v2 response gets `undefined` and will happily
  submit an order that gets rejected.
- **`status` is not boolean.** `sellonly` pairs accept sells and reject buys.
  Filter on `status === 'tradable'` before buying, not on truthiness.
- **`best_bid_ask` ignores size.** Never use it to compute expected fill on
  anything larger than the minimum. That is what `estimated_price` is for.
- **The `next` cursor is a full URL.** You must re-sign the path and query it
  points at, not blindly `fetch` it, because the signature covers the path.
- Quotes are point-in-time and carry a `timestamp`. Treat anything older than a
  few seconds as stale in a fast market rather than acting on it.
