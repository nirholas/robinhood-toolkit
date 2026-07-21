/**
 * robinhood-toolkit · USDG transfers on Robinhood Chain
 * Author: nirholas · https://github.com/nirholas/robinhood-toolkit
 * License: All Rights Reserved (c) 2026 nirholas
 */
import { createPublicClient, createWalletClient, erc20Abi, formatUnits, getAddress, http, parseUnits } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { robinhoodMainnet, robinhoodTestnet } from "./token.mjs";

export const USDG_MAINNET = getAddress("0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168");

/**
 * USDG on testnet is not verified. Supply RH_USDG_TESTNET after confirming the
 * address from https://docs.robinhood.com/chain/contracts/ or the testnet explorer.
 */
export function usdgAddress(chainId) {
  if (chainId === 4663) return USDG_MAINNET;
  if (chainId === 46630) {
    const a = process.env.RH_USDG_TESTNET;
    if (!a) throw new Error("RH_USDG_TESTNET is not set and the testnet USDG address is not verified");
    return getAddress(a);
  }
  throw new Error(`unsupported chainId ${chainId}`);
}

export function publicClientFor(chainId, rpcUrl) {
  const chain = chainId === 4663 ? robinhoodMainnet : robinhoodTestnet;
  return createPublicClient({ chain, transport: http(rpcUrl) });
}

/** Read decimals every time. Never hardcode the exponent. */
export async function usdgMeta(client) {
  const address = usdgAddress(await client.getChainId());
  const [symbol, decimals] = await Promise.all([
    client.readContract({ address, abi: erc20Abi, functionName: "symbol" }),
    client.readContract({ address, abi: erc20Abi, functionName: "decimals" }),
  ]);
  return { address, symbol, decimals };
}

export async function usdgBalance(client, holder) {
  const { address, decimals, symbol } = await usdgMeta(client);
  const raw = await client.readContract({
    address,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [getAddress(holder)],
  });
  return { raw, formatted: formatUnits(raw, decimals), decimals, symbol, token: address };
}

/**
 * Transfer USDG. `amount` is a decimal string such as "12.50", parsed with the
 * decimals read from the contract at call time.
 */
export async function transferUsdg({ rpcUrl, chainId, privateKey, to, amount, dryRun = true }) {
  const publicClient = publicClientFor(chainId, rpcUrl);
  const onchainChainId = await publicClient.getChainId();
  if (onchainChainId !== chainId) {
    throw new Error(`RPC reports chainId ${onchainChainId}, expected ${chainId}`);
  }

  const account = privateKeyToAccount(privateKey);
  const recipient = getAddress(to);
  const { address, decimals, symbol } = await usdgMeta(publicClient);
  const value = parseUnits(String(amount), decimals);
  if (value <= 0n) throw new Error("amount must be greater than zero");

  const before = await usdgBalance(publicClient, account.address);
  if (before.raw < value) {
    throw new Error(`insufficient ${symbol}: have ${before.formatted}, need ${amount}`);
  }

  const gas = await publicClient.estimateContractGas({
    address,
    abi: erc20Abi,
    functionName: "transfer",
    args: [recipient, value],
    account,
  });

  const plan = {
    chainId,
    token: address,
    symbol,
    decimals,
    from: account.address,
    to: recipient,
    amount: String(amount),
    rawAmount: value.toString(),
    balanceBefore: before.formatted,
    estimatedGas: gas.toString(),
  };

  if (dryRun) return { ...plan, dryRun: true };

  const walletClient = createWalletClient({
    account,
    chain: publicClient.chain,
    transport: http(rpcUrl),
  });
  const hash = await walletClient.writeContract({
    address,
    abi: erc20Abi,
    functionName: "transfer",
    args: [recipient, value],
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash, confirmations: 1 });
  if (receipt.status !== "success") throw new Error(`transfer reverted: ${hash}`);

  const after = await usdgBalance(publicClient, account.address);
  const recipientAfter = await usdgBalance(publicClient, recipient);

  return {
    ...plan,
    dryRun: false,
    hash,
    gasUsed: receipt.gasUsed.toString(),
    balanceAfter: after.formatted,
    senderDelta: formatUnits(before.raw - after.raw, decimals),
    recipientBalance: recipientAfter.formatted,
  };
}
