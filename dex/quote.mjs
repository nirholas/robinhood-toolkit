/**
 * robinhood-toolkit · Uniswap v3 quote
 * Author: nirholas · https://github.com/nirholas/robinhood-toolkit
 * License: MIT (c) 2026 nirholas
 *
 * QuoterV2 is NOT a view function: it reverts to return its answer in the revert
 * data. Simulate it with simulateContract. A plain readContract either fails or
 * returns garbage.
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
