/* built by nirholas x.com/nichxbt */
/**
 * robinhood-toolkit · backtest cost model (shared by backtester and paper broker)
 * Author: nirholas · https://github.com/nirholas/robinhood-toolkit
 * License: All Rights Reserved (c) 2026 nirholas
 *
 * One cost model, imported by both the backtester (prompt 03) and the paper
 * broker (prompt 04). If paper fills and backtest fills ever disagree, it is
 * because someone reimplemented this instead of importing it. Don't.
 */
export function createCostModel({
  takerFeeBps = 30,
  halfSpreadBps = 5,
  slippageBpsPerVolShare = 50,
  gasCostQuote = 0,
} = {}) {
  return {
    params: { takerFeeBps, halfSpreadBps, slippageBpsPerVolShare, gasCostQuote },

    /** Effective fill price including half-spread and size-dependent slippage. */
    fillPrice({ side, referencePrice, quantity, barVolume }) {
      const volShare = barVolume > 0 ? Math.min(1, quantity / barVolume) : 1;
      const bps = halfSpreadBps + slippageBpsPerVolShare * volShare;
      const adj = referencePrice * (bps / 10_000);
      return side === 'buy' ? referencePrice + adj : referencePrice - adj;
    },

    fee({ price, quantity }) {
      return price * quantity * (takerFeeBps / 10_000) + gasCostQuote;
    },
  };
}
/* built by nirholas x.com/nichxbt */
