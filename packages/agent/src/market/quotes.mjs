/**
 * robinhood-toolkit · market data port (placeholder)
 * Author: nirholas · https://github.com/nirholas/robinhood-toolkit
 * License: All Rights Reserved (c) 2026 nirholas
 *
 * Prompt 02 replaces this with a real feed. Until then it returns a static,
 * clearly-fake quote so the loop skeleton is runnable end to end. It implements
 * the MarketData seam from ./ports.mjs.
 */
export default function createMarketData(_config) {
  return {
    async getQuote(symbol) {
      const mid = 100_000;
      return { symbol, bid: mid - 1, ask: mid + 1, ts: Date.now() };
    },
  };
}
