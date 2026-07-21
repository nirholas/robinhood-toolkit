/**
 * robinhood-toolkit · EIP-3085 wallet_addEthereumChain payloads
 * Author: nirholas · https://github.com/nirholas/robinhood-toolkit
 * License: MIT (c) 2026 nirholas
 *
 * Dependency-free on purpose: a browser ES module (apps/connect) imports this
 * file directly. EIP-3085 requires the hex chain ID as a string — `0x1237`,
 * not `4663`. Passing the decimal fails with an opaque wallet error.
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
};
