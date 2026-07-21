/**
 * robinhood-toolkit · Uniswap v3 exactInputSingle on Robinhood Chain
 * Author: nirholas · https://github.com/nirholas/robinhood-toolkit
 * License: MIT (c) 2026 nirholas
 *
 * SwapRouter02 has NO deadline parameter. If the deployment you resolved is the
 * older SwapRouter (v1), its exactInputSingle struct includes deadline and the
 * ABI below fails to encode — a useful signal that you resolved the wrong router.
 * Quote and execute in one path: ~101 ms blocks make a quote go stale fast.
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

  // Approve EXACTLY the amount being swapped. Never an unlimited approval to a
  // router you have not proven with dex/verify.mjs.
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
