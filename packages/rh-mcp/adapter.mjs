/**
 * robinhood-toolkit · schema-driven adapter for the Robinhood Trading MCP
 * Author: nirholas · https://github.com/nirholas/robinhood-toolkit
 * License: MIT (c) 2026 nirholas
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
 * Does this tool's schema look like it accepts a crypto pair such as BTC-USD?
 * Detection is by schema shape, not by tool name, because no crypto tool name is
 * published. See prompts/30-agentic-mcp/06-prepare-for-crypto-rollout.md.
 */
export function acceptsCryptoPair(tool) {
  const properties = tool.inputSchema?.properties ?? {};
  const symbol = properties.symbol ?? properties.pair ?? properties.currency_pair;
  if (!symbol) return false;

  // An explicit enum is the strongest signal available.
  if (Array.isArray(symbol.enum)) return symbol.enum.some((v) => /^[A-Z]{2,10}-[A-Z]{3,5}$/.test(v));

  const hints = `${tool.name} ${tool.description ?? ''} ${symbol.description ?? ''}`;
  if (/crypto|BTC|ETH|-USD pair|currency pair/i.test(hints)) return true;
  if (Array.isArray(properties.asset_class?.enum)) {
    return properties.asset_class.enum.some((v) => /crypto/i.test(v));
  }
  return false;
}

/**
 * Crypto capabilities, defined by schema shape rather than by name. Merged into
 * CAPABILITIES below so `adapter.has('cryptoPlaceOrder')` works with no other
 * changes once the agentic crypto surface appears on the account.
 */
export const CRYPTO_CAPABILITIES = {
  cryptoPlaceOrder: (t) => acceptsCryptoPair(t) && /place|submit|buy|sell|trade|order/i.test(t.name) && !/cancel|review|simulate/i.test(t.name),
  cryptoReviewOrder: (t) => acceptsCryptoPair(t) && /review|simulate|preview|validate/i.test(t.name),
  cryptoCancelOrder: (t) => acceptsCryptoPair(t) && /cancel/i.test(t.name),
  cryptoPositions: (t) => /crypto/i.test(`${t.name} ${t.description ?? ''}`) && /position|holding|balance/i.test(t.name),
};

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
  ...CRYPTO_CAPABILITIES,
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
