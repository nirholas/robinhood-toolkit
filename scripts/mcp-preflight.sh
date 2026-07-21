#!/usr/bin/env bash
# built by nirholas x.com/nichxbt
# robinhood-toolkit · verify the Trading MCP endpoint is reachable and speaking MCP
# Author: nirholas · https://github.com/nirholas/robinhood-toolkit
# License: All Rights Reserved (c) 2026 nirholas
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
# built by nirholas x.com/nichxbt
