<!--
  robinhood-toolkit · MCP host config index
  Author: nirholas · https://github.com/nirholas/robinhood-toolkit
  License: All Rights Reserved (c) 2026 nirholas
  Dated: 2026-07-21
-->

# Robinhood Trading MCP — host configs

One server, one URL, every host. The only thing that differs between hosts is the
config file syntax (or a UI). Nothing here contains secrets — tokens live in each
host's own credential store.

| Fact | Value |
|---|---|
| Endpoint | `https://agent.robinhood.com/mcp/trading` |
| Transport | Streamable HTTP |
| Auth | OAuth 2.1 authorization code + PKCE, public client, no secret |

## Host → config location

| Host | Config artifact (this folder) | Where it installs on your machine |
|---|---|---|
| Claude Code | [claude-code.md](claude-code.md) | none — `claude mcp add` command |
| Claude Desktop | [claude-desktop.json](claude-desktop.json) | macOS: `~/Library/Application Support/Claude/claude_desktop_config.json` · Windows: `%APPDATA%\Claude\claude_desktop_config.json` |
| Cursor | [cursor.json](cursor.json) | project `.cursor/mcp.json` or global `~/.cursor/mcp.json` |
| Codex | [codex.toml](codex.toml) | `~/.codex/config.toml` |
| ChatGPT | [hosted-ui.md](hosted-ui.md) | product UI (connector / custom MCP server) |
| Grok | [hosted-ui.md](hosted-ui.md) | product UI (custom MCP server) |

## Before blaming a host

Run the host-independent preflight from the repo root:

```sh
./scripts/mcp-preflight.sh
```

A `401` is the healthy answer — the endpoint is up and requires auth. Only after
this passes should you suspect the host's config.

## Account rules (host-independent)

- Reads span all your Robinhood accounts.
- Order placement is confined to the funded Agentic account.
- Today the server supports long equities and options orders only.
- Each host authenticates separately — one browser approval per host, and
  re-approval after a token expiry.
