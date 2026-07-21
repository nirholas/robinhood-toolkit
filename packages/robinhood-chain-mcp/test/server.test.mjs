/**
 * robinhood-toolkit · robinhood-chain-mcp stdio round-trip tests
 * Author: nirholas · https://github.com/nirholas/robinhood-toolkit
 * License: All Rights Reserved (c) 2026 nirholas
 *
 * Drives the real server binary with a real MCP client over stdio. Nothing here
 * touches the network: every assertion is about the wire contract, or about a
 * rejection that happens before any RPC call is made.
 */
import { strict as assert } from 'node:assert';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import test, { after, before, describe } from 'node:test';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const SERVER = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'server.mjs');

const EXPECTED_TOOLS = [
  'get_balance',
  'get_chain_info',
  'get_token_balance',
  'get_token_info',
  'get_transaction',
  'read_contract',
  'search_pairs',
  'verify_token_address',
];

describe('stdio round trip', () => {
  let client;

  before(async () => {
    client = new Client({ name: 'robinhood-chain-mcp-tests', version: '1.0.0' });
    await client.connect(new StdioClientTransport({ command: process.execPath, args: [SERVER] }));
  });

  after(async () => {
    await client.close();
  });

  test('handshake reports the server identity', () => {
    const info = client.getServerVersion();
    assert.equal(info.name, 'robinhood-chain-mcp');
    assert.match(info.version, /^\d+\.\d+\.\d+/);
  });

  test('instructions state the read-only boundary', () => {
    const instructions = client.getInstructions();
    assert.match(instructions, /cannot sign or send transactions/i);
    assert.match(instructions, /verify_token_address/);
  });

  test('advertises exactly the documented tool surface', async () => {
    const { tools } = await client.listTools();
    assert.deepEqual(tools.map((tool) => tool.name).sort(), EXPECTED_TOOLS);
  });

  test('no tool exposes a key, signing, or spending parameter', async () => {
    const { tools } = await client.listTools();
    const forbidden = /private_?key|mnemonic|seed|signer|sign|send|transfer|approve|swap/i;

    for (const tool of tools) {
      for (const property of Object.keys(tool.inputSchema.properties ?? {})) {
        assert.doesNotMatch(
          property,
          forbidden,
          `tool ${tool.name} exposes a parameter named "${property}" that implies a write path`,
        );
      }
    }
  });

  test('every tool has a description long enough to route on', async () => {
    const { tools } = await client.listTools();
    for (const tool of tools) {
      assert.ok(tool.description?.length > 120, `${tool.name} description is too thin to disambiguate`);
      assert.ok(tool.title, `${tool.name} has no title`);
    }
  });

  test('network parameter is optional everywhere and defaults to mainnet', async () => {
    const { tools } = await client.listTools();
    for (const tool of tools) {
      const network = tool.inputSchema.properties?.network;
      if (!network) continue;
      assert.deepEqual(network.enum, ['mainnet', 'testnet'], `${tool.name} network enum`);
      assert.equal(network.default, 'mainnet', `${tool.name} network default`);
      assert.ok(
        !(tool.inputSchema.required ?? []).includes('network'),
        `${tool.name} must not require network`,
      );
    }
  });

  test('read_contract refuses a state-changing function before any RPC call', async () => {
    const result = await client.callTool({
      name: 'read_contract',
      arguments: {
        address: '0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168',
        abi: 'function transfer(address to, uint256 amount) returns (bool)',
        function_name: 'transfer',
        args: ['0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73', '1'],
      },
    });

    assert.equal(result.isError, true, 'a nonpayable function must be rejected');
    assert.match(result.content[0].text, /read-only and refuses it/);
  });

  test('a malformed address returns an actionable error, not a crash', async () => {
    const result = await client.callTool({
      name: 'get_balance',
      arguments: { address: 'definitely-not-an-address' },
    });

    assert.equal(result.isError, true);
    assert.match(result.content[0].text, /not a valid EVM address/);
    assert.match(result.content[0].text, /0x-prefixed 20-byte hex/);
  });

  test('the server survives a bad call and still answers the next one', async () => {
    // The whole point of the guard() boundary: one bad argument must not take
    // the process down, or the host loses every subsequent tool call.
    await client.callTool({ name: 'get_token_info', arguments: { token: 'garbage' } });
    const { tools } = await client.listTools();
    assert.equal(tools.length, EXPECTED_TOOLS.length);
  });

  test('search_pairs requires one of query or pair_address', async () => {
    const result = await client.callTool({ name: 'search_pairs', arguments: {} });
    assert.equal(result.isError, true);
    assert.match(result.content[0].text, /Provide either "query" or "pair_address"/);
  });

  test('read_contract rejects an unparseable ABI with guidance', async () => {
    const result = await client.callTool({
      name: 'read_contract',
      arguments: {
        address: '0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168',
        abi: 'this is not a signature',
        function_name: 'decimals',
      },
    });

    assert.equal(result.isError, true);
    assert.match(result.content[0].text, /Could not parse the ABI signature/);
  });

  test('read_contract rejects a function absent from the supplied ABI', async () => {
    const result = await client.callTool({
      name: 'read_contract',
      arguments: {
        address: '0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168',
        abi: 'function decimals() view returns (uint8)',
        function_name: 'totalSupply',
      },
    });

    assert.equal(result.isError, true);
    assert.match(result.content[0].text, /does not define a function named "totalSupply"/);
    assert.match(result.content[0].text, /Functions found in the ABI: decimals/);
  });
});

describe('bin entry point', () => {
  test('starts when invoked through a symlink, the way npm installs bin', async () => {
    // Regression: npm links bin as a symlink, so process.argv[1] is the link
    // path while import.meta.url is the real path. Comparing them raw made the
    // server start, print nothing, and exit 0 under npx while working fine when
    // run as `node src/server.mjs`.
    const { mkdtempSync, symlinkSync, rmSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');

    const dir = mkdtempSync(join(tmpdir(), 'rh-mcp-bin-'));
    const link = join(dir, 'robinhood-chain-mcp');
    symlinkSync(SERVER, link);

    try {
      const client = new Client({ name: 'symlink-check', version: '1.0.0' });
      await client.connect(new StdioClientTransport({ command: process.execPath, args: [link] }));
      const { tools } = await client.listTools();
      assert.equal(tools.length, EXPECTED_TOOLS.length, 'server must serve tools when launched via symlink');
      await client.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('signing surface', () => {
  test('the package declares no signing dependency', async () => {
    const { readFileSync } = await import('node:fs');
    const manifest = JSON.parse(
      readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'package.json'), 'utf8'),
    );
    const deps = Object.keys(manifest.dependencies ?? {});

    // viem ships signing under viem/accounts, which this package never imports.
    // Anything below would be a signing capability arriving through the door.
    for (const banned of ['ethers', 'web3', '@scure/bip39', '@scure/bip32', 'bip39']) {
      assert.ok(!deps.includes(banned), `unexpected signing dependency: ${banned}`);
    }
  });

  test('no source file imports a signing primitive', async () => {
    const { readdirSync, readFileSync } = await import('node:fs');
    const srcDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');

    for (const file of readdirSync(srcDir).filter((name) => name.endsWith('.mjs'))) {
      const source = readFileSync(join(srcDir, file), 'utf8');
      const imports = source.match(/^import[\s\S]*?from\s+['"][^'"]+['"]/gm) ?? [];
      const joined = imports.join('\n');

      assert.doesNotMatch(joined, /viem\/accounts/, `${file} imports viem/accounts`);
      assert.doesNotMatch(joined, /createWalletClient/, `${file} imports createWalletClient`);
      assert.doesNotMatch(joined, /privateKeyToAccount|mnemonicToAccount/, `${file} imports a key loader`);
    }
  });
});
