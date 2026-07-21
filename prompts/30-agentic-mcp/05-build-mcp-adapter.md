<!--
  robinhood-toolkit · build prompt: schema-driven MCP adapter
  Author: nirholas · https://github.com/nirholas/robinhood-toolkit
  License: All Rights Reserved (c) 2026 nirholas
-->

# 05 · Build a schema-driven MCP adapter

## Goal

Build an adapter that binds to the Trading MCP's tools **from their advertised
schemas at runtime**, validates arguments before sending them, and gives your
application a stable interface that survives the server adding, renaming, or
changing tools.

## Prerequisites

- Prompt 03: `packages/rh-mcp/enumerate.mjs` and a tool snapshot.
- Prompt 04: `packages/rh-mcp/policy.mjs`.

## Reference facts

- Endpoint `https://agent.robinhood.com/mcp/trading`, streamable HTTP.
- Each `tools/list` entry carries `name`, `description`, and `inputSchema`, a
  JSON Schema object. `inputSchema.required` lists mandatory properties.
- Tool calls are `tools/call` with `{ name, arguments }`. In the SDK this is
  `client.callTool({ name, arguments })`.
- Results carry a `content` array and an `isError` boolean. **A tool that fails
  logically returns `isError: true` with an explanatory content block rather than
  throwing.** Code that only catches exceptions will treat a rejected order as a
  success.
- The full tool schema is unpublished. `review_equity_order` is the one
  documented name, described as simulating an order and returning pre-trade
  warnings.
- Today the server supports long equities and options orders. Crypto is announced
  and will run through this same endpoint.

The design consequence: do not write one method per known tool name. Write a
capability resolver that finds the tool matching a capability by inspecting the
live schema, and fails loudly when no tool satisfies it.

## Steps

1. Write the adapter, `packages/rh-mcp/adapter.mjs`:

```js
/**
 * robinhood-toolkit · schema-driven adapter for the Robinhood Trading MCP
 * Author: nirholas · https://github.com/nirholas/robinhood-toolkit
 * License: All Rights Reserved (c) 2026 nirholas
 */
import { connect, enumerateTools } from './enumerate.mjs';

export class ToolUnavailable extends Error {
  constructor(capability, available) {
    super(`no tool satisfies capability "${capability}". Available: ${available.join(', ') || 'none'}`);
    this.name = 'ToolUnavailable';
    this.capability = capability;
  }
}

export class ToolCallFailed extends Error {
  constructor(name, detail, result) {
    super(`tool ${name} failed: ${detail}`);
    this.name = 'ToolCallFailed';
    this.tool = name;
    this.result = result;
  }
}

/**
 * A capability is a predicate over a tool's advertised schema. This is what
 * makes the adapter survive renames: we match on shape and intent, not on a
 * hardcoded string.
 */
export const CAPABILITIES = {
  listPositions: (t) => /position|holding/i.test(t.name) && !isWrite(t),
  listAccounts: (t) => /account/i.test(t.name) && !isWrite(t),
  listOrders: (t) => /order/i.test(t.name) && /list|get|search|history/i.test(t.name) && !isWrite(t),
  reviewOrder: (t) => /review|simulate|preview|validate/i.test(t.name),
  placeOrder: (t) => /order/i.test(t.name) && isWrite(t) && !/cancel/i.test(t.name),
  cancelOrder: (t) => /cancel/i.test(t.name),
};

/** Heuristic write detection. Conservative: unknown counts as a write. */
export function isWrite(tool) {
  if (/^(get|list|read|fetch|search|review|simulate|preview)_/i.test(tool.name)) return false;
  return /place|submit|buy|sell|cancel|create|order|trade|execute/i.test(tool.name);
}

export class RobinhoodMCPAdapter {
  #tools = new Map();

  constructor({ client, tools, guard = null }) {
    this.client = client;
    this.guard = guard;
    for (const tool of tools) this.#tools.set(tool.name, tool);
  }

  static async open({ guard = null } = {}) {
    const client = await connect();
    const tools = await enumerateTools(client);
    return new RobinhoodMCPAdapter({ client, tools, guard });
  }

  get toolNames() {
    return [...this.#tools.keys()];
  }

  get writeTools() {
    return new Set(this.toolNames.filter((n) => isWrite(this.#tools.get(n))));
  }

  /** Resolve a capability to a concrete tool, or throw with what is available. */
  resolve(capability) {
    const predicate = CAPABILITIES[capability];
    if (!predicate) throw new Error(`unknown capability: ${capability}`);
    const match = [...this.#tools.values()].find(predicate);
    if (!match) throw new ToolUnavailable(capability, this.toolNames);
    return match;
  }

  has(capability) {
    try {
      this.resolve(capability);
      return true;
    } catch {
      return false;
    }
  }

  /** Validate arguments against the tool's advertised inputSchema. */
  validate(tool, args) {
    const schema = tool.inputSchema ?? {};
    const properties = schema.properties ?? {};
    const problems = [];

    for (const key of schema.required ?? []) {
      if (args[key] === undefined || args[key] === null) problems.push(`missing required "${key}"`);
    }
    for (const [key, value] of Object.entries(args)) {
      const spec = properties[key];
      if (!spec) {
        if (schema.additionalProperties === false) problems.push(`unknown argument "${key}"`);
        continue;
      }
      if (spec.type && !typeMatches(spec.type, value)) {
        problems.push(`"${key}" should be ${spec.type}, got ${typeof value}`);
      }
      if (Array.isArray(spec.enum) && !spec.enum.includes(value)) {
        problems.push(`"${key}" must be one of ${spec.enum.join(', ')}`);
      }
    }
    if (problems.length) throw new Error(`invalid arguments for ${tool.name}: ${problems.join('; ')}`);
    return args;
  }

  /**
   * Call a capability. Throws ToolCallFailed on isError so a logical failure
   * cannot be mistaken for success.
   */
  async call(capability, args = {}) {
    const tool = this.resolve(capability);
    this.validate(tool, args);

    if (this.guard && this.writeTools.has(tool.name)) {
      this.guard.check({
        tool: tool.name,
        symbol: args.symbol,
        side: args.side,
        notionalUsd: args.notional_usd ?? args.quote_amount ?? args.amount,
        portfolioValueUsd: this.guard.policy.agentic_account_funded_usd,
        simulated: args.__simulated === true,
      });
    }

    const { __simulated, ...toolArgs } = args;
    const result = await this.client.callTool({ name: tool.name, arguments: toolArgs });

    if (result.isError) {
      throw new ToolCallFailed(tool.name, textOf(result), result);
    }
    if (this.guard && this.writeTools.has(tool.name)) {
      this.guard.recordPlaced({ tool: tool.name, symbol: args.symbol, side: args.side, notionalUsd: args.notional_usd });
    }
    return result;
  }

  /** Review then place, refusing to place if review is unavailable. */
  async reviewThenPlace(orderArgs) {
    if (!this.has('reviewOrder')) {
      throw new ToolUnavailable('reviewOrder', this.toolNames);
    }
    const review = await this.call('reviewOrder', orderArgs);
    return { review, place: () => this.call('placeOrder', { ...orderArgs, __simulated: true }) };
  }

  async close() {
    await this.client.close();
  }
}

function typeMatches(type, value) {
  switch (type) {
    case 'string':
      return typeof value === 'string';
    case 'number':
    case 'integer':
      return typeof value === 'number';
    case 'boolean':
      return typeof value === 'boolean';
    case 'array':
      return Array.isArray(value);
    case 'object':
      return value !== null && typeof value === 'object' && !Array.isArray(value);
    default:
      return true;
  }
}

export function textOf(result) {
  return (result.content ?? [])
    .filter((c) => c.type === 'text')
    .map((c) => c.text)
    .join('\n')
    .trim();
}
```

2. Write a capability report so you can see what your account actually supports:

```js
/**
 * robinhood-toolkit · report which capabilities the live MCP surface satisfies
 * Author: nirholas · https://github.com/nirholas/robinhood-toolkit
 * License: All Rights Reserved (c) 2026 nirholas
 */
import { CAPABILITIES, RobinhoodMCPAdapter } from '../packages/rh-mcp/adapter.mjs';

const adapter = await RobinhoodMCPAdapter.open();
console.log(`${adapter.toolNames.length} tools advertised\n`);

for (const capability of Object.keys(CAPABILITIES)) {
  if (adapter.has(capability)) {
    console.log(`  yes  ${capability.padEnd(16)} -> ${adapter.resolve(capability).name}`);
  } else {
    console.log(`  no   ${capability}`);
  }
}

console.log(`\nclassified as writes: ${[...adapter.writeTools].join(', ') || 'none'}`);
await adapter.close();
```

Save as `examples/mcp-capabilities.mjs`.

3. Review the write classification by hand. `isWrite` is a heuristic and it is
   deliberately conservative, but a misclassification in the safe direction only
   costs you an unnecessary guard check, while one in the unsafe direction skips
   your guardrails entirely. Print `adapter.writeTools`, compare it against your
   prompt-03 snapshot descriptions, and pin an explicit override list for any tool
   the heuristic gets wrong:

```js
const EXPLICIT_WRITES = new Set(['review_equity_order' /* if your snapshot shows it mutates */]);
```

## Deliverable

- `packages/rh-mcp/adapter.mjs` exporting `RobinhoodMCPAdapter`, `CAPABILITIES`,
  `isWrite`, `textOf`, `ToolUnavailable`, `ToolCallFailed`
- `examples/mcp-capabilities.mjs`
- Offline tests over fixture tool lists taken from your snapshot
- A section in `packages/rh-mcp/README.md` explaining the capability model and
  why the adapter does not name tools directly

## How to verify

```sh
node --test packages/rh-mcp/adapter.test.mjs
node examples/mcp-capabilities.mjs
```

The offline test must construct an adapter from a fixture list, with no network:

```js
import { strict as assert } from 'node:assert';
import test from 'node:test';
import { RobinhoodMCPAdapter, ToolCallFailed, ToolUnavailable } from './adapter.mjs';

const fixture = [
  {
    name: 'review_equity_order',
    description: 'Simulate an order and return pre-trade warnings.',
    inputSchema: {
      type: 'object',
      required: ['symbol', 'side'],
      properties: { symbol: { type: 'string' }, side: { type: 'string', enum: ['buy', 'sell'] } },
    },
  },
];

function adapterWith(tools, callTool) {
  return new RobinhoodMCPAdapter({ client: { callTool, close: async () => {} }, tools });
}

test('resolves a capability by schema, not by hardcoded name', () => {
  const a = adapterWith(fixture, async () => ({ content: [] }));
  assert.equal(a.resolve('reviewOrder').name, 'review_equity_order');
});

test('missing capability throws with the available list', () => {
  const a = adapterWith(fixture, async () => ({ content: [] }));
  assert.throws(() => a.resolve('cancelOrder'), ToolUnavailable);
  assert.equal(a.has('cancelOrder'), false);
});

test('rejects arguments the schema does not allow', async () => {
  const a = adapterWith(fixture, async () => ({ content: [] }));
  await assert.rejects(a.call('reviewOrder', { symbol: 'AAPL' }), /missing required "side"/);
  await assert.rejects(a.call('reviewOrder', { symbol: 'AAPL', side: 'hold' }), /must be one of buy, sell/);
});

test('isError becomes an exception, not a silent success', async () => {
  const a = adapterWith(fixture, async () => ({
    isError: true,
    content: [{ type: 'text', text: 'Insufficient buying power.' }],
  }));
  await assert.rejects(a.call('reviewOrder', { symbol: 'AAPL', side: 'buy' }), ToolCallFailed);
});
```

Live, `examples/mcp-capabilities.mjs` must print a real tool count and a
capability table. Any capability reported `no` is a genuine gap in what your
account can do today, not a bug in the adapter, and should be handled by prompt 06.

## Gotchas

- **`isError: true` does not throw.** This is the highest-value gotcha in this
  file. An MCP tool reporting "insufficient buying power" returns a normal
  response with `isError` set. A `try`/`catch` around `callTool` catches nothing
  and your code proceeds as if the order succeeded. The adapter converts it.
- **Do not bind methods to tool names.** A `placeEquityOrder()` method hardcodes
  a name that is unpublished and subject to change. Capabilities resolve at
  runtime and fail loudly when unsatisfied.
- **The write heuristic is a heuristic.** Review `adapter.writeTools` against the
  real descriptions and maintain an explicit override set. Guarding a read
  costs nothing; missing a write costs money.
- **Validate before sending, not after.** The server's error for a malformed
  argument may be generic. Local validation against `inputSchema` names the exact
  field, which matters when a model generated the arguments.
- **`__simulated` is a local convention, not a wire field.** The adapter strips
  it before the call. If you forget to strip a local flag, servers with
  `additionalProperties: false` reject the whole call.
- **A capability resolving does not mean it works for your account.** Tool
  availability can depend on account state. Resolution proves the tool is
  advertised; only a call proves it is usable.
- **Guard checks belong inside the adapter.** If the guard lives only at the
  application layer, any other code path holding the client bypasses it. Putting
  it in `call()` means everything routed through the adapter is covered.
