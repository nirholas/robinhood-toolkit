<!-- built by nirholas x.com/nichxbt -->
<!--
  robinhood-toolkit · build prompt: simulate before you send
  Author: nirholas · https://github.com/nirholas/robinhood-toolkit
  License: All Rights Reserved (c) 2026 nirholas
-->

# 03 · Transaction simulation

## Goal

Never send a transaction or an order whose outcome you have not predicted. You
will build a chain-side simulator that runs `eth_call` and asset-change analysis
against Robinhood Chain before every write, and an order-side preview that
validates a REST order against balances, minimums, and expected fill cost before
it is submitted. Both produce a diff a human or a policy engine can reject.

## Prerequisites

- `npm i viem` inside `packages/agent`.
- `prompts/50-autonomous/05-execution-engine.md` for the broker this plugs into.
- `prompts/80-safety/02-policy-guardrails.md`. Simulation output feeds the
  policy engine as context; simulation alone decides nothing.
- A funded testnet account on chain 46630 for verification.

## Reference facts (verified)

| | Mainnet | Testnet |
|---|---|---|
| Chain ID | 4663 | 46630 |
| RPC | `https://rpc.mainnet.chain.robinhood.com` | `https://rpc.testnet.chain.robinhood.com` |
| Explorer | `https://robinhoodchain.blockscout.com` | `https://explorer.testnet.chain.robinhood.com` |
| Gas token | ETH | ETH |

- WETH `0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73` · USDG `0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168`
- Arbitrum Orbit on Nitro, so `eth_call`, `eth_estimateGas`, and state overrides
  behave as they do on Arbitrum One. `eth_estimateGas` already includes the L1
  data component; do not add a surcharge.
- Observed gas price around 0.055 gwei and block time around 101 ms. Simulation
  latency, not gas, is your budget constraint: a simulate-then-send round trip
  spans multiple blocks, so the state you simulated against is already slightly
  stale by the time you send. Size your slippage tolerance accordingly.
- `debug_traceCall` and Tenderly-style bundle simulation are **UNVERIFIED** on
  this RPC. Probe for support at startup and degrade to `eth_call` plus balance
  diffing rather than assuming a namespace exists. The code below does that.
- Crypto REST API docs: <https://docs.robinhood.com/crypto/trading>. Check
  whether a dry-run or preview endpoint exists today; if not, the local preview
  below is the substitute and it must model fees the same way the paper broker
  does.

## Steps

1. Create `src/sim/probe.mjs`, run once at startup: call
   `eth_call`, `eth_estimateGas`, and `debug_traceCall` against a harmless
   target and record which succeed. Cache the capability set. Never call a
   method you have not confirmed exists on the live endpoint.
2. Create `src/sim/simulate.mjs`. For contract writes, use viem's
   `simulateContract`, which performs `eth_call` from your account and returns
   both the decoded result and a `request` object. **Send that exact `request`.**
   Hand-assembling a write after a simulation means you simulated one thing and
   sent another.
3. Add balance diffing. Snapshot the account's ETH balance and the balances of
   every token in the transaction's scope before and after, using `eth_call`
   with a block override where supported and a before/after read otherwise.
   Produce a signed delta per asset. The delta is what a human should approve,
   not the calldata.
4. Add invariant assertions that run against the simulated result and deny on
   failure: no asset the intent did not mention may decrease; ETH spend must not
   exceed `gasLimit * maxFeePerGas` plus the declared value; the receiving
   address must match the intent; output amount must be at least
   `minAmountOut`.
5. Simulate against the pending state (`blockTag: 'pending'`) so you account for
   your own queued transactions. Simulating against `latest` while you have a
   pending nonce gives you an answer for a state you have already left.
6. Create `src/sim/preview-order.mjs` for the REST side: fetch current best
   bid/ask and account balances, compute expected fill price with the same cost
   model as the paper broker, check the venue's minimum order size and any price
   band, and return the projected cash and position delta. Compare the actual
   fill afterwards and record the difference. Persistent divergence between
   preview and fill means your cost model is wrong and every backtest you have
   run is optimistic.
7. Feed the simulation result into the policy engine as context so notional
   caps are evaluated against the **simulated** outcome, not the intended one. A
   swap that intends 100 USDG and simulates to 4,000 USDG is exactly the case
   the cap exists for.

```js
/**
 * robinhood-toolkit · pre-send simulation with asset diffing
 * Author: nirholas · https://github.com/nirholas/robinhood-toolkit
 * License: All Rights Reserved (c) 2026 nirholas
 */
import { createPublicClient, defineChain, http, erc20Abi, formatEther } from 'viem';

export const robinhoodMainnet = defineChain({
  id: 4663,
  name: 'Robinhood Chain',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: ['https://rpc.mainnet.chain.robinhood.com'] } },
  blockExplorers: { default: { name: 'Blockscout', url: 'https://robinhoodchain.blockscout.com' } },
});

export const KNOWN_TOKENS = {
  WETH: '0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73',
  USDG: '0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168',
};

/** Detects which simulation methods this RPC actually supports. */
export async function probeCapabilities(client) {
  const caps = { ethCall: false, estimateGas: false, debugTraceCall: false };
  const probe = { to: KNOWN_TOKENS.USDG, data: '0x313ce567' }; // decimals()

  try { await client.call(probe); caps.ethCall = true; } catch {}
  try { await client.estimateGas({ ...probe }); caps.estimateGas = true; } catch {}
  try {
    await client.request({ method: 'debug_traceCall', params: [probe, 'latest', { tracer: 'callTracer' }] });
    caps.debugTraceCall = true;
  } catch {}

  if (!caps.ethCall) throw new Error('RPC does not support eth_call. Refusing to send unsimulated transactions.');
  return caps;
}

/**
 * Simulates a contract write and returns the asset deltas it would produce.
 * Throws on revert, which is the point: a revert here costs nothing.
 */
export async function simulateWrite({
  client,
  account,
  address,
  abi,
  functionName,
  args,
  value = 0n,
  watchTokens = Object.values(KNOWN_TOKENS),
}) {
  const before = await snapshot({ client, owner: account.address, tokens: watchTokens });

  const { request, result } = await client.simulateContract({
    account,
    address,
    abi,
    functionName,
    args,
    value,
    blockTag: 'pending', // account for our own queued transactions
  });

  const gas = await client.estimateGas({
    account,
    to: address,
    data: request.data ?? undefined,
    value,
  }).catch(() => null);

  const gasPrice = await client.getGasPrice();
  const maxGasCost = gas === null ? null : gas * gasPrice;

  // eth_call does not commit state, so post-state is derived from the decoded
  // result plus known gas cost rather than from a second read.
  return {
    simulated: true,
    request,
    decodedResult: result,
    balancesBefore: before,
    gasEstimate: gas?.toString() ?? null,
    gasPriceWei: gasPrice.toString(),
    maxGasCostWei: maxGasCost?.toString() ?? null,
    maxGasCostEth: maxGasCost === null ? null : formatEther(maxGasCost),
    simulatedAt: new Date().toISOString(),
  };
}

async function snapshot({ client, owner, tokens }) {
  const eth = await client.getBalance({ address: owner, blockTag: 'pending' });
  const entries = await Promise.all(
    tokens.map(async (token) => {
      const balance = await client.readContract({
        address: token, abi: erc20Abi, functionName: 'balanceOf', args: [owner],
      }).catch(() => null);
      return [token, balance?.toString() ?? null];
    }),
  );
  return { ETH: eth.toString(), ...Object.fromEntries(entries) };
}

/** Invariants that must hold or the send is denied. */
export function assertInvariants({ simulation, intent }) {
  const failures = [];

  if (!simulation.simulated) failures.push('transaction was not simulated');
  if (simulation.request.to?.toLowerCase() !== intent.to?.toLowerCase()) {
    failures.push(`recipient mismatch: simulated ${simulation.request.to}, intended ${intent.to}`);
  }
  if (intent.minAmountOut !== undefined) {
    const out = BigInt(simulation.decodedResult ?? 0);
    if (out < BigInt(intent.minAmountOut)) {
      failures.push(`output ${out} below minAmountOut ${intent.minAmountOut}`);
    }
  }
  if (intent.maxGasCostWei && simulation.maxGasCostWei) {
    if (BigInt(simulation.maxGasCostWei) > BigInt(intent.maxGasCostWei)) {
      failures.push(`gas cost ${simulation.maxGasCostEth} ETH exceeds budget`);
    }
  }

  return { ok: failures.length === 0, failures };
}
```

```js
/**
 * robinhood-toolkit · REST order preview
 * Author: nirholas · https://github.com/nirholas/robinhood-toolkit
 * License: All Rights Reserved (c) 2026 nirholas
 */
export async function previewOrder({ intent, quotes, broker, costs, minOrderNotional = 1 }) {
  const quote = await quotes.getQuote(intent.symbol);
  const balances = await broker.getBalances();
  const positions = await broker.getPositions();

  const reference = intent.type === 'limit' ? intent.limitPrice : (intent.side === 'buy' ? quote.ask : quote.bid);
  const expectedPrice = costs.fillPrice({
    side: intent.side,
    referencePrice: reference,
    quantity: intent.quantity,
    barVolume: quote.size ?? Infinity,
  });
  const fee = costs.fee({ price: expectedPrice, quantity: intent.quantity });
  const notional = expectedPrice * intent.quantity;

  const blockers = [];
  if (notional < minOrderNotional) blockers.push(`notional ${notional.toFixed(2)} below venue minimum`);
  if (intent.side === 'buy' && notional + fee > Number(balances.USD ?? 0)) {
    blockers.push(`insufficient cash: need ${(notional + fee).toFixed(2)}, have ${balances.USD}`);
  }
  if (intent.side === 'sell' && intent.quantity > Number(positions[intent.symbol] ?? 0)) {
    blockers.push(`insufficient position in ${intent.symbol}`);
  }
  const slippagePct = Math.abs((expectedPrice - reference) / reference) * 100;
  if (intent.maxSlippagePct && slippagePct > intent.maxSlippagePct) {
    blockers.push(`modeled slippage ${slippagePct.toFixed(3)}% exceeds ${intent.maxSlippagePct}%`);
  }

  return {
    ok: blockers.length === 0,
    blockers,
    quote,
    expectedPrice: Number(expectedPrice.toFixed(8)),
    expectedFee: Number(fee.toFixed(8)),
    expectedNotional: Number(notional.toFixed(2)),
    slippagePct: Number(slippagePct.toFixed(4)),
    cashDelta: Number(((intent.side === 'buy' ? -1 : 1) * notional - fee).toFixed(2)),
    positionDelta: intent.side === 'buy' ? intent.quantity : -intent.quantity,
    previewedAt: new Date().toISOString(),
  };
}
```

## Deliverable

- `src/sim/probe.mjs`, `src/sim/simulate.mjs`, `src/sim/preview-order.mjs`.
- Broker integration so no write path can reach `writeContract` or the orders
  endpoint without a simulation result attached to the intent.
- `scripts/simulate.mjs` printing a human-readable diff for a given intent.
- `test/simulation.test.js` asserting a reverting call is caught, that a
  recipient mismatch fails invariants, and that the broker refuses an intent
  with no simulation attached.

## How to verify

```sh
cd packages/agent
node --test test/simulation.test.js

# capability probe against the live RPC
node -e "
import('viem').then(async ({createPublicClient,http})=>{
  const { probeCapabilities, robinhoodMainnet } = await import('./src/sim/simulate.mjs');
  const c = createPublicClient({ chain: robinhoodMainnet, transport: http() });
  console.log(await probeCapabilities(c));
});"

# simulate a real testnet swap without sending it
AGENT_CHAIN=testnet node scripts/simulate.mjs --intent fixtures/swap-intent.json
```

The last command must print the asset deltas and gas cost and must not produce a
transaction hash. Then send the same intent on testnet 46630 and confirm the
actual receipt matches the simulated deltas. If they diverge, stop and find out
why before pointing anything at 4663.

## Gotchas

- **Simulating and then sending something else is worse than not simulating**,
  because it produces false confidence. Use viem's returned `request` verbatim.
  Any manual reconstruction between the two calls voids the guarantee.
- A successful simulation is not a guarantee. State changes between your
  `eth_call` and your inclusion. On a 101 ms chain that window is short but real,
  and it is exactly when a sandwich or a pool move lands. Keep `minAmountOut`
  and deadline parameters in the transaction itself; simulation does not replace
  on-chain slippage protection.
- Simulate against `pending`, not `latest`, when you have queued transactions of
  your own. Otherwise the simulation answers a question about a state you have
  already moved past.
- `debug_traceCall` may not be exposed. Probe, and degrade to `eth_call` plus
  balance diffing. Do not ship code that assumes a namespace exists because it
  worked on a different RPC provider.
- `eth_estimateGas` on Orbit includes L1 data cost. Adding your own L1 surcharge
  double-counts and will make your gas budget check reject valid transactions.
- A revert during simulation is a success for this component. Log it at info,
  deny the order, and move on. Treating simulation failures as errors to be
  retried turns a working guardrail into a retry storm.
- Preview versus fill divergence is a leading indicator that your cost model is
  wrong. Record both and chart the difference. It is the cheapest calibration
  data you will get, and it directly corrects the backtester.
<!-- built by nirholas x.com/nichxbt -->
