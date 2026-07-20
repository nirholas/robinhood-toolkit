/**
 * robinhood-chain · known token constants and the live USDG ticker collision
 * Author: nirholas · https://github.com/nirholas/robinhood-toolkit
 * License: MIT (c) 2026 nirholas
 *
 * robinhood-toolkit · package: robinhood-chain
 */

import { getAddress } from 'viem'
import { ROBINHOOD_MAINNET_ID } from './chains.js'

/**
 * Wrapped Ether on Robinhood Chain mainnet. A proxy contract.
 * Metadata read on-chain 2026-07-20: name 'WETH', symbol 'WETH', decimals 18.
 */
export const WETH = Object.freeze({
  address: '0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73',
  name: 'WETH',
  symbol: 'WETH',
  decimals: 18,
  chainId: ROBINHOOD_MAINNET_ID,
})

/**
 * Global Dollar, the settlement asset for Stock Tokens. A proxy contract.
 * Metadata read on-chain 2026-07-20: name 'Global Dollar', symbol 'USDG',
 * decimals 6.
 *
 * DECIMALS ARE 6, NOT 18. This is the highest-value gotcha on this chain.
 * Formatting a USDG balance with an 18 exponent understates it by a factor of
 * 10^12 and still produces a number that looks like a real balance. Parsing with
 * 18 attempts to send 10^12 times the intended amount. Neither failure announces
 * itself.
 */
export const USDG = Object.freeze({
  address: '0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168',
  name: 'Global Dollar',
  symbol: 'USDG',
  decimals: 6,
  chainId: ROBINHOOD_MAINNET_ID,
})

/**
 * Curated tokens keyed by symbol, for use as compile-time constants in your own
 * source. Do NOT feed user input into this map: on this chain a symbol does not
 * identify a token. Use knownTokenAt(address) for runtime resolution.
 */
export const KNOWN_TOKENS = Object.freeze({ WETH, USDG })

/**
 * Tokens observed live on mainnet that squat the ticker of a real token.
 *
 * This is not a hypothetical attack. As of 2026-07-20 an ERC-20 named
 * "Useless Stupid Degen Gamblers" trades on Robinhood Chain with symbol "USDG"
 * and has live pools. A DexScreener symbol search for USDG returns it alongside
 * the real Global Dollar. A user who types "USDG" and takes the first hit can
 * land on either.
 *
 * It also has 18 decimals against the real USDG's 6, so a codebase that resolves
 * by symbol and defaults decimals gets both failures at once.
 *
 * This list is a convenience for surfacing a warning in a UI. It is NOT a
 * security boundary: a new impostor costs one deploy, so it can never be
 * complete. Verify by address with assertCanonicalToken instead.
 */
export const KNOWN_IMPOSTORS = Object.freeze([
  Object.freeze({
    address: '0x8218d73C00567A01481495Ad6c5143e00D5BB5b4',
    name: 'Useless Stupid Degen Gamblers',
    symbol: 'USDG',
    decimals: 18,
    chainId: ROBINHOOD_MAINNET_ID,
    impersonates: USDG.address,
    note: 'Memecoin squatting the Global Dollar ticker. Not a stablecoin.',
  }),
])

const BY_ADDRESS = new Map(
  [...Object.values(KNOWN_TOKENS), ...KNOWN_IMPOSTORS].map((t) => [t.address.toLowerCase(), t]),
)

/**
 * Resolve a known token by address. Returns null for anything not in the curated
 * set. Address resolution is the safe direction; symbol resolution is not.
 */
export function knownTokenAt(address) {
  return BY_ADDRESS.get(getAddress(address).toLowerCase()) ?? null
}

/**
 * True when the address is a documented ticker squatter.
 *
 * Advisory only. A false result means "not on our list", never "safe".
 */
export function isKnownImpostor(address) {
  const normalized = getAddress(address).toLowerCase()
  return KNOWN_IMPOSTORS.some((t) => t.address.toLowerCase() === normalized)
}
