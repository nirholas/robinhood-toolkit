/**
 * robinhood-chain · chain definition tests
 * Author: nirholas · https://github.com/nirholas/robinhood-toolkit
 * License: All Rights Reserved (c) 2026 nirholas
 *
 * robinhood-toolkit · package: robinhood-chain
 */

import assert from 'node:assert/strict'
import test from 'node:test'

import {
  CHAINS,
  MULTICALL3_ADDRESS,
  UnsupportedChainError,
  addChainParams,
  getChain,
  isRobinhoodChain,
  robinhoodChain,
  robinhoodTestnet,
} from '../index.js'

test('mainnet is chain 4663 with ETH as the gas token', () => {
  assert.equal(robinhoodChain.id, 4663)
  assert.equal(robinhoodChain.nativeCurrency.symbol, 'ETH')
  assert.equal(robinhoodChain.nativeCurrency.decimals, 18)
  assert.equal(robinhoodChain.rpcUrls.default.http[0], 'https://rpc.mainnet.chain.robinhood.com')
  assert.equal(robinhoodChain.blockExplorers.default.url, 'https://robinhoodchain.blockscout.com')
  assert.notEqual(robinhoodChain.testnet, true)
})

test('testnet is chain 46630 and flagged as a testnet', () => {
  assert.equal(robinhoodTestnet.id, 46630)
  assert.equal(robinhoodTestnet.testnet, true)
  assert.equal(robinhoodTestnet.rpcUrls.default.http[0], 'https://rpc.testnet.chain.robinhood.com')
})

// This is the assertion that keeps viem's multicall() working. A chain
// definition without contracts.multicall3 makes client.multicall() throw
// ChainDoesNotSupportContract; it does not degrade to individual calls.
test('both chains declare Multicall3 at the canonical address', () => {
  for (const chain of CHAINS) {
    assert.equal(
      chain.contracts?.multicall3?.address,
      MULTICALL3_ADDRESS,
      `${chain.name} must declare contracts.multicall3 or viem multicall() throws`,
    )
  }
  assert.equal(MULTICALL3_ADDRESS, '0xcA11bde05977b3631167028862bE2a173976CA11')
})

test('getChain resolves both networks and throws on anything else', () => {
  assert.equal(getChain(4663).id, 4663)
  assert.equal(getChain('46630').id, 46630)
  assert.throws(() => getChain(1), UnsupportedChainError)
  assert.throws(() => getChain(1), /Supported: 4663, 46630/)
})

test('isRobinhoodChain distinguishes the two networks from Ethereum mainnet', () => {
  assert.equal(isRobinhoodChain(4663), true)
  assert.equal(isRobinhoodChain(46630), true)
  assert.equal(isRobinhoodChain(1), false)
})

// EIP-3085 requires hex STRING chain IDs. Passing 4663 fails with an opaque
// wallet error that names nothing useful.
test('EIP-3085 payloads use hex string chain IDs matching the numeric ones', () => {
  assert.equal(addChainParams.mainnet.chainId, '0x1237')
  assert.equal(addChainParams.testnet.chainId, '0xb626')
  assert.equal(Number(addChainParams.mainnet.chainId), robinhoodChain.id)
  assert.equal(Number(addChainParams.testnet.chainId), robinhoodTestnet.id)
})
