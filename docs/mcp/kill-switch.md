<!-- built by nirholas x.com/nichxbt -->
<!--
  robinhood-toolkit · Agentic MCP kill switch — how to stop an agent, in order
  Author: nirholas · https://github.com/nirholas/robinhood-toolkit
  License: All Rights Reserved (c) 2026 nirholas
-->

# Kill switch — stopping an agent

Robinhood does not supervise a connected agent, and an agentic strategy can move
faster than you can watch it. This file is the runbook for stopping one. There
are three separate actions with three different latencies. Know which is
fastest, and rehearse each one **before** an incident, not during it.

The order below is fastest-to-most-thorough. In an incident, do step 1 first; it
is the only one that halts activity in seconds. Steps 2 and 3 make the stop
durable so the agent cannot resume.

## 1. Stop the host process (fastest — seconds)

The agent only acts while its host process is running. Killing that process ends
all new tool calls immediately.

- Foreground: `Ctrl-C` in the terminal running the host.
- Backgrounded / detached: find and kill it.

```sh
# Find the host process (adjust the pattern to your host)
pgrep -af 'mcp|claude|agent-host' 

# Kill it
kill <pid>          # graceful
kill -9 <pid>       # if it will not stop
```

An in-flight order that has already left your machine is **not** recalled by
killing the host. This stops *new* writes; it does not undo the last one. Confirm
open orders in the Robinhood app and cancel any you did not intend.

## 2. Disconnect the MCP server from the host config (minutes)

Prevents the host from reconnecting on its next start or auto-restart. Edit the
host's MCP server config and remove (or comment out) the Robinhood server entry,
then restart the host so the change takes effect.

- Claude Desktop: edit `claude_desktop_config.json` (see
  [claude-desktop.json](claude-desktop.json)), remove the Robinhood server from
  `mcpServers`, and restart the app.
- Other hosts: remove the server from that host's MCP configuration.

This closes the crash-loop hole: a supervisor that restarts a killed host cannot
reconnect to Robinhood if the server is no longer in the config.

## 3. Revoke access from the Robinhood side (most thorough)

The only action that holds even if some other process still has the token. Revoke
the agent's access in your Robinhood account so the credentials stop working
regardless of what is running locally.

- In the Robinhood app or web: account settings → connected agents / MCP access →
  revoke the connection.
- After revoking, a new connection requires re-authentication on desktop.

Revocation is the backstop for the gotcha that guardrails only constrain your own
agent: another script holding the same token is unaffected by steps 1 and 2, but
loses access here.

## Rehearsal checklist

Do this once, while nothing is wrong, and record the timings:

- [ ] Kill a running host with `Ctrl-C` and confirm no further tool calls fire.
- [ ] Kill a backgrounded host by PID and confirm the same.
- [ ] Remove the Robinhood server from the host config, restart, and confirm the
      host comes up with no Robinhood tools available.
- [ ] Revoke access in Robinhood and confirm a subsequent connection attempt is
      rejected until re-authentication.
- [ ] Write down the wall-clock time each step took. In an incident you will
      reach for the fastest one you have actually timed.

## What none of these do

- They do not cancel an order already accepted by Robinhood. Cancel open orders
  in the app separately.
- They do not reduce read exposure that already happened. Data that reached the
  model provider is governed by that provider's terms, not Robinhood's.
<!-- built by nirholas x.com/nichxbt -->
