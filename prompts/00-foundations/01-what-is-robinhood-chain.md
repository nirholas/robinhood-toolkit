<!--
  robinhood-toolkit · build prompt: orient on Robinhood Chain and verify its stack claims
  Author: nirholas · https://github.com/nirholas/robinhood-toolkit
  License: MIT (c) 2026 nirholas
-->

# 01 · What is Robinhood Chain

## Goal

Produce a machine-checked fact sheet for Robinhood Chain. Instead of trusting a
marketing page, you will query the live chain and emit a JSON report proving
chain ID, block cadence, gas price, gas token, and Arbitrum Nitro provenance.
This is the orientation artifact every later prompt in this repo builds on.

## Prerequisites

- Node 20+ and a package manager.
- `npm i viem` (v2). No API key required for this prompt.
- Outbound HTTPS to `*.chain.robinhood.com`.

## Reference facts (verified)

| | Mainnet | Testnet |
|---|---|---|
| Chain ID | 4663 (`0x1237`) | 46630 (`0xb626`) |
| RPC | `https://rpc.mainnet.chain.robinhood.com` | `https://rpc.testnet.chain.robinhood.com` |
| Explorer | `https://robinhoodchain.blockscout.com` | `https://explorer.testnet.chain.robinhood.com` |
| Sequencer feed | `wss://feed.mainnet.chain.robinhood.com` | `wss://feed.testnet.chain.robinhood.com` |
| Gas token | ETH | ETH |

- Stack: Arbitrum Orbit chain on the Nitro stack. Settles to Ethereum. Data
  availability via Ethereum blobs.
- Mainnet live 2026-07-01. Testnet running since 2026-02-10.
- Observed mainnet gas price approximately 0.055 gwei. Observed block time
  approximately 101 ms.
- Robinhood operates both the sequencer and the proposer. L2BEAT classifies the
  risk profile as "Other" because fewer than five external actors can submit
  fraud challenges. See prompt 06 for the full treatment.
- Docs root: <https://docs.robinhood.com/chain/>
- Legal: self-custody wallet services run through Robinhood Non-Custodial Ltd
  (Cayman Islands), a separate entity from Robinhood Financial LLC and Robinhood
  Crypto LLC. An on-chain balance on this network is not a brokerage balance.

Anything not in this table is UNVERIFIED. Check the live source before you
write it into a document that someone will act on.

## Steps

1. Create `scripts/chain-facts.mjs` with the attribution header from
   `ATTRIBUTION.md`.
2. Define both networks with `defineChain` rather than importing from
   `viem/chains`. Do not assume the chain ships in viem's registry.
3. For each network, call `eth_chainId`, `eth_blockNumber`, `eth_gasPrice`, and
   `web3_clientVersion`. The client version string is the Nitro provenance
   signal: an Orbit chain reports a Nitro build, not Geth.
4. Measure block cadence empirically. Read the newest block and a block 100
   behind it, then divide the timestamp delta. Nitro block timestamps are in
   seconds, so a sub-second cadence requires a wider sample to resolve. Sample
   1000 blocks and report milliseconds per block.
5. Assert each observed value against the reference table. Emit a report with a
   `pass` or `mismatch` verdict per field rather than throwing on the first
   difference. Gas price is a live market value, so compare it as an order of
   magnitude, not an equality.
6. Write the result to `reports/chain-facts.json` and print a summary table.

```js
/**
 * robinhood-toolkit · chain fact prober
 * Author: nirholas · https://github.com/nirholas/robinhood-toolkit
 * License: MIT (c) 2026 nirholas
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
    looksLikeNitro: /nitro/i.test(clientVersion ?? ''),
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
```

7. Write `docs/robinhood-chain-overview.md` from the JSON, not from memory. Every
   number in the prose must trace to a field in `reports/chain-facts.json`. Add
   the attribution header. Include a one-paragraph "what this chain is" summary:
   an Arbitrum Orbit rollup, ETH for gas, sub-second blocks, settling to Ethereum
   with blob data availability, operated by Robinhood.
8. Include the legal-separation note from the reference facts verbatim in intent.
   Readers arrive assuming their Robinhood app balance and their on-chain balance
   are the same pool. They are not. They are also not unrelated products. State
   both halves.

## Deliverable

- `scripts/chain-facts.mjs`, runnable with `node scripts/chain-facts.mjs`.
- `reports/chain-facts.json`, regenerated on every run.
- `docs/robinhood-chain-overview.md`, every figure sourced from the report.

## How to verify

```sh
node scripts/chain-facts.mjs
```

Expected, confirmed by running this script on 2026-07-20: `chainIdMatches` true
for both networks, `chainIdHex` of `0x1237` and `0xb626`, `looksLikeNitro` true
with `clientVersion` reporting `nitro/v3.11.3-rc.4-4bed0c5`, mainnet
`msPerBlock` 101 and `gasPriceGwei` approximately 0.056.

The two networks do not have matching cadence or pricing. Observed testnet
values were `msPerBlock` approximately 432 and `gasPriceGwei` 0.01. Do not
assert the mainnet figures against testnet. Cross-check the head block number against
<https://robinhoodchain.blockscout.com> in a browser. The two should agree
within a few seconds of drift.

A raw curl check, no dependencies:

```sh
curl -s https://rpc.mainnet.chain.robinhood.com \
  -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}'
```

Expected: `{"jsonrpc":"2.0","id":1,"result":"0x1237"}`.

## Gotchas

- `viem/chains` does not necessarily export this network. Define it yourself, as
  above, and export the definition so later prompts import one source of truth.
- Nitro block timestamps have second granularity. With approximately 101 ms
  blocks, a 10-block sample yields a cadence of 0 or a wildly wrong figure.
  Sample at least 1000 blocks.
- Gas price is live. Treat 0.055 gwei as an observed data point from
  2026-07-20, not a constant. Assert magnitude, never equality.
- Mainnet and testnet are not configured alike. Testnet blocks were observed at
  roughly 4x mainnet's interval and its gas price at a flat 0.01 gwei. Benchmark
  numbers taken on testnet do not transfer to mainnet.
- `web3_clientVersion` is not guaranteed to be exposed by every gateway. Handle
  a null and report `looksLikeNitro` as unknown rather than failing the run.
- Do not describe this chain as "Robinhood's blockchain for trading stocks on
  the app." The on-chain environment and the brokerage are distinct entities and
  distinct balances. Conflating them is the single most common error in
  third-party writeups.
- Block explorer hostnames differ in shape between the two networks
  (`robinhoodchain.blockscout.com` versus `explorer.testnet.chain.robinhood.com`).
  Do not pattern-match one from the other.