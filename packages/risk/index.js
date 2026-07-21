/* built by nirholas x.com/nichxbt */
/**
 * robinhood-toolkit · robinhood-risk public surface
 * Author: nirholas · https://github.com/nirholas/robinhood-toolkit
 * License: All Rights Reserved (c) 2026 nirholas
 *
 * robinhood-toolkit · package: robinhood-risk
 *
 * The risk layer for Robinhood Chain: a machine-readable trust model, an
 * accessible disclosure UI, a persisted pre-transaction acknowledgment gate, and
 * a sequencer liveness monitor. Everything a value-moving flow needs to degrade
 * correctly when the operator's assumptions stop holding.
 */

export {
  TRUST_MODEL,
  GATE_ASSUMPTION_IDS,
  assumptionById,
  bySeverity,
  gateAssumptions,
  highSeverity,
  unverified,
} from './src/assumptions.js'

export {
  CANONICAL_EXIT,
  DEGRADED_MS,
  FEED_SILENT_MS,
  STALLED_MS,
  canSubmitIn,
  classify,
  classifyDivergence,
  defaultParseFeedMessage,
  monitorLiveness,
  robinhoodChain,
  robinhoodTestnet,
} from './src/liveness.js'

export {
  DISCLOSURE_CSS,
  disclosureHTML,
  injectDisclosureStyles,
  mountDisclosure,
} from './src/disclosure.js'

export {
  ACK_STORAGE_KEY,
  ACK_VERSION,
  GATE_CSS,
  clearAcknowledgment,
  gated,
  hasAcknowledged,
  recordAcknowledgment,
  requireDisclosure,
} from './src/gate.js'

export { bindLivenessToSubmit, livenessMessage } from './src/liveness-ui.js'
/* built by nirholas x.com/nichxbt */
