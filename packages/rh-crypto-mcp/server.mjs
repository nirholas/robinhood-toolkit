#!/usr/bin/env node
/**
 * robinhood-toolkit · MCP server exposing the Robinhood Crypto Trading API
 * Author: nirholas · https://github.com/nirholas/robinhood-toolkit
 * License: MIT (c) 2026 nirholas
 *
 * NEVER write to stdout from this process. Stdout is the JSON-RPC channel and a
 * stray console.log corrupts the stream, which the host reports as an unhelpful
 * parse error. Diagnostics and the audit log go to stderr.
 *
 * The agent is untrusted input: a model chooses these arguments while possibly
 * reasoning over attacker-influenced text. Every guardrail lives here in the
 * server, where the agent cannot skip it, not in a system prompt.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

import { RobinhoodCrypto } from '../rh-crypto/client.mjs';
import { bestBidAsk, estimatedPrice, listTradingPairs } from '../rh-crypto/marketdata.mjs';
import { markToMarket } from '../rh-crypto/portfolio.mjs';
import { assertTradable, buildOrder, cancelOrder, getOrder, roundToIncrement } from '../rh-crypto/orders.mjs';
import { loadPolicy, PolicyGuard, PolicyViolation } from '../rh-mcp/policy.mjs';

const rh = new RobinhoodCrypto();
const policy = await loadPolicy(process.env.RH_POLICY_PATH ?? 'config/agent-policy.json');
const guard = new PolicyGuard(policy, { auditLog: (line) => process.stderr.write(`${line}\n`) });

const server = new McpServer({ name: 'robinhood-crypto', version: '1.0.0' });

const ok = (data) => ({ content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] });
const fail = (message) => ({ isError: true, content: [{ type: 'text', text: message }] });

server.registerTool(
  'list_trading_pairs',
  {
    title: 'List crypto trading pairs',
    description: 'Tradable crypto pairs with size limits and increments. Use before sizing any order.',
    inputSchema: { symbols: z.array(z.string()).optional() },
  },
  async ({ symbols }) => ok(await listTradingPairs(rh, { symbols })),
);

server.registerTool(
  'get_quote',
  {
    title: 'Get a crypto quote',
    description: 'Best bid and ask for one or more pairs. Ignores order size; use estimate_order_cost for sizing.',
    inputSchema: { symbols: z.array(z.string()).min(1) },
  },
  async ({ symbols }) => ok(Object.fromEntries(await bestBidAsk(rh, symbols))),
);

server.registerTool(
  'estimate_order_cost',
  {
    title: 'Estimate order cost',
    description: 'Size-aware price estimate. Use side "ask" to estimate a buy, "bid" to estimate a sell.',
    inputSchema: {
      symbol: z.string(),
      side: z.enum(['bid', 'ask', 'both']),
      quantities: z.array(z.number().positive()).min(1).max(10),
    },
  },
  async ({ symbol, side, quantities }) => ok(await estimatedPrice(rh, { symbol, side, quantities })),
);

server.registerTool(
  'get_portfolio',
  {
    title: 'Get crypto portfolio',
    description: 'Cash, holdings, and mark-to-market value of the crypto account.',
    inputSchema: {},
  },
  async () => ok(await markToMarket(rh)),
);

server.registerTool(
  'review_crypto_order',
  {
    title: 'Review a crypto order',
    description:
      'Simulate an order without placing it. Returns the estimated cost, the policy decision, and any warnings. Always call this before place_crypto_order.',
    inputSchema: {
      symbol: z.string(),
      side: z.enum(['buy', 'sell']),
      asset_quantity: z.number().positive(),
    },
  },
  async ({ symbol, side, asset_quantity }) => {
    const [pair] = await listTradingPairs(rh, { symbols: [symbol] });
    if (!pair) return fail(`unknown trading pair: ${symbol}`);

    const warnings = [];
    const quantity = roundToIncrement(asset_quantity, pair.asset_increment);
    if (Number(quantity) !== asset_quantity) {
      warnings.push(`quantity rounded down to ${quantity} to match increment ${pair.asset_increment}`);
    }

    try {
      assertTradable(pair, { side, quantity });
    } catch (error) {
      return fail(error.message);
    }

    const quote = await estimatedPrice(rh, {
      symbol,
      side: side === 'buy' ? 'ask' : 'bid',
      quantities: [quantity],
    });
    const estimate = quote.results[0];
    const notionalUsd = Number(estimate.price) * Number(quantity);

    let policyDecision = 'allowed';
    try {
      guard.check({
        tool: 'place_crypto_order',
        symbol,
        side,
        notionalUsd,
        portfolioValueUsd: policy.agentic_account_funded_usd,
        simulated: true,
      });
    } catch (error) {
      if (!(error instanceof PolicyViolation)) throw error;
      policyDecision = error.message;
      warnings.push(error.message);
    }

    return ok({
      symbol,
      side,
      quantity,
      estimated_price: estimate.price,
      estimated_notional_usd: Number(notionalUsd.toFixed(2)),
      policy: policyDecision,
      orders_placed_today: guard.ordersToday,
      warnings,
      would_be_rejected: policyDecision !== 'allowed',
    });
  },
);

server.registerTool(
  'place_crypto_order',
  {
    title: 'Place a crypto order',
    description:
      'Place a real crypto order that spends real money. Call review_crypto_order first. Subject to the server-side policy limits.',
    inputSchema: {
      symbol: z.string(),
      side: z.enum(['buy', 'sell']),
      type: z.enum(['market', 'limit']),
      asset_quantity: z.number().positive(),
      limit_price: z.number().positive().optional(),
      confirmed: z.literal(true).describe('Must be true. Set only after reviewing with review_crypto_order.'),
    },
  },
  async ({ symbol, side, type, asset_quantity, limit_price, confirmed }) => {
    if (confirmed !== true) return fail('confirmed must be true; run review_crypto_order first');
    if (type === 'limit' && limit_price === undefined) return fail('limit orders require limit_price');

    const [pair] = await listTradingPairs(rh, { symbols: [symbol] });
    if (!pair) return fail(`unknown trading pair: ${symbol}`);

    const quantity = roundToIncrement(asset_quantity, pair.asset_increment);
    try {
      assertTradable(pair, { side, quantity });
    } catch (error) {
      return fail(error.message);
    }

    const quote = await estimatedPrice(rh, {
      symbol,
      side: side === 'buy' ? 'ask' : 'bid',
      quantities: [quantity],
    });
    const notionalUsd = Number(quote.results[0].price) * Number(quantity);

    const intent = {
      tool: 'place_crypto_order',
      symbol,
      side,
      notionalUsd,
      portfolioValueUsd: policy.agentic_account_funded_usd,
      simulated: true,
    };
    try {
      guard.check(intent);
    } catch (error) {
      if (error instanceof PolicyViolation) return fail(error.message);
      throw error;
    }

    const config =
      type === 'market'
        ? { asset_quantity: quantity }
        : { asset_quantity: quantity, limit_price: String(limit_price) };

    // client_order_id is generated once, inside buildOrder, and never regenerated.
    // If an agent retries this tool, that is a new order with a new id by design;
    // the id is not reused across calls, so never move generation into a retry path.
    const body = buildOrder({ symbol, side, type, config });

    try {
      const order = await rh.post('/api/v1/crypto/trading/orders/', body);
      guard.recordPlaced(intent);
      return ok(order);
    } catch (error) {
      return fail(`order rejected: ${error.summary ?? error.message}`);
    }
  },
);

server.registerTool(
  'get_order_status',
  {
    title: 'Get order status',
    description: 'Current state, fill quantity, and average price for one order.',
    inputSchema: { order_id: z.string().uuid() },
  },
  async ({ order_id }) => {
    const order = await getOrder(rh, order_id);
    return order ? ok(order) : fail(`order ${order_id} not found`);
  },
);

server.registerTool(
  'cancel_crypto_order',
  {
    title: 'Cancel a crypto order',
    description: 'Submit a cancel request. Cancellation is requested, not guaranteed; re-check status afterwards.',
    inputSchema: { order_id: z.string().uuid() },
  },
  async ({ order_id }) => ok({ result: await cancelOrder(rh, order_id) }),
);

await server.connect(new StdioServerTransport());
process.stderr.write('robinhood-crypto MCP server 1.0.0 ready on stdio\n');
