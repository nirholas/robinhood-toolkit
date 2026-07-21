<<<<<<< Updated upstream
=======
/* built by nirholas x.com/nichxbt */
>>>>>>> Stashed changes
/**
 * robinhood-toolkit · policy port (placeholder)
 * Author: nirholas · https://github.com/nirholas/robinhood-toolkit
 * License: All Rights Reserved (c) 2026 nirholas
 *
 * The real policy engine (risk limits, notional caps, daily loss stops) arrives
 * in the 80-safety track. This placeholder deliberately blocks everything: a
 * skeleton with no rules must fail closed, never open. Implements the Policy
 * seam from ./ports.mjs.
 */
export default function createPolicy(_config) {
  return {
    async evaluate(_intent, _ctx) {
      return { allow: false, violations: ['no policy engine wired in (fail closed)'] };
    },
  };
}
<<<<<<< Updated upstream
=======
/* built by nirholas x.com/nichxbt */
>>>>>>> Stashed changes
