<!--
  robinhood-toolkit · rh-crypto-mcp package readme
  Author: nirholas · https://github.com/nirholas/robinhood-toolkit
  License: All Rights Reserved (c) 2026 nirholas
-->

# rh-crypto-mcp

An MCP server that exposes the [Robinhood Crypto Trading REST API](https://docs.robinhood.com/crypto/trading/) as tools, so any MCP host — Claude Code, Claude Desktop, Cursor, ChatGPT, Codex, Grok — can trade crypto through an agent **today**, without waiting for agentic crypto to land on Robinhood's own MCP server.

Robinhood's Trading MCP covers long equities and options today; the Crypto REST API covers crypto today. This server bridges the two. It is a thin MCP surface over [`packages/rh-crypto/`](../rh-crypto/); every safety property comes from there and from the server-side policy guard in [`packages/rh-mcp/policy.mjs`](../rh-mcp/policy.mjs).

> **This server is not Robinhood's.** You are responsible for it. Robinhood does not supervise, monitor, or audit agents, and that includes this one. The guardrails written here are the only ones running.

## Tools

| Tool | Kind | What it does |
|---|---|---|
| `list_trading_pairs` | read | Tradable pairs with size limits and increments. Use before sizing any order. |
| `get_quote` | read | Best bid/ask for one or more pairs. Size-agnostic. |
| `estimate_order_cost` | read | Size-aware price estimate. `ask` estimates a buy, `bid` a sell. |
| `get_portfolio` | read | Cash, holdings, and mark-to-market value. |
| `review_crypto_order` | read | Simulate an order: estimated cost, policy decision, warnings. **Never places anything.** |
| `place_crypto_order` | **write** | Place a real order that spends real money. Requires `confirmed: true`. |
| `get_order_status` | read | State, fill quantity, and average price for one order. |
| `cancel_crypto_order` | write | Request a cancel. Cancellation is requested, not guaranteed. |

Eight tools with one confirmation gate — deliberately small. Every extra write tool is another path a confused model can take.

## Safety model

**The agent is untrusted input.** A model chooses these arguments, and it may be reasoning over market commentary, token metadata, or web content an attacker controls. Every guardrail lives in the server, where the agent cannot skip it — not in a system prompt, which is not an access control.

- **Server-side policy guard.** Every simulated and real write passes [`PolicyGuard.check`](../rh-mcp/policy.mjs), which enforces `allowed_symbols`, `max_order_notional_usd`, `max_orders_per_day`, `max_position_concentration`, and `require_simulation_before_write` from your policy file.
- **Explicit confirmation.** `place_crypto_order` requires a literal `confirmed: true` field. The model must make a deliberate second decision to spend money. It is never defaulted true and a truthy string will not pass.
- **`isError`, not exceptions.** Logical failures return `{ isError: true, content: [...] }` with a message the agent can act on. An agent that only catches exceptions would otherwise treat a rejected order as filled.
- **One `client_order_id` per order.** It is generated once inside `buildOrder` and never regenerated in a retry path, so a retry is a new order by design, not a silent double-spend.
- **Audit log to stderr.** Every placed order writes a JSON audit line to stderr — never stdout, which is the JSON-RPC channel — and no credential ever appears in it.

## Environment

Credentials go in the host config env block or the process environment, **never in a tool schema.** No tool accepts an API key as a parameter.

| Var | Required | Default | Meaning |
|---|---|---|---|
| `RH_API_KEY` | yes | — | Robinhood Crypto API key (`rh-api-...`). |
| `RH_PRIVATE_KEY` | yes | — | Base64 32-byte Ed25519 seed. Generate with `npm run keygen` in `packages/rh-crypto`. |
| `RH_POLICY_PATH` | no | `config/agent-policy.json` | Path to the policy file the guard enforces. |

The policy counters (orders placed today) live in the server process. Restarting the server resets the daily count; if your host restarts the server frequently, persist the counter to disk.

## Register with a host

### Claude Code

```sh
claude mcp add robinhood-crypto \
  --env RH_API_KEY=rh-api-... \
  --env RH_PRIVATE_KEY=... \
  --env RH_POLICY_PATH=/absolute/path/to/config/agent-policy.json \
  -- node /absolute/path/to/packages/rh-crypto-mcp/server.mjs
```

### Claude Desktop / Cursor (JSON config)

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

Use absolute paths. The server resolves its policy path relative to the process working directory, which a host does not guarantee — always pass `RH_POLICY_PATH` as an absolute path.

## Worked example: review, then place

The intended flow is always review first, then place with the reviewed numbers.

```jsonc
// 1. Review a minimum-size buy. Nothing is placed.
review_crypto_order  { "symbol": "BTC-USD", "side": "buy", "asset_quantity": 0.0001 }
// ->
{
  "symbol": "BTC-USD",
  "side": "buy",
  "quantity": "0.0001",
  "estimated_price": "...",
  "estimated_notional_usd": 6.12,
  "policy": "allowed",
  "orders_placed_today": 0,
  "warnings": [],
  "would_be_rejected": false
}

// 2. Place it. `confirmed: true` is mandatory.
place_crypto_order  { "symbol": "BTC-USD", "side": "buy", "type": "market",
                      "asset_quantity": 0.0001, "confirmed": true }
// -> the real order object; an audit line is written to stderr.

// 3. Read the fill.
get_order_status  { "order_id": "..." }
```

A review that exceeds a policy limit returns `would_be_rejected: true` with the rule named, and `place_crypto_order` returns `isError` with the same message — the guard runs identically in both.

## Verify

```sh
node --test packages/rh-crypto-mcp/roundtrip.test.mjs
```

The round-trip test drives the server with a real MCP client over stdio — the only way to prove the wire contract. It needs live credentials to start the authenticated client, and skips cleanly when `RH_API_KEY` / `RH_PRIVATE_KEY` are unset so CI stays green.

Then verify by hand through a host. Ask the agent to:

1. List BTC-USD trading pair details — it must return real increments.
2. Review a buy of the minimum size — an estimated notional and a policy decision, and it must not place anything.
3. Review a buy of ten times your `max_order_notional_usd` — `would_be_rejected: true` with the policy rule named.
4. Attempt `place_crypto_order` without `confirmed` — it must fail with the confirmation message.
5. Place a real minimum-size order with `confirmed: true`, then read `get_order_status`, and cross-check the fill in the Robinhood app.

Confirm the audit lines appear on stderr for every placed order, and that no credential appears in them.

## Gotchas

- **Never log to stdout in a stdio MCP server.** Stdout is the JSON-RPC channel; a stray `console.log` corrupts the stream. The audit logger writes to stderr for exactly this reason.
- **Return `isError`, do not throw.** A thrown error surfaces as a protocol-level failure with no useful text for the model.
- **The agent is untrusted input.** Validate and enforce policy in the server. A system prompt is not access control.
- **Require an explicit `confirmed: true`.** Do not default it, and do not accept a truthy string.
- **Generate `client_order_id` once.** Moving ID generation into a retry path turns an agent retry into two real orders.

## License

All Rights Reserved © 2026 nirholas
