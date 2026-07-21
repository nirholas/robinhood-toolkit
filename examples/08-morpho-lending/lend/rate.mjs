/**
 * robinhood-toolkit · Morpho rate reader
 * Author: nirholas · https://github.com/nirholas/robinhood-toolkit
 * License: MIT (c) 2026 nirholas
 *
 * The APY a UI quotes is a headline, not contract state. The truth is the IRM's
 * borrow rate per second, from which supply APY is derived through utilization
 * and the market fee. Read it here. Never display a hardcoded number.
 */
import { parseAbi } from 'viem'

const irmAbi = parseAbi([
  'function borrowRateView((address loanToken,address collateralToken,address oracle,address irm,uint256 lltv), (uint128 totalSupplyAssets,uint128 totalSupplyShares,uint128 totalBorrowAssets,uint128 totalBorrowShares,uint128 lastUpdate,uint128 fee)) view returns (uint256)',
])

const SECONDS_PER_YEAR = 31_536_000
const WAD = 10n ** 18n

/** borrowRatePerSecond is WAD-scaled. Convert to a compounded annual rate. */
export function toApy(ratePerSecondWad) {
  const perSecond = Number(ratePerSecondWad) / Number(WAD)
  return Math.expm1(perSecond * SECONDS_PER_YEAR)
}

/**
 * Read the live rates for a market. `state` is the tuple returned by Morpho's
 * market() — the same shape readMarketState() produces, minus the derived
 * fields, which this re-derives so it can be called with either.
 */
export async function marketRates(client, irm, params, state) {
  const borrowRate = await client.readContract({
    address: irm,
    abi: irmAbi,
    functionName: 'borrowRateView',
    args: [params, marketTuple(state)],
  })
  const borrowApy = toApy(borrowRate)
  const utilization =
    state.totalSupplyAssets === 0n
      ? 0
      : Number((state.totalBorrowAssets * 10_000n) / state.totalSupplyAssets) / 10_000
  const feeFraction = Number(state.fee) / Number(WAD)
  const supplyApy = borrowApy * utilization * (1 - feeFraction)
  return { borrowRatePerSecond: borrowRate, borrowApy, supplyApy, utilization, fee: feeFraction }
}

/** borrowRateView wants the raw 6-field tuple; accept either object or array. */
function marketTuple(state) {
  if (Array.isArray(state)) return state.slice(0, 6)
  return [
    state.totalSupplyAssets,
    state.totalSupplyShares,
    state.totalBorrowAssets,
    state.totalBorrowShares,
    state.lastUpdate,
    state.fee,
  ]
}
