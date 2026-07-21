/**
 * robinhood-toolkit · network definitions (chains, lookup)
 * Author: nirholas · https://github.com/nirholas/robinhood-toolkit
 * License: All Rights Reserved (c) 2026 nirholas
 *
 * One definition of each network. No chain ID, RPC URL, or explorer URL
 * literal should appear anywhere else in the repo — import from here.
 */
import { defineChain } from 'viem';

/**
 * Multicall3 at the canonical cross-chain address. Bytecode confirmed present
 * on BOTH networks on 2026-07-20. Declaring it here is load-bearing: viem's
 * client.multicall() THROWS ChainDoesNotSupportContract when the chain
 * definition omits it. It does not silently fall back to individual calls.
 */
const MULTICALL3 = '0xcA11bde05977b3631167028862bE2a173976CA11';

export const robinhoodMainnet = defineChain({
  id: 4663,
  name: 'Robinhood Chain',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: ['https://rpc.mainnet.chain.robinhood.com'] } },
  blockExplorers: {
    default: { name: 'Blockscout', url: 'https://robinhoodchain.blockscout.com' },
  },
  contracts: { multicall3: { address: MULTICALL3 } },
});

export const robinhoodTestnet = defineChain({
  id: 46630,
  name: 'Robinhood Chain Testnet',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: ['https://rpc.testnet.chain.robinhood.com'] } },
  blockExplorers: {
    default: { name: 'Blockscout', url: 'https://explorer.testnet.chain.robinhood.com' },
  },
  contracts: { multicall3: { address: MULTICALL3 } },
  testnet: true,
});

export const CHAINS = [robinhoodMainnet, robinhoodTestnet];

/** Resolve a chain from a numeric ID without a switch statement. */
export const byChainId = Object.fromEntries(CHAINS.map((c) => [c.id, c]));

// Re-exported so callers can pull chains and the client factory from one place.
// Prompt 03's scripts import { publicClientFor, robinhoodMainnet, robinhoodTestnet }
// straight from this module.
export { publicClientFor, transportFor } from './client.js';
