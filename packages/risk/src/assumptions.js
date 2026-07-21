/* built by nirholas x.com/nichxbt */
/**
 * robinhood-toolkit · trust assumption model
 * Author: nirholas · https://github.com/nirholas/robinhood-toolkit
 * License: All Rights Reserved (c) 2026 nirholas
 *
 * robinhood-toolkit · package: robinhood-risk
 *
 * The single machine-readable source of truth for what a user trusts when they
 * transact on Robinhood Chain. The disclosure UI, the pre-transaction gate, and
 * the site risk section all render FROM this array, so product copy cannot drift
 * from the model.
 *
 * Rules that keep this file honest:
 *   - An unverified item stays in the array with `verified: false`. It is never
 *     dropped. An omitted risk reads as an absent risk.
 *   - Every entry carries a `mitigation`. A risk with no mitigation is a
 *     disclaimer, and a disclaimer is not the deliverable.
 *   - Every unverified entry's mitigation names a primary source to check.
 *
 * See README.md for the severity scale and the procedure for moving an item from
 * unverified to verified.
 */

/** @typedef {'low' | 'medium' | 'high'} Severity */

/**
 * @typedef {object} Assumption
 * @property {string} id            Stable kebab-case key. Referenced by the gate.
 * @property {Severity} severity    Impact if the assumption fails to hold.
 * @property {boolean} verified     True only when confirmed from a primary source.
 * @property {string} statement     Plain-language description, no jargon-only claims.
 * @property {string[]} affects     User actions this assumption bears on.
 * @property {string} mitigation    What a user or integrator can actually do about it.
 */

/** @type {readonly Assumption[]} */
export const TRUST_MODEL = [
  {
    id: 'centralized-sequencer',
    severity: 'high',
    verified: true,
    statement:
      'Robinhood operates both the sequencer and the proposer. One party orders ' +
      'transactions and posts state roots.',
    affects: ['transaction inclusion', 'censorship resistance', 'liveness'],
    mitigation:
      'Monitor sequencer liveness and disable submission when stalled. Do not ' +
      'design flows that assume guaranteed inclusion within a deadline.',
  },
  {
    id: 'permissioned-fraud-proofs',
    severity: 'high',
    verified: true,
    statement:
      'Fewer than five external actors can submit fraud challenges. L2BEAT ' +
      'classifies the risk profile as "Other" for this reason.',
    affects: ['state validity', 'withdrawal correctness'],
    mitigation:
      'Do not describe this chain as inheriting Ethereum security without ' +
      'qualification. Size positions to the operator trust you are extending.',
  },
  {
    id: 'withdrawal-latency',
    severity: 'medium',
    verified: true,
    statement:
      'Canonical withdrawals take approximately 7 days, the optimistic ' +
      'challenge period. Deposits take approximately 10 minutes.',
    affects: ['exit', 'liquidity planning'],
    mitigation:
      'Surface the 7 day period before the user signs. Offer partner routes as ' +
      'a labeled alternative with their own trust model, not as a default.',
  },
  {
    id: 'blob-data-availability',
    severity: 'low',
    verified: true,
    statement:
      'Transaction data is posted to Ethereum via blobs, so chain history is ' +
      'reconstructible independently of the operator.',
    affects: ['data availability', 'history reconstruction'],
    mitigation:
      'This is a strength, not a risk. Do not let it be read as covering ' +
      'execution validity, which it does not.',
  },
  {
    id: 'upgradeable-token-proxies',
    severity: 'medium',
    verified: true,
    statement:
      'Core bridged tokens (WETH, USDG) are proxy contracts whose ' +
      'implementations can change.',
    affects: ['token behavior', 'integration stability'],
    mitigation:
      'Interact through the proxy, never a cached implementation address. ' +
      'Monitor upgrade events on addresses you depend on.',
  },
  {
    id: 'proxy-upgrade-control',
    severity: 'high',
    verified: false,
    statement:
      'UNVERIFIED: who controls proxy upgrades, and under what multisig or ' +
      'timelock. Confirm at https://docs.robinhood.com/chain/contracts/ before ' +
      'making any claim.',
    affects: ['token behavior', 'user funds'],
    mitigation:
      'Verify from primary sources (https://docs.robinhood.com/chain/contracts/ ' +
      'and the block explorer) before publishing. Do not guess.',
  },
  {
    id: 'escape-hatch',
    severity: 'high',
    verified: false,
    statement:
      'UNVERIFIED: whether users can force-include a transaction or exit ' +
      'without sequencer cooperation, and on what delay.',
    affects: ['censorship resistance', 'worst-case exit'],
    mitigation:
      'Confirm from the chain docs (https://docs.robinhood.com/chain/) and the ' +
      'L2BEAT page for this chain. This determines the worst case, so it is the ' +
      'highest-value fact to resolve.',
  },
  {
    id: 'entity-separation',
    severity: 'medium',
    verified: true,
    statement:
      'Self-custody wallet services run through Robinhood Non-Custodial Ltd ' +
      '(Cayman), a separate entity from Robinhood Financial LLC and Robinhood ' +
      'Crypto LLC. An on-chain balance is not a brokerage balance and carries ' +
      'no brokerage account protections. The entities are related, not ' +
      'unaffiliated.',
    affects: ['custody', 'user expectations', 'account protections'],
    mitigation:
      'State both halves in UI copy. Never imply app funds and chain funds are ' +
      'one pool, and never imply the products are unrelated.',
  },
  {
    id: 'network-age',
    severity: 'low',
    verified: true,
    statement: 'Mainnet launched 2026-07-01. Operational history is short.',
    affects: ['operational confidence'],
    mitigation: 'Rehearse on testnet. Size early mainnet exposure accordingly.',
  },
]

/** Severity rank for sorting: high first. */
const SEVERITY_RANK = { high: 0, medium: 1, low: 2 }

/** Assumptions still awaiting confirmation from a primary source. */
export const unverified = () => TRUST_MODEL.filter((a) => !a.verified)

/** Assumptions whose failure would be high-impact. Must render without a click. */
export const highSeverity = () => TRUST_MODEL.filter((a) => a.severity === 'high')

/** Look up one assumption by id. Throws on an unknown id so typos surface loudly. */
export function assumptionById(id) {
  const found = TRUST_MODEL.find((a) => a.id === id)
  if (!found) throw new Error(`unknown assumption id "${id}"`)
  return found
}

/** The two items a user must see before a first value-moving action. */
export const GATE_ASSUMPTION_IDS = ['withdrawal-latency', 'centralized-sequencer']

/** Assumptions surfaced by the pre-transaction gate, high severity first. */
export const gateAssumptions = () =>
  GATE_ASSUMPTION_IDS.map(assumptionById).sort(
    (a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity],
  )

/** Whole model, high severity first, for a rendered disclosure. */
export const bySeverity = () =>
  [...TRUST_MODEL].sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity])
/* built by nirholas x.com/nichxbt */
