<!-- built by nirholas x.com/nichxbt -->
<!--
  robinhood-toolkit · build prompt: Agentic account setup and guardrails
  Author: nirholas · https://github.com/nirholas/robinhood-toolkit
  License: All Rights Reserved (c) 2026 nirholas
-->

# 04 · Agentic account setup and guardrails

## Goal

Open and fund the Agentic account, then build the guardrail layer that sits
between your agent and any write tool. The account boundary is the only limit
Robinhood enforces for you. Everything finer-grained is yours to build.

## Prerequisites

- Prompt 01 or 02: an authenticated MCP connection.
- Prompt 03: a tool snapshot, so you know which tools are writes.
- A desktop device. The Agentic account cannot be opened from mobile.

## Reference facts

| Fact | Value |
|---|---|
| Read scope | All your Robinhood accounts: positions, balances, portfolio, orders, transactions, and account numbers |
| Write scope | Confined to the funded Agentic account |
| Assets today | Long equities and options orders |
| Crypto | Announced, not live. Rolling out to eligible US traders at no additional cost |
| Simulation tool | `review_equity_order` simulates an order and returns pre-trade warnings |

The asymmetry is the point of this file: **reads are broad, writes are narrow**.
Connecting an agent exposes your whole Robinhood read surface to a third-party
model provider while limiting order placement to one ring-fenced account. Size
the account accordingly, and understand that the read exposure is not reduced by
funding the account with less.

Robinhood's own statements you should design around:

- Robinhood does **not** control, supervise, monitor, recommend, or audit
  connected agents.
- Once your data reaches the agent it has left Robinhood's security environment
  and is governed by that provider's terms, not Robinhood's.
- Agents can make errors, misinterpret instructions, act on incomplete or
  outdated information, and behave in unexpected ways.
- Agentic strategies can move quickly and be difficult to monitor or stop in real
  time.

Two consequences worth stating plainly. First, there is no server-side per-trade
limit you can configure to save you; the funded balance is the blast radius.
Second, the agent only acts while its host is running, so an unattended strategy
requires you to keep a process alive, which also means an unattended failure runs
unattended.

UNVERIFIED: whether Robinhood exposes configurable per-order or per-day limits on
the Agentic account beyond the funded balance. Check your account settings during
setup and record what you find. Build the client-side guardrails below regardless,
because they run before the request leaves your machine.

## Steps

1. Open the Agentic account. Robinhood prompts you during or immediately after
   MCP authentication on desktop. It requires a primary account in good standing.
   You can hold at most 10 self-directed individual accounts.

2. Fund it deliberately. Write the number down before you transfer, and pick it
   as "the amount I am willing to lose to a model error", not "the amount I want
   to trade with". These are different numbers.

3. Record the boundary in your project so it is reviewable:

```json
{
  "agentic_account_funded_usd": 500,
  "max_order_notional_usd": 50,
  "max_orders_per_day": 10,
  "max_position_concentration": 0.25,
  "allowed_symbols": ["BTC-USD", "ETH-USD"],
  "require_simulation_before_write": true,
  "reviewed_on": "2026-07-20"
}
```

Save as `config/agent-policy.json`.

4. Build the guardrail layer. This is the deliverable that matters.
   `packages/rh-mcp/policy.mjs`:

```js
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
```

5. Wire the simulation requirement to a real tool. If your prompt-03 snapshot
   contains `review_equity_order` or an equivalent review tool for the order path
   you are using, call it first and require it to return without blocking
   warnings before the write is allowed. If no review tool exists for a given
   path, treat that path as higher risk and lower its notional cap rather than
   dropping the requirement.

6. Know how to stop. Write down, in `docs/mcp/kill-switch.md`, the exact steps
   in order: stop the host process, disconnect the MCP server from the host
   config, and revoke access from the Robinhood side. Test each one before you
   need it, not during an incident.

## Deliverable

- A funded Agentic account with the amount recorded
- `config/agent-policy.json`
- `packages/rh-mcp/policy.mjs` exporting `loadPolicy`, `PolicyGuard`,
  `guardClient`, `PolicyViolation`
- `docs/mcp/kill-switch.md` with tested steps
- Tests for every policy rule, offline

## How to verify

```sh
node --test packages/rh-mcp/policy.test.mjs
```

The tests must prove each rule rejects:

```js
import { strict as assert } from 'node:assert';
import test from 'node:test';
import { PolicyGuard, PolicyViolation } from './policy.mjs';

const policy = {
  agentic_account_funded_usd: 500,
  max_order_notional_usd: 50,
  max_orders_per_day: 2,
  max_position_concentration: 0.25,
  allowed_symbols: ['BTC-USD'],
  require_simulation_before_write: true,
};
const ok = { tool: 'x', symbol: 'BTC-USD', side: 'buy', notionalUsd: 10, portfolioValueUsd: 500, simulated: true };

test('accepts a compliant intent', () => {
  assert.doesNotThrow(() => new PolicyGuard(policy, { auditLog() {} }).check(ok));
});

test('rejects an off-list symbol', () => {
  const guard = new PolicyGuard(policy, { auditLog() {} });
  assert.throws(() => guard.check({ ...ok, symbol: 'DOGE-USD' }), PolicyViolation);
});

test('rejects an oversized order', () => {
  const guard = new PolicyGuard(policy, { auditLog() {} });
  assert.throws(() => guard.check({ ...ok, notionalUsd: 51 }), /max_order_notional_usd/);
});

test('rejects an unsimulated write', () => {
  const guard = new PolicyGuard(policy, { auditLog() {} });
  assert.throws(() => guard.check({ ...ok, simulated: false }), /require_simulation_before_write/);
});

test('daily count only advances on success', () => {
  const guard = new PolicyGuard(policy, { auditLog() {} });
  guard.check(ok);
  assert.equal(guard.ordersToday, 0, 'checking must not consume budget');
  guard.recordPlaced(ok);
  guard.recordPlaced(ok);
  assert.throws(() => guard.check(ok), /max_orders_per_day/);
});

test('rejects excessive concentration', () => {
  const guard = new PolicyGuard(policy, { auditLog() {} });
  assert.throws(() => guard.check({ ...ok, notionalUsd: 49, portfolioValueUsd: 100 }), /concentration/);
});
```

Live: confirm the Agentic account appears separately from your main account, and
confirm your agent's reads span all accounts while a write attempt outside the
Agentic account is rejected by Robinhood.

## Gotchas

- **The funded balance is the only limit Robinhood enforces.** Everything in
  `policy.mjs` runs on your machine and can be bypassed by any code path that
  calls the tool directly. Guardrails constrain your own agent, not an attacker
  and not a mistake in another script holding the same token.
- **A prompt is not a guardrail.** "Never spend more than 50 dollars" in a system
  prompt is a suggestion to a model that Robinhood explicitly does not supervise.
  Enforce in code, before the call.
- **Checking must not consume budget.** If `check()` increments the counter, a
  run of rejected intents exhausts the day's allowance and the failure looks like
  a limit bug. Increment only after the write succeeds.
- **Reads are not narrowed by funding less.** The read scope covers all accounts
  and account numbers regardless of the Agentic balance. If broad read exposure to
  a model provider is unacceptable, the mitigation is not connecting, not funding
  less.
- **Day rollover needs handling.** A guard that computes the day once at
  construction never resets in a long-lived process. `#rollDay` is called on every
  check for that reason.
- **In-memory counters reset on restart.** A crash loop can multiply your daily
  order allowance. Persist the counter if the process is not stable.
- **Test the kill switch before you need it.** Stopping the host, disconnecting
  the server, and revoking access are three different actions with three different
  latencies. Know which one is fastest.
- **Crypto is not live on this rail yet.** Do not build an Agentic crypto policy
  and assume it is being enforced against real crypto orders today. Prompt 06
  covers detecting the rollout at runtime.
<!-- built by nirholas x.com/nichxbt -->
