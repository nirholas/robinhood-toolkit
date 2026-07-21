/* built by nirholas x.com/nichxbt */
/**
 * robinhood-toolkit · Robinhood Chain definitions for the client modules
 * Author: nirholas · https://github.com/nirholas/robinhood-toolkit
 * License: All Rights Reserved (c) 2026 nirholas
 *
 * viem chain definitions shared by the clients/ modules (prompt 04). Values are
 * verified against the live networks: mainnet chain id 4663, testnet 46630.
 * Multicall3 bytecode is confirmed present on both networks, so declaring it is
 * safe and keeps client.multicall() from throwing ChainDoesNotSupportContract.
 */
import { defineChain } from "viem";

/** Multicall3 at its canonical cross-chain address; bytecode confirmed on both networks. */
export const MULTICALL3 = "0xcA11bde05977b3631167028862bE2a173976CA11";

export const robinhoodMainnet = defineChain({
  id: 4663,
  name: "Robinhood Chain",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.mainnet.chain.robinhood.com"] } },
  blockExplorers: {
    default: { name: "Blockscout", url: "https://robinhoodchain.blockscout.com" },
  },
  contracts: { multicall3: { address: MULTICALL3 } },
});

export const robinhoodTestnet = defineChain({
  id: 46630,
  name: "Robinhood Chain Testnet",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.testnet.chain.robinhood.com"] } },
  blockExplorers: {
    default: { name: "Blockscout", url: "https://explorer.testnet.chain.robinhood.com" },
  },
  contracts: { multicall3: { address: MULTICALL3 } },
  testnet: true,
});
/* built by nirholas x.com/nichxbt */
