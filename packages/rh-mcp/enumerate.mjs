/* built by nirholas x.com/nichxbt */
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
/* built by nirholas x.com/nichxbt */
