<!--
  robinhood-toolkit · build prompt: live execution engine, REST and on-chain
  Author: nirholas · https://github.com/nirholas/robinhood-toolkit
  License: MIT (c) 2026 nirholas
-->

# 05 · Execution engine

## Goal

Implement the live `Broker` port twice: once against the Robinhood Crypto REST
API, once against Robinhood Chain via viem. Both must be idempotent under
retry, both must pass every order through the policy engine and simulator
first, and both must be unreachable unless the operator explicitly enabled live
mode.

## Prerequisites

- Prompts 01 and 04 completed. The paper broker defines the contract this must
  match method for method.
- `npm i viem` inside `packages/agent`.
- REST credentials per track `20-crypto-api`. Chain execution needs a signer;
  read `prompts/80-safety/01-key-management.md` before you create one.
- `prompts/80-safety/02-policy-guardrails.md` and
  `prompts/80-safety/03-transaction-simulation.md` are hard prerequisites, not
  suggestions. Wire them before the first live order.

## Reference facts (verified)

| | Mainnet | Testnet |
|---|---|---|
| Chain ID | 4663 | 46630 |
| RPC | `https://rpc.mainnet.chain.robinhood.com` | `https://rpc.testnet.chain.robinhood.com` |
| Explorer | `https://robinhoodchain.blockscout.com` | `https://explorer.testnet.chain.robinhood.com` |
| Gas token | ETH | ETH |

- WETH `0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73` · USDG `0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168`
- Crypto REST API docs: <https://docs.robinhood.com/crypto/trading>. Read the
  current auth scheme, endpoint paths, rate limits, and order payload schema
  from that page. Do not hardcode a shape from memory or from an example you
  found elsewhere; the client below isolates every venue-specific detail in one
  module so a doc change is a one-file edit.
- Arbitrum Orbit chain, so `eth_estimateGas` returns an L2 figure that already
  embeds the L1 data cost. Do not add your own L1 surcharge on top.
- Observed gas price around 0.055 gwei. Cheap enough that gas is not a trading
  constraint, expensive enough that a loop stuck retrying a reverting
  transaction still burns real ETH.
- Robinhood does not supervise connected agents. There is no upstream circuit
  breaker on your order flow.

## Steps

1. Create `src/broker/live-rest.mjs`. Put every venue detail (base URL, auth
   header construction, path names, payload field names) in the top 30 lines so
   a docs change is a single localized edit.
2. Make `placeOrder` idempotent. Send the loop's `clientOrderId` as the venue's
   client-supplied order identifier so a retry after a network timeout does not
   create a second order. **A timeout is not a rejection.** The order may have
   landed. Never blind-retry a POST that spends money; re-query by client order
   ID first and only send if it is genuinely absent.
3. Implement a retry policy that distinguishes error classes: retry 5xx and
   network errors with exponential backoff and jitter; never retry 4xx; on 429
   respect the rate limit response and back off rather than tightening the loop.
4. Create `src/broker/onchain.mjs` using viem. Every transaction goes through
   `simulateContract` first (prompt `80-safety/03`), and the resulting `request`
   object is what you write, so the simulated call and the sent call cannot
   diverge.
5. Manage the nonce explicitly for the on-chain path. Two concurrent sends from
   the same account with an auto-fetched nonce collide, and on a 101 ms block
   chain that window is easy to hit. Serialize sends through a single queue per
   account.
6. Set a deadline on every send. If a transaction is not mined within N blocks,
   decide deliberately: replace with higher fee, or cancel with a zero-value
   self-send at the same nonce. Do not leave it pending and send another order
   on top.
7. Write a conformance test that runs identical assertions against the paper
   broker and each live broker, with the live brokers pointed at testnet 46630
   and a REST sandbox if one is available.

```js
/**
 * robinhood-toolkit · live REST broker
 * Author: nirholas · https://github.com/nirholas/robinhood-toolkit
 * License: MIT (c) 2026 nirholas
 */
// --- venue surface: verify every value below against
// --- https://docs.robinhood.com/crypto/trading before first live use
const BASE_URL = process.env.RH_CRYPTO_BASE_URL ?? 'https://trading.robinhood.com';
const ORDERS_PATH = process.env.RH_ORDERS_PATH ?? '/api/v1/crypto/trading/orders/';

export default function createRestBroker({ signRequest, fetchImpl = fetch, timeoutMs = 10_000 } = {}) {
  if (typeof signRequest !== 'function') {
    throw new Error('signRequest is required. See prompts/20-crypto-api for the auth scheme.');
  }

  async function call(method, path, body) {
    const payload = body ? JSON.stringify(body) : '';
    const headers = await signRequest({ method, path, body: payload });
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), timeoutMs);
    try {
      const res = await fetchImpl(`${BASE_URL}${path}`, {
        method,
        headers: { 'content-type': 'application/json', ...headers },
        body: payload || undefined,
        signal: ac.signal,
      });
      const text = await res.text();
      const json = text ? JSON.parse(text) : null;
      if (!res.ok) {
        const err = new Error(`${method} ${path} -> ${res.status}`);
        err.status = res.status;
        err.body = json;
        err.retryable = res.status >= 500 || res.status === 429;
        err.retryAfterMs = Number(res.headers.get('retry-after') ?? 0) * 1000;
        throw err;
      }
      return json;
    } finally {
      clearTimeout(t);
    }
  }

  async function withRetry(fn, { attempts = 3 } = {}) {
    let lastErr;
    for (let i = 0; i < attempts; i += 1) {
      try {
        return await fn();
      } catch (err) {
        lastErr = err;
        if (!err.retryable && err.status) throw err; // never retry a 4xx
        const backoff = err.retryAfterMs || Math.min(8000, 2 ** i * 500) + Math.random() * 250;
        await new Promise((r) => setTimeout(r, backoff));
      }
    }
    throw lastErr;
  }

  return {
    mode: 'live-rest',

    async placeOrder(intent) {
      // Idempotency: if the id already exists at the venue, adopt it instead of resending.
      const existing = await this.getOrder(intent.clientOrderId).catch(() => null);
      if (existing) return existing;

      return withRetry(() =>
        call('POST', ORDERS_PATH, {
          client_order_id: intent.clientOrderId,
          symbol: intent.symbol,
          side: intent.side,
          type: intent.type,
          [`${intent.type}_order_config`]: {
            quantity: String(intent.quantity),
            ...(intent.type === 'limit' ? { limit_price: String(intent.limitPrice) } : {}),
            time_in_force: intent.timeInForce ?? 'gtc',
          },
        }),
      );
    },

    async getOrder(clientOrderId) {
      return call('GET', `${ORDERS_PATH}?client_order_id=${encodeURIComponent(clientOrderId)}`)
        .then((r) => r?.results?.[0] ?? null);
    },

    async cancelOrder(id) {
      return call('POST', `${ORDERS_PATH}${encodeURIComponent(id)}/cancel/`);
    },

    async getPositions() {
      return call('GET', '/api/v1/crypto/trading/holdings/');
    },

    async getBalances() {
      return call('GET', '/api/v1/crypto/trading/accounts/');
    },
  };
}
```

```js
/**
 * robinhood-toolkit · on-chain broker for Robinhood Chain
 * Author: nirholas · https://github.com/nirholas/robinhood-toolkit
 * License: MIT (c) 2026 nirholas
 */
import { createPublicClient, createWalletClient, defineChain, http } from 'viem';

export const robinhoodMainnet = defineChain({
  id: 4663,
  name: 'Robinhood Chain',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: ['https://rpc.mainnet.chain.robinhood.com'] } },
  blockExplorers: { default: { name: 'Blockscout', url: 'https://robinhoodchain.blockscout.com' } },
});

export const robinhoodTestnet = defineChain({
  id: 46630,
  name: 'Robinhood Chain Testnet',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: ['https://rpc.testnet.chain.robinhood.com'] } },
  blockExplorers: { default: { name: 'Blockscout', url: 'https://explorer.testnet.chain.robinhood.com' } },
  testnet: true,
});

/** Serializes sends so two concurrent orders cannot claim the same nonce. */
function createSendQueue() {
  let tail = Promise.resolve();
  return (job) => {
    const run = tail.then(job, job);
    tail = run.catch(() => {});
    return run;
  };
}

export default function createOnchainBroker({ account, chain = robinhoodMainnet, confirmations = 1 } = {}) {
  const publicClient = createPublicClient({ chain, transport: http() });
  const walletClient = createWalletClient({ account, chain, transport: http() });
  const enqueue = createSendQueue();

  return {
    mode: `live-onchain:${chain.id}`,

    /** Simulate, then send exactly what was simulated. */
    async execute({ address, abi, functionName, args, value = 0n, deadlineBlocks = 20 }) {
      return enqueue(async () => {
        const { request, result } = await publicClient.simulateContract({
          account,
          address,
          abi,
          functionName,
          args,
          value,
        });

        const startBlock = await publicClient.getBlockNumber();
        const hash = await walletClient.writeContract(request);

        const receipt = await publicClient.waitForTransactionReceipt({
          hash,
          confirmations,
          timeout: 60_000,
        });

        const minedIn = Number(receipt.blockNumber - startBlock);
        if (minedIn > deadlineBlocks) {
          console.warn(`[chain] tx mined ${minedIn} blocks late: ${hash}`);
        }
        if (receipt.status !== 'success') {
          throw new Error(`transaction reverted on chain: ${hash}`);
        }

        return {
          hash,
          simulatedResult: result,
          blockNumber: receipt.blockNumber.toString(),
          gasUsed: receipt.gasUsed.toString(),
          effectiveGasPrice: receipt.effectiveGasPrice?.toString() ?? null,
          explorer: `${chain.blockExplorers.default.url}/tx/${hash}`,
        };
      });
    },

    async getBalances() {
      return { ETH: (await publicClient.getBalance({ address: account.address })).toString() };
    },
  };
}
```

## Deliverable

- `src/broker/live-rest.mjs` and `src/broker/onchain.mjs`.
- `src/broker/live.mjs` selecting a venue by `AGENT_VENUE=rest|chain`.
- `test/broker-conformance.test.js` running one assertion suite across paper,
  REST, and chain brokers.

## How to verify

```sh
cd packages/agent
node --test test/broker-conformance.test.js

# chain path on testnet only, funded testnet account required
AGENT_MODE=live AGENT_VENUE=chain AGENT_CHAIN=testnet \
AGENT_LIVE_CONFIRM=i-understand-this-spends-real-money \
node scripts/place-test-order.mjs
```

Confirm the resulting transaction on
`https://explorer.testnet.chain.robinhood.com`. Then confirm the REST path
against a single minimum-size order and check the fill appears in both the
venue's own order history and your audit journal from `80-safety/04`. If those
two disagree, stop and reconcile before scaling size.

## Gotchas

- **Timeouts are ambiguous, not negative.** The most expensive bug in
  algorithmic trading is retrying an order that already filled. Query by client
  order ID before every retry, without exception.
- Do not build the transaction and then simulate a different one. Use viem's
  `simulateContract` return value `request` verbatim as the write input. Any
  hand-assembled write after a simulation is an unsimulated write.
- Auto-nonce plus concurrency equals nonce collision. The send queue above is
  the minimum. If you run multiple agent processes, they need separate accounts
  or a shared nonce lease (prompt 07).
- `waitForTransactionReceipt` with a status of `reverted` is still a resolved
  promise. Check `receipt.status` explicitly. A revert that you treat as success
  will desync your position tracking from reality.
- The 4663 and 46630 chain IDs differ by a digit. Assert the connected chain ID
  at startup and refuse to run if it does not match the configured environment.
  Sending a mainnet-intended order to testnet is embarrassing; the reverse is
  expensive.
- Rate limits are venue policy and can change. Treat 429 as backpressure and
  slow the whole loop, not just the one call.
