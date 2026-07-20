<!--
  robinhood-toolkit · build prompt: your own crypto MCP server
  Author: nirholas · https://github.com/nirholas/robinhood-toolkit
  License: MIT (c) 2026 nirholas
-->

# 07 · Build your own crypto MCP server

## Goal

Build an MCP server that exposes the Robinhood Crypto Trading REST API as tools,
so any MCP host (Claude Code, Claude Desktop, Cursor, ChatGPT, Codex, Grok) can
trade crypto through an agent **today**, without waiting for agentic crypto to
land on Robinhood's own MCP server.

This is the crypto agent path that works right now. Robinhood's Trading MCP
covers long equities and options today; the Crypto REST API covers crypto today.
This server bridges the two.

## Prerequisites

- Track 20 complete. This server is a thin MCP surface over
  `packages/rh-crypto/`, and every safety property comes from there.
- Prompt 04's policy guard, which this server enforces server-side.
- Node 20 or newer.

## Reference facts

Verified 2026-07-20 by running the round trip described below.

| Fact | Value |
|---|---|
| SDK | `@modelcontextprotocol/sdk` 1.29.0 |
| Schema library | `zod` 4.4.3 |
| Server class | `McpServer` from `@modelcontextprotocol/sdk/server/mcp.js` |
| Local transport | `StdioServerTransport` from `.../server/stdio.js` |
| Tool registration | `server.registerTool(name, { title, description, inputSchema }, handler)` |

`inputSchema` is an object of Zod validators keyed by parameter name. The SDK
converts it to JSON Schema draft-07 automatically. Verified output for a single
required string parameter:

```json
{"type":"object","properties":{"msg":{"type":"string"}},"required":["msg"],"$schema":"http://json-schema.org/draft-07/schema#"}
```

Handlers return `{ content: [{ type: 'text', text: '...' }] }`. To signal a
logical failure, return `{ isError: true, content: [...] }` rather than throwing.
This is the same contract prompt 05 taught you to consume: an agent that only
catches exceptions will otherwise treat a rejected order as filled.

Design constraint worth stating up front: **the agent is untrusted input.** A
model chooses these arguments, and it may be reasoning over market commentary,
token metadata, or web content that an attacker controls. Guardrails belong in
the server, where the agent cannot skip them, not in the prompt.

## Steps

1. Scaffold:

```sh
mkdir -p packages/rh-crypto-mcp
cd packages/rh-crypto-mcp
npm init -y
npm install @modelcontextprotocol/sdk zod
```

Set `"type": "module"` in the package's `package.json`.

2. Write `packages/rh-crypto-mcp/server.mjs`:

```js
#!/usr/bin/env node
/**
 * robinhood-toolkit · MCP server exposing the Robinhood Crypto Trading API
 * Author: nirholas · https://github.com/nirholas/robinhood-toolkit
 * License: MIT (c) 2026 nirholas
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
    const body = buildOrder({ symbol, side, type, config });

    try {
      const order = await rh.requestWithPolicy('POST', '/api/v1/crypto/trading/orders/', {
        body,
        idempotent: true,
      });
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
```

3. Register the server with a host. Claude Code:

```sh
claude mcp add robinhood-crypto -- node /absolute/path/to/packages/rh-crypto-mcp/server.mjs
```

Claude Desktop or Cursor, in the JSON config:

```json
{
  "mcpServers": {
    "robinhood-crypto": {
      "command": "node",
      "args": ["/absolute/path/to/packages/rh-crypto-mcp/server.mjs"],
      "env": {
        "RH_API_KEY": "rh-api-...",
        "RH_PRIVATE_KEY": "...",
        "RH_POLICY_PATH": "/absolute/path/to/config/agent-policy.json"
      }
    }
  }
}
```

4. Write the automated round-trip test,
   `packages/rh-crypto-mcp/roundtrip.test.mjs`. It drives your server with a real
   MCP client over stdio, which is the only way to prove the wire contract:

```js
/**
 * robinhood-toolkit · MCP round-trip test for the crypto server
 * Author: nirholas · https://github.com/nirholas/robinhood-toolkit
 * License: MIT (c) 2026 nirholas
 */
import { strict as assert } from 'node:assert';
import test from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

test('server advertises its tools and enforces confirmation', async () => {
  const client = new Client({ name: 'roundtrip', version: '1.0.0' });
  await client.connect(
    new StdioClientTransport({ command: 'node', args: ['packages/rh-crypto-mcp/server.mjs'] }),
  );

  const { tools } = await client.listTools();
  const names = tools.map((t) => t.name).sort();
  assert.deepEqual(names, [
    'cancel_crypto_order',
    'estimate_order_cost',
    'get_order_status',
    'get_portfolio',
    'get_quote',
    'list_trading_pairs',
    'place_crypto_order',
    'review_crypto_order',
  ]);

  const place = tools.find((t) => t.name === 'place_crypto_order');
  assert.ok(place.inputSchema.required.includes('confirmed'), 'confirmation must be required');

  // A read is safe to exercise live.
  const pairs = await client.callTool({ name: 'list_trading_pairs', arguments: { symbols: ['BTC-USD'] } });
  assert.equal(pairs.isError, undefined);

  await client.close();
});
```

5. Write `packages/rh-crypto-mcp/README.md`: what the server exposes, how to
   register it on each host, the env vars it needs, the policy file it enforces,
   and a worked example of review-then-place.

## Deliverable

- `packages/rh-crypto-mcp/server.mjs`, executable, with eight tools
- `packages/rh-crypto-mcp/roundtrip.test.mjs`
- `packages/rh-crypto-mcp/README.md`
- Host registration snippets for Claude Code and at least one JSON-config host

## How to verify

```sh
node --test packages/rh-crypto-mcp/roundtrip.test.mjs
```

Then verify by hand through a host. In Claude Code, ask the agent to:

1. List BTC-USD trading pair details. It must return real increments.
2. Review a buy of the minimum size. It must return an estimated notional and a
   policy decision, and it must not place anything.
3. Review a buy of ten times your `max_order_notional_usd`. It must return
   `would_be_rejected: true` with the policy rule named.
4. Attempt `place_crypto_order` without `confirmed`. It must fail with the
   confirmation message.
5. Place a real minimum-size order with `confirmed: true`, then read
   `get_order_status`. Cross-check the fill in the Robinhood app.

Confirm the audit lines appear on stderr for every placed order, and that no
credential appears in them.

## Gotchas

- **Never log to stdout in a stdio MCP server.** Stdout is the JSON-RPC channel. A
  stray `console.log` corrupts the stream and the host reports an unhelpful parse
  error. The audit logger above writes to stderr for exactly this reason.
- **Return `isError`, do not throw.** A thrown error surfaces as a protocol-level
  failure with no useful text for the model. `fail()` gives the agent a message it
  can act on, and matches what prompt 05 consumes.
- **The agent is untrusted input.** Arguments come from a model that may be
  reasoning over attacker-influenced text: market commentary, token names, web
  pages. Validate in the server and enforce policy in the server. A system prompt
  is not an access control.
- **Require an explicit `confirmed: true`.** A literal-typed required field means
  the model must make a deliberate second decision to spend money. Do not default
  it to true, and do not accept a truthy string.
- **Generate `client_order_id` once.** `buildOrder` does this. If you move ID
  generation into a retry path, an agent retry becomes two real orders. This is
  the same failure mode as prompt 07 in track 20, and it is worse here because the
  retry may be a model decision rather than a code path you wrote.
- **Policy counters live in the server process.** Restarting the server resets the
  daily count. If the host restarts your server frequently, persist the counter to
  disk.
- **Credentials go in the host config env block or the environment, never in the
  tool schema.** Never expose a tool that accepts an API key as a parameter; a
  model would then be able to log or forward it.
- **This server is not Robinhood's.** You are responsible for it. Robinhood does
  not supervise, monitor, or audit agents, and that includes this one. The
  guardrails you write here are the only ones running.
- **Keep the tool surface small and legible.** Every extra write tool is another
  path a confused model can take. Eight tools with one confirmation gate is easier
  to reason about than thirty convenience wrappers.
