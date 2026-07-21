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
  // Safe to retry: the same client_order_id in `body` makes a repeat submission
  // a no-op server-side. The UUID was generated once by buildOrder, outside any
  // retry loop, so every attempt sends the identical body.
  return rh.requestWithPolicy('POST', '/api/v1/crypto/trading/orders/', { body, idempotent: true });
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

// ---------------------------------------------------------------------------
// Order configuration builders (prompt 04)
//
// Each of the four order types carries a required config object under a
// type-derived key. These builders assemble that object, coerce every numeric
// field to a decimal string (the API rejects numbers), and enforce the rules
// the schema encodes so mistakes surface before a network call.
// ---------------------------------------------------------------------------

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
