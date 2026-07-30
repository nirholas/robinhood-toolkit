/* built by nirholas x.com/nichxbt */
/**
 * robinhood-toolkit · ERC-20 reader on Robinhood Chain
 * Author: nirholas · https://github.com/nirholas/robinhood-toolkit
 * License: All Rights Reserved (c) 2026 nirholas
 */
import { createPublicClient, defineChain, http, erc20Abi, formatUnits, getAddress } from "viem";

export const robinhoodTestnet = defineChain({
  id: 46630,
  name: "Robinhood Chain Testnet",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.testnet.chain.robinhood.com"] } },
  blockExplorers: {
    default: { name: "Blockscout", url: "https://explorer.testnet.chain.robinhood.com" },
  },
  testnet: true,
});

export const robinhoodMainnet = defineChain({
  id: 4663,
  name: "Robinhood Chain",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.mainnet.chain.robinhood.com"] } },
  blockExplorers: {
    default: { name: "Blockscout", url: "https://robinhoodchain.blockscout.com" },
  },
});

export async function readToken(client, tokenAddress, holder) {
  const token = getAddress(tokenAddress);
  const contract = { address: token, abi: erc20Abi };

  const [name, symbol, decimals, totalSupply] = await Promise.all([
    client.readContract({ ...contract, functionName: "name" }),
    client.readContract({ ...contract, functionName: "symbol" }),
    client.readContract({ ...contract, functionName: "decimals" }),
    client.readContract({ ...contract, functionName: "totalSupply" }),
  ]);

  const balance = holder
    ? await client.readContract({ ...contract, functionName: "balanceOf", args: [getAddress(holder)] })
    : 0n;

  return {
    address: token,
    name,
    symbol,
    decimals,
    totalSupply: formatUnits(totalSupply, decimals),
    balance: formatUnits(balance, decimals),
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [, , tokenArg, holderArg] = process.argv;
  if (!tokenArg) {
    console.error("usage: node clients/token.mjs <tokenAddress> [holderAddress]");
    process.exit(1);
  }
  const client = createPublicClient({ chain: robinhoodTestnet, transport: http() });
  console.log(await readToken(client, tokenArg, holderArg));
}
/* built by nirholas x.com/nichxbt */
