/* built by nirholas x.com/nichxbt */
/**
 * robinhood-toolkit · order lifecycle tracking
 * Author: nirholas · https://github.com/nirholas/robinhood-toolkit
 * License: All Rights Reserved (c) 2026 nirholas
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
/* built by nirholas x.com/nichxbt */
