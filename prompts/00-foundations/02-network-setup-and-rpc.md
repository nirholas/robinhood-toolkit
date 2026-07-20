<!--
  robinhood-toolkit · build prompt: network definitions, RPC clients, and failover
  Author: nirholas · https://github.com/nirholas/robinhood-toolkit
  License: MIT (c) 2026 nirholas
-->

# 02 · Network setup and RPC

## Goal

Build a small, reusable network package that every other prompt in this repo
imports: typed chain definitions for both networks, a public client factory with
transport failover, a WebSocket sequencer feed reader, and an EIP-3085 payload
for adding the network to a browser wallet. One definition, no copy-pasted
chain IDs scattered across a codebase.

## Prerequisites

- Node 20+, `npm i viem ws`.
- Completed prompt 01 (you have the observed chain facts to assert against).
- Optional: an Alchemy account if you want the recommended commercial RPC. Not
  required for anything in this prompt to run.

## Reference facts (verified)

| | Mainnet | Testnet |
|---|---|---|
| Chain ID | 4663 (`0x1237`) | 46630 (`0xb626`) |
| Public RPC | `https://rpc.mainnet.chain.robinhood.com` | `https://rpc.testnet.chain.robinhood.com` |
| Explorer | `https://robinhoodchain.blockscout.com` | `https://explorer.testnet.chain.robinhood.com` |
| Sequencer feed | `wss://feed.mainnet.chain.robinhood.com` | `wss://feed.testnet.chain.robinhood.com` |
| Gas token | ETH | ETH |

- Recommended commercial provider: Alchemy, at
  `https://robinhood-mainnet.g.alchemy.com/v2/{API_KEY}`. This requires your own
  API key. It is a template, never a copy-paste endpoint. A literal
  `{API_KEY}` in a config file is a bug, not a placeholder.
- Stack is Arbitrum Nitro, so Arbitrum-specific RPC namespaces and precompiles
  are available in addition to standard Ethereum JSON-RPC. `web3_clientVersion`
  returned `nitro/v3.11.3-rc.4-4bed0c5` on both networks on 2026-07-20.
- Multicall3 is deployed at the canonical `0xcA11bde05977b3631167028862bE2a173976CA11`
  on both networks, bytecode confirmed. Declare it in the chain definition or
  `client.multicall()` throws.
- The two networks are configured differently. Observed mainnet block cadence
  approximately 101 ms at approximately 0.056 gwei; testnet approximately 432 ms
  at a flat 0.01 gwei. Do not tune one against measurements from the other.
- Connection docs: <https://docs.robinhood.com/chain/connecting/>
- Rate limits on the public RPC endpoints are UNVERIFIED. Do not publish a
  requests-per-second figure. Measure it yourself under your own load, or use a
  keyed provider where the limit is contractual.

## Steps

1. Create `packages/network/src/chains.ts`. Export `robinhoodMainnet` and
   `robinhoodTestnet` via viem's `defineChain`. Include `nativeCurrency` as ETH
   with 18 decimals, both `rpcUrls` and `blockExplorers`, and `testnet: true` on
   the testnet definition.
2. Export a `byChainId` lookup and a `CHAINS` array so callers can resolve a
   network from a numeric ID without a switch statement.
3. Create `packages/network/src/client.ts` exporting `publicClientFor(chain, opts)`.
   Build the transport with viem's `fallback([...])`, putting a keyed provider
   first when its env var is present and the public endpoint second. `fallback`
   gives you automatic failover on transport error, which a bare `http()` does
   not.
4. Enable request batching on the transport. At approximately 101 ms block
   times, an indexer issuing one request per block per field will hit whatever
   the rate limit turns out to be. Batching collapses those into single calls.
5. Create `packages/network/src/feed.ts`, a reader for the sequencer WebSocket
   feed. Reconnect with exponential backoff and a jitter term. The feed emits
   sequenced batches ahead of settlement, so it is the lowest-latency signal
   available.

   The frame shape below was observed live on the testnet feed on 2026-07-20.
   It is the standard Arbitrum Nitro broadcaster envelope. Treat it as observed
   behavior, not a documented contract, and keep the parser tolerant:

   ```json
   {
     "version": 1,
     "messages": [
       {
         "sequenceNumber": 91812174,
         "message": { "message": { }, "delayedMessagesRead": 404717 },
         "blockHash": "0xc16646d6...",
         "signatureV2": "clGbNSOEQJEj..."
       }
     ]
   }
   ```

   Key the reader off `sequenceNumber` for ordering and gap detection. A gap in
   the sequence means you dropped frames and must backfill over RPC, so track
   the last seen number and compare on every batch.
6. Create `packages/network/src/wallet-config.ts` exporting an EIP-3085
   `wallet_addEthereumChain` parameter object for each network. Chain IDs go in
   as hex strings, `0x1237` and `0xb626`, not decimals.
7. Add a `README.md` in `packages/network/` per the repo documentation rule:
   what it exports, one runnable example, and the failover behavior.

```ts
/**
 * robinhood-toolkit · network definitions and client factory
 * Author: nirholas · https://github.com/nirholas/robinhood-toolkit
 * License: MIT (c) 2026 nirholas
 */
import { createPublicClient, defineChain, fallback, http } from 'viem';

/**
 * Multicall3 at the canonical cross-chain address. Bytecode confirmed present
 * on BOTH networks on 2026-07-20. Declaring it here is load-bearing: viem's
 * client.multicall() THROWS ChainDoesNotSupportContract when the chain
 * definition omits it. It does not silently fall back to individual calls.
 */
const MULTICALL3 = '0xcA11bde05977b3631167028862bE2a173976CA11' as const;

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

export const CHAINS = [robinhoodMainnet, robinhoodTestnet] as const;
export const byChainId = Object.fromEntries(CHAINS.map((c) => [c.id, c]));

/**
 * Keyed provider first when ALCHEMY_API_KEY is set, public RPC as the backstop.
 * Never hardcode a key. An unset key simply drops that rung of the chain.
 */
export function publicClientFor(chain = robinhoodMainnet) {
  const urls: string[] = [];

  const key = process.env.ALCHEMY_API_KEY;
  if (key && chain.id === robinhoodMainnet.id) {
    urls.push(`https://robinhood-mainnet.g.alchemy.com/v2/${key}`);
  }
  urls.push(chain.rpcUrls.default.http[0]);

  return createPublicClient({
    chain,
    transport: fallback(
      urls.map((url) =>
        http(url, {
          batch: { wait: 16 },
          retryCount: 3,
          retryDelay: 150,
          timeout: 10_000,
        }),
      ),
      { rank: false },
    ),
  });
}
```

The wallet payload, hex chain IDs:

```ts
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
} as const;
```

A minimal feed reader, schema derived at runtime:

```js
/**
 * robinhood-toolkit · sequencer feed probe
 * Author: nirholas · https://github.com/nirholas/robinhood-toolkit
 * License: MIT (c) 2026 nirholas
 */
import WebSocket from 'ws';

const url = process.env.FEED_URL ?? 'wss://feed.testnet.chain.robinhood.com';
let attempt = 0;

function connect() {
  const ws = new WebSocket(url);

  ws.on('open', () => {
    attempt = 0;
    console.log('[feed] connected', url);
  });

  ws.on('message', (raw) => {
    // Schema is UNVERIFIED. Log the first frames, then type what you observe.
    const text = raw.toString();
    try {
      console.dir(JSON.parse(text), { depth: 3 });
    } catch {
      console.log('[feed] non-JSON frame', text.slice(0, 200));
    }
  });

  ws.on('close', () => {
    const delay = Math.min(30_000, 2 ** attempt++ * 500) + Math.random() * 250;
    console.warn(`[feed] closed, reconnecting in ${Math.round(delay)}ms`);
    setTimeout(connect, delay);
  });

  ws.on('error', (err) => console.error('[feed] error', err.message));
}

connect();
```

## Deliverable

- `packages/network/` containing `chains.ts`, `client.ts`, `feed.ts`,
  `wallet-config.ts`, and `README.md`, all carrying attribution headers.
- No chain ID, RPC URL, or explorer URL literal anywhere else in the repo. Later
  prompts import from this package.

## How to verify

1. Chain IDs agree with the network, both directions:

```sh
curl -s https://rpc.testnet.chain.robinhood.com \
  -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}'
```

Expected `0xb626`. Mainnet returns `0x1237`.

2. Failover actually fails over. Set `ALCHEMY_API_KEY` to a deliberately invalid
   value and confirm `publicClientFor(robinhoodMainnet).getBlockNumber()` still
   resolves via the public rung. If it throws, your transport is not wrapped in
   `fallback`.
3. The feed connects and emits frames within a few seconds:
   `FEED_URL=wss://feed.testnet.chain.robinhood.com node feed.mjs`.
   Verified 2026-07-20: connects immediately and streams `version: 1` envelopes
   with monotonically increasing `sequenceNumber` values. If you see the
   reconnect backoff message repeatedly, the failure is your egress, not the
   feed.
4. In a browser wallet, `wallet_addEthereumChain` with the mainnet payload adds
   the network and the wallet reports chain 4663.

## Gotchas

- EIP-3085 requires the hex chain ID as a string. Passing `4663` instead of
  `'0x1237'` fails with an opaque wallet error.
- The Alchemy URL is a template. Interpolate from an env var. Committing
  `https://robinhood-mainnet.g.alchemy.com/v2/{API_KEY}` verbatim into a config
  produces a runtime 401 that reads like a network outage.
- Alchemy's Robinhood host is mainnet-shaped in the verified fact. A testnet
  equivalent is UNVERIFIED. Do not derive one by string substitution. Check the
  provider dashboard.
- `fallback` with `rank: true` sends latency probes and adds background load.
  Leave ranking off unless you have measured a reason to enable it.
- Sub-second blocks make naive polling loops expensive. Use batching, and prefer
  `watchBlockNumber` with a poll interval you chose deliberately over a
  per-iteration `getBlockNumber`.
- Public RPC rate limits are UNVERIFIED. Build backoff on 429 responses from day
  one instead of discovering the limit in production.
- Nitro exposes Arbitrum precompiles and extra RPC namespaces. Standard
  Ethereum JSON-RPC works, but do not assume L1 gas semantics: fee estimation on
  this stack accounts for an L1 data component.
