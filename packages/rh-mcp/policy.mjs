/**
 * robinhood-toolkit · client-side policy guard for agent-initiated writes
 * Author: nirholas · https://github.com/nirholas/robinhood-toolkit
 * License: All Rights Reserved (c) 2026 nirholas
 */
import { readFile } from 'node:fs/promises';

export class PolicyViolation extends Error {
  constructor(rule, detail) {
    super(`policy violation [${rule}]: ${detail}`);
    this.name = 'PolicyViolation';
    this.rule = rule;
  }
}

export async function loadPolicy(path = 'config/agent-policy.json') {
  const policy = JSON.parse(await readFile(path, 'utf8'));
  for (const key of ['max_order_notional_usd', 'max_orders_per_day']) {
    if (!(Number(policy[key]) > 0)) throw new Error(`policy is missing a positive ${key}`);
  }
  return policy;
}

/** Tracks per-day counters in memory. Persist it if your process restarts often. */
export class PolicyGuard {
  #ordersToday = 0;
  #day = new Date().toISOString().slice(0, 10);

  constructor(policy, { auditLog = console.log } = {}) {
    this.policy = policy;
    this.auditLog = auditLog;
  }

  #rollDay() {
    const today = new Date().toISOString().slice(0, 10);
    if (today !== this.#day) {
      this.#day = today;
      this.#ordersToday = 0;
    }
  }

  /**
   * @param intent {{tool, symbol, side, notionalUsd, portfolioValueUsd, simulated}}
   * Throws PolicyViolation, or returns the intent unchanged.
   */
  check(intent) {
    this.#rollDay();
    const p = this.policy;

    if (Array.isArray(p.allowed_symbols) && !p.allowed_symbols.includes(intent.symbol)) {
      throw new PolicyViolation('allowed_symbols', `${intent.symbol} is not on the allow list`);
    }
    if (!(Number(intent.notionalUsd) > 0)) {
      throw new PolicyViolation('notional', 'order notional must be a positive number');
    }
    if (Number(intent.notionalUsd) > Number(p.max_order_notional_usd)) {
      throw new PolicyViolation(
        'max_order_notional_usd',
        `${intent.notionalUsd} exceeds ${p.max_order_notional_usd}`,
      );
    }
    if (this.#ordersToday >= Number(p.max_orders_per_day)) {
      throw new PolicyViolation('max_orders_per_day', `already placed ${this.#ordersToday} today`);
    }
    if (p.require_simulation_before_write && intent.simulated !== true) {
      throw new PolicyViolation('require_simulation_before_write', 'run the review tool first');
    }
    if (p.max_position_concentration && intent.portfolioValueUsd > 0) {
      const share = Number(intent.notionalUsd) / Number(intent.portfolioValueUsd);
      if (share > Number(p.max_position_concentration)) {
        throw new PolicyViolation(
          'max_position_concentration',
          `${(share * 100).toFixed(1)}% exceeds ${(p.max_position_concentration * 100).toFixed(1)}%`,
        );
      }
    }
    return intent;
  }

  /** Call after a write actually succeeds, so failed attempts do not consume budget. */
  recordPlaced(intent) {
    this.#rollDay();
    this.#ordersToday += 1;
    this.auditLog(
      JSON.stringify({
        at: new Date().toISOString(),
        event: 'order_placed',
        tool: intent.tool,
        symbol: intent.symbol,
        side: intent.side,
        notional_usd: intent.notionalUsd,
        orders_today: this.#ordersToday,
      }),
    );
  }

  get ordersToday() {
    this.#rollDay();
    return this.#ordersToday;
  }
}

/**
 * Wrap an MCP client so every write passes the guard. Read tools pass through.
 * `writeTools` comes from your prompt-03 snapshot, not from a guess.
 */
export function guardClient(client, guard, { writeTools }) {
  const original = client.callTool.bind(client);
  client.callTool = async (params, ...rest) => {
    if (!writeTools.has(params.name)) return original(params, ...rest);

    const intent = {
      tool: params.name,
      symbol: params.arguments?.symbol,
      side: params.arguments?.side,
      notionalUsd: params.arguments?.notional_usd ?? params.arguments?.quote_amount,
      portfolioValueUsd: guard.policy.agentic_account_funded_usd,
      simulated: params.arguments?.__simulated === true,
    };
    guard.check(intent);
    const result = await original(params, ...rest);
    guard.recordPlaced(intent);
    return result;
  };
  return client;
}
