/* built by nirholas x.com/nichxbt */
/**
 * robinhood-toolkit · network · offline unit tests
 * Author: nirholas · https://github.com/nirholas/robinhood-toolkit
 * License: All Rights Reserved (c) 2026 nirholas
 *
 * Pure structural checks — no network. The live verification steps (chain IDs
 * over eth_chainId, failover, feed streaming) live in the package README.
 * Run the live smoke against a network with RH_LIVE_TESTS=1.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { numberToHex } from 'viem';

import {
  robinhoodMainnet,
  robinhoodTestnet,
  CHAINS,
  byChainId,
  publicClientFor,
  transportFor,
} from '../src/chains.js';
import { addChainParams } from '../src/wallet-config.js';

const MULTICALL3 = '0xcA11bde05977b3631167028862bE2a173976CA11';

test('chain definitions carry the verified facts', () => {
  assert.equal(robinhoodMainnet.id, 4663);
  assert.equal(robinhoodTestnet.id, 46630);
  assert.equal(robinhoodTestnet.testnet, true);
  for (const chain of CHAINS) {
    assert.equal(chain.nativeCurrency.symbol, 'ETH');
    assert.equal(chain.nativeCurrency.decimals, 18);
    // Multicall3 is load-bearing: client.multicall() throws without it.
    assert.equal(chain.contracts.multicall3.address, MULTICALL3);
  }
});

test('byChainId resolves both networks without a switch', () => {
  assert.equal(byChainId[4663], robinhoodMainnet);
  assert.equal(byChainId[46630], robinhoodTestnet);
  assert.equal(byChainId[1], undefined);
  assert.equal(CHAINS.length, 2);
});

test('wallet payloads use hex string chain IDs derived from the chain defs', () => {
  // Hex, not decimal — passing 4663 fails with an opaque wallet error.
  assert.equal(addChainParams.mainnet.chainId, '0x1237');
  assert.equal(addChainParams.testnet.chainId, '0xb626');
  assert.equal(addChainParams.mainnet.chainId, numberToHex(robinhoodMainnet.id));
  assert.equal(addChainParams.testnet.chainId, numberToHex(robinhoodTestnet.id));
  // No literal drift between the wallet payload and the chain definition.
  assert.deepEqual(addChainParams.mainnet.rpcUrls, robinhoodMainnet.rpcUrls.default.http);
  assert.equal(
    addChainParams.testnet.blockExplorerUrls[0],
    robinhoodTestnet.blockExplorers.default.url,
  );
});

test('transportFor wraps rungs in a fallback so failover is possible', () => {
  const saved = process.env.ALCHEMY_API_KEY;
  try {
    // Keyed rung present only on mainnet, only when the key is set.
    process.env.ALCHEMY_API_KEY = 'test-key';
    const mainnet = transportFor(robinhoodMainnet)({ chain: robinhoodMainnet });
    assert.equal(mainnet.config.type, 'fallback');
    assert.equal(mainnet.value.transports.length, 2); // alchemy + public

    // Testnet has no verified Alchemy host: key is ignored, public rung only.
    const testnet = transportFor(robinhoodTestnet)({ chain: robinhoodTestnet });
    assert.equal(testnet.value.transports.length, 1);

    // No key: mainnet drops to the public rung alone.
    delete process.env.ALCHEMY_API_KEY;
    const bare = transportFor(robinhoodMainnet)({ chain: robinhoodMainnet });
    assert.equal(bare.value.transports.length, 1);
  } finally {
    if (saved === undefined) delete process.env.ALCHEMY_API_KEY;
    else process.env.ALCHEMY_API_KEY = saved;
  }
});

test('publicClientFor builds a client bound to the chain', () => {
  const client = publicClientFor(robinhoodTestnet);
  assert.equal(client.chain.id, 46630);
  assert.equal(typeof client.getBlockNumber, 'function');
  assert.equal(typeof client.multicall, 'function');
});
/* built by nirholas x.com/nichxbt */
