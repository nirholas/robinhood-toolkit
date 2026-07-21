/**
 * robinhood-chain · amount formatting that never guesses decimals
 * Author: nirholas · https://github.com/nirholas/robinhood-toolkit
 * License: All Rights Reserved (c) 2026 nirholas
 *
 * robinhood-toolkit · package: robinhood-chain
 */

import { erc20Abi, formatUnits, getAddress, parseUnits } from 'viem'
import { MissingDecimalsError, RobinhoodChainError } from './errors.js'

/**
 * Validate a decimals value. Rejects undefined, null, non-integers, negatives,
 * and anything above 255 (the uint8 ceiling of the ERC-20 return type).
 *
 * There is deliberately no default parameter anywhere in this module.
 */
export function assertDecimals(decimals, context) {
  if (decimals === undefined || decimals === null) throw new MissingDecimalsError(context)
  const n = Number(decimals)
  if (!Number.isInteger(n) || n < 0 || n > 255) {
    throw new RobinhoodChainError(
      `Invalid token decimals ${JSON.stringify(decimals)}${context ? ` (${context})` : ''}. ` +
        'Expected an integer between 0 and 255.',
    )
  }
  return n
}

/**
 * Format a raw on-chain amount into a decimal string.
 *
 * `decimals` is REQUIRED. Omitting it throws MissingDecimalsError rather than
 * assuming 18, because USDG on this chain is 6 and a wrong exponent produces a
 * plausible-looking wrong number instead of a visible failure.
 *
 * @example
 * formatToken(1_500_000n, USDG.decimals) // '1.5'
 * formatToken(1_500_000n)                // throws MissingDecimalsError
 */
export function formatToken(amount, decimals) {
  const d = assertDecimals(decimals, 'formatToken')
  if (typeof amount !== 'bigint') {
    if (typeof amount === 'number' && !Number.isSafeInteger(amount)) {
      throw new RobinhoodChainError(
        `formatToken received an unsafe number ${amount}. Pass raw amounts as bigint to avoid precision loss.`,
      )
    }
    return formatUnits(BigInt(amount), d)
  }
  return formatUnits(amount, d)
}

/**
 * Parse a human decimal string into a raw on-chain bigint.
 *
 * `decimals` is REQUIRED, same reasoning as formatToken. Passing 18 for USDG
 * would attempt to move 10^12 times the intended amount.
 *
 * @example
 * parseToken('1.5', USDG.decimals) // 1500000n
 */
export function parseToken(value, decimals) {
  const d = assertDecimals(decimals, 'parseToken')
  if (value === undefined || value === null || value === '') {
    throw new RobinhoodChainError('parseToken requires a value such as "1.5".')
  }
  if (typeof value === 'number' && !Number.isFinite(value)) {
    throw new RobinhoodChainError(`parseToken received a non-finite number ${value}.`)
  }
  return parseUnits(String(value), d)
}

/**
 * Read a token's decimals from the contract.
 *
 * Pass a `cache` (any Map) when reading the same token repeatedly in a hot loop.
 * Decimals are immutable in practice for these tokens, but the cache is opt-in
 * so this function never quietly serves a stale value you did not ask it to keep.
 */
export async function readDecimals(client, address, { cache } = {}) {
  const token = getAddress(address)
  const key = `${client.chain?.id ?? 'unknown'}:${token}`
  if (cache?.has(key)) return cache.get(key)

  let decimals
  try {
    decimals = await client.readContract({ address: token, abi: erc20Abi, functionName: 'decimals' })
  } catch (cause) {
    throw new RobinhoodChainError(
      `Could not read decimals() from ${token}. This package will not fall back to 18. ` +
        'Confirm the address is an ERC-20 on the network this client is pointed at.',
      { cause },
    )
  }

  const d = assertDecimals(decimals, `decimals() of ${token}`)
  cache?.set(key, d)
  return d
}

/**
 * Read a token balance and format it with decimals read from the same contract.
 * Returns both the raw bigint and the formatted string, so callers can display
 * one and do arithmetic on the other.
 */
export async function readBalance(client, { token, account, cache } = {}) {
  if (!token) throw new RobinhoodChainError('readBalance requires a `token` address.')
  if (!account) throw new RobinhoodChainError('readBalance requires an `account` address.')

  const tokenAddress = getAddress(token)
  const owner = getAddress(account)

  const [raw, decimals] = await Promise.all([
    client.readContract({ address: tokenAddress, abi: erc20Abi, functionName: 'balanceOf', args: [owner] }),
    readDecimals(client, tokenAddress, { cache }),
  ])

  return { token: tokenAddress, account: owner, raw, decimals, formatted: formatToken(raw, decimals) }
}
