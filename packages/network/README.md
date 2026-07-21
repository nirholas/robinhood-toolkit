<!--
  robinhood-toolkit · package readme: network
  Author: nirholas · https://github.com/nirholas/robinhood-toolkit
  License: MIT (c) 2026 nirholas
-->

# @robinhood-toolkit/network

One definition of each Robinhood Chain network, imported everywhere else in the
repo. No chain ID, RPC URL, or explorer URL literal should live anywhere but
here.

## Exports

| From | Export | What it is |
|---|---|---|
| `src/chains.js` | `robinhoodMainnet`, `robinhoodTestnet` | viem `defineChain` objects (ETH native, Multicall3 declared) |
| `src/chains.js` | `CHAINS`, `byChainId` | array + numeric-ID lookup, no switch statement |
| `src/client.js` | `publicClientFor(chain)` | read-only client on the failover transport |
| `src/client.js` | `transportFor(chain)` | the shared `fallback([...])` transport (wallet clients reuse it) |
| `src/wallet-config.js` | `addChainParams` | EIP-3085 `wallet_addEthereumChain` payloads, hex chain IDs |
| `src/feed.js` | `readFeed(opts)` | sequencer WebSocket reader with reconnect + gap detection |

`chains.js` re-exports `publicClientFor` and `transportFor` so callers can pull
chains and the client factory from a single import.

## Example

```js
import { publicClientFor, robinhoodTestnet } from '@robinhood-toolkit/network';

const client = publicClientFor(robinhoodTestnet);
console.log(await client.getBlockNumber());
```

## Failover

`transportFor` builds `fallback([...])`. When `ALCHEMY_API_KEY` is set (mainnet
only — a testnet Alchemy host is UNVERIFIED), the keyed provider is the first
rung and the public RPC is the backstop; on a transport error viem falls through
to the next rung automatically. Ranking is off by default (`rank: false`) to
avoid background latency probes. Requests are batched (`batch.wait: 16`) because
sub-second blocks make one-request-per-field polling expensive.

Verify failover: set `ALCHEMY_API_KEY` to a deliberately invalid value and
confirm `publicClientFor(robinhoodMainnet).getBlockNumber()` still resolves via
the public rung.
