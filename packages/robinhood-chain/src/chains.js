/* built by nirholas x.com/nichxbt */
/**
 * robinhood-chain · viem chain definitions for Robinhood Chain mainnet and testnet
 * Author: nirholas · https://github.com/nirholas/robinhood-toolkit
 * License: All Rights Reserved (c) 2026 nirholas
 *
 * robinhood-toolkit · package: robinhood-chain
 */

import { defineChain } from 'viem'
import { UnsupportedChainError } from './errors.js'

/**
 * Multicall3 at the canonical cross-chain address. Bytecode confirmed present on
 * BOTH Robinhood Chain networks (7618 hex chars on mainnet, read 2026-07-20).
 *
 * Declaring this in the chain definition is load-bearing, not cosmetic: viem's
 * client.multicall() throws ChainDoesNotSupportContract when the chain has no
 * contracts.multicall3 entry. It does NOT fall back to individual eth_call
 * requests. The address is deployed and the calls are valid; viem refuses before
 * sending anything. This is the single most common way a fresh Robinhood Chain
 * project breaks.
 */
export const MULTICALL3_ADDRESS = '0xcA11bde05977b3631167028862bE2a173976CA11'

export const ROBINHOOD_MAINNET_ID = 4663
export const ROBINHOOD_TESTNET_ID = 46630

/**
 * Robinhood Chain mainnet. Arbitrum Orbit (Nitro), settles to Ethereum, blobs
 * for data availability. Public mainnet since 2026-07-01, permissionless deploys.
 *
 * Observed 2026-07-20: block cadence approximately 101 ms at approximately
 * 0.056 gwei. Roughly 850,000 blocks per day. Every block-range intuition
 * carried over from a 12-second L1 is off by two orders of magnitude here.
 */
export const robinhoodChain = /* @__PURE__ */ defineChain({
  id: ROBINHOOD_MAINNET_ID,
  name: 'Robinhood Chain',
  network: 'robinhood',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: {
    default: {
      http: ['https://rpc.mainnet.chain.robinhood.com'],
      webSocket: ['wss://feed.mainnet.chain.robinhood.com'],
    },
  },
  blockExplorers: {
    default: {
      name: 'Blockscout',
      url: 'https://robinhoodchain.blockscout.com',
      apiUrl: 'https://robinhoodchain.blockscout.com/api',
    },
  },
  contracts: {
    multicall3: { address: MULTICALL3_ADDRESS },
  },
})

/**
 * Robinhood Chain testnet. Observed cadence approximately 432 ms at a flat
 * 0.01 gwei, and materially more permissive RPC limits than mainnet because it
 * carries far less volume.
 *
 * Do not tune a scanner or an indexer against this network and ship those
 * constants to mainnet. A 1501-block eth_getLogs span succeeded here and is
 * rejected on mainnet.
 */
export const robinhoodTestnet = /* @__PURE__ */ defineChain({
  id: ROBINHOOD_TESTNET_ID,
  name: 'Robinhood Chain Testnet',
  network: 'robinhood-testnet',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: {
    default: {
      http: ['https://rpc.testnet.chain.robinhood.com'],
      webSocket: ['wss://feed.testnet.chain.robinhood.com'],
    },
  },
  blockExplorers: {
    default: {
      name: 'Blockscout',
      url: 'https://explorer.testnet.chain.robinhood.com',
      apiUrl: 'https://explorer.testnet.chain.robinhood.com/api',
    },
  },
  contracts: {
    multicall3: { address: MULTICALL3_ADDRESS },
  },
  testnet: true,
})

/** Both networks, mainnet first. */
export const CHAINS = [robinhoodChain, robinhoodTestnet]

/** Numeric chain ID to chain definition. */
export const chainsById = {
  [ROBINHOOD_MAINNET_ID]: robinhoodChain,
  [ROBINHOOD_TESTNET_ID]: robinhoodTestnet,
}

/**
 * Resolve a chain definition by numeric ID.
 * Throws UnsupportedChainError rather than returning undefined, so a wrong-chain
 * bug surfaces at the boundary instead of as a downstream property access on
 * undefined.
 */
export function getChain(chainId) {
  const chain = chainsById[Number(chainId)]
  if (!chain) throw new UnsupportedChainError(chainId, [ROBINHOOD_MAINNET_ID, ROBINHOOD_TESTNET_ID])
  return chain
}

/** True when the ID is one of the two Robinhood Chain networks. */
export function isRobinhoodChain(chainId) {
  return Object.hasOwn(chainsById, Number(chainId))
}

/**
 * EIP-3085 wallet_addEthereumChain payloads.
 *
 * Chain IDs are hex STRINGS here. Passing the decimal 4663 instead of '0x1237'
 * fails with an opaque wallet error that names nothing useful.
 */
export const addChainParams = {
  mainnet: {
    chainId: '0x1237',
    chainName: 'Robinhood Chain',
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    rpcUrls: ['https://rpc.mainnet.chain.robinhood.com'],
    blockExplorerUrls: ['https://robinhoodchain.blockscout.com'],
  },
  testnet: {
    chainId: '0xb626',
    chainName: 'Robinhood Chain Testnet',
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    rpcUrls: ['https://rpc.testnet.chain.robinhood.com'],
    blockExplorerUrls: ['https://explorer.testnet.chain.robinhood.com'],
  },
}

/**
 * Confirms Multicall3 bytecode is still present. Cheap, and it makes a
 * sequential fallback path testable instead of theoretical.
 */
export async function hasMulticall3(client) {
  const code = await client.getCode({ address: MULTICALL3_ADDRESS })
  return Boolean(code) && code !== '0x'
}
/* built by nirholas x.com/nichxbt */
