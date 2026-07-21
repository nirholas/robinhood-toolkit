<!--
  robinhood-toolkit · rh-crypto package README
  Author: nirholas · https://github.com/nirholas/robinhood-toolkit
  License: All Rights Reserved (c) 2026 nirholas
-->

# rh-crypto

A zero-dependency, Ed25519-signed HTTP client for the [Robinhood Crypto Trading
API](https://docs.robinhood.com/crypto/trading). Ed25519 ships in Node's
standard `node:crypto`, so this package pulls in nothing else.

One `RobinhoodCrypto` instance issues a byte-exact signed request to any v1 or v2
endpoint. The signature covers the exact bytes transmitted — path (including the
query string), uppercase method, and the body serialized exactly once.

- Base URL: `https://trading.robinhood.com`
- Auth headers: `x-api-key`, `x-signature`, `x-timestamp`
- Signed message: `` `${apiKey}${timestamp}${path}${method}${body}` ``
- Timestamps are Unix seconds and **valid for 30 seconds only**.
- US-only. Requires a Robinhood Crypto account and API credentials created at
  <https://robinhood.com/account/crypto>.

## Install / requirements

Node 20 or newer. Inside this monorepo the package is available as the workspace
`rh-crypto`; the modules are plain `.mjs` files you can also import by path.

## Generate a keypair

You generate the keypair locally and hand Robinhood only the public key.

```sh
node packages/rh-crypto/keygen.mjs
```

It prints a base64 32-byte private seed and public key:

```
private (keep secret): <base64 32-byte seed>
public  (give to RH) : <base64 32-byte public key>
```

Paste the public key into the "Add key" flow in your crypto account settings,
then store both secrets outside the repo (`.env` is gitignored):

```sh
printf 'RH_API_KEY=rh-api-...\nRH_PRIVATE_KEY=...\n' >> .env
```

## Quick start

```js
import { RobinhoodCrypto } from 'rh-crypto'; // or: '../packages/rh-crypto/client.mjs'

// Reads RH_API_KEY and RH_PRIVATE_KEY from the environment by default.
const rh = new RobinhoodCrypto();

// GET with no body.
const account = await rh.get('/api/v1/crypto/trading/accounts/');

// GET with query params (array values repeat the key, and are part of the signature).
const holdings = await rh.get('/api/v1/crypto/trading/holdings/', { asset_code: ['BTC', 'ETH'] });

// POST — the body is serialized exactly once, then that same string is signed and sent.
const order = await rh.post('/api/v1/crypto/trading/orders/', {
  client_order_id: crypto.randomUUID(),
  side: 'buy',
  type: 'market',
  symbol: 'BTC-USD',
  market_order_config: { asset_quantity: '0.0001' },
});
```

Run the bundled smoke test end to end:

```sh
node --env-file=.env examples/rh-whoami.mjs
```

It should print an account object with `account_number`, `status`,
`buying_power`, and `buying_power_currency`.

## Exports

### `client.mjs`

- **`class RobinhoodCrypto`** — the authenticated client.
  - `new RobinhoodCrypto({ apiKey?, privateKey? })` — defaults to
    `process.env.RH_API_KEY` and `process.env.RH_PRIVATE_KEY`. Throws if either
    is missing. The private key is a base64 32-byte Ed25519 seed.
  - `request(method, path, { query?, body? })` — low-level signed request.
    Returns the parsed JSON body, or throws a `RobinhoodError` on non-2xx.
  - `get(path, query?)` — convenience for `GET`.
  - `post(path, body, query?)` — convenience for `POST`.
- **`buildQuery(query)`** — serializes a query object to a `?a=b&c=d` string.
  Array values repeat the key; `null`/`undefined` values are dropped.

### `sign.mjs`

- **`loadPrivateKey(base64Seed)`** — wraps a base64 32-byte Ed25519 seed in the
  PKCS8 prefix and returns a Node `KeyObject`. Throws if the seed isn't 32 bytes.
- **`publicKeyBase64(privateKey)`** — derives the base64 public key from a
  private `KeyObject`.
- **`authHeaders({ apiKey, privateKey, method, path, body?, timestamp? })`** —
  returns the three auth headers. `path` must include the query string; `body`
  is the exact serialized string you transmit (or `""` for no body); `timestamp`
  defaults to the current Unix second.

### `errors.mjs`

- **`class RobinhoodError`** — thrown on non-2xx responses. Carries `status`,
  `type`, `errors[]`, `method`, `path`, `headers`. Getters: `byField`,
  `isValidation`, `isAuth`, `isPermission`, `isRateLimit`, `isServer`, `summary`.
- **`toRobinhoodError({ status, payload, method, path, headers })`** — builds a
  `RobinhoodError` from a failed response (used internally by the client).
- **`triage(error)`** — maps a `RobinhoodError` to `{ action, retryable, hint }`
  over the documented status codes.
- **`logError(error)`** — logs a greppable JSON record. Never emits headers, so
  the signature and key are never written to logs.

### `marketdata.mjs`

The read layer: list pairs, read top of book, and price a hypothetical order
size before committing to it.

- **`listTradingPairs(rh, { symbols?, limit? })`** — every tradable pair,
  following the `next` cursor to exhaustion. `symbols` filters to specific pairs
  (array; repeats the `symbol` param). Returns the flat array of pair objects.
  The `next` cursor is a full URL, so each page is re-signed against the path and
  query it points at — never `fetch`ed blindly, because the signature covers the
  path.
- **`bestBidAsk(rh, symbols)`** — best bid/ask for one symbol or an array.
  Returns a `Map` keyed by symbol. **Ignores order size** — do not use it to
  compute expected fill on anything larger than the minimum.
- **`estimatedPrice(rh, { symbol, side, quantities })`** — size-aware v1 quote.
  `side` is `'bid'` (you are selling), `'ask'` (you are buying), or `'both'`.
  `quantities` is one value or an array of at most 10. Read `price` off each
  `results[]` entry — that is your size-aware price; the spread-inclusive fields
  describe top of book, not your size.
- **`estimatedPriceV2(rh, { symbol, side, quantities })`** — the v2 quote, which
  additionally returns the fee under your current fee tier (`fee_ratio`,
  `est_fee`, `est_total_cost`, `est_total_credit`). Use it when the quote must
  include fees.
- **`slippageBps({ topOfBook, sized, side })`** — basis points between the
  size-agnostic top of book and the size-aware quote. Positive means the
  size-aware price is worse. Returns `null` if the reference field is absent.

To estimate the cost of a **buy**, request an **`ask`** quote; to estimate the
credit from a **sell**, request a **`bid`** quote. The bid and ask both include a
spread: the buy spread is the percent difference between the ask and the mid, and
the sell spread is the percent difference between the bid and the mid.

Pairs carry sizing constraints (`min_order_size`, `asset_increment`,
`quote_increment`) that every order must respect but that change rarely. Cache
the pair list at process start, refresh on an interval, and validate order sizes
against the cache before hitting the order endpoint.

### `orders.mjs`

Building and validating order bodies before they cost anything, plus the write
calls themselves. Every builder throws on a bad shape so mistakes surface before
a network round trip.

- **`buildOrder({ symbol, side, type, config, clientOrderId? })`** — assembles an
  `AddOrder` body, deriving the `<type>_order_config` key from `type` so it cannot
  drift. Generates a UUID `client_order_id` when none is given; reuse one id across
  retries of the same logical order for idempotency.
- **`marketConfig({ assetQuantity })`** — `market_order_config`. Market orders
  take `asset_quantity` only; there is no notional field.
- **`limitConfig({ assetQuantity?, quoteAmount?, limitPrice })`** —
  `limit_order_config`.
- **`stopLossConfig({ assetQuantity?, quoteAmount?, stopPrice, timeInForce? })`** —
  `stop_loss_order_config`. Becomes a market order when the stop triggers, so it
  can fill well below `stopPrice` in a fast move.
- **`stopLimitConfig({ assetQuantity?, quoteAmount?, limitPrice, stopPrice, timeInForce? })`**
  — `stop_limit_order_config`. Bounds the fill price but can fail to fill at all.

  For every config that supports both, **exactly one** of `assetQuantity`
  (base currency) or `quoteAmount` (quote currency) may be present — the builders
  enforce this with an XOR rather than letting the API reject the request.
  `timeInForce` defaults to `'gtc'` and must be one of `TIME_IN_FORCE`
  (`gtc`, `gfd`, `gfw`, `gfm`). Every price and quantity is coerced to a decimal
  string, because the API rejects numbers. In v1, `time_in_force` is accepted on
  the two stop configs only.
- **`assertStopSane({ side, stopPrice, limitPrice?, lastPrice })`** — refuses a
  stop that would trigger immediately (sell stop at/above last, buy stop
  at/below last) and a stop-limit whose limit sits on the wrong side of the stop
  and may never fill.
- **`assertTradable(pair, { side, quantity })`** — validates a quantity against a
  `TradingPair`'s status and min/max bounds.
- **`roundToIncrement(quantity, increment)`** — floors a quantity to the pair's
  increment as a fixed-precision string. Rounds **down**, never up, so it cannot
  push you past `max_order_size` or your buying power.
- **`placeOrder(rh, body, { dryRun = true })`** — posts the order. **Dry run is
  the default**; it returns the would-be request without spending. Pass
  `{ dryRun: false }` to place a real order.
- **`cancelOrder(rh, orderId)`** — requests a cancel. Returns a success **string**,
  not an order object; the order may still fill before the cancel lands, so poll
  afterwards.
- **`getOrder(rh, orderId)`** / **`waitForTerminal(rh, orderId, { timeoutMs?, intervalMs? })`**
  — read one order via the `?id=` filter, or poll until terminal.

### `lifecycle.mjs`

Following an order from submission through executions to a terminal state.

- **`isTerminal(state)`** — true only for `filled`, `canceled`, `failed`. Any
  other state (including v1's `partially_filled` and v2's `pending`, and any state
  added later) is treated as non-terminal, so an unknown state keeps you polling
  rather than falsely reporting "done".
- **`averageFill(order)`** — quantity-weighted average price computed from
  `executions[]`, as a number, or `null` before the first fill. Prefer this over
  the order's `average_price`, which is `null` until filled. Execution
  `effective_price` and `quantity` are decimal **strings**; this coerces with
  `Number()` — keep the string form for anything you persist, since floats lose
  precision on large notionals.
- **`fillRatio(order)`** — fraction filled (0–1) against the requested
  `asset_quantity`, or **`null`** for a `quote_amount` order that has no asset
  target. Do not let that `null` collapse to `0` in position sizing.
- **`track(rh, orderId, { intervalMs?, timeoutMs?, onChange? })`** — polls an
  order, firing `onChange(order, previous)` whenever `state` or
  `filled_asset_quantity` moves, and resolves with the final order once terminal
  or the deadline passes. Do not poll one order per second forever; back off once
  an order has been open and unchanged for a while (see the rate-limit prompt).
- **`ordersSince(rh, isoTimestamp, { symbol?, state? })`** — every order updated
  since a timestamp, following pagination. Use it on startup to reconcile:
  `gfd`/`gfw`/`gfm` orders expire on Robinhood's clock, so an order that vanished
  overnight expired, it did not fail.

```sh
node --env-file=.env examples/rh-bracket.mjs BTC-USD          # dry run
node --env-file=.env examples/rh-bracket.mjs BTC-USD --live   # spends money
```

### `portfolio.mjs`

Balances, holdings, mark-to-market value, and fee tier. Reads only.

- **`getAccount(rh)`** — the single v1 account object (`account_number`,
  `status`, `buying_power`, `buying_power_currency`).
- **`getAccountsV2(rh)`** — the v2 accounts **array**, with the paginated list
  already unwrapped. v2 accounts additionally carry `account_type`,
  `is_api_tradable`, and `fee_tier_status`.
- **`getFeeTier(rh, accountNumber?)`** — that account's `fee_tier_status`, or
  `null` if it carries none. Defaults to the first account.
- **`getHoldings(rh, { assetCodes? })`** — every holding, following pagination,
  with `total_quantity` and `quantity_available_for_trading` **coerced to
  numbers** at the boundary (v2 returns them as strings; nothing downstream has
  to care which version produced them).
- **`markToMarket(rh, { quote = 'USD' })`** — a snapshot: `cash`, `invested`,
  `total`, `currency`, an `unpriced` list of asset codes with no quotable pair,
  and `positions` sorted by value descending. Each position carries `price`,
  `value`, and `locked` (quantity tied up by resting sell orders). Marked against
  the **bid** because that is what a sell would actually receive. Assets with no
  USD pair are reported in `unpriced` rather than valued at zero.
- **`concentration(snapshot, assetCode)`** — the fraction (0–1) of the portfolio
  held in one asset.

```sh
node --env-file=.env examples/rh-portfolio.mjs
```

`FeeTierStatus`: `fee_ratio`, `thirty_day_volume`, `next_fee_tier_ratio`
(nullable), `next_fee_tier_threshold` (nullable). Both nulls mean you are already
in the best tier available to you. Fee tier is per account and shifts as volume
rolls off the 30-day window — re-read it rather than caching it for the life of
the process.

### `keygen.mjs`

A runnable script (no exports) that prints a fresh base64 keypair.

## Market data: v1 vs v2 are not interchangeable

Both API versions expose pairs, best bid/ask, and estimated price, but the
response shapes differ in ways that silently produce `undefined` if you assume
they match. Reach for v2 when you need fees folded into the quote; otherwise v1
carries the richer spread breakdown.

### Endpoints

| Purpose | v1 path | v2 path |
|---|---|---|
| Trading pairs | `/api/v1/crypto/trading/trading_pairs/` | `/api/v2/crypto/trading/trading_pairs/` |
| Best bid/ask | `/api/v1/crypto/marketdata/best_bid_ask/` | `/api/v2/crypto/marketdata/best_bid_ask/` |
| Estimated price | `/api/v1/crypto/marketdata/estimated_price/` | `/api/v2/crypto/trading/estimated_price/` |

`side` is one of `bid`, `ask`, `both`. `quantity` is a comma-separated list, at
most 10 values, each between the pair's min and max order size.

> **Note the v2 `estimated_price` path is under `trading/`, not `marketdata/`.**
> A published curl sample for v1 also shows a different path
> (`/marketdata/api/v1/estimated_price/`) than the spec key
> (`/api/v1/crypto/marketdata/estimated_price/`). This package uses the spec
> path, which is what Robinhood's own reference Python client uses. If it 404s on
> your account, try the sample path and record which one your account accepts.

### Trading pair fields

| v1 `TradingPair` | `V2TradingPair` |
|---|---|
| `symbol` | `symbol` |
| `asset_code`, `quote_code` | `asset_code`, `quote_code` |
| `asset_increment`, `quote_increment` | `asset_increment`, `quote_increment` |
| `max_order_size` | `max_order_size` |
| **`min_order_size`** | **`min_order_amount`** (renamed) |
| `status` | `status` |
| — | **`is_api_tradable`** (added) |

`status` is `tradable` \| `untradable` \| `sellonly` — not a boolean. A
`sellonly` pair accepts sells and rejects buys, so filter on
`status === 'tradable'` before buying, not on truthiness. Code that reads
`min_order_size` off a **v2** response gets `undefined` and will happily submit
an order that gets rejected — read `min_order_amount` there.

### Best bid/ask fields

| v1 `BidAskPrice` | `V2BestBidAsk` |
|---|---|
| `symbol` | `symbol` |
| `price` (mid) | — |
| `bid_inclusive_of_sell_spread`, `sell_spread` | `bid` |
| `ask_inclusive_of_buy_spread`, `buy_spread` | `ask` |
| `timestamp` | — |

v2 is much thinner: just `symbol`, `bid`, `ask`, with no spread breakdown or
mid.

### Estimated price fields

| v1 `EstimatedPrice` | `V2EstimatedPrice` |
|---|---|
| `symbol`, `side`, `quantity` | `symbol`, `side`, `quantity` |
| **`price`** (size-aware, use this) | `bid`, `ask` |
| `bid_inclusive_of_sell_spread`, `sell_spread` | — |
| `ask_inclusive_of_buy_spread`, `buy_spread` | — |
| `timestamp` | `timestamp` |
| — | `fee_ratio`, `est_fee`, `est_total_cost`, `est_total_credit` |

Use **`price`** from a v1 estimate as your size-aware price — the
spread-inclusive fields describe top of book, not your size. Use v2 when you need
the fee included in the quote.

In v1, prices come from partner market makers. In v2, partner exchanges provide
prices and orders route accordingly. Quotes are point-in-time and carry a
`timestamp`; treat anything older than a few seconds as stale in a fast market.

Print a live quote for any symbol:

```sh
node --env-file=.env examples/rh-quote.mjs BTC-USD
```

It prints the pair's sizing constraints, top of book, and a size-aware ask quote
with the slippage in basis points.

## Portfolio: accounts and holdings differ across versions too

| Object | v1 | v2 |
|---|---|---|
| Account fields | `account_number`, `status`, `buying_power`, `buying_power_currency` | same four **plus** `account_type`, `is_api_tradable`, `fee_tier_status` |
| Accounts response | a **single object** | a **paginated list** — read `.results`, don't index `[0]` on the raw response |
| Holdings quantities | **numbers** | **strings** — arithmetic without coercion silently concatenates |
| Holdings request | `account_number` optional | `account_number` **required** — omitting it is a `400`, not an empty list |

`portfolio.mjs` normalizes holdings quantities to numbers at the boundary, so the
version that produced them stops mattering downstream. Two more traps worth
stating outright:

- **`quantity_available_for_trading` is the number to size sells against**, not
  `total_quantity` — the latter includes quantity locked by resting sell orders,
  and sizing off it produces rejections that look like phantom-balance bugs.
- **`status` has three values** (`active`, `deactivated`, `sell_only`). A
  `sell_only` account accepts sells and rejects buys; check it at startup and
  fail loudly rather than discovering it on your first buy.

## v1 versus v2 for order placement

**Decision: order placement uses v1.** The shared constant `ORDER_API_VERSION`
in `client.mjs` is `'v1'`, and `orders.mjs` posts to
`/api/v1/crypto/trading/orders/`. Every later prompt reads that one constant
rather than rediscovering the choice.

All read-only actions exist on both versions, so nothing in this toolkit's reads
depends on the order version — only order placement and fee-tier volume accrual
do.

### Why v1 here

- **Internal consistency.** The order module already ships on the v1 path, and
  keeping the constant and the code in agreement is worth more than a fee-tier
  edge that only applies to enrolled accounts.
- **Simplest surface, fewest moving parts** for a toolkit whose default order
  flow is a dry run.
- **No forced migration.** Per Robinhood's Help Center there is currently no
  announced deprecation date for v1.

### The v2 tradeoff, stated plainly

- **Only v2 orders count toward your 30-day trading volume for fee tiers.** Place
  through v1 and `thirty_day_volume` stays flat no matter how much you trade —
  expected behavior, not a reporting bug.
- Fee-tier trading is limited to eligible jurisdictions.
- If `getFeeTier(rh)` returns `null`, your account is **not enrolled in fee
  tiers**, so placing orders on v2 would not benefit you today. Confirm with
  `node --env-file=.env examples/rh-portfolio.mjs` before assuming otherwise.

**Switch to v2 if you intend to build volume and your account is fee-tier
enabled.** Change it in one place, and never mix versions across order placement
— half your volume would then stop counting:

1. Set `ORDER_API_VERSION = 'v2'` in `client.mjs`.
2. Point the order paths in `orders.mjs` at their v2 equivalents
   (`/api/v2/crypto/trading/orders/`).
3. Keep re-reading `getFeeTier` rather than caching it — the tier changes as
   volume rolls off the 30-day window.

## Streaming: there is no published socket, so this polls

**There is no published WebSocket or streaming endpoint for the Robinhood Crypto
Trading API.** Verified 2026-07-20 against the full OpenAPI 3.0.1 spec at
<https://docs.robinhood.com/crypto/trading>: it declares 14 paths, all HTTP GET
or POST under `https://trading.robinhood.com`, and contains zero occurrences of
`websocket`, `wss://`, `stream`, or `subscribe`. No `webhooks` section, no
callbacks. This is stated plainly here so nobody re-litigates it later.

`RobinhoodStream` (in `stream.mjs`) therefore presents a push-style interface —
`'quote'` / `'order'` / `'error'` / `'idle'` events plus an async `quotes()`
iterator — over a poller. Both polls batch, so two endpoints at a 2s interval is
60 requests/minute total regardless of how many symbols you watch. Quotes
deduplicate on `timestamp`, orders on state + filled quantity, and every failure
class backs off exponentially to a ceiling. A future socket can be swapped in
behind the same interface without touching callers.

Before assuming the poller is still the right answer, confirm the surface has not
changed:

```sh
# Does the published spec mention streaming at all?
curl -s https://docs.robinhood.com/crypto/trading/ \
  | grep -o '/_next/static/chunks/pages/crypto/trading-[a-f0-9]*\.js'
# Fetch that chunk and grep it:
curl -s "https://docs.robinhood.com<chunk path from above>" \
  | grep -c -e websocket -e 'wss://' -e subscribe
# A non-zero count means the surface changed. Re-read the docs.
```

Do not build against an unpublished internal socket found by inspecting app
traffic: it is not covered by the documented API, can change without notice, and
using it is a customer-agreement question, not an engineering one.

## Verify

```sh
# Unit tests — no network access required.
node --test packages/rh-crypto/sign.test.mjs

# Live smoke test — needs valid credentials in .env.
node --env-file=.env examples/rh-whoami.mjs

# Live size-aware quote — needs valid credentials in .env.
node --env-file=.env examples/rh-quote.mjs BTC-USD

# Live portfolio snapshot — needs valid credentials in .env.
node --env-file=.env examples/rh-portfolio.mjs

# Live quote + order stream — needs valid credentials in .env. Ctrl-C to stop.
node --env-file=.env examples/rh-stream.mjs BTC-USD ETH-USD
```

The unit test proves key-loading is correct by deriving Robinhood's published
demo public key from the matching private seed. For the portfolio snapshot,
compare the printed `cash` against buying power in the Robinhood app and each
position quantity against the app's holdings — they must match exactly. `total`
should land within a fraction of a percent of the app's crypto value; the small
gap is expected because this marks against the bid inclusive of spread while the
app may show a mid. If `getFeeTier` prints nothing, the account is not enrolled
in fee tiers.

## Gotchas

- **Sign the exact bytes you send.** Serialize the body once; sign that string;
  send that string. Serializing twice (e.g. handing the object to a library that
  re-serializes) is the most common cause of intermittent 401s.
- **The query string is part of the signature.** The client derives the sent URL
  and the signed path from one string so they can't drift.
- **The 30-second window is short.** Generate the timestamp immediately before
  the request; on retry, re-sign with a fresh timestamp rather than replaying old
  headers. Clock drift over 30s produces 401s that look like a bad key — check
  `date -u` first.
- **`401`** means the signature or timestamp is wrong; **`403`** means the key is
  valid but lacks the permission selected at key-creation time (re-create the
  credential to change scope).
- **The published example signature is not reproducible from JSON.** Robinhood's
  worked example signs a Python `dict` `str()` repr, not JSON. Don't treat it as
  a JSON canonicalization spec; the rule that matters is signing the exact bytes
  sent. That's why the unit test pins key derivation, not a sample signature.
