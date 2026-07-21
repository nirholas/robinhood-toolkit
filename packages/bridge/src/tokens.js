/**
 * robinhood-toolkit · bridged token registry and on-chain verifier
 * Author: nirholas · https://github.com/nirholas/robinhood-toolkit
 * License: MIT (c) 2026 nirholas
 *
 * robinhood-toolkit · package: bridge
 *
 * A bridged ERC-20 has a DIFFERENT address on Robinhood Chain than on Ethereum.
 * A USDC address copied from Ethereum resolves to an address with no code here,
 * and value sent to it is not recoverable. This module is the boundary that
 * refuses to guess: symbols resolve only to addresses that were read from the
 * live chain, and everything else throws.
 */

import { createPublicClient, erc20Abi, getAddress, http } from 'viem'
import {
  MULTICALL3_ADDRESS,
  ROBINHOOD_MAINNET_ID,
  ROBINHOOD_TESTNET_ID,
  getChain,
  robinhoodChain,
} from 'robinhood-chain'

/**
 * Per-chain token registry. The address of a token on one chain tells you
 * NOTHING about its address on another. Only entries whose address, bytecode,
 * and ERC-20 metadata were confirmed on-chain belong here. Decimals are stored
 * alongside the address on purpose: WETH is 18 and USDG is 6, and a UI that
 * hardcodes 18 is wrong by a factor of a trillion on USDG.
 *
 * Verified on Robinhood Chain mainnet 2026-07-20 (both proxies; read through to
 * the implementation before assuming behavior).
 */
export const TOKENS = {
  [ROBINHOOD_MAINNET_ID]: {
    WETH: Object.freeze({
      address: getAddress('0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73'),
      name: 'WETH',
      symbol: 'WETH',
      decimals: 18,
      verifiedAt: '2026-07-20',
    }),
    USDG: Object.freeze({
      address: getAddress('0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168'),
      name: 'Global Dollar',
      symbol: 'USDG',
      decimals: 6,
      verifiedAt: '2026-07-20',
    }),
  },
  // Testnet bridged addresses have not been read from-chain in this repo yet.
  // An empty object is deliberate: resolveToken() must throw, not fall back.
  [ROBINHOOD_TESTNET_ID]: {},
}

/**
 * Symbols that are KNOWN to bridge to Robinhood Chain but whose canonical
 * address has not been verified into TOKENS yet. Listing them lets the thrown
 * error say "this exists, go verify it" instead of "unknown symbol", without
 * ever risking a fallback to an unverified (or Ethereum) address.
 */
export const UNRESOLVED_SYMBOLS = Object.freeze(['USDC', 'USDT', 'DAI', 'WBTC'])

/**
 * Resolve a symbol to its verified address on a specific chain.
 *
 * Returns the checksummed address string. Throws a specific, actionable error
 * when the symbol is unmapped — never falls back to an Ethereum address, which
 * is the exact failure mode this module exists to prevent.
 *
 * @param {string} symbol   token ticker, case-insensitive
 * @param {number} chainId  defaults to Robinhood Chain mainnet
 * @returns {`0x${string}`} the checksummed address on that chain
 */
export function resolveToken(symbol, chainId = ROBINHOOD_MAINNET_ID) {
  const entry = resolveTokenEntry(symbol, chainId)
  return entry.address
}

/**
 * Same resolution as resolveToken() but returns the full registry entry,
 * including the decimals you must use to format or parse amounts for this token.
 *
 * @param {string} symbol
 * @param {number} chainId
 * @returns {{address:`0x${string}`,name:string,symbol:string,decimals:number,verifiedAt:string}}
 */
export function resolveTokenEntry(symbol, chainId = ROBINHOOD_MAINNET_ID) {
  const key = String(symbol).toUpperCase()
  const entry = TOKENS[chainId]?.[key]
  if (entry) return entry

  const known = UNRESOLVED_SYMBOLS.includes(key)
  const chainName = safeChainName(chainId)
  throw new Error(
    `No verified address for ${key} on chain ${chainId}${chainName ? ` (${chainName})` : ''}. ` +
      (known
        ? `${key} bridges to this chain but its canonical address is not verified into ` +
          `TOKENS yet. `
        : '') +
      `Bridged tokens have chain-specific addresses — a token's Ethereum address is NOT ` +
      `its address here. Look the address up on the explorer, confirm it with verifyToken(), ` +
      `then add it to TOKENS. Never fall back to an Ethereum address.`,
  )
}

/** Chain name for error messages; tolerant of unknown IDs. */
function safeChainName(chainId) {
  try {
    return getChain(chainId).name
  } catch {
    return null
  }
}

/**
 * Build a read-only client for a chain. Honors RH_RPC for a custom endpoint.
 */
function clientFor(chain) {
  return createPublicClient({ chain, transport: http(process.env.RH_RPC || undefined) })
}

/**
 * Confirm an address is a live ERC-20 before you trust it: bytecode must exist,
 * and name/symbol/decimals/totalSupply must respond. Returns the metadata read
 * from the chain, plus the bytecode size and an explorer link.
 *
 * This is the gate every address must pass before entering TOKENS. An address
 * with no code is a typo or a wrong-chain paste — it throws here rather than
 * silently becoming a registry entry.
 *
 * @param {string} address        the address to verify
 * @param {import('viem').Chain} chain  defaults to Robinhood Chain mainnet
 */
export async function verifyToken(address, chain = robinhoodChain) {
  const client = clientFor(chain)
  const checksummed = getAddress(address)

  const bytecode = await client.getCode({ address: checksummed })
  if (!bytecode || bytecode === '0x') {
    throw new Error(
      `No contract deployed at ${checksummed} on ${chain.name}. An address with no code is ` +
        `not a token — this is what an Ethereum address pasted onto Robinhood Chain looks like.`,
    )
  }

  // decimals is attacker-relevant and must be read, never assumed. name/symbol
  // are attacker-controlled strings: treat them as data, never as a logic key.
  const contracts = ['name', 'symbol', 'decimals', 'totalSupply'].map((functionName) => ({
    address: checksummed,
    abi: erc20Abi,
    functionName,
  }))

  let name, symbol, decimals, totalSupply
  try {
    const [n, s, d, t] = await client.multicall({
      contracts,
      allowFailure: false,
      multicallAddress: MULTICALL3_ADDRESS,
    })
    ;[name, symbol, decimals, totalSupply] = [n, s, d, t]
  } catch {
    // Fall back to individual eth_call when multicall is unavailable.
    ;[name, symbol, decimals, totalSupply] = await Promise.all(
      contracts.map((c) => client.readContract(c)),
    )
  }

  return {
    address: checksummed,
    name,
    symbol,
    decimals: Number(decimals),
    totalSupply: totalSupply.toString(),
    bytecodeSize: (bytecode.length - 2) / 2,
    chainId: chain.id,
    explorer: `${chain.blockExplorers.default.url}/address/${checksummed}`,
    readAt: new Date().toISOString(),
  }
}
