<!--
  robinhood-toolkit · build prompt: placing a first Robinhood crypto order
  Author: nirholas · https://github.com/nirholas/robinhood-toolkit
  License: All Rights Reserved (c) 2026 nirholas
-->

# 03 · Place your first order

## Goal

Place one real market order for the smallest quantity the pair allows, confirm
the fill, and cancel a resting limit order. Everything here spends real money,
so the deliverable includes a dry-run mode that is on by default.

## Prerequisites

- Prompts 01 and 02 complete.
- An API credential created **with order-placement permission**. Read-only keys
  return 403 on POST.
- Funded Robinhood Crypto buying power. Check it first:
  `node --env-file=.env examples/rh-whoami.mjs`.

## Reference facts

`POST /api/v1/crypto/trading/orders/` places an order. Required body fields per
the `AddOrder` schema: `symbol`, `client_order_id`, `side`, `type`, plus the
configuration object matching the type.

| Field | Notes |
|---|---|
| `symbol` | Uppercase pair, e.g. `BTC-USD` |
| `client_order_id` | UUID you generate; used for idempotency validation |
| `side` | `buy` or `sell` |
| `type` | `market`, `limit`, `stop_limit`, `stop_loss` |
| `<type>_order_config` | Required object; the key name is derived from `type` |

`market_order_config` accepts only `asset_quantity`. The other configs are
covered in prompt 04.

The response is an `OrderResponse`: `id`, `account_number`, `symbol`,
`client_order_id`, `side`, `type`, `state`, `executions[]`, `average_price`,
`filled_asset_quantity`, `created_at`, `updated_at`, plus the echoed config
object. `state` is one of `open`, `canceled`, `partially_filled`, `filled`,
`failed`.

`POST /api/v1/crypto/trading/orders/{id}/cancel/` cancels an open order. It takes
no body and returns a plain success string of the form
`Cancel request was submitted for order {id}`, **not** an order object. Cancel is
a request, not a guarantee.

To read a single order, filter the list endpoint:
`GET /api/v1/crypto/trading/orders/?id=<uuid>`. Robinhood's reference Python
client also calls `GET /api/v1/crypto/trading/orders/{order_id}/`, but that path
is not in the published OpenAPI paths. UNVERIFIED: prefer the `?id=` filter,
which is in the spec, and test the path form yourself before relying on it.

For v2 (fee tiers), the same shapes apply but `account_number` is a **required
query parameter** on `POST /api/v2/crypto/trading/orders/`. See prompt 05.

## Steps

1. Write `packages/rh-crypto/orders.mjs`:

```js
/**
 * robinhood-toolkit · order placement for the Robinhood Crypto Trading API
 * Author: nirholas · https://github.com/nirholas/robinhood-toolkit
 * License: All Rights Reserved (c) 2026 nirholas
 */
import { randomUUID } from 'node:crypto';

export const ORDER_TYPES = ['market', 'limit', 'stop_limit', 'stop_loss'];

/**
 * Build an AddOrder body. Throws rather than letting the API reject it,
 * so mistakes surface before a network call.
 */
export function buildOrder({ symbol, side, type, config, clientOrderId }) {
  if (!symbol || symbol !== symbol.toUpperCase()) {
    throw new Error(`symbol must be uppercase, got ${symbol}`);
  }
  if (side !== 'buy' && side !== 'sell') throw new Error(`side must be buy or sell, got ${side}`);
  if (!ORDER_TYPES.includes(type)) throw new Error(`type must be one of ${ORDER_TYPES.join(', ')}`);
  if (!config || typeof config !== 'object') throw new Error(`${type} orders require a config object`);

  return {
    client_order_id: clientOrderId ?? randomUUID(),
    side,
    symbol,
    type,
    [`${type}_order_config`]: config,
  };
}

/** Round a quantity down to the pair's increment, as a fixed-precision string. */
export function roundToIncrement(quantity, increment) {
  const step = Number(increment);
  if (!(step > 0)) throw new Error(`invalid increment: ${increment}`);
  const decimals = (increment.split('.')[1] ?? '').length;
  return (Math.floor(Number(quantity) / step) * step).toFixed(decimals);
}

/** Validate a quantity against a TradingPair before submitting. */
export function assertTradable(pair, { side, quantity }) {
  if (!pair) throw new Error('unknown trading pair');
  if (pair.status === 'untradable') throw new Error(`${pair.symbol} is untradable`);
  if (pair.status === 'sellonly' && side === 'buy') throw new Error(`${pair.symbol} is sell-only`);
  const q = Number(quantity);
  if (q < Number(pair.min_order_size)) {
    throw new Error(`quantity ${q} below min_order_size ${pair.min_order_size}`);
  }
  if (q > Number(pair.max_order_size)) {
    throw new Error(`quantity ${q} above max_order_size ${pair.max_order_size}`);
  }
}

export async function placeOrder(rh, body, { dryRun = true } = {}) {
  if (dryRun) {
    return { dry_run: true, would_post: '/api/v1/crypto/trading/orders/', body };
  }
  return rh.post('/api/v1/crypto/trading/orders/', body);
}

export async function cancelOrder(rh, orderId) {
  // Returns a success string, not an order object.
  return rh.post(`/api/v1/crypto/trading/orders/${orderId}/cancel/`);
}

export async function getOrder(rh, orderId) {
  const page = await rh.get('/api/v1/crypto/trading/orders/', { id: orderId });
  return (page.results ?? [])[0] ?? null;
}

/** Poll until the order reaches a terminal state or the deadline passes. */
export async function waitForTerminal(rh, orderId, { timeoutMs = 30_000, intervalMs = 1_000 } = {}) {
  const terminal = new Set(['filled', 'canceled', 'failed']);
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const order = await getOrder(rh, orderId);
    if (order && terminal.has(order.state)) return order;
    if (Date.now() >= deadline) return order;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}
```

2. Write `examples/rh-first-order.mjs`. Dry run is the default; a real order
   requires an explicit flag.

```js
/**
 * robinhood-toolkit · place one minimum-size market order
 * Author: nirholas · https://github.com/nirholas/robinhood-toolkit
 * License: All Rights Reserved (c) 2026 nirholas
 *
 * Usage:
 *   node --env-file=.env examples/rh-first-order.mjs BTC-USD          # dry run
 *   node --env-file=.env examples/rh-first-order.mjs BTC-USD --live   # spends money
 */
import { RobinhoodCrypto } from '../packages/rh-crypto/client.mjs';
import { estimatedPrice, listTradingPairs } from '../packages/rh-crypto/marketdata.mjs';
import { assertTradable, buildOrder, placeOrder, roundToIncrement, waitForTerminal } from '../packages/rh-crypto/orders.mjs';

const symbol = process.argv[2] ?? 'BTC-USD';
const live = process.argv.includes('--live');
const rh = new RobinhoodCrypto();

const [pair] = await listTradingPairs(rh, { symbols: [symbol] });
const quantity = roundToIncrement(pair.min_order_size, pair.asset_increment);
assertTradable(pair, { side: 'buy', quantity });

const quote = await estimatedPrice(rh, { symbol, side: 'ask', quantities: [quantity] });
const estimate = quote.results[0];
console.log(`buying ${quantity} ${pair.asset_code} at about ${estimate.price} (est cost ${(Number(estimate.price) * Number(quantity)).toFixed(2)} USD)`);

const body = buildOrder({
  symbol,
  side: 'buy',
  type: 'market',
  config: { asset_quantity: quantity },
});

const result = await placeOrder(rh, body, { dryRun: !live });
console.log(result);

if (live) {
  const final = await waitForTerminal(rh, result.id);
  console.log(`state=${final.state} filled=${final.filled_asset_quantity} avg=${final.average_price}`);
}
```

3. Run the dry run first and read the printed body carefully. Confirm the
   quantity, the side, and that the config key matches the type. Then run with
   `--live` once.

4. Practice a cancel. Place a limit buy far below market so it rests, then cancel
   it. Prompt 04 covers limit config; the cancel call is:

```js
console.log(await cancelOrder(rh, orderId));
// -> "Cancel request was submitted for order <id>"
```

## Deliverable

- `packages/rh-crypto/orders.mjs` exporting `buildOrder`, `roundToIncrement`,
  `assertTradable`, `placeOrder`, `cancelOrder`, `getOrder`, `waitForTerminal`
- `examples/rh-first-order.mjs` with dry run as the default
- Unit tests for `buildOrder`, `roundToIncrement`, and `assertTradable` that run
  with no network access

## How to verify

```sh
node --test packages/rh-crypto/orders.test.mjs
node --env-file=.env examples/rh-first-order.mjs BTC-USD            # inspect body
node --env-file=.env examples/rh-first-order.mjs BTC-USD --live
```

The live run must print a `state` of `filled` for a market order within seconds.
Cross-check the fill in the Robinhood app. `average_price` must be close to the
`estimated_price` you printed before submitting; a large gap means you priced
the wrong side.

## Gotchas

- **The config key is derived from `type` and must match.** Sending
  `type: 'market'` with a `limit_order_config` is a 400 with
  `attr: "market_order_config"`. The `buildOrder` helper above derives the key so
  it cannot drift.
- **`client_order_id` is for idempotency.** Generate it once per logical order
  and reuse it across retries of the same order. Generating a fresh UUID inside a
  retry loop converts one intended order into several real ones. This is the most
  expensive mistake in this track.
- **Cancel is a request, not a result.** The endpoint returns a string
  acknowledging submission. The order may still fill before the cancel lands. Poll
  the order state afterwards; never assume canceled.
- **`market_order_config` takes only `asset_quantity`.** There is no
  notional/`quote_amount` field for market orders in the schema, so you cannot say
  "buy 20 dollars of BTC" directly with a market order. Convert notional to
  quantity yourself using `estimated_price`, then round down to
  `asset_increment`.
- **Round down, never up.** Rounding up can push you past `max_order_size` or
  past your buying power. `roundToIncrement` floors deliberately.
- **A market order can partially fill.** `state: 'partially_filled'` is a real
  state in v1. Read `filled_asset_quantity`, not the quantity you requested, when
  computing position size.
- **Order placement permission is set at key creation.** If POST returns 403 with
  a read that works, the key lacks the scope. Create a new credential.
- Fees: v1 orders do not carry fee-tier pricing and do not count toward your
  30-day volume. If fee tiers matter to you, read prompt 05 before placing volume
  through v1.
