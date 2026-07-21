/**
 * robinhood-toolkit · package: bridge — public entry point
 * Author: nirholas · https://github.com/nirholas/robinhood-toolkit
 * License: MIT (c) 2026 nirholas
 *
 * Bridging value onto Robinhood Chain and getting the token accounting right.
 *
 *   - Bridged ERC-20s have chain-specific addresses. resolveToken() throws
 *     rather than fall back to an Ethereum address.
 *   - verifyToken() proves bytecode + ERC-20 metadata before an address is
 *     trusted. Decimals are read, never assumed (WETH 18, USDG 6).
 *   - Withdrawals wait the ~7-day optimistic-rollup challenge period. That is
 *     surfaced as a required field, not buried in docs.
 */

export {
  TOKENS,
  UNRESOLVED_SYMBOLS,
  resolveToken,
  resolveTokenEntry,
  verifyToken,
} from './src/tokens.js'

export {
  CANONICAL_BRIDGE_URL,
  CHALLENGE_PERIOD_DAYS,
  APPROX_DEPOSIT_MINUTES,
  bridgeRoutes,
  estimateWithdrawal,
  estimateDeposit,
} from './src/withdrawal.js'
