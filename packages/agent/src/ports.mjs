/**
 * robinhood-toolkit · agent ports (the four seams)
 * Author: nirholas · https://github.com/nirholas/robinhood-toolkit
 * License: All Rights Reserved (c) 2026 nirholas
 *
 * These are documented shapes, not enforced interfaces. Every component in the
 * 50-autonomous track implements exactly one of them, which is what makes the
 * paper broker (04), the live broker (05), and the backtester (03) drop-in
 * swaps: the loop only ever talks to these four objects.
 *
 * This module exports nothing at runtime by design — it is the contract, and
 * the JSDoc typedefs below are the single source of truth for each seam. Import
 * them for editor tooling; do not import them expecting behaviour.
 */

/**
 * A two-sided price snapshot for one symbol.
 * @typedef  {object} Quote
 * @property {string} symbol  Trading pair, e.g. "BTC-USD".
 * @property {number} bid     Best bid (what a seller receives).
 * @property {number} ask     Best ask (what a buyer pays).
 * @property {number} ts      Epoch milliseconds the quote was observed.
 */

/**
 * Seam 1 — market data. Read-only price access.
 * @typedef  {object} MarketData
 * @property {(symbol: string) => Promise<Quote> | Quote} getQuote
 */

/**
 * Context handed to a strategy on each evaluation.
 * @typedef  {object} StrategyContext
 * @property {string} symbol
 * @property {Quote}  quote
 * @property {'paper'|'live'} mode
 */

/**
 * A trade instruction emitted by a strategy. `null` means "do nothing".
 * @typedef  {object} Signal
 * @property {'buy'|'sell'} side
 * @property {'limit'|'market'} [type='limit']
 * @property {number} quantity          Base-asset quantity.
 * @property {number} [limitPrice]      Required for limit orders.
 */

/**
 * Seam 2 — strategy. Turns context into a Signal or abstains.
 * @typedef  {object} Strategy
 * @property {(ctx: StrategyContext) => Promise<Signal|null> | Signal | null} decide
 */

/**
 * The concrete order the loop assembled from a Signal, before it is allowed.
 * @typedef  {object} OrderIntent
 * @property {string} clientOrderId     Idempotency key the loop generates.
 * @property {string} symbol
 * @property {'buy'|'sell'} side
 * @property {'limit'|'market'} type
 * @property {number} quantity
 * @property {number} [limitPrice]
 * @property {number} notional          quantity * price, in quote currency.
 */

/**
 * The policy engine's ruling on an intent.
 * @typedef  {object} Verdict
 * @property {boolean}  allow            False blocks the order.
 * @property {string[]} violations       Human-readable reasons when blocked.
 */

/**
 * Seam 3 — policy. The gate between a strategy's wish and a broker call.
 * @typedef  {object} Policy
 * @property {(intent: OrderIntent, ctx: { quote: Quote, mode: 'paper'|'live' }) => Promise<Verdict> | Verdict} evaluate
 */

/**
 * What a broker returns after accepting an order. Paper brokers fill
 * synchronously (Fill); live brokers usually acknowledge async (OrderAck).
 * @typedef  {object} Fill
 * @property {string} clientOrderId
 * @property {'filled'} status
 * @property {number} filledQuantity
 * @property {number} avgPrice
 *
 * @typedef  {object} OrderAck
 * @property {string} clientOrderId
 * @property {string} brokerOrderId
 * @property {'accepted'|'pending'} status
 */

/**
 * Seam 4 — broker. The only seam that can move real money (live impl only).
 * `getBalances` is optional for paper brokers but REQUIRED for live: the live
 * preflight refuses to start without it.
 * @typedef  {object} Broker
 * @property {(intent: OrderIntent) => Promise<Fill|OrderAck> | Fill|OrderAck} placeOrder
 * @property {() => Promise<Record<string, number>>} [getBalances]
 */

/**
 * Seam bonus — journal. Every tick writes one record, even no-op ticks, so a
 * post-mortem has no gaps. Record format is defined in
 * prompts/80-safety/04-audit-logging.md; the loop only emits the object.
 * @typedef  {object} Journal
 * @property {(record: object) => Promise<void> | void} write
 * @property {() => Promise<void> | void} [flush]
 */

export {};
