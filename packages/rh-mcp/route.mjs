/**
 * robinhood-toolkit · route crypto orders to whichever rail is available
 * Author: nirholas · https://github.com/nirholas/robinhood-toolkit
 * License: MIT (c) 2026 nirholas
 */
import { RobinhoodCrypto } from '../rh-crypto/client.mjs';
import { buildOrder } from '../rh-crypto/orders.mjs';

export async function placeCryptoOrder(adapter, { symbol, side, type, config }) {
  if (adapter?.has('cryptoPlaceOrder')) {
    // MCP lane. Schemas are unknown until rollout, so validate against the live
    // schema (the adapter does this) rather than guessing argument names here.
    const tool = adapter.resolve('cryptoPlaceOrder');
    const args = mapToSchema(tool.inputSchema, { symbol, side, type, config });
    return { rail: 'mcp', result: await adapter.call('cryptoPlaceOrder', args) };
  }

  // REST lane. This works today and is the default.
  const rh = new RobinhoodCrypto();
  const body = buildOrder({ symbol, side, type, config });
  return { rail: 'rest', result: await rh.post('/api/v1/crypto/trading/orders/', body) };
}

/**
 * Map canonical fields onto whatever property names the live schema advertises.
 * Throws if a required property cannot be satisfied, so an unmapped rollout
 * fails loudly instead of sending a malformed order.
 */
export function mapToSchema(schema, canonical) {
  const properties = schema?.properties ?? {};
  const aliases = {
    symbol: ['symbol', 'pair', 'currency_pair', 'ticker'],
    side: ['side', 'direction', 'action'],
    type: ['type', 'order_type'],
  };

  const args = {};
  for (const [field, candidates] of Object.entries(aliases)) {
    const key = candidates.find((c) => c in properties);
    if (key) args[key] = canonical[field];
  }
  if (canonical.config) {
    for (const [k, v] of Object.entries(canonical.config)) {
      if (k in properties) args[k] = v;
    }
  }

  const missing = (schema?.required ?? []).filter((r) => args[r] === undefined);
  if (missing.length) {
    throw new Error(
      `cannot map canonical order onto ${JSON.stringify(missing)}; inspect the live schema and extend the alias table`,
    );
  }
  return args;
}
