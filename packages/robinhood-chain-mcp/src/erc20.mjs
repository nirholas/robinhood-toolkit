/**
 * robinhood-toolkit · ERC-20 reads on Robinhood Chain
 * Author: nirholas · https://github.com/nirholas/robinhood-toolkit
 * License: All Rights Reserved (c) 2026 nirholas
 *
 * Two rules this module exists to enforce:
 *
 * 1. `decimals` is ALWAYS read on-chain, never defaulted. USDG is 6, WETH is 18.
 *    A silent default of 18 misprices a USDG balance by a factor of a trillion
 *    and still renders as a plausible number, which is worse than an error.
 * 2. `symbol` and `name` are attacker-controlled strings. They are returned as
 *    display data and never used to key logic.
 */
import { erc20Abi, formatUnits } from 'viem';
import { publicClientFor } from './chain.mjs';
import { ToolError } from './errors.mjs';

/**
 * Infrastructure addresses verified by hand on the explorer and re-confirmed
 * on-chain 2026-07-20. This list is deliberately tiny and contains only the two
 * canonical tokens the toolkit itself allowlists.
 *
 * Stock Token addresses are NOT here on purpose: they live in a dynamic
 * registry and must be resolved at runtime, never hardcoded.
 */
export const KNOWN_TOKENS = Object.freeze({
  mainnet: Object.freeze([
    Object.freeze({
      symbol: 'WETH',
      name: 'WETH',
      address: '0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73',
      decimals: 18,
      note: 'Canonical wrapped ether on Robinhood Chain. Proxy contract.',
    }),
    Object.freeze({
      symbol: 'USDG',
      name: 'Global Dollar',
      address: '0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168',
      decimals: 6,
      note: 'Canonical Global Dollar stablecoin, the settlement asset for Stock Tokens. Proxy contract. Six decimals, not eighteen.',
    }),
  ]),
  testnet: Object.freeze([]),
});

/** Look up a canonical token by symbol. Case-insensitive; returns null if absent. */
export function knownTokenBySymbol(network, symbol) {
  const list = KNOWN_TOKENS[network] ?? [];
  const wanted = String(symbol).trim().toUpperCase();
  return list.find((token) => token.symbol.toUpperCase() === wanted) ?? null;
}

/** Look up a canonical token by address. Returns null if absent. */
export function knownTokenByAddress(network, address) {
  const list = KNOWN_TOKENS[network] ?? [];
  const wanted = String(address).toLowerCase();
  return list.find((token) => token.address.toLowerCase() === wanted) ?? null;
}

/** True when the address has bytecode, i.e. it is a contract and not an EOA. */
export async function hasBytecode(network, address) {
  const client = publicClientFor(network);
  const code = await client.getCode({ address });
  return Boolean(code && code !== '0x');
}

/**
 * Read name, symbol, decimals, and totalSupply.
 *
 * Every field is read with allowFailure so one non-conforming method does not
 * throw away the whole response. `decimals` is the only field treated as
 * mandatory, because nothing downstream can format a balance without it.
 *
 * Throws ToolError when the address is not a contract or does not implement
 * enough of ERC-20 to be usable, so the agent gets "this is not an ERC-20"
 * rather than a decoding stack trace.
 */
export async function readTokenMetadata(network, address) {
  const client = publicClientFor(network);
  const base = { address, abi: erc20Abi };

  const [code, results] = await Promise.all([
    client.getCode({ address }),
    client.multicall({
      allowFailure: true,
      contracts: [
        { ...base, functionName: 'name' },
        { ...base, functionName: 'symbol' },
        { ...base, functionName: 'decimals' },
        { ...base, functionName: 'totalSupply' },
      ],
    }),
  ]);

  if (!code || code === '0x') {
    throw new ToolError(
      `${address} has no bytecode on Robinhood Chain ${network}. It is an externally owned account or an undeployed address, not a token contract.`,
      { hint: 'Check the address on the block explorer, and confirm you are querying the right network.' },
    );
  }

  const [name, symbol, decimals, totalSupply] = results;

  if (decimals.status !== 'success') {
    throw new ToolError(
      `${address} is a contract on ${network} but does not implement ERC-20 decimals(). It is not a usable ERC-20 token.`,
      { hint: 'Use read_contract with the correct ABI fragment if you know what interface this contract exposes.' },
    );
  }

  return {
    address,
    // Display strings only. Attacker-controlled: never key logic on these.
    name: name.status === 'success' ? name.result : null,
    symbol: symbol.status === 'success' ? symbol.result : null,
    decimals: Number(decimals.result),
    totalSupply:
      totalSupply.status === 'success'
        ? {
            raw: totalSupply.result.toString(),
            formatted: formatUnits(totalSupply.result, Number(decimals.result)),
          }
        : null,
    // Surfaced so an agent can see when a token is only partially conforming.
    unreadableFields: [
      name.status !== 'success' ? 'name' : null,
      symbol.status !== 'success' ? 'symbol' : null,
      totalSupply.status !== 'success' ? 'totalSupply' : null,
    ].filter(Boolean),
  };
}

/**
 * ERC-20 balance for one holder, formatted with decimals read in the SAME call.
 * The decimals read is not cached across calls: a proxy upgrade can change it,
 * and a stale exponent is the exact failure this module exists to prevent.
 */
export async function readTokenBalance(network, token, holder) {
  const client = publicClientFor(network);
  const base = { address: token, abi: erc20Abi };

  const [code, results] = await Promise.all([
    client.getCode({ address: token }),
    client.multicall({
      allowFailure: true,
      contracts: [
        { ...base, functionName: 'balanceOf', args: [holder] },
        { ...base, functionName: 'decimals' },
        { ...base, functionName: 'symbol' },
      ],
    }),
  ]);

  if (!code || code === '0x') {
    throw new ToolError(
      `Token address ${token} has no bytecode on Robinhood Chain ${network}.`,
      { hint: 'Confirm the token address and the network. Bridged tokens have different addresses per chain.' },
    );
  }

  const [balance, decimals, symbol] = results;

  if (balance.status !== 'success') {
    throw new ToolError(
      `balanceOf() reverted on ${token} for holder ${holder}. This contract does not behave like an ERC-20.`,
      { hint: 'Verify the address is a token contract, not a pool, router, or proxy without a token interface.' },
    );
  }
  if (decimals.status !== 'success') {
    throw new ToolError(
      `${token} returned a balance but does not implement decimals(), so the raw value cannot be safely formatted.`,
      { hint: `Raw balance is ${balance.result.toString()}. Do not assume 18 decimals to format it.` },
    );
  }

  const dec = Number(decimals.result);
  return {
    token,
    holder,
    symbol: symbol.status === 'success' ? symbol.result : null,
    decimals: dec,
    raw: balance.result.toString(),
    formatted: formatUnits(balance.result, dec),
  };
}
