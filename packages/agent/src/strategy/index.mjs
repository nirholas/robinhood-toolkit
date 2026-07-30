/* built by nirholas x.com/nichxbt */
/**
 * robinhood-toolkit · strategy port (placeholder)
 * Author: nirholas · https://github.com/nirholas/robinhood-toolkit
 * License: All Rights Reserved (c) 2026 nirholas
 *
 * Prompt 02 (signal generation) replaces this. The skeleton ships a strategy
 * that never trades so a fresh checkout in PAPER mode does nothing surprising:
 * you opt into signals, you do not opt out of them. Implements the Strategy
 * seam from ./ports.mjs.
 */
export default function createStrategy(_config) {
  return {
    async decide(_ctx) {
      return null; // abstain: emit no orders until a real strategy is wired in
    },
  };
}
/* built by nirholas x.com/nichxbt */
