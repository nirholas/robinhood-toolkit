<!-- built by nirholas x.com/nichxbt -->
<!--
  robinhood-toolkit · build prompt: enumerate the Trading MCP tool surface
  Author: nirholas · https://github.com/nirholas/robinhood-toolkit
  License: All Rights Reserved (c) 2026 nirholas
-->

# 03 · Enumerate the tool surface at runtime

## Goal

Discover, at runtime, exactly which tools the Robinhood Trading MCP server offers
your account and what arguments each one takes. Produce a dated snapshot file you
can diff, so a server-side change shows up as a diff rather than as a broken
agent.

**Do not hardcode a tool list, including from this repository.** Robinhood has not
published the full tool schema. Anything you did not read off a live
`tools/list` response is a guess.

## Prerequisites

- Prompt 01 or 02 complete: an authenticated connection from at least one host.
- Node 20 or newer for the programmatic path.

## Reference facts

Verified live on 2026-07-20.

| Fact | Value |
|---|---|
| Endpoint | `https://agent.robinhood.com/mcp/trading` |
| Transport | Streamable HTTP |
| JSON-RPC method to list tools | `tools/list` |
| Auth | OAuth 2.1 + PKCE; bearer token in the `Authorization` header |

MCP tool discovery is a two-step JSON-RPC exchange: `initialize`, then
`tools/list`. The response contains a `tools` array where each entry has `name`,
`description`, and `inputSchema` (a JSON Schema object). That is the authoritative
description of what you can call and with what arguments.

**The one tool name Robinhood documents publicly is `review_equity_order`**,
which simulates an order and returns pre-trade warnings without placing it. Treat
that as a single confirmed data point, not as the shape of the whole API. Every
other name, and every parameter of every tool including that one, must come from
your own `tools/list` output.

The OAuth metadata the SDK will discover for you, confirmed by running the
discovery functions against the live server:

```
resource:  https://agent.robinhood.com/mcp/trading
authz:     https://robinhood.com/oauth
token:     https://api.robinhood.com/oauth2/token/
register:  https://agent.robinhood.com/oauth/trading/register
pkce:      S256
```

## Steps

### Path A: enumerate through your host (fastest)

If you connected via Claude Code, the client already holds a token:

```sh
claude mcp list
```

Then in a session, ask the agent to list every tool from the `robinhood-trading`
server with its full input schema, and to write the result to a file. This
requires no new code and is the right first move. It is not sufficient on its
own, because you want a machine-readable artifact you can diff in CI.

### Path B: enumerate programmatically

1. Install the official SDK:

```sh
npm install @modelcontextprotocol/sdk
```

2. Confirm discovery works before dealing with tokens. This script needs no auth
   and is the fastest way to prove the endpoint is intact:

```js
/**
 * robinhood-toolkit · verify Trading MCP OAuth discovery
 * Author: nirholas · https://github.com/nirholas/robinhood-toolkit
 * License: All Rights Reserved (c) 2026 nirholas
 */
import {
  discoverAuthorizationServerMetadata,
  discoverOAuthProtectedResourceMetadata,
} from '@modelcontextprotocol/sdk/client/auth.js';

const ENDPOINT = 'https://agent.robinhood.com/mcp/trading';

const resource = await discoverOAuthProtectedResourceMetadata(ENDPOINT);
console.log('resource:', resource.resource);
console.log('authorization servers:', resource.authorization_servers);

const server = await discoverAuthorizationServerMetadata(resource.authorization_servers[0]);
console.log('authorize:', server.authorization_endpoint);
console.log('token:', server.token_endpoint);
console.log('register:', server.registration_endpoint);
console.log('pkce:', server.code_challenge_methods_supported);
```

3. Implement an OAuth provider that persists tokens to disk, then connect and
   list tools. `packages/rh-mcp/enumerate.mjs`:

```js
/**
 * robinhood-toolkit · enumerate the Robinhood Trading MCP tool surface
 * Author: nirholas · https://github.com/nirholas/robinhood-toolkit
 * License: All Rights Reserved (c) 2026 nirholas
 */
import { createServer } from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { UnauthorizedError } from '@modelcontextprotocol/sdk/client/auth.js';

const ENDPOINT = 'https://agent.robinhood.com/mcp/trading';
const STORE = join(homedir(), '.robinhood-toolkit', 'mcp-auth.json');
const REDIRECT_PORT = 33418;
const REDIRECT_URL = `http://localhost:${REDIRECT_PORT}/callback`;

async function readStore() {
  try {
    return JSON.parse(await readFile(STORE, 'utf8'));
  } catch {
    return {};
  }
}

async function writeStore(patch) {
  const current = await readStore();
  await mkdir(dirname(STORE), { recursive: true });
  await writeFile(STORE, JSON.stringify({ ...current, ...patch }, null, 2), { mode: 0o600 });
}

/** Implements the SDK's OAuthClientProvider contract with on-disk persistence. */
class FileAuthProvider {
  get redirectUrl() {
    return REDIRECT_URL;
  }

  get clientMetadata() {
    return {
      client_name: 'robinhood-toolkit enumerator',
      redirect_uris: [REDIRECT_URL],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
    };
  }

  async clientInformation() {
    return (await readStore()).client;
  }

  async saveClientInformation(info) {
    await writeStore({ client: info });
  }

  async tokens() {
    return (await readStore()).tokens;
  }

  async saveTokens(tokens) {
    await writeStore({ tokens });
  }

  async saveCodeVerifier(verifier) {
    await writeStore({ verifier });
  }

  async codeVerifier() {
    const { verifier } = await readStore();
    if (!verifier) throw new Error('no PKCE code verifier stored');
    return verifier;
  }

  async redirectToAuthorization(authorizationUrl) {
    console.log('\nOpen this URL to approve access:\n');
    console.log(authorizationUrl.toString());
    console.log('');
  }
}

/** Wait for Robinhood to redirect back with the authorization code. */
function awaitAuthorizationCode() {
  return new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      const url = new URL(req.url, REDIRECT_URL);
      if (url.pathname !== '/callback') {
        res.writeHead(404).end();
        return;
      }
      const code = url.searchParams.get('code');
      const error = url.searchParams.get('error');
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end(code ? 'Authorized. You can close this tab.' : `Authorization failed: ${error}`);
      server.close();
      code ? resolve(code) : reject(new Error(error ?? 'no code returned'));
    });
    server.listen(REDIRECT_PORT);
  });
}

export async function connect() {
  const authProvider = new FileAuthProvider();
  const client = new Client({ name: 'robinhood-toolkit', version: '1.0.0' });
  const transport = new StreamableHTTPClientTransport(new URL(ENDPOINT), { authProvider });

  try {
    await client.connect(transport);
  } catch (error) {
    if (!(error instanceof UnauthorizedError)) throw error;
    const code = await awaitAuthorizationCode();
    await transport.finishAuth(code);
    await client.connect(new StreamableHTTPClientTransport(new URL(ENDPOINT), { authProvider }));
  }
  return client;
}

export async function enumerateTools(client) {
  const tools = [];
  let cursor;
  do {
    const page = await client.listTools(cursor ? { cursor } : {});
    tools.push(...page.tools);
    cursor = page.nextCursor;
  } while (cursor);
  return tools.sort((a, b) => a.name.localeCompare(b.name));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const client = await connect();
  const tools = await enumerateTools(client);

  const snapshot = {
    captured_at: new Date().toISOString(),
    endpoint: ENDPOINT,
    tool_count: tools.length,
    tools: tools.map((t) => ({
      name: t.name,
      description: t.description,
      required: t.inputSchema?.required ?? [],
      properties: Object.keys(t.inputSchema?.properties ?? {}).sort(),
      inputSchema: t.inputSchema,
    })),
  };

  await writeFile('docs/mcp/tools-snapshot.json', `${JSON.stringify(snapshot, null, 2)}\n`);

  for (const tool of snapshot.tools) {
    const required = tool.required.length ? ` required: ${tool.required.join(', ')}` : '';
    console.log(`${tool.name}${required}`);
    console.log(`  ${tool.description ?? '(no description)'}`);
  }
  console.log(`\n${tools.length} tools written to docs/mcp/tools-snapshot.json`);
  await client.close();
}
```

4. Add a drift check so a server-side change fails loudly rather than at trade
   time. `packages/rh-mcp/check-drift.mjs`:

```js
/**
 * robinhood-toolkit · fail if the MCP tool surface changed since the snapshot
 * Author: nirholas · https://github.com/nirholas/robinhood-toolkit
 * License: All Rights Reserved (c) 2026 nirholas
 */
import { readFile } from 'node:fs/promises';
import { connect, enumerateTools } from './enumerate.mjs';

const snapshot = JSON.parse(await readFile('docs/mcp/tools-snapshot.json', 'utf8'));
const client = await connect();
const live = await enumerateTools(client);
await client.close();

const before = new Map(snapshot.tools.map((t) => [t.name, t]));
const after = new Map(live.map((t) => [t.name, t]));

const added = [...after.keys()].filter((n) => !before.has(n));
const removed = [...before.keys()].filter((n) => !after.has(n));
const changed = [...after.keys()].filter((n) => {
  const a = before.get(n);
  if (!a) return false;
  return JSON.stringify(a.inputSchema) !== JSON.stringify(after.get(n).inputSchema);
});

for (const n of added) console.log(`ADDED   ${n}`);
for (const n of removed) console.log(`REMOVED ${n}`);
for (const n of changed) console.log(`CHANGED ${n}`);

if (added.length || removed.length || changed.length) {
  console.log(`\nTool surface drifted since ${snapshot.captured_at}. Re-run enumerate.mjs and review.`);
  process.exitCode = 1;
} else {
  console.log(`No drift since ${snapshot.captured_at}. ${live.length} tools.`);
}
```

5. Read the schemas before you call anything. For each tool, note whether it is a
   read or a write, and whether a simulate-only counterpart exists.
   `review_equity_order` is documented as simulating an order and returning
   pre-trade warnings; check your snapshot for whether analogous review tools
   exist for other order paths, rather than assuming they do.

## Deliverable

- `packages/rh-mcp/enumerate.mjs`
- `packages/rh-mcp/check-drift.mjs`
- `docs/mcp/tools-snapshot.json`, committed and dated
- `packages/rh-mcp/README.md` documenting how to regenerate the snapshot

## How to verify

```sh
node packages/rh-mcp/enumerate.mjs
```

Must complete the OAuth flow once, then print a tool list and write the snapshot.
Then:

```sh
node packages/rh-mcp/check-drift.mjs   # must exit 0 immediately after a fresh snapshot
```

Cross-check one tool against your host: ask Claude Code to describe the same tool
and confirm the parameter names match your snapshot exactly. If your snapshot has
a parameter the agent does not mention, or vice versa, one of the two sessions is
stale.

Sanity assertions on the snapshot itself: `tool_count` is greater than zero,
every tool has a non-empty `name`, and every `inputSchema` is an object with
`type: "object"`.

## Gotchas

- **A hardcoded tool list is the bug this file exists to prevent.** The full
  schema is unpublished and the server is adding asset classes. Enumerate, snapshot,
  diff.
- **`tools/list` is paginated.** A single call can return a `nextCursor`. Code
  that reads `page.tools` once may see a partial surface and conclude a tool does
  not exist. The loop above drains the cursor.
- **The tool surface is account-specific.** What the server advertises can depend
  on your account state, jurisdiction, and whether the Agentic account is open and
  funded. Your snapshot describes your account, not everyone's. Say so in the
  file.
- **`review_equity_order` is the only publicly named tool.** Do not extrapolate a
  naming convention from one sample and assume `review_crypto_order` exists.
  Check the snapshot.
- **Store tokens with restrictive permissions.** The provider above writes mode
  `0600`. A world-readable token file is a brokerage credential leak. Never commit
  `~/.robinhood-toolkit/mcp-auth.json`, and never commit a token into the
  snapshot: the snapshot must contain only names, descriptions, and schemas.
- **The redirect listener is short-lived and localhost-only.** Do not leave a
  callback server running, and do not expose it beyond localhost.
- **SDK APIs move between versions.** The code above targets
  `@modelcontextprotocol/sdk` 1.29.0, where the auth-module exports and
  `transport.finishAuth` were verified present. Pin a range and re-check the
  provider interface when you upgrade.
- **Enumerating is not authorizing.** Seeing a write tool in the list does not
  mean you should call it. Prompt 04 covers guardrails before you let an agent
  reach for one.
<!-- built by nirholas x.com/nichxbt -->
