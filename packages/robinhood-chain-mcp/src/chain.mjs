/**
 * robinhood-toolkit · Robinhood Chain network definitions and read-only clients
 * Author: nirholas · https://github.com/nirholas/robinhood-toolkit
 * License: All Rights Reserved (c) 2026 nirholas
 *
 * READ-ONLY BY DESIGN. This module creates viem *public* clients only. It never
 * imports createWalletClient, privateKeyToAccount, or any signing primitive.
 * There is deliberately no code path here that can produce a signature.
 */
import { createPublicClient, defineChain, http } from 'viem';

/**
 * Multicall3 at the canonical cross-chain address. Bytecode confirmed present on
 * BOTH networks (re-verified 2026-07-20 via eth_getCode). Declaring it is
 * load-bearing: viem's client.multicall() throws ChainDoesNotSupportContract
 * when the chain definition omits it rather than degrading to single calls.
 */
export const MULTICALL3 = '0xcA11bde05977b3631167028862bE2a173976CA11';

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

/** The two network slugs every tool accepts. */
export const NETWORKS = /** @type {const} */ (['mainnet', 'testnet']);

const CHAINS = { mainnet: robinhoodMainnet, testnet: robinhoodTestnet };

/**
 * Resolve a network slug to its chain definition. Callers pass a validated enum,
 * so an unknown slug here is a programming error rather than user input.
 */
export function chainFor(network = 'mainnet') {
  const chain = CHAINS[network];
  if (!chain) throw new Error(`unknown network "${network}"; expected one of ${NETWORKS.join(', ')}`);
  return chain;
}

/**
 * Per-network RPC override. Lets an operator point the server at a keyed
 * provider without editing code. An unset variable simply falls through to the
 * public endpoint, so the server works with zero configuration.
 */
function rpcUrlFor(network, chain) {
  const override =
    network === 'mainnet'
      ? process.env.ROBINHOOD_MAINNET_RPC_URL
      : process.env.ROBINHOOD_TESTNET_RPC_URL;
  return override?.trim() || chain.rpcUrls.default.http[0];
}

const clients = new Map();

/**
 * A cached public client per network. Caching matters: an MCP host may issue
 * many tool calls against one long-lived process, and request batching only
 * coalesces across calls that share a transport.
 */
export function publicClientFor(network = 'mainnet') {
  const cached = clients.get(network);
  if (cached) return cached;

  const chain = chainFor(network);
  const client = createPublicClient({
    chain,
    transport: http(rpcUrlFor(network, chain), {
      // ~101ms blocks on mainnet: batching keeps a burst of reads to one round trip.
      batch: { wait: 16 },
      retryCount: 3,
      retryDelay: 150,
      timeout: 15_000,
    }),
  });

  clients.set(network, client);
  return client;
}

/** Explorer deep link for an address, transaction, or token. */
export function explorerUrl(network, kind, value) {
  const base = chainFor(network).blockExplorers.default.url;
  return `${base}/${kind}/${value}`;
}
