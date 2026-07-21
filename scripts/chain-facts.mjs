/* built by nirholas x.com/nichxbt */
/**
 * robinhood-toolkit · chain fact prober
 * Author: nirholas · https://github.com/nirholas/robinhood-toolkit
 * License: All Rights Reserved (c) 2026 nirholas
 */
import { createPublicClient, defineChain, http, formatGwei } from 'viem';
import { mkdir, writeFile } from 'node:fs/promises';

export const robinhoodMainnet = defineChain({
  id: 4663,
  name: 'Robinhood Chain',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: ['https://rpc.mainnet.chain.robinhood.com'] } },
  blockExplorers: {
    default: { name: 'Blockscout', url: 'https://robinhoodchain.blockscout.com' },
  },
});

export const robinhoodTestnet = defineChain({
  id: 46630,
  name: 'Robinhood Chain Testnet',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: ['https://rpc.testnet.chain.robinhood.com'] } },
  blockExplorers: {
    default: { name: 'Blockscout', url: 'https://explorer.testnet.chain.robinhood.com' },
  },
  testnet: true,
});

// Nitro block timestamps have second granularity. With sub-second cadence a
// small sample resolves to 0 or a wildly wrong figure, so sample wide.
const SAMPLE = 1000n;

async function probe(chain) {
  const client = createPublicClient({ chain, transport: http() });

  const [chainId, head, gasPrice, clientVersion] = await Promise.all([
    client.getChainId(),
    client.getBlockNumber(),
    client.getGasPrice(),
    client.request({ method: 'web3_clientVersion' }).catch(() => null),
  ]);

  const [newest, older] = await Promise.all([
    client.getBlock({ blockNumber: head }),
    client.getBlock({ blockNumber: head - SAMPLE }),
  ]);

  const spanSeconds = Number(newest.timestamp - older.timestamp);
  const msPerBlock = (spanSeconds * 1000) / Number(SAMPLE);

  // web3_clientVersion is not guaranteed by every gateway. Report unknown
  // rather than failing the run when it is absent.
  const looksLikeNitro = clientVersion == null ? null : /nitro/i.test(clientVersion);

  return {
    network: chain.name,
    chainId,
    chainIdHex: `0x${chainId.toString(16)}`,
    expectedChainId: chain.id,
    chainIdMatches: chainId === chain.id,
    head: head.toString(),
    gasPriceWei: gasPrice.toString(),
    gasPriceGwei: formatGwei(gasPrice),
    msPerBlock: Number(msPerBlock.toFixed(1)),
    clientVersion,
    looksLikeNitro,
    gasToken: chain.nativeCurrency.symbol,
    sampledBlocks: Number(SAMPLE),
    observedAt: new Date().toISOString(),
  };
}

const results = [];
for (const chain of [robinhoodMainnet, robinhoodTestnet]) {
  try {
    results.push(await probe(chain));
  } catch (err) {
    results.push({ network: chain.name, error: String(err?.shortMessage ?? err) });
  }
}

await mkdir('reports', { recursive: true });
await writeFile('reports/chain-facts.json', JSON.stringify(results, null, 2));
console.table(results);
/* built by nirholas x.com/nichxbt */
