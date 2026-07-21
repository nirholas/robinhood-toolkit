/**
 * robinhood-toolkit · bridge routes and the seven-day withdrawal cost model
 * Author: nirholas · https://github.com/nirholas/robinhood-toolkit
 * License: MIT (c) 2026 nirholas
 *
 * robinhood-toolkit · package: bridge
 *
 * Robinhood Chain is an optimistic rollup. A canonical withdrawal waits out the
 * fraud-challenge period — approximately seven days — before the funds are
 * claimable on Ethereum. That is a PROTOCOL PROPERTY, not a queue you can
 * escalate. This module makes it a required field so a UI cannot render a
 * withdrawal flow without confronting it.
 */

export const CHALLENGE_PERIOD_DAYS = 7
export const APPROX_DEPOSIT_MINUTES = 10

export const CANONICAL_BRIDGE_URL =
  'https://portal.arbitrum.io/bridge?destinationChain=robinhood-chain&sourceChain=ethereum'

/**
 * Partner liquidity networks. They front liquidity to skip the challenge period,
 * so a "fast withdrawal" through them is a DIFFERENT trust model, not a faster
 * version of the canonical one. Fees and latency are market-driven — quote each
 * live at request time; a cached figure is a misquote.
 */
const PARTNER_NAMES = ['LayerZero/Stargate', 'Chainlink CCIP', 'Relay', 'Across', 'LiFi']

/**
 * Route model for a given direction.
 *
 * @param {{direction: 'deposit' | 'withdraw'}} opts
 */
export function bridgeRoutes({ direction }) {
  if (direction !== 'deposit' && direction !== 'withdraw') {
    throw new Error(`bridgeRoutes: direction must be 'deposit' or 'withdraw', got ${JSON.stringify(direction)}.`)
  }

  const canonical = {
    id: 'canonical',
    name: 'Arbitrum canonical bridge',
    url: CANONICAL_BRIDGE_URL,
    trust: 'rollup-native, no third-party liquidity provider',
    depositMinutes: direction === 'deposit' ? APPROX_DEPOSIT_MINUTES : null,
    // The challenge period only applies on the way out.
    challengePeriodDays: direction === 'withdraw' ? CHALLENGE_PERIOD_DAYS : 0,
    feeQuote: 'live',
  }

  // Third-party liquidity networks. Faster exits, additional trust assumptions.
  // Fees and latency are market-driven: quote each at request time.
  const partners = PARTNER_NAMES.map((name) => ({
    id: name.toLowerCase().replace(/[^a-z]+/g, '-').replace(/^-|-$/g, ''),
    name,
    trust: 'third-party bridge, independent security model',
    depositMinutes: 'quote-required',
    // Partners front liquidity to bypass the wait; they do not shorten it.
    challengePeriodDays: 0,
    feeQuote: 'live',
  }))

  return { canonical, partners }
}

/**
 * Estimate a withdrawal from Robinhood Chain to Ethereum.
 *
 * Returns the canonical route (with its ~7 day challenge period) and the partner
 * routes (marked as requiring a live quote). `challengePeriodDays` is surfaced at
 * the TOP LEVEL so no UI can render this flow without reading it — show it to the
 * user before they sign, not on the confirmation screen.
 *
 * Fees are never quoted from a stored figure. `feeQuote: 'live'` is the contract:
 * the caller must fetch a live quote per route at request time.
 *
 * @param {{amount?: bigint|string|number, symbol?: string}} [params]
 */
export function estimateWithdrawal({ amount, symbol } = {}) {
  const { canonical, partners } = bridgeRoutes({ direction: 'withdraw' })

  return {
    direction: 'withdraw',
    // Load-bearing. A withdrawal flow that does not read this field is broken.
    challengePeriodDays: CHALLENGE_PERIOD_DAYS,
    amount: amount === undefined ? null : String(amount),
    symbol: symbol ?? null,
    canonical,
    partners,
    feesAreLive: true,
    warning:
      `Canonical withdrawals wait the full ~${CHALLENGE_PERIOD_DAYS}-day optimistic-rollup ` +
      `challenge period before funds are claimable on Ethereum. This cannot be escalated. ` +
      `Partner routes can exit sooner by fronting liquidity, under a different trust model, ` +
      `for a market-driven fee that must be quoted live. Surface this delay before the user signs.`,
  }
}

/**
 * Symmetric estimate for a deposit (Ethereum → Robinhood Chain). No challenge
 * period on the way in; latency is approximately ten minutes, and your own
 * measured L1→L2 delta should replace that figure once you have it.
 *
 * @param {{amount?: bigint|string|number, symbol?: string}} [params]
 */
export function estimateDeposit({ amount, symbol } = {}) {
  const { canonical, partners } = bridgeRoutes({ direction: 'deposit' })
  return {
    direction: 'deposit',
    challengePeriodDays: 0,
    approxMinutes: APPROX_DEPOSIT_MINUTES,
    amount: amount === undefined ? null : String(amount),
    symbol: symbol ?? null,
    canonical,
    partners,
    feesAreLive: true,
    note:
      'Bridge ETH before you bridge tokens: ETH is the gas token, and arriving with an ERC-20 ' +
      'balance and zero ETH leaves you unable to pay gas. Replace approxMinutes with your own ' +
      'measured L1→L2 delta from a rehearsal deposit.',
  }
}
