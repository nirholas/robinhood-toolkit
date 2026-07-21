<!--
  robinhood-toolkit · build prompt: Uniswap swaps on Robinhood Chain
  Author: nirholas · https://github.com/nirholas/robinhood-toolkit
  License: All Rights Reserved (c) 2026 nirholas
-->

# 07 · Swap on Uniswap, with addresses resolved not guessed

## Goal

Execute an on-chain swap through Uniswap on Robinhood Chain: resolve the router,
factory, and quoter addresses from official Uniswap deployment sources at build
time, prove each resolved address is correct with on-chain cross-checks, quote
the trade, set slippage from the quote, and execute. Rehearse on a fork before
spending.

## Prerequisites

- Prompts 04 (viem chain definitions), 05 (registry resolver), and 06 (USDG
  module) completed.
- Node.js 20 with `viem`. Anvil for the fork rehearsal.
- An account holding ETH for gas and the input token for the swap.

## Reference facts (verified)

- Uniswap is reported live on Robinhood Chain: v2, v3, v4, and UniswapX.
- Mainnet: chain ID `4663`, RPC `https://rpc.mainnet.chain.robinhood.com`,
  explorer `https://robinhoodchain.blockscout.com` (Blockscout).
- Testnet: chain ID `46630`, RPC `https://rpc.testnet.chain.robinhood.com`.
- WETH `0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73` and USDG
  `0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168`, both proxies with confirmed
  bytecode. These are the two anchors you use to validate a resolved router.
- Arbitrum Orbit (Nitro), fully EVM compatible, so stock Uniswap contracts and
  ABIs work unmodified.
- Stock Tokens settle in USDG and their addresses come from the runtime registry
  (prompt 05). Never hardcode one into a swap path.

**UNVERIFIED and must be resolved by you:** every Uniswap contract address on
chain 4663 and 46630, including SwapRouter02, the v3 factory, QuoterV2, the
Universal Router, Permit2, the v4 PoolManager, and which fee tiers have
liquidity. This toolkit does not carry them. Resolve them in step 1 and prove
them in step 2. Do not accept an address from a blog post, a chat message, or a
generated snippet without running the step 2 checks against it.

## Steps

### 1. Resolve addresses from official Uniswap sources

Check, in this order:

1. Uniswap deployment docs: <https://docs.uniswap.org/contracts/v3/reference/deployments/>
   for v2 and v3, and the v4 deployments page for the PoolManager and
   Universal Router.
2. The published Uniswap SDK packages, which carry per-chain address maps. This
   is the machine-readable source and is what the code below reads.
3. The Blockscout explorer on chain 4663, to confirm the contract exists and its
   source is verified.

```sh
npm i viem @uniswap/sdk-core
```

`dex/resolve.mjs`:

```js
/**
 * robinhood-toolkit · resolve Uniswap deployment addresses for Robinhood Chain
 * Author: nirholas · https://github.com/nirholas/robinhood-toolkit
 * License: All Rights Reserved (c) 2026 nirholas
 */
import { getAddress, isAddress } from "viem";
import * as sdkCore from "@uniswap/sdk-core";

/** Read a per-chain address map from the SDK if the SDK knows this chain. */
function fromSdk(mapName, chainId) {
  const map = sdkCore[mapName];
  const value = map?.[chainId];
  return typeof value === "string" && isAddress(value) ? getAddress(value) : null;
}

/** Env override, for addresses you confirmed from the docs and verified on-chain. */
function fromEnv(name) {
  const v = process.env[name];
  if (!v) return null;
  if (!isAddress(v)) throw new Error(`${name} is not a valid address: ${v}`);
  return getAddress(v);
}

/**
 * Returns the Uniswap addresses for a chain, or throws with instructions.
 * Nothing here is hardcoded per chain on purpose.
 */
export function resolveUniswap(chainId) {
  const resolved = {
    chainId,
    v3Factory: fromEnv("UNI_V3_FACTORY") ?? fromSdk("V3_CORE_FACTORY_ADDRESSES", chainId),
    swapRouter02: fromEnv("UNI_SWAP_ROUTER_02") ?? fromSdk("SWAP_ROUTER_02_ADDRESSES", chainId),
    quoterV2: fromEnv("UNI_QUOTER_V2"),
    v2Factory: fromEnv("UNI_V2_FACTORY") ?? fromSdk("V2_FACTORY_ADDRESSES", chainId),
    universalRouter: fromEnv("UNI_UNIVERSAL_ROUTER"),
    permit2: fromEnv("UNI_PERMIT2"),
    v4PoolManager: fromEnv("UNI_V4_POOL_MANAGER"),
  };

  const missing = ["v3Factory", "swapRouter02", "quoterV2"].filter((k) => !resolved[k]);
  if (missing.length) {
    throw new Error(
      `Missing Uniswap addresses for chain ${chainId}: ${missing.join(", ")}. ` +
        "Resolve them from https://docs.uniswap.org/contracts/v3/reference/deployments/ " +
        "and the v4 deployments page, confirm each on https://robinhoodchain.blockscout.com, " +
        "then set UNI_V3_FACTORY, UNI_SWAP_ROUTER_02, UNI_QUOTER_V2 in your environment.",
    );
  }
  return resolved;
}
```

Some SDK versions type these maps as `Record<SupportedChainId, string>` and will
simply not contain 4663. That is expected. The env path is the documented way to
supply a docs-confirmed address, and step 2 is what makes it trustworthy.

### 2. Prove the resolved addresses on-chain before using them

Four checks. All must pass.

`dex/verify.mjs`:

```js
/**
 * robinhood-toolkit · on-chain verification of resolved Uniswap addresses
 * Author: nirholas · https://github.com/nirholas/robinhood-toolkit
 * License: All Rights Reserved (c) 2026 nirholas
 */
import { getAddress, parseAbi } from "viem";

export const WETH_ROBINHOOD_MAINNET = getAddress("0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73");
export const USDG_ROBINHOOD_MAINNET = getAddress("0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168");

const routerAbi = parseAbi([
  "function factory() view returns (address)",
  "function WETH9() view returns (address)",
]);
const factoryAbi = parseAbi([
  "function getPool(address,address,uint24) view returns (address)",
  "function owner() view returns (address)",
]);
const poolAbi = parseAbi([
  "function token0() view returns (address)",
  "function token1() view returns (address)",
  "function fee() view returns (uint24)",
  "function liquidity() view returns (uint128)",
]);

async function requireCode(client, address, label) {
  const code = await client.getBytecode({ address });
  if (!code || code === "0x") throw new Error(`${label} ${address} has no bytecode on this chain`);
}

export async function verifyUniswap(client, addrs) {
  const chainId = await client.getChainId();
  if (chainId !== addrs.chainId) throw new Error(`RPC chainId ${chainId} != resolved ${addrs.chainId}`);

  // 1. Bytecode exists at every address.
  await requireCode(client, addrs.v3Factory, "v3Factory");
  await requireCode(client, addrs.swapRouter02, "SwapRouter02");
  await requireCode(client, addrs.quoterV2, "QuoterV2");

  // 2. The router points at the factory you resolved.
  const routerFactory = await client.readContract({
    address: addrs.swapRouter02,
    abi: routerAbi,
    functionName: "factory",
  });
  if (getAddress(routerFactory) !== getAddress(addrs.v3Factory)) {
    throw new Error(`router.factory() = ${routerFactory}, expected ${addrs.v3Factory}`);
  }

  // 3. The router's WETH9 matches the WETH address verified for this chain.
  if (chainId === 4663) {
    const weth9 = await client.readContract({
      address: addrs.swapRouter02,
      abi: routerAbi,
      functionName: "WETH9",
    });
    if (getAddress(weth9) !== WETH_ROBINHOOD_MAINNET) {
      throw new Error(`router.WETH9() = ${weth9}, expected ${WETH_ROBINHOOD_MAINNET}`);
    }
  }

  return { ...addrs, verifiedAt: new Date().toISOString() };
}

/** Find which fee tiers actually have a pool with liquidity. */
export async function findPools(client, factory, tokenA, tokenB, fees = [100, 500, 3000, 10000]) {
  const found = [];
  for (const fee of fees) {
    const pool = await client.readContract({
      address: factory,
      abi: factoryAbi,
      functionName: "getPool",
      args: [getAddress(tokenA), getAddress(tokenB), fee],
    });
    if (pool === "0x0000000000000000000000000000000000000000") continue;

    const [liquidity, token0, token1] = await Promise.all([
      client.readContract({ address: pool, abi: poolAbi, functionName: "liquidity" }),
      client.readContract({ address: pool, abi: poolAbi, functionName: "token0" }),
      client.readContract({ address: pool, abi: poolAbi, functionName: "token1" }),
    ]);
    found.push({ fee, pool: getAddress(pool), liquidity, token0, token1 });
  }
  return found.sort((a, b) => (b.liquidity > a.liquidity ? 1 : -1));
}
```

Check 3 is the strongest signal available: it ties a resolved router to an
address this toolkit independently verified on chain 4663. A router whose
`WETH9()` is not `0x0Bd7...AD73` is not the router for this chain.

If `findPools` returns nothing for a pair, Uniswap may be deployed but that pair
may have no pool. Do not conclude the addresses are wrong from an empty result
alone.

### 3. Quote

QuoterV2 is not a view function. Simulate it rather than calling it as a read.

`dex/quote.mjs`:

```js
/**
 * robinhood-toolkit · Uniswap v3 quote
 * Author: nirholas · https://github.com/nirholas/robinhood-toolkit
 * License: All Rights Reserved (c) 2026 nirholas
 */
import { parseAbi } from "viem";

const quoterAbi = parseAbi([
  "function quoteExactInputSingle((address tokenIn,address tokenOut,uint256 amountIn,uint24 fee,uint160 sqrtPriceLimitX96)) returns (uint256 amountOut,uint160 sqrtPriceX96After,uint32 initializedTicksCrossed,uint256 gasEstimate)",
]);

export async function quoteExactInputSingle(client, quoterV2, { tokenIn, tokenOut, amountIn, fee }) {
  const { result } = await client.simulateContract({
    address: quoterV2,
    abi: quoterAbi,
    functionName: "quoteExactInputSingle",
    args: [{ tokenIn, tokenOut, amountIn, fee, sqrtPriceLimitX96: 0n }],
  });
  const [amountOut, sqrtPriceX96After, ticksCrossed, gasEstimate] = result;
  return { amountOut, sqrtPriceX96After, ticksCrossed, gasEstimate };
}

/** minOut with slippage expressed in basis points, integer math only. */
export function applySlippage(amountOut, slippageBps) {
  if (slippageBps < 0 || slippageBps > 10_000) throw new Error("slippageBps out of range");
  return (amountOut * BigInt(10_000 - slippageBps)) / 10_000n;
}
```

### 4. Swap

`dex/swap.mjs`:

```js
/**
 * robinhood-toolkit · Uniswap v3 exactInputSingle on Robinhood Chain
 * Author: nirholas · https://github.com/nirholas/robinhood-toolkit
 * License: All Rights Reserved (c) 2026 nirholas
 */
import { createWalletClient, erc20Abi, formatUnits, getAddress, http, parseAbi, parseUnits } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { quoteExactInputSingle, applySlippage } from "./quote.mjs";

const routerAbi = parseAbi([
  "function exactInputSingle((address tokenIn,address tokenOut,uint24 fee,address recipient,uint256 amountIn,uint256 amountOutMinimum,uint160 sqrtPriceLimitX96)) payable returns (uint256 amountOut)",
]);

export async function swapExactInputSingle({
  publicClient,
  rpcUrl,
  privateKey,
  addrs,
  tokenIn,
  tokenOut,
  amountIn,
  fee,
  slippageBps = 50,
  dryRun = true,
}) {
  const account = privateKeyToAccount(privateKey);
  const tIn = getAddress(tokenIn);
  const tOut = getAddress(tokenOut);

  const [decIn, decOut, symIn, symOut] = await Promise.all([
    publicClient.readContract({ address: tIn, abi: erc20Abi, functionName: "decimals" }),
    publicClient.readContract({ address: tOut, abi: erc20Abi, functionName: "decimals" }),
    publicClient.readContract({ address: tIn, abi: erc20Abi, functionName: "symbol" }),
    publicClient.readContract({ address: tOut, abi: erc20Abi, functionName: "symbol" }),
  ]);

  const raw = parseUnits(String(amountIn), decIn);
  const balance = await publicClient.readContract({
    address: tIn,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [account.address],
  });
  if (balance < raw) throw new Error(`insufficient ${symIn}: have ${formatUnits(balance, decIn)}`);

  const quote = await quoteExactInputSingle(publicClient, addrs.quoterV2, {
    tokenIn: tIn,
    tokenOut: tOut,
    amountIn: raw,
    fee,
  });
  const amountOutMinimum = applySlippage(quote.amountOut, slippageBps);

  const plan = {
    tokenIn: tIn,
    tokenOut: tOut,
    symbolIn: symIn,
    symbolOut: symOut,
    fee,
    amountIn: String(amountIn),
    quotedOut: formatUnits(quote.amountOut, decOut),
    minOut: formatUnits(amountOutMinimum, decOut),
    slippageBps,
    router: addrs.swapRouter02,
  };
  if (dryRun) return { ...plan, dryRun: true };

  const wallet = createWalletClient({ account, chain: publicClient.chain, transport: http(rpcUrl) });

  const allowance = await publicClient.readContract({
    address: tIn,
    abi: erc20Abi,
    functionName: "allowance",
    args: [account.address, addrs.swapRouter02],
  });
  if (allowance < raw) {
    const approveHash = await wallet.writeContract({
      address: tIn,
      abi: erc20Abi,
      functionName: "approve",
      args: [addrs.swapRouter02, raw],
    });
    await publicClient.waitForTransactionReceipt({ hash: approveHash });
  }

  const hash = await wallet.writeContract({
    address: addrs.swapRouter02,
    abi: routerAbi,
    functionName: "exactInputSingle",
    args: [
      {
        tokenIn: tIn,
        tokenOut: tOut,
        fee,
        recipient: account.address,
        amountIn: raw,
        amountOutMinimum,
        sqrtPriceLimitX96: 0n,
      },
    ],
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash, confirmations: 1 });
  if (receipt.status !== "success") throw new Error(`swap reverted: ${hash}`);

  const outBalance = await publicClient.readContract({
    address: tOut,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [account.address],
  });

  return { ...plan, dryRun: false, hash, gasUsed: receipt.gasUsed.toString(), balanceOut: formatUnits(outBalance, decOut) };
}
```

Note the router has no `deadline` parameter in SwapRouter02. If the deployment
you resolved is the older `SwapRouter` (v1), its struct includes `deadline` and
the ABI above will fail to encode. That mismatch is itself a useful signal about
which router you actually resolved.

### 5. Rehearse on a fork

```sh
anvil --fork-url https://rpc.mainnet.chain.robinhood.com --chain-id 4663 --port 8545
```

Fund an anvil account with the input token by impersonating a holder from the
explorer (prompt 06, step 4), then run the swap against
`http://127.0.0.1:8545` with `dryRun: false`. Confirm the output balance moves
and that a revert on `amountOutMinimum` is reachable by setting `slippageBps: 0`
and re-running.

### 6. Swapping a Stock Token

Resolve the token address through the registry, never a literal:

```js
import { createPublicClient, http } from "viem";
import { robinhoodMainnet } from "../clients/token.mjs";
import { resolveStockToken } from "../registry/resolve.mjs";
import { USDG_ROBINHOOD_MAINNET } from "./verify.mjs";

const publicClient = createPublicClient({ chain: robinhoodMainnet, transport: http() });
const aapl = await resolveStockToken(publicClient, "AAPL");
// use aapl.address as tokenOut, USDG_ROBINHOOD_MAINNET as tokenIn
```

## Deliverable

- `dex/resolve.mjs`, `dex/verify.mjs`, `dex/quote.mjs`, `dex/swap.mjs`.
- `dex/DEPLOYMENTS.md` recording each resolved address, the official source URL
  it came from, the date resolved, and the output of the step 2 checks.
- A fork rehearsal transcript showing a successful swap and a deliberate
  slippage revert.
- `.env.example` listing `UNI_V3_FACTORY`, `UNI_SWAP_ROUTER_02`, `UNI_QUOTER_V2`
  and any optional v2, v4, Universal Router, or Permit2 addresses.

## How to verify

1. `resolveUniswap(4663)` throws a useful error with no env set, and succeeds
   once you supply docs-confirmed addresses.
2. `verifyUniswap` passes all checks, including `router.WETH9()` equal to
   `0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73`.
3. `findPools(client, factory, WETH, USDG)` returns at least one pool with
   non-zero liquidity, and each returned pool's `token0`/`token1` are the pair
   you asked for.
4. A dry-run swap prints a quote and a `minOut` strictly below it.
5. On the fork, the executed swap changes both balances and the receipt logs
   include a `Swap` event from the pool address returned by `findPools`.
6. `slippageBps: 0` reverts on the fork, proving slippage protection is live.
7. No Uniswap address appears as a literal in any source file.

## Gotchas

- Do not trust any Uniswap address you did not resolve from official Uniswap
  sources and then verify on-chain. This is the exact place where fabricated
  addresses cause real losses.
- QuoterV2 reverts to return data. Use `simulateContract`, not `readContract`.
  A quote from a plain read either fails or silently returns garbage.
- Quotes are not guarantees. Always pass a real `amountOutMinimum`. Passing zero
  is an unlimited-slippage order.
- Fee tiers are per pool. A pair with a 3000 pool may have no 500 pool. Discover
  tiers with `findPools`, never assume 3000.
- v2, v3, v4, and UniswapX have different routers and different calldata.
  Verified v3 addresses tell you nothing about v4. v4 routes through the
  PoolManager and the Universal Router with Permit2 approvals, which is a
  different approval model entirely.
- Around 101 ms blocks means a quote goes stale fast. Quote and execute in the
  same code path, not minutes apart.
- Reading decimals for both tokens at runtime is mandatory. Stock Tokens and USDG
  will not necessarily share an exponent.
- Approve exactly the amount you are swapping. An unlimited approval to a router
  you resolved from an unverified source is the worst combination of the two
  mistakes in this file.
- The sequencer is centralized. There is no public mempool to be sandwiched in
  the L1 sense, but sequencer ordering is a trust assumption, not a protection.
  Set slippage as if you can be front-run.
