<!-- built by nirholas x.com/nichxbt -->
<!--
  robinhood-toolkit · build prompt: connect the Robinhood Trading MCP to Claude Code
  Author: nirholas · https://github.com/nirholas/robinhood-toolkit
  License: All Rights Reserved (c) 2026 nirholas
-->

# 01 · Connect the Trading MCP to Claude Code

## Goal

Connect Claude Code to Robinhood's Trading MCP server, complete the OAuth
handshake, and confirm the connection by listing the tools the server actually
advertises to your account.

## Prerequisites

- Claude Code installed and working.
- A Robinhood account in good standing.
- A **desktop** device. Opening and authenticating an Agentic account cannot be
  done from mobile.
- `curl` for the verification steps.

## Reference facts

| Fact | Value |
|---|---|
| MCP endpoint | `https://agent.robinhood.com/mcp/trading` |
| Transport | Streamable HTTP |
| Auth | OAuth 2.1, authorization code + PKCE (S256) |

Verified by direct request on 2026-07-20. An unauthenticated `initialize` call
returns:

```
HTTP/2 401
www-authenticate: Bearer resource_metadata="https://agent.robinhood.com/.well-known/oauth-protected-resource/mcp/trading"
access-control-allow-methods: GET, POST, OPTIONS, DELETE
access-control-expose-headers: Mcp-Session-Id
```

That is an RFC 9728 protected-resource challenge, and the exposed
`Mcp-Session-Id` header plus the GET/POST/DELETE method set confirms streamable
HTTP rather than the older SSE transport. You do not need to implement any of
this by hand in Claude Code; the client does it. It matters because it tells you
exactly what to check when the connection fails.

Discovered OAuth metadata, verified live:

```json
{
  "issuer": "https://agent.robinhood.com/mcp/trading",
  "authorization_endpoint": "https://robinhood.com/oauth",
  "token_endpoint": "https://api.robinhood.com/oauth2/token/",
  "registration_endpoint": "https://agent.robinhood.com/oauth/trading/register",
  "grant_types_supported": ["authorization_code", "refresh_token"],
  "code_challenge_methods_supported": ["S256"],
  "token_endpoint_auth_methods_supported": ["none"],
  "scopes_supported": ["internal"]
}
```

`token_endpoint_auth_methods_supported: ["none"]` means the server treats MCP
clients as public clients: there is no client secret to obtain or store, and
dynamic client registration is open at the registration endpoint. PKCE is what
protects the exchange.

### Capability scope, stated once

Today the Trading MCP supports placing **long equities and options orders**.
Robinhood's wording: "You currently can use your agent to place long equities and
options orders. Note that we'll be adding support for more assets soon." Agentic
crypto is announced but not live: "Agentic Accounts for crypto will begin rolling
out soon to eligible US traders at no additional cost." When it ships it runs
through this same Trading MCP endpoint. Prompt 06 covers building for that now
and detecting it at runtime. This file gets you connected; the connection is the
same either way.

### Account scoping

Reads cover **all** your Robinhood accounts: positions, balances, portfolio,
orders, transactions. Order placement is confined to the funded Agentic account.
Connecting does not expose your main account to order placement.

## Steps

1. Add the server:

```sh
claude mcp add robinhood-trading --transport http https://agent.robinhood.com/mcp/trading
```

2. Start Claude Code and trigger the OAuth flow. Claude Code prompts for
   authentication on first use of the server; you can also drive it explicitly:

```sh
claude
# then, in the session:
/mcp
```

Select `robinhood-trading` and authenticate. A browser opens to
`https://robinhood.com/oauth`. Approve access there.

3. Open and fund the Agentic account. Robinhood prompts you to open a dedicated
   Agentic account during or immediately after authentication. This account is
   separate from your main portfolio, and it is the only account your agent can
   place orders in. Fund it with the amount you are willing to put under agent
   control, and no more.

4. Confirm the connection and see what the server actually offers:

```sh
claude mcp list
```

Then in a session, ask Claude to list the tools it has from the
`robinhood-trading` server. Do not assume a tool list from any documentation,
including this repo. Prompt 03 covers enumerating tools properly, including
programmatically.

5. Record the configuration. `claude mcp add` writes to your Claude Code config.
   Check it in to your dotfiles if you keep them, but note it contains no
   secrets: tokens are stored separately by Claude Code, not in the MCP config.

## Deliverable

- A working `robinhood-trading` MCP connection in Claude Code
- A funded Agentic account
- `docs/mcp-setup.md` in your project recording: the endpoint, the date you
  connected, the tool names the server actually advertised on that date, and the
  dollar amount you funded the Agentic account with

## How to verify

Independent of Claude Code, confirm the endpoint is reachable and speaking the
protocol you expect:

```sh
# Expect 401 with a www-authenticate challenge. A 404 or a timeout means
# the endpoint changed.
curl -s -D - -o /dev/null -X POST https://agent.robinhood.com/mcp/trading \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"probe","version":"0.0.1"}}}'

# Confirm the OAuth metadata still matches what this prompt documents.
curl -s https://agent.robinhood.com/.well-known/oauth-authorization-server | python3 -m json.tool
```

In Claude Code, `claude mcp list` must show `robinhood-trading` as connected. Ask
the agent to read your portfolio; it should return real balances. Ask it what
tools it has; it should name them without you supplying the list.

## Gotchas

- **Desktop only for account setup.** Opening the Agentic account and completing
  authentication cannot be done from a mobile device. This is the single most
  common place the setup stalls.
- **Claude Code has to be running for the agent to trade.** It is not a hosted
  service. Close the session and nothing executes. Do not build a strategy that
  assumes an always-on loop unless you are keeping the process alive yourself.
- **Reads are broad, writes are narrow.** Authenticating exposes read access to
  every Robinhood account you hold, including account numbers. If that is not
  acceptable to you, do not connect. The narrow write scope does not narrow the
  read scope.
- **Robinhood does not control, supervise, monitor, recommend, or audit connected
  agents.** Once your data reaches the agent it has left Robinhood's security
  environment and is governed by that provider's terms. Treat the model provider
  as a party to every trade decision.
- **Do not hardcode a tool list.** The full tool schema is not published. Tools
  can be added or renamed server-side at any time. Enumerate at runtime (prompt
  03) and fail loudly if an expected tool is missing.
- **`--transport http`, not `sse`.** The server is streamable HTTP. An `sse`
  transport flag will fail or silently degrade depending on client version.
- **No client secret exists.** If any guide tells you to obtain one for this
  endpoint, it is wrong: `token_endpoint_auth_methods_supported` is `["none"]`.
  Do not go looking for a credential that the protocol does not use.
- Fund the Agentic account deliberately. It is the blast radius. Guardrails
  belong there, not in a prompt asking the model to be careful.
<!-- built by nirholas x.com/nichxbt -->
