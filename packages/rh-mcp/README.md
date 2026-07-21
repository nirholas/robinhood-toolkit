<!--
  robinhood-toolkit · rh-mcp package readme
  Author: nirholas · https://github.com/nirholas/robinhood-toolkit
  License: All Rights Reserved (c) 2026 nirholas
-->

# rh-mcp

Client-side tooling for a **Robinhood Trading MCP** connection. Two concerns
live here:

- **Tool-surface discovery** — [enumerate.mjs](enumerate.mjs) and
  [check-drift.mjs](check-drift.mjs) discover, at runtime, exactly which tools
  the server offers *your* account and write a dated, diffable snapshot.
- **Policy guardrails** — [policy.mjs](policy.mjs) and [adapter.mjs](adapter.mjs)
  enforce client-side limits on agent-initiated writes. See the guardrails
  section below.

This document is primarily about regenerating the tool snapshot.

---

## Why enumerate at runtime

Robinhood has not published the full Trading MCP tool schema, and the surface is
**account-specific** — what the server advertises depends on your account state,
jurisdiction, and whether the Agentic account is open and funded. A hardcoded
tool list is therefore a guess that goes stale silently and breaks an agent at
trade time.

The only publicly documented tool name is `review_equity_order` (simulates an
order, returns pre-trade warnings, places nothing). Every other name, and every
parameter of every tool including that one, must come from your own `tools/list`
response.

So: enumerate, snapshot, diff. A server-side change then shows up as a **diff in
CI**, not as a broken agent.

## Reference facts

Verified live on 2026-07-20.

| Fact | Value |
|---|---|
| Endpoint | `https://agent.robinhood.com/mcp/trading` |
| Transport | Streamable HTTP |
| Discovery method | `initialize` then `tools/list` (JSON-RPC) |
| Auth | OAuth 2.1 + PKCE (`S256`); bearer token in `Authorization` |
| SDK | `@modelcontextprotocol/sdk` `^1.29.0` |

## Prerequisites

- An authenticated path to the server from at least one host (Prompt 01/02).
- Node 20 or newer.
- `npm install` at the repo root (installs `@modelcontextprotocol/sdk`).

## Regenerate the snapshot

The scripts write to `docs/mcp/tools-snapshot.json` using a **repo-root-relative**
path, so run them **from the repository root**, not from this directory:

```sh
node packages/rh-mcp/enumerate.mjs
```

The first run has no stored token, so the SDK triggers the OAuth flow:

1. The script prints an authorization URL. Open it and approve access.
2. Robinhood redirects to `http://localhost:33418/callback`, where a
   short-lived, localhost-only listener catches the authorization code.
3. The transport exchanges the code, tokens are persisted to
   `~/.robinhood-toolkit/mcp-auth.json` (mode `0600`), and the client reconnects.

Subsequent runs reuse the stored token silently. On success the script prints the
tool list and writes `docs/mcp/tools-snapshot.json`.

## Check for drift

After a fresh snapshot, verify the live surface still matches:

```sh
node packages/rh-mcp/check-drift.mjs
```

It re-enumerates the live server and compares against the committed snapshot,
printing `ADDED` / `REMOVED` / `CHANGED` per tool. It exits `0` when nothing
drifted and `1` otherwise — wire it into CI so a server-side change fails loudly.
When it flags drift, re-run `enumerate.mjs`, review the diff, and commit the new
snapshot.

## The snapshot artifact

`docs/mcp/tools-snapshot.json` contains, per tool: `name`, `description`,
`required`, sorted `properties`, and the full `inputSchema`. It contains **no
tokens** — only names, descriptions, and schemas — and describes **your**
account's surface, not everyone's.

Sanity checks that should hold on any real snapshot:

- `tool_count` is greater than zero.
- Every tool has a non-empty `name`.
- Every `inputSchema` is an object with `type: "object"`.

Cross-check one tool against your host (e.g. ask Claude Code to describe the same
tool) and confirm the parameter names match exactly. A mismatch means one of the
two sessions is stale.

## What not to commit

- **Never** commit `~/.robinhood-toolkit/mcp-auth.json` — it holds a brokerage
  credential. It lives outside the repo by design.
- **Never** let a token land in the snapshot. The snapshot is names, descriptions,
  and schemas only.

## Guardrails (policy.mjs / adapter.mjs)

Enumerating a write tool is not permission to call it. [policy.mjs](policy.mjs)
and [adapter.mjs](adapter.mjs) enforce client-side limits — per-order notional,
daily order count, symbol allow lists, mandatory simulation, position
concentration — before a write leaves your machine. Run their tests with:

```sh
npm test --workspace rh-mcp
```

## The capability model (adapter.mjs)

The adapter **does not name tools directly.** There is no `placeEquityOrder()`
method. Instead it resolves *capabilities* — `placeOrder`, `reviewOrder`,
`listPositions`, `listOrders`, `cancelOrder` — against the live schema at
runtime. A capability is a predicate over a tool's advertised schema:

```js
export const CAPABILITIES = {
  reviewOrder: (t) => /review|simulate|preview|validate/i.test(t.name),
  placeOrder:  (t) => /order/i.test(t.name) && isWrite(t) && !/cancel/i.test(t.name),
  // ...
};
```

Application code asks for a capability and gets back whichever concrete tool the
server currently advertises for it:

```js
import { RobinhoodMCPAdapter } from 'rh-mcp/adapter';

const adapter = await RobinhoodMCPAdapter.open({ guard });

if (adapter.has('listPositions')) {
  const positions = await adapter.call('listPositions');
}

const { review, place } = await adapter.reviewThenPlace({
  symbol: 'AAPL', side: 'buy', notional_usd: 25,
});
```

`node ../../examples/mcp-capabilities.mjs` (from the repo root,
`node examples/mcp-capabilities.mjs`) prints the live tool count and which
capabilities resolve on your account.

### Why the adapter does not name tools directly

The full Trading MCP schema is unpublished. `review_equity_order` is the only
documented name; the rest are discovered at runtime and change as Robinhood adds,
renames, or reshapes tools — crypto is announced for this same endpoint. A method
that hardcodes `place_equity_order` breaks silently the day that name changes. A
capability predicate matches on *shape and intent*, so:

- Adding a tool is transparent — a new capability simply starts resolving.
- Renaming a tool keeps working as long as it still matches the predicate.
- A tool disappearing fails **loudly**: `resolve()` throws `ToolUnavailable`
  listing what *is* available, instead of calling a name that no longer exists.

Resolution proves a tool is *advertised*, not that it *works* for your account —
availability can depend on account state, so only a real call proves usability. A
capability reported `no` by the capability report is a genuine gap in what your
account can do today, not an adapter bug.

### What the adapter enforces

- **Local argument validation** against `inputSchema` (`required`, `type`,
  `enum`, `additionalProperties: false`) *before* the call, so a model-generated
  argument fails naming the exact offending field, not with a generic server
  error.
- **`isError: true` becomes an exception.** A tool that fails logically —
  "insufficient buying power", a rejected order — returns a *normal* response
  with `isError` set, not a thrown error. A bare `try`/`catch` around `callTool`
  catches nothing and proceeds as if the order filled. The adapter raises
  `ToolCallFailed` so a rejection can never be mistaken for a fill.
- **Guarding lives inside `call()`.** Every write routed through the adapter
  passes `guard.check()` first and `guard.recordPlaced()` only on success, so a
  blocked or failed write never consumes daily budget, and no other code path
  holding the client can bypass the guard.

### The write heuristic is a heuristic

`isWrite()` classifies a tool from its name, conservatively: an unrecognized verb
counts as a write. A misclassification toward *write* costs only an unnecessary
guard check; one toward *read* skips your guardrails entirely. Review
`adapter.writeTools` against your snapshot descriptions and pin an explicit
override for anything it gets wrong:

```js
const EXPLICIT_WRITES = new Set(['review_equity_order' /* if your snapshot shows it mutates */]);
```

### `__simulated` is a local convention, not a wire field

`reviewThenPlace()` sets `__simulated: true` so the guard's
`require_simulation_before_write` rule is satisfied. `call()` strips it before
sending, which matters against servers that set `additionalProperties: false` and
would otherwise reject the whole call.

Exports from `rh-mcp/adapter`: `RobinhoodMCPAdapter`, `CAPABILITIES`, `isWrite`,
`textOf`, `ToolUnavailable`, `ToolCallFailed`.

## Agentic crypto readiness (crypto-readiness.mjs / route.mjs)

Agentic crypto is **announced but not yet live**. When it ships it runs through
this **same** endpoint — there is no separate crypto MCP URL to wait for — so the
transport, OAuth flow, and call envelope are all already verifiable. The only
unknowns are the crypto tool names and their input schemas, and those are
**unknowable from outside**: they must come from a live `tools/list` on your own
account.

The design consequence is that we **detect by capability, not by name**:

- [adapter.mjs](adapter.mjs) exports `acceptsCryptoPair` (does a tool's schema
  accept a pair like `BTC-USD`?) and `CRYPTO_CAPABILITIES`, merged into
  `CAPABILITIES` so `adapter.has('cryptoPlaceOrder')` works with no other changes.
  Nothing hardcodes `place_crypto_order` or any other guessed name.
- [crypto-readiness.mjs](crypto-readiness.mjs) turns the adapter's answer into a
  persisted assessment and reports whether readiness **changed** since last check.
- [examples/mcp-crypto-watch.mjs](../../examples/mcp-crypto-watch.mjs) is a poller
  you run on a schedule. It writes `docs/mcp/crypto-readiness.json` and exits with
  code **10** the moment crypto lights up on your account, and **11** if a
  previously-present capability disappears — a distinct signal a scheduler can
  alert on. No hardcoded rollout date anywhere; the detector is the answer.
- [route.mjs](route.mjs) routes crypto orders to the MCP lane when
  `cryptoPlaceOrder` is available and falls back to the **REST rail**, which
  **works today** and is the default. `mapToSchema` maps canonical fields onto
  whatever property names the live schema advertises and **throws on any unmapped
  required field**, so an unforeseen rollout naming fails loudly instead of
  sending a malformed order.

```sh
node examples/mcp-crypto-watch.mjs   # today: prints "crypto available: false"
```

The fixture tests in [crypto-readiness.test.mjs](crypto-readiness.test.mjs) prove
the MCP lane works when the capability appears — the fixture deliberately uses
`pair`/`order_type` rather than `symbol`/`type` so the detection and mapping are
tested against naming we do not control.

> Crypto trading is **not blocked** by any of this. The Robinhood Crypto Trading
> REST API (`packages/rh-crypto`) places real crypto orders today. The MCP lane is
> an additional interface, not a prerequisite. And a capability appearing is **not
> permission to trade**: on exit code 10, re-enumerate, read the new schemas,
> extend the policy guard for crypto notionals (a size in `asset_quantity` needs
> converting before a USD cap means anything), and test with the smallest size.

## Gotchas

- `tools/list` is **paginated**. `enumerate.mjs` drains `nextCursor`; a single
  `listTools` call may return a partial surface.
- The tool surface is **account-specific and dated**. Treat the snapshot as a
  description of your account at capture time.
- **SDK APIs move between versions.** This code targets `@modelcontextprotocol/sdk`
  `1.29.0`, where the auth-module exports and `transport.finishAuth` are verified
  present. Re-check the `OAuthClientProvider` interface when you upgrade.
- The redirect listener is **short-lived and localhost-only**. Do not leave it
  running or expose it beyond localhost.
