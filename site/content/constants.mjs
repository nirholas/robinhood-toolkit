/* built by nirholas x.com/nichxbt */
/**
 * robinhood-toolkit · verified network constants used across the site
 * Author: nirholas · https://github.com/nirholas/robinhood-toolkit
 * License: All Rights Reserved (c) 2026 nirholas
 *
 * Every value here was confirmed against a live source rather than copied from
 * documentation. The chain IDs and RPC endpoints were verified by direct
 * eth_chainId calls; mainnet returns 0x1237, which is 4663.
 */

export const NETWORKS = {
  mainnet: {
    name: 'Robinhood Chain mainnet',
    chainId: 4663,
    chainIdHex: '0x1237',
    rpc: 'https://rpc.mainnet.chain.robinhood.com',
    explorer: 'https://robinhoodchain.blockscout.com',
    feed: 'wss://feed.mainnet.chain.robinhood.com',
    gasToken: 'ETH',
    faucet: null
  },
  testnet: {
    name: 'Robinhood Chain testnet',
    chainId: 46630,
    chainIdHex: '0xb626',
    rpc: 'https://rpc.testnet.chain.robinhood.com',
    explorer: 'https://explorer.testnet.chain.robinhood.com',
    feed: 'wss://feed.testnet.chain.robinhood.com',
    gasToken: 'ETH',
    faucet: 'https://faucet.testnet.chain.robinhood.com'
  }
}

export const CONTRACTS = {
  weth: '0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73',
  usdg: '0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168'
}

/**
 * Read on-chain via eth_call on 2026-07-20. Decimals matter: the canonical USDG
 * is a 6-decimal token, and at least one impostor sharing its ticker is an
 * 18-decimal token. Assuming 18 everywhere is a six-order-of-magnitude bug.
 */
export const TOKEN_FACTS = {
  [CONTRACTS.weth]: { symbol: 'WETH', name: 'WETH', decimals: 18 },
  [CONTRACTS.usdg]: { symbol: 'USDG', name: 'Global Dollar', decimals: 6 }
}

export const LINKS = {
  chainDocs: 'https://docs.robinhood.com/chain/',
  cryptoDocs: 'https://docs.robinhood.com/crypto/trading',
  mcpEndpoint: 'https://agent.robinhood.com/mcp/trading',
  l2beat: 'https://l2beat.com/scaling/projects/robinhood',
  dexscreener: 'https://dexscreener.com/robinhood',
  tradingview: 'https://www.tradingview.com/',
  lightweightCharts: 'https://github.com/tradingview/lightweight-charts'
}

/** Common function selectors used by the read-only eth_call widgets. */
export const SELECTORS = {
  symbol: '0x95d89b41',
  name: '0x06fdde03',
  decimals: '0x313ce567',
  totalSupply: '0x18160ddd'
}
/* built by nirholas x.com/nichxbt */
