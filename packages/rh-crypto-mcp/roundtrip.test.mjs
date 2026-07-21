/**
 * robinhood-toolkit · MCP round-trip test for the crypto server
 * Author: nirholas · https://github.com/nirholas/robinhood-toolkit
 * License: All Rights Reserved (c) 2026 nirholas
 *
 * Drives the server with a real MCP client over stdio, which is the only way to
 * prove the wire contract. The server instantiates an authenticated client at
 * startup, so the full round trip needs live credentials; without them the test
 * skips rather than failing, leaving CI green in a credential-less environment.
 */
import { strict as assert } from 'node:assert';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..');
const serverPath = join(here, 'server.mjs');
const policyPath = join(repoRoot, 'config', 'agent-policy.json');

const haveCreds = Boolean(process.env.RH_API_KEY && process.env.RH_PRIVATE_KEY);

test('server advertises its tools and enforces confirmation', { skip: haveCreds ? false : 'RH_API_KEY / RH_PRIVATE_KEY not set' }, async () => {
  const client = new Client({ name: 'roundtrip', version: '1.0.0' });
  await client.connect(
    new StdioClientTransport({
      command: 'node',
      args: [serverPath],
      cwd: repoRoot,
      env: { ...process.env, RH_POLICY_PATH: policyPath },
    }),
  );

  const { tools } = await client.listTools();
  const names = tools.map((t) => t.name).sort();
  assert.deepEqual(names, [
    'cancel_crypto_order',
    'estimate_order_cost',
    'get_order_status',
    'get_portfolio',
    'get_quote',
    'list_trading_pairs',
    'place_crypto_order',
    'review_crypto_order',
  ]);

  const place = tools.find((t) => t.name === 'place_crypto_order');
  assert.ok(place.inputSchema.required.includes('confirmed'), 'confirmation must be required');

  // A read is safe to exercise live.
  const pairs = await client.callTool({ name: 'list_trading_pairs', arguments: { symbols: ['BTC-USD'] } });
  assert.equal(pairs.isError, undefined);

  await client.close();
});
