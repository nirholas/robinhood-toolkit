<!-- built by nirholas x.com/nichxbt -->
<!--
  robinhood-toolkit · ChatGPT and Grok MCP setup (hosted UI)
  Author: nirholas · https://github.com/nirholas/robinhood-toolkit
  License: All Rights Reserved (c) 2026 nirholas
  Dated: 2026-07-21
-->

# ChatGPT and Grok — Robinhood Trading MCP (hosted UI)

Both hosts are configured in the product UI, not a config file. The value you
paste is the same everywhere:

```
https://agent.robinhood.com/mcp/trading
```

Transport is Streamable HTTP; auth is OAuth 2.1 (authorization code + PKCE,
public client). After you add the server, complete Robinhood's approval in the
browser.

## ChatGPT

UNVERIFIED — menu paths in hosted products move frequently. Navigate by the
current UI, not a memorized path. As of 2026-07-21 the flow was roughly:

1. Settings → Connectors (or "Custom MCP servers").
2. Add a connector / custom MCP server.
3. Paste `https://agent.robinhood.com/mcp/trading`.
4. Complete the Robinhood approval when the browser prompts.

## Grok

UNVERIFIED — same caveat. As of 2026-07-21, roughly:

1. Settings → Integrations / MCP servers.
2. Add a custom MCP server.
3. Paste `https://agent.robinhood.com/mcp/trading`.
4. Complete the Robinhood approval.

## When you verify

Replace the steps above with what you actually saw, and update the date. Add
dated screenshots to this folder if helpful. What is *verified and stable* is
that the URL, transport, and approval flow are identical to every other host —
only the menu path differs.

## Verify it worked

Ask the agent to list its Robinhood tools and read your portfolio. The same tool
names appear here as on every other host, because the server is the same.
<!-- built by nirholas x.com/nichxbt -->
