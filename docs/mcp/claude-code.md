<!--
  robinhood-toolkit · Claude Code MCP setup
  Author: nirholas · https://github.com/nirholas/robinhood-toolkit
  Dated: 2026-07-21
-->

# Claude Code — Robinhood Trading MCP

Claude Code manages remote MCP servers with the `claude mcp` command; there is no
config file to hand-edit.

## Add

```sh
claude mcp add robinhood-trading --transport http https://agent.robinhood.com/mcp/trading
```

Then complete the OAuth approval in the browser when prompted. Claude Code
registers itself dynamically against Robinhood's public OAuth client — no secret,
no per-host provisioning.

## Verify

```sh
claude mcp list
```

`robinhood-trading` should appear and, after auth, report as connected. Then ask
the agent to list its Robinhood tools and read your portfolio.

## Remove

```sh
claude mcp remove robinhood-trading
```

## Notes

- Endpoint: `https://agent.robinhood.com/mcp/trading` (identical on every host).
- Transport: Streamable HTTP.
- Auth: OAuth 2.1 authorization code + PKCE, public client, no secret.
- Tokens live in Claude Code's own credential store, never in any config file.
