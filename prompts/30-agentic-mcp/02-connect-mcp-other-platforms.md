<!--
  robinhood-toolkit · build prompt: connect the Trading MCP on other platforms
  Author: nirholas · https://github.com/nirholas/robinhood-toolkit
  License: MIT (c) 2026 nirholas
-->

# 02 · Connect from Claude Desktop, ChatGPT, Codex, Cursor, and Grok

## Goal

Connect the same Robinhood Trading MCP endpoint from every supported host, and
produce one config file per host that a teammate can copy without guesswork.

## Prerequisites

- Prompt 01 read, including the Agentic account setup, which is host-independent
  and only needs doing once.
- The host application installed.

## Reference facts

| Fact | Value |
|---|---|
| Endpoint | `https://agent.robinhood.com/mcp/trading` |
| Transport | Streamable HTTP |
| Auth | OAuth 2.1 authorization code + PKCE, public client, no secret |

Robinhood lists these supported platforms: **Claude Code, Claude Desktop,
ChatGPT, Codex, Cursor, and Grok**, plus other MCP-compatible platforms
generally. The flow is identical everywhere: you approve access on Robinhood's
side, then paste the same URL into the host's MCP configuration. There is no
per-host credential and no per-host endpoint.

Because the server is a public OAuth client with dynamic registration
(`registration_endpoint`: `https://agent.robinhood.com/oauth/trading/register`,
verified 2026-07-20), any host that implements MCP's OAuth flow can register
itself. You do not pre-provision anything per host.

The account rules do not change per host: reads span all your Robinhood accounts,
order placement is confined to the funded Agentic account, and today the server
supports long equities and options orders only.

## Steps

1. **Claude Code** (from prompt 01, repeated for completeness):

```sh
claude mcp add robinhood-trading --transport http https://agent.robinhood.com/mcp/trading
```

2. **Claude Desktop.** Edit the MCP config file:

- macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
- Windows: `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "robinhood-trading": {
      "type": "http",
      "url": "https://agent.robinhood.com/mcp/trading"
    }
  }
}
```

Restart Claude Desktop, then approve the OAuth prompt in the browser.

3. **Cursor.** Create `.cursor/mcp.json` in the project, or the global
   equivalent at `~/.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "robinhood-trading": {
      "url": "https://agent.robinhood.com/mcp/trading"
    }
  }
}
```

Open Cursor settings, find the MCP section, and confirm the server shows as
connected after completing the browser auth.

4. **Codex.** Codex reads `~/.codex/config.toml`:

```toml
[mcp_servers.robinhood-trading]
url = "https://agent.robinhood.com/mcp/trading"
```

UNVERIFIED: the exact key names and whether your Codex build expects
`mcp_servers` or a different table have changed between releases. Confirm
against `codex --help` or your installed version's documentation before filing a
bug. The URL and transport never change; only the host's config syntax does.

5. **ChatGPT and Grok.** Both are configured in the product UI rather than a
   file: add a connector or custom MCP server, paste
   `https://agent.robinhood.com/mcp/trading`, and complete the Robinhood
   approval. UNVERIFIED: menu paths in hosted products move frequently, so
   navigate by the current UI rather than a memorized path. What is verified is
   that the URL, transport, and approval flow are the same as every other host.

6. Write one config per host into your repo so this is reproducible:

```
docs/mcp/
  claude-code.md
  claude-desktop.json
  cursor.json
  codex.toml
  hosted-ui.md      # ChatGPT and Grok, with dated screenshots or steps
```

None of these files contain secrets. Tokens live in each host's own credential
store, never in the MCP config.

7. Write a host-independent preflight check you can run before blaming any host:

```sh
#!/usr/bin/env bash
# robinhood-toolkit · verify the Trading MCP endpoint is reachable and speaking MCP
# Author: nirholas · https://github.com/nirholas/robinhood-toolkit
# License: MIT (c) 2026 nirholas
set -euo pipefail

ENDPOINT="https://agent.robinhood.com/mcp/trading"

status=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$ENDPOINT" \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"preflight","version":"1.0.0"}}}')

if [ "$status" = "401" ]; then
  echo "OK: endpoint is up and requires auth, as expected"
elif [ "$status" = "200" ]; then
  echo "OK: endpoint answered without auth, which is unexpected; investigate"
else
  echo "PROBLEM: endpoint returned $status" >&2
  exit 1
fi

curl -s "https://agent.robinhood.com/.well-known/oauth-protected-resource" \
  | python3 -c 'import json,sys; d=json.load(sys.stdin); print("resource:", d["resource"]); print("scopes:", d["scopes_supported"])'
```

Save as `scripts/mcp-preflight.sh`, `chmod +x`, and run it first whenever a host
reports a connection failure. A 401 is the healthy answer.

## Deliverable

- `docs/mcp/` with one config artifact per host, each dated
- `scripts/mcp-preflight.sh`, executable, with the attribution header
- A short table in `docs/mcp/README.md` mapping host to config location, so the
  next person does not search for it

## How to verify

```sh
./scripts/mcp-preflight.sh
```

Must print `OK: endpoint is up and requires auth`. Then, on each host you
configured, ask the agent to list its Robinhood tools and to read your portfolio.
The same tool names must appear on every host, because the server is the same.
If two hosts show different tool sets, one of them has a stale session; reconnect
it rather than assuming the hosts differ in capability.

## Gotchas

- **The URL is identical everywhere.** If a guide gives you a different endpoint
  per platform, it is wrong. One server, one URL.
- **Config file syntax is the only real difference.** JSON with `mcpServers` for
  the Claude apps and Cursor, TOML for Codex, UI for ChatGPT and Grok. Do not
  transplant a `command`/`args` stdio block from another MCP server; this is a
  remote HTTP server and has no local process.
- **Hosted product UIs move.** Anything in this file marked UNVERIFIED is marked
  that way because menu paths change faster than documentation. Verify in the
  product, and update your dated notes when you do.
- **Each host authenticates separately.** Approving in Claude Code does not
  authenticate Cursor. Expect one browser approval per host, and expect to
  re-approve after a token expiry.
- **More hosts means more copies of your data.** Every connected host is another
  provider that receives your positions, balances, and account numbers, governed
  by that provider's terms rather than Robinhood's. Connect the hosts you
  actually use and disconnect the ones you were only testing.
- **Robinhood does not supervise or audit any of them.** The host list is a
  compatibility statement, not an endorsement or a security review of those
  products.
- **Do not put the endpoint behind a proxy you do not control** to "add
  logging". You would be inserting yourself into an OAuth flow and a brokerage
  session. If you need an audit trail, log on your own client side.
