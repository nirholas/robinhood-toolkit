<!-- built by nirholas x.com/nichxbt -->
<!--
  robinhood-toolkit · build prompt: bridging ETH and ERC-20s to Robinhood Chain
  Author: nirholas · https://github.com/nirholas/robinhood-toolkit
  License: All Rights Reserved (c) 2026 nirholas
-->

# 04 · Bridging to Robinhood Chain

## Goal

Move value onto Robinhood Chain and get the token accounting right. You will
build a deposit helper against the canonical Arbitrum bridge, a token address
resolver that maps an Ethereum ERC-20 to its distinct Robinhood Chain address,
and a withdrawal cost model that makes the seven-day exit period impossible to
miss in your UI.

## Prerequisites

- Prompts 02 and 03 completed.
- ETH on Ethereum mainnet for the deposit path, or a testnet balance for
  rehearsal.
- `npm i viem`. The bridge itself is used through its web UI in this prompt; the
  programmatic path is noted where the interface is verified.

## Reference facts (verified)

- Canonical bridge:
  `https://portal.arbitrum.io/bridge?destinationChain=robinhood-chain&sourceChain=ethereum`
- Deposit latency approximately 10 minutes. Withdrawal latency approximately
  7 days, because this is an optimistic rollup and withdrawals wait out the
  fraud-challenge period. That is a protocol property, not a queue.
- Partner routes exist for faster or cheaper transfers: LayerZero and Stargate,
  Chainlink CCIP, Relay, Across, and LiFi. These are third-party liquidity
  networks with their own trust assumptions. They are not the canonical bridge.
- Bridged ERC-20 tokens have different addresses on Robinhood Chain than on
  Ethereum. A USDC address from Ethereum will not resolve here.
- Verified token addresses on Robinhood Chain, both proxies, bytecode and ERC-20
  metadata confirmed on-chain 2026-07-20:
  - WETH `0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73`, `name: 'WETH'`,
    `decimals: 18`
  - USDG `0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168`, `name: 'Global Dollar'`,
    `decimals: 6`
  Decimals differ between these two. Read decimals per token, never assume 18.
- Gas token is ETH. A bridged deposit of ETH is what pays for gas.
- Bridging docs: <https://docs.robinhood.com/chain/bridging/>. Contract
  reference: <https://docs.robinhood.com/chain/contracts/>.
- The Orbit bridge contract addresses (inbox, outbox, gateway router) are
  UNVERIFIED in this document. Read them from the contracts doc page or from the
  bridge UI's transaction targets before writing them into code. Do not copy
  Arbitrum One addresses; every Orbit chain has its own deployment.
- Withdrawal fast-exit pricing on partner routes is UNVERIFIED and market-driven.
  Quote it live, never quote a stored figure.

## Steps

1. Rehearse on testnet first. Fund from the faucet (prompt 03) and complete one
   full deposit and one full withdrawal before touching mainnet value. The seven
   day wait is why you rehearse: a mistake discovered on day six is expensive.
2. Perform the first mainnet deposit through the canonical bridge UI, not
   through code. Use a small amount. Record the L1 transaction hash, the L2
   transaction hash, and the wall-clock delta between them. That measured delta
   is your real deposit latency, and it belongs in your docs instead of the
   approximate figure.
3. Build `packages/bridge/src/tokens.ts`, a registry keyed by chain ID mapping a
   symbol to its address on that chain. Seed it with the two verified addresses.
   Mark every other entry as unresolved rather than guessing.
4. Build `resolveToken(symbol, chainId)` that throws a specific error when a
   symbol is unmapped, telling the caller to look the address up on the
   explorer. Silent fallback to an Ethereum address is the failure mode this
   entire module exists to prevent.
5. Verify every address before it enters the registry. Fetch `name`, `symbol`,
   `decimals`, and confirm bytecode exists at the address. An address with no
   code is a typo or a wrong-chain paste.
6. Build `packages/bridge/src/withdrawal.ts` exposing `estimateWithdrawal()`,
   returning the canonical route with its approximately seven day challenge
   period and a list of partner routes marked as requiring a live quote. Return
   an explicit `challengePeriodDays: 7` field so a UI cannot render a withdrawal
   flow without confronting it.
7. In any UI you build on top of this, show the withdrawal delay before the user
   signs, not on the confirmation screen. Users who learn about a seven day lock
   after signing file support tickets.

```js
/**
 * robinhood-toolkit · bridged token registry and verifier
 * Author: nirholas · https://github.com/nirholas/robinhood-toolkit
 * License: All Rights Reserved (c) 2026 nirholas
 */
import { erc20Abi, getAddress } from 'viem';
import { publicClientFor, robinhoodMainnet } from '../../network/src/chains.js';

/**
 * Addresses are per-chain. A token's Ethereum address is NOT its address here.
 * Only verified entries belong in this map.
 */
export const TOKENS = {
  [robinhoodMainnet.id]: {
    WETH: getAddress('0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73'),
    USDG: getAddress('0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168'),
  },
};

export function resolveToken(symbol, chainId = robinhoodMainnet.id) {
  const address = TOKENS[chainId]?.[symbol.toUpperCase()];
  if (!address) {
    throw new Error(
      `No verified address for ${symbol} on chain ${chainId}. ` +
        `Bridged tokens have chain-specific addresses. Look it up on the ` +
        `explorer and add it to TOKENS after verifying with verifyToken().`,
    );
  }
  return address;
}

/** Confirms code exists and the ERC-20 surface responds before you trust it. */
export async function verifyToken(address, chain = robinhoodMainnet) {
  const client = publicClientFor(chain);
  const checksummed = getAddress(address);

  const bytecode = await client.getBytecode({ address: checksummed });
  if (!bytecode || bytecode === '0x') {
    throw new Error(`No contract deployed at ${checksummed} on ${chain.name}.`);
  }

  const [name, symbol, decimals, totalSupply] = await Promise.all([
    client.readContract({ address: checksummed, abi: erc20Abi, functionName: 'name' }),
    client.readContract({ address: checksummed, abi: erc20Abi, functionName: 'symbol' }),
    client.readContract({ address: checksummed, abi: erc20Abi, functionName: 'decimals' }),
    client.readContract({ address: checksummed, abi: erc20Abi, functionName: 'totalSupply' }),
  ]);

  return {
    address: checksummed,
    name,
    symbol,
    decimals,
    totalSupply: totalSupply.toString(),
    bytecodeSize: (bytecode.length - 2) / 2,
    explorer: `${chain.blockExplorers.default.url}/address/${checksummed}`,
  };
}
```

Route model, with the challenge period as a required field:

```js
export function bridgeRoutes({ direction }) {
  const canonical = {
    id: 'canonical',
    name: 'Arbitrum canonical bridge',
    url: 'https://portal.arbitrum.io/bridge?destinationChain=robinhood-chain&sourceChain=ethereum',
    trust: 'rollup-native, no third-party liquidity provider',
    depositMinutes: direction === 'deposit' ? 10 : null,
    challengePeriodDays: direction === 'withdraw' ? 7 : 0,
    feeQuote: 'live',
  };

  // Third-party liquidity networks. Faster exits, additional trust assumptions.
  // Fees and latency are market-driven: quote each at request time.
  const partners = ['LayerZero/Stargate', 'Chainlink CCIP', 'Relay', 'Across', 'LiFi'].map(
    (name) => ({
      id: name.toLowerCase().replace(/[^a-z]+/g, '-'),
      name,
      trust: 'third-party bridge, independent security model',
      depositMinutes: 'quote-required',
      challengePeriodDays: 0,
      feeQuote: 'live',
    }),
  );

  return { canonical, partners };
}
```

## Deliverable

- `packages/bridge/` with `tokens.ts`, `withdrawal.ts`, `README.md`, and the
  attribution headers.
- `reports/bridge-tokens.json`: `verifyToken()` output for WETH and USDG,
  regenerated on demand.
- A documented deposit and withdrawal runbook with your own measured latencies
  from step 2, not the approximate figures.

## How to verify

Run the token verifier against both verified addresses:

```sh
node -e "import('./packages/bridge/src/tokens.js').then(async m => {
  console.log(await m.verifyToken('0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73'));
  console.log(await m.verifyToken('0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168'));
})"
```

Expected, confirmed by running this on 2026-07-20: WETH returns
`name: 'WETH'`, `decimals: 18`, `bytecodeSize: 2202`. USDG returns
`name: 'Global Dollar'`, `symbol: 'USDG'`, `decimals: 6`, `bytecodeSize: 170`.
The small USDG bytecode is the proxy stub, which is expected, not a red flag.
Open each printed explorer URL and confirm the contract page matches.
Both are proxies, so the explorer will show a proxy pattern; read through to the
implementation before assuming behavior.

Then prove the guard: `resolveToken('USDC')` must throw the explicit
unmapped-symbol error rather than returning anything.

For the bridge itself: after your rehearsal deposit, confirm the L2 balance
change on <https://robinhoodchain.blockscout.com> and that the delta between L1
and L2 confirmation is in the range you documented.

## Gotchas

- Bridged ERC-20 addresses differ from their Ethereum counterparts. This is the
  single highest-frequency bug in bridge integrations. Sending to an Ethereum
  address on this chain sends to an address with no code, and the funds are not
  recoverable by you.
- Seven days is a protocol property of optimistic rollup withdrawals, not a
  queue you can escalate. Design your product around it. Surface it before the
  signature.
- Partner routes bypass the challenge period by fronting liquidity. That is a
  different trust model, not a faster version of the same one. Label them as
  such in any UI. See prompt 06.
- Do not copy Arbitrum One bridge contract addresses. Every Orbit chain has its
  own inbox, outbox, and gateway router deployment. Those addresses are
  UNVERIFIED here: read them from
  <https://docs.robinhood.com/chain/contracts/>.
- Both verified token addresses are proxies. Do not cache an implementation
  address as if it were the token. Always interact with the proxy.
- WETH is 18 decimals and USDG is 6. Hardcoding 18 across a bridge UI produces
  amounts wrong by a factor of a trillion, in a flow that moves real value. Read
  `decimals()` per token and store it alongside the address in the registry.
- Bridge ETH before you bridge tokens. Arriving with an ERC-20 balance and zero
  ETH leaves you unable to pay gas to do anything with it.
- Test the withdrawal path on testnet before you need it on mainnet. Discovering
  a broken exit flow while holding real value is the worst time to discover it.
- Fees on every route are live and market-driven. Quote at request time. A
  cached fee estimate in a UI is a misquote.
<!-- built by nirholas x.com/nichxbt -->
