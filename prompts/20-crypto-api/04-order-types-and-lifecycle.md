<!--
  robinhood-toolkit · build prompt: order types and lifecycle
  Author: nirholas · https://github.com/nirholas/robinhood-toolkit
  License: MIT (c) 2026 nirholas
-->

# 04 · Order types and lifecycle

## Goal

Support all four order types with correct configuration objects, and build a
lifecycle tracker that follows an order from submission through executions to a
terminal state.

## Prerequisites

- Prompt 03 complete, including `packages/rh-crypto/orders.mjs`.

## Reference facts

All four types and their required config objects, from the `AddOrder` schema:

| `type` | Config key | Config fields |
|---|---|---|
| `market` | `market_order_config` | `asset_quantity` |
| `limit` | `limit_order_config` | `quote_amount`, `asset_quantity`, `limit_price` |
| `stop_loss` | `stop_loss_order_config` | `quote_amount`, `asset_quantity`, `stop_price`, `time_in_force` |
| `stop_limit` | `stop_limit_order_config` | `quote_amount`, `asset_quantity`, `limit_price`, `stop_price`, `time_in_force` |

Rule quoted from the spec: for order configurations that support both
`asset_quantity` and `quote_amount`, **only one can be present in the request
body**. `asset_quantity` is denominated in the base currency (BTC in BTC-USD);
`quote_amount` is denominated in the quote currency (USD).

`time_in_force` values, with the spec's own definitions:

| Value | Meaning |
|---|---|
| `gtc` | Good til canceled. Open until filled or canceled. |
| `gfd` | Good for day. Open until end of day or canceled. |
| `gfw` | Good for week. Open until end of week or canceled. |
| `gfm` | Good for month. Open until end of month or canceled. |

In v1, `time_in_force` appears on `stop_loss_order_config` and
`stop_limit_order_config` only. In v2, `AddOrderV2` also accepts
`time_in_force` on `limit_order_config`. UNVERIFIED whether the v1 limit
endpoint silently accepts and ignores the field; test it against your account
before depending on either behavior.

### States

`OrderResponse.state`: `open`, `canceled`, `partially_filled`, `filled`,
`failed`.

The v2 order list filter accepts a slightly different set: `open`, `canceled`,
`filled`, `failed`, `pending`. Note `pending` exists as a v2 filter value and
`partially_filled` does not appear in it. Do not hardcode one set for both
versions; treat any state you do not recognize as non-terminal and keep polling.

### Executions

`executions[]` items are `OrderExecution`: `effective_price`, `quantity`,
`timestamp`, all required, all strings (`effective_price` and `quantity` are
`format: decimal` strings, not numbers). `average_price` on the order is the
average of all executions and is nullable until the first fill.

### List filters

`GET /api/v1/crypto/trading/orders/` accepts `created_at_start`,
`created_at_end`, `updated_at_start`, `updated_at_end` (all ISO 8601), `symbol`,
`id`, `side`, `state`, `type`, `cursor`, `limit`.

## Steps

1. Extend `packages/rh-crypto/orders.mjs` with config builders:

```js
/**
 * robinhood-toolkit · order configuration builders
 * Author: nirholas · https://github.com/nirholas/robinhood-toolkit
 * License: MIT (c) 2026 nirholas
 */
export const TIME_IN_FORCE = ['gtc', 'gfd', 'gfw', 'gfm'];

/** Exactly one of assetQuantity or quoteAmount must be supplied. */
function sizing({ assetQuantity, quoteAmount }) {
  const hasAsset = assetQuantity !== undefined;
  const hasQuote = quoteAmount !== undefined;
  if (hasAsset === hasQuote) {
    throw new Error('supply exactly one of assetQuantity or quoteAmount');
  }
  return hasAsset ? { asset_quantity: String(assetQuantity) } : { quote_amount: String(quoteAmount) };
}

function checkTif(tif) {
  if (!TIME_IN_FORCE.includes(tif)) {
    throw new Error(`time_in_force must be one of ${TIME_IN_FORCE.join(', ')}`);
  }
  return tif;
}

export function marketConfig({ assetQuantity }) {
  if (assetQuantity === undefined) throw new Error('market orders require assetQuantity');
  return { asset_quantity: String(assetQuantity) };
}

export function limitConfig({ assetQuantity, quoteAmount, limitPrice }) {
  if (limitPrice === undefined) throw new Error('limit orders require limitPrice');
  return { ...sizing({ assetQuantity, quoteAmount }), limit_price: String(limitPrice) };
}

export function stopLossConfig({ assetQuantity, quoteAmount, stopPrice, timeInForce = 'gtc' }) {
  if (stopPrice === undefined) throw new Error('stop_loss orders require stopPrice');
  return {
    ...sizing({ assetQuantity, quoteAmount }),
    stop_price: String(stopPrice),
    time_in_force: checkTif(timeInForce),
  };
}

export function stopLimitConfig({ assetQuantity, quoteAmount, limitPrice, stopPrice, timeInForce = 'gtc' }) {
  if (limitPrice === undefined) throw new Error('stop_limit orders require limitPrice');
  if (stopPrice === undefined) throw new Error('stop_limit orders require stopPrice');
  return {
    ...sizing({ assetQuantity, quoteAmount }),
    limit_price: String(limitPrice),
    stop_price: String(stopPrice),
    time_in_force: checkTif(timeInForce),
  };
}

/** Sanity-check stop and limit prices against the side. */
export function assertStopSane({ side, stopPrice, limitPrice, lastPrice }) {
  const stop = Number(stopPrice);
  const last = Number(lastPrice);
  if (side === 'sell' && stop >= last) {
    throw new Error(`sell stop ${stop} is at or above last ${last}; it would trigger immediately`);
  }
  if (side === 'buy' && stop <= last) {
    throw new Error(`buy stop ${stop} is at or below last ${last}; it would trigger immediately`);
  }
  if (limitPrice !== undefined) {
    const limit = Number(limitPrice);
    if (side === 'sell' && limit > stop) {
      throw new Error(`sell stop-limit with limit ${limit} above stop ${stop} may never fill`);
    }
    if (side === 'buy' && limit < stop) {
      throw new Error(`buy stop-limit with limit ${limit} below stop ${stop} may never fill`);
    }
  }
}
```

2. Write the lifecycle tracker, `packages/rh-crypto/lifecycle.mjs`:

```js
/**
 * robinhood-toolkit · order lifecycle tracking
 * Author: nirholas · https://github.com/nirholas/robinhood-toolkit
 * License: MIT (c) 2026 nirholas
 */
const TERMINAL = new Set(['filled', 'canceled', 'failed']);

export function isTerminal(state) {
  return TERMINAL.has(state);
}

/** Weighted average fill price computed from executions, as a number. */
export function averageFill(order) {
  const fills = order.executions ?? [];
  if (fills.length === 0) return null;
  let notional = 0;
  let quantity = 0;
  for (const f of fills) {
    const q = Number(f.quantity);
    notional += Number(f.effective_price) * q;
    quantity += q;
  }
  return quantity === 0 ? null : notional / quantity;
}

/** Fraction of the order that has filled, 0 to 1, or null if size is unknown. */
export function fillRatio(order) {
  const config = order.market_order_config ?? order.limit_order_config ?? order.stop_loss_order_config ?? order.stop_limit_order_config;
  const requested = Number(config?.asset_quantity);
  if (!(requested > 0)) return null; // quote_amount orders have no asset target
  return Number(order.filled_asset_quantity ?? 0) / requested;
}

/**
 * Poll an order and invoke onChange whenever state or fill quantity moves.
 * Resolves with the final order once terminal or the deadline passes.
 */
export async function track(rh, orderId, { intervalMs = 1_000, timeoutMs = 300_000, onChange } = {}) {
  const deadline = Date.now() + timeoutMs;
  let previous = null;
  for (;;) {
    const page = await rh.get('/api/v1/crypto/trading/orders/', { id: orderId });
    const order = (page.results ?? [])[0];
    if (!order) throw new Error(`order ${orderId} not found`);

    const changed =
      !previous ||
      previous.state !== order.state ||
      previous.filled_asset_quantity !== order.filled_asset_quantity;
    if (changed) onChange?.(order, previous);
    previous = order;

    if (isTerminal(order.state)) return order;
    if (Date.now() >= deadline) return order;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

/** All orders updated since a timestamp, following pagination. */
export async function ordersSince(rh, isoTimestamp, { symbol, state } = {}) {
  const out = [];
  let page = await rh.get('/api/v1/crypto/trading/orders/', {
    updated_at_start: isoTimestamp,
    symbol,
    state,
    limit: 100,
  });
  for (;;) {
    out.push(...(page.results ?? []));
    if (!page.next) break;
    const url = new URL(page.next);
    page = await rh.get(url.pathname, Object.fromEntries(url.searchParams));
  }
  return out;
}
```

3. Write `examples/rh-bracket.mjs`: place a resting limit buy, track it, and on
   fill place a stop-loss sell for the filled quantity. Keep dry run as the
   default flag as in prompt 03.

## Deliverable

- Config builders in `packages/rh-crypto/orders.mjs`
- `packages/rh-crypto/lifecycle.mjs` exporting `isTerminal`, `averageFill`,
  `fillRatio`, `track`, `ordersSince`
- `examples/rh-bracket.mjs`
- Tests covering: exactly-one-of sizing, rejected bad `time_in_force`, and
  `assertStopSane` catching an immediately-triggering stop

## How to verify

```sh
node --test packages/rh-crypto/orders.test.mjs
```

Then, live: place a limit buy roughly 20 percent below market with `gtc`. It must
come back `state: 'open'` and appear in
`GET /api/v1/crypto/trading/orders/?state=open`. Cancel it and confirm it moves
to `canceled`. Place a minimum-size market order and confirm `track` emits at
least one change event and returns `filled` with a non-null `averageFill`.

## Gotchas

- **`quote_amount` and `asset_quantity` are mutually exclusive.** Sending both is
  a validation error. The `sizing` helper enforces it with an XOR rather than
  letting the API decide.
- **Execution numbers are strings.** `effective_price` and `quantity` are
  `format: decimal` strings. Adding them without `Number()` concatenates. Worse,
  parsing them as floats loses precision on large notionals, so keep the string
  form for anything you persist or report.
- **`average_price` is nullable.** It is null before the first fill. Guard it, or
  compute from `executions` with `averageFill`.
- **The v1 and v2 state vocabularies differ.** v1 order objects can be
  `partially_filled`; the v2 list filter offers `pending` instead. Treat unknown
  states as non-terminal so a new state does not turn into an infinite fill wait
  or a false "done".
- **`fillRatio` returns null for `quote_amount` orders.** There is no asset
  target to divide by. Do not let that null become a zero in position sizing.
- **A stop is not a guaranteed price.** `stop_loss` becomes a market order when
  triggered and can fill well below the stop in a fast move. `stop_limit` bounds
  the price but can fail to fill at all. Pick deliberately.
- **`gfd`, `gfw`, `gfm` expire on Robinhood's clock, not yours.** An order that
  vanishes overnight expired; it did not fail. Reconcile with
  `ordersSince` on startup rather than assuming your in-memory state survived.
- **Do not poll one order per second forever.** Prompt 07 covers the rate budget.
  Back off once an order has been open and unchanged for a while.
