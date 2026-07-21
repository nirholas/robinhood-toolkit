/**
 * robinhood-toolkit · paper broker (placeholder)
 * Author: nirholas · https://github.com/nirholas/robinhood-toolkit
 * License: All Rights Reserved (c) 2026 nirholas
 *
 * Prompt 04 fleshes this out into a fill simulator with slippage and a position
 * book. The skeleton version fills instantly at the intent's limit price so the
 * loop's executed path is exercisable without any network. Implements the
 * Broker seam from ./ports.mjs. Sends no real orders.
 */
export default function createPaperBroker(_config) {
  return {
    async placeOrder(intent) {
      return {
        clientOrderId: intent.clientOrderId,
        status: 'filled',
        filledQuantity: intent.quantity,
        avgPrice: intent.limitPrice ?? intent.notional / intent.quantity,
        paper: true,
      };
    },
  };
}
