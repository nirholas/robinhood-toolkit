/* built by nirholas x.com/nichxbt */
/**
 * robinhood-toolkit · robinhood-chain-mcp live-chain tests
 * Author: nirholas · https://github.com/nirholas/robinhood-toolkit
 * License: All Rights Reserved (c) 2026 nirholas
 *
 * These hit Robinhood Chain mainnet and the DexScreener API for real. They are
 * skipped unless ROBINHOOD_MCP_LIVE=1, so a default `npm test` stays offline,
 * deterministic, and safe to run in CI without depending on a third party.
 *
 *   npm run test:live
 *
 * Everything read here is public state. Nothing is signed and nothing is sent.
 */
import { strict as assert } from 'node:assert';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import test, { after, before, describe } from 'node:test';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const SERVER = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'server.mjs');
const LIVE = process.env.ROBINHOOD_MCP_LIVE === '1';

// Verified on mainnet 2026-07-20.
const USDG_REAL = '0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168'; // Global Dollar, 6 decimals
const USDG_FAKE = '0x8218d73C00567A01481495Ad6c5143e00D5BB5b4'; // "Useless Stupid Degen Gamblers", 18 decimals
const WETH = '0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73';
const LIVE_PAIR = '0x95f9B0AF9282A22F7ef57058e65098db3f667f95';

describe('live chain reads', { skip: LIVE ? false : 'set ROBINHOOD_MCP_LIVE=1 to run live-chain tests' }, () => {
  let client;

  const call = async (name, args = {}) => {
    const result = await client.callTool({ name, arguments: args });
    assert.notEqual(result.isError, true, `${name} failed: ${result.content?.[0]?.text}`);
    return JSON.parse(result.content[0].text);
  };

  before(async () => {
    client = new Client({ name: 'robinhood-chain-mcp-live', version: '1.0.0' });
    await client.connect(new StdioClientTransport({ command: process.execPath, args: [SERVER] }));
  });

  after(async () => {
    await client.close();
  });

  test('get_chain_info returns chain 4663 and a moving head', async () => {
    const info = await call('get_chain_info', { network: 'mainnet' });
    assert.equal(info.chainId, 4663);
    assert.equal(info.chainIdMatchesExpected, true);
    assert.ok(BigInt(info.latestBlock) > 0n);
    assert.match(info.clientVersion, /nitro/i, 'Robinhood Chain runs Arbitrum Nitro');
  });

  test('get_chain_info returns chain 46630 on testnet', async () => {
    const info = await call('get_chain_info', { network: 'testnet' });
    assert.equal(info.chainId, 46630);
    assert.equal(info.chainIdMatchesExpected, true);
  });

  test('get_token_info reads USDG decimals as 6, never a default of 18', async () => {
    const info = await call('get_token_info', { token: USDG_REAL });
    assert.equal(info.decimals, 6);
    assert.equal(info.name, 'Global Dollar');
    assert.equal(info.symbol, 'USDG');
    assert.equal(info.canonical.verified, true);
  });

  test('get_token_info reads WETH decimals as 18', async () => {
    const info = await call('get_token_info', { token: WETH });
    assert.equal(info.decimals, 18);
  });

  test('the impostor USDG really does report 18 decimals on chain', async () => {
    // This is what makes the collision dangerous rather than merely confusing:
    // the two tokens disagree on decimals as well as identity.
    const info = await call('get_token_info', { token: USDG_FAKE });
    assert.equal(info.symbol, 'USDG');
    assert.equal(info.decimals, 18);
    assert.equal(info.canonical, null);
  });

  test('verify_token_address flags the fake USDG as an impostor', async () => {
    const result = await call('verify_token_address', { symbol: 'USDG', address: USDG_FAKE });

    assert.equal(result.verdict, 'impostor');
    assert.equal(result.safeToUseAsClaimedTicker, false);
    assert.equal(result.symbolMatches, true, 'the impostor does report the symbol, which is the point');
    assert.equal(result.canonicalForSymbol.address, USDG_REAL);
    assert.ok(result.warnings.some((warning) => /DANGER/.test(warning)));
  });

  test('verify_token_address clears the real USDG as canonical', async () => {
    const result = await call('verify_token_address', { symbol: 'USDG', address: USDG_REAL });

    assert.equal(result.verdict, 'canonical');
    assert.equal(result.safeToUseAsClaimedTicker, true);
    assert.equal(result.onchain.decimals, 6);
  });

  test('verify_token_address rejects an address whose symbol does not match', async () => {
    const result = await call('verify_token_address', { symbol: 'USDG', address: WETH });
    assert.equal(result.verdict, 'symbol_mismatch');
    assert.equal(result.safeToUseAsClaimedTicker, false);
  });

  test('the USDG ticker collision is still live', async () => {
    const result = await call('verify_token_address', { symbol: 'USDG', address: USDG_REAL });
    if (result.tickerCollisionScan.status !== 'ok') {
      // DexScreener being unreachable must not fail the on-chain verdict.
      assert.equal(result.verdict, 'canonical');
      return;
    }
    assert.ok(
      result.tokensSharingThisTicker.length > 1,
      'expected more than one token on Robinhood Chain trading as USDG',
    );
  });

  test('get_balance returns a formatted native balance', async () => {
    const balance = await call('get_balance', { address: WETH });
    assert.equal(balance.chainId, 4663);
    assert.equal(balance.symbol, 'ETH');
    assert.equal(balance.decimals, 18);
    assert.ok(/^\d+(\.\d+)?$/.test(balance.formatted));
  });

  test('get_token_balance formats with on-chain decimals', async () => {
    const balance = await call('get_token_balance', { token: USDG_REAL, holder: WETH });
    assert.equal(balance.decimals, 6);
    assert.equal(balance.symbol, 'USDG');
    assert.match(balance.decimalsSource, /not assumed/);
  });

  test('read_contract calls a view function and decodes it', async () => {
    const result = await call('read_contract', {
      address: USDG_REAL,
      abi: 'function decimals() view returns (uint8)',
      function_name: 'decimals',
    });
    assert.equal(result.result, 6);
    assert.equal(result.stateMutability, 'view');
  });

  test('read_contract accepts a JSON ABI array as well as a signature', async () => {
    const result = await call('read_contract', {
      address: USDG_REAL,
      abi: JSON.stringify([
        { type: 'function', name: 'symbol', stateMutability: 'view', inputs: [], outputs: [{ type: 'string' }] },
      ]),
      function_name: 'symbol',
    });
    assert.equal(result.result, 'USDG');
  });

  test('search_pairs fetches the verified live pair', async () => {
    const result = await call('search_pairs', { pair_address: LIVE_PAIR });
    assert.equal(result.count, 1);
    assert.equal(result.chainSlug, 'robinhood');
    assert.equal(result.pairs[0].pairAddress, LIVE_PAIR);
    assert.equal(result.pairs[0].chainId, 'robinhood');
  });

  test('search_pairs warns when a query matches several distinct tokens', async () => {
    const result = await call('search_pairs', { query: 'USDG', limit: 30 });
    assert.equal(result.chainSlug, 'robinhood');
    if (result.distinctBaseTokens > 1) {
      assert.ok(result.warnings.some((warning) => /Symbols are not unique/.test(warning)));
    }
  });

  test('get_transaction resolves a real transaction taken from a recent block', async () => {
    // Pull a genuine hash off the chain rather than pinning one: at ~101ms
    // blocks a hardcoded hash ages out of any useful context immediately.
    const { publicClientFor } = await import('../src/chain.mjs');
    const rpc = publicClientFor('mainnet');

    let hash = null;
    let blockNumber = await rpc.getBlockNumber();
    for (let attempt = 0; attempt < 10 && !hash; attempt += 1) {
      const block = await rpc.getBlock({ blockNumber: blockNumber - BigInt(attempt) });
      hash = block.transactions[0] ?? null;
    }
    assert.ok(hash, 'expected at least one transaction in the last ten blocks');

    const result = await call('get_transaction', { hash });
    assert.equal(result.hash.toLowerCase(), hash.toLowerCase());
    assert.equal(result.chainId, 4663);
    assert.ok(['success', 'reverted', 'pending'].includes(result.status));
    assert.match(result.explorer, /robinhoodchain\.blockscout\.com\/tx\//);
  });

  test('a nonexistent transaction hash returns a helpful error, not a crash', async () => {
    const result = await client.callTool({
      name: 'get_transaction',
      arguments: { hash: `0x${'0'.repeat(63)}1` },
    });
    assert.equal(result.isError, true);
    assert.match(result.content[0].text, /was not found/);
  });
});
/* built by nirholas x.com/nichxbt */
