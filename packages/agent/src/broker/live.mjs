/* built by nirholas x.com/nichxbt */
/**
 * robinhood-toolkit · live broker (placeholder)
 * Author: nirholas · https://github.com/nirholas/robinhood-toolkit
 * License: All Rights Reserved (c) 2026 nirholas
 *
 * Prompt 05 (execution engine) implements the real Robinhood Crypto REST
 * integration here. The skeleton exposes getBalances so the live preflight has
 * something to check, and refuses to place an order: reaching a live venue must
 * be a deliberate act of writing code, not a default that shipped. Implements
 * the Broker seam from ./ports.mjs.
 */
export default function createLiveBroker(_config) {
  return {
    async getBalances() {
      // Non-empty so the preflight's "no balances" guard passes once the
      // operator has explicitly opted into live via AGENT_LIVE_CONFIRM.
      return { USD: 0 };
    },
    async placeOrder(_intent) {
      throw new Error('live broker not implemented — see prompts/50-autonomous/05-execution-engine.md');
    },
  };
}
/* built by nirholas x.com/nichxbt */
