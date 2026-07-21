/**
 * robinhood-toolkit · trust & risk page content
 * Author: nirholas · https://github.com/nirholas/robinhood-toolkit
 * License: MIT (c) 2026 nirholas
 *
 * The public risk section renders FROM the same TRUST_MODEL the app's disclosure
 * gate uses (packages/risk). The copy here cannot drift from the model, because
 * it is the model.
 */

import { bySeverity, unverified } from '../../../packages/risk/src/assumptions.js'
import { LINKS } from '../constants.mjs'
import { callout, esc, list, p, pager, section } from '../ui.mjs'

export const route = {
  path: '/risk/',
  file: 'risk/index.html',
  nav: 'Risk',
  title: 'Trust assumptions and risk',
  description:
    'What you trust when you transact on Robinhood Chain: a single centralized sequencer and proposer, a fraud-challenger set of fewer than five external actors, a ~7 day canonical exit, upgradeable token proxies, and the entity separation between on-chain and brokerage balances. Rendered from the machine-readable trust model.'
}

const SEV = {
  high: { label: 'High severity', glyph: '▲' },
  medium: { label: 'Medium severity', glyph: '■' },
  low: { label: 'Low severity', glyph: '●' }
}

/** One assumption as a self-contained block. Severity is text + glyph, never color alone. */
function assumptionBlock(a) {
  const sev = SEV[a.severity] ?? SEV.low
  const status = a.verified
    ? '<span class="risk-badge">Verified</span>'
    : '<span class="risk-badge risk-badge--unverified">Unverified — confirm from a primary source</span>'
  return `<article class="risk-item risk-item--${esc(a.severity)}" id="risk-${esc(a.id)}">
  <div class="risk-item__head">
    <span class="risk-item__sev"><span aria-hidden="true">${sev.glyph}</span> ${esc(sev.label)}</span>
    ${status}
  </div>
  <p class="risk-item__statement">${esc(a.statement)}</p>
  <p class="risk-item__affects"><strong>Affects:</strong> ${a.affects.map(esc).join(', ')}</p>
  <p class="risk-item__mitigation"><strong>What you can do:</strong> ${esc(a.mitigation)}</p>
</article>`
}

export function render({ base }) {
  const items = bySeverity().map(assumptionBlock).join('\n')
  const stillOpen = unverified()

  return `
<div class="page-head">
  <p class="eyebrow">Risk</p>
  <h1>Trust assumptions and risk</h1>
  <p class="lede">
    Robinhood Chain is an Arbitrum Orbit L2 that publishes its transaction data to Ethereum, so its
    history is reconstructible by anyone. That is data availability. Execution validity is a separate
    guarantee, and it currently rests on a single operator and a small set of fraud challengers. The
    difference matters, and it is why "secured by Ethereum" is only half true here.
  </p>
</div>

${section(
  'model',
  'What you are trusting',
  p(
    'Every item below is an assumption you accept when you transact on this chain. High-severity items',
    'come first, and nothing is hidden behind a click. This list is generated from the same',
    '<code>TRUST_MODEL</code> the app uses to gate value-moving actions, so it stays in sync with the',
    'code by construction.'
  ),
  `<div class="risk-list">\n${items}\n</div>`
)}

${section(
  'da-vs-execution',
  'Data availability is not execution validity',
  p(
    'Transaction data is posted to Ethereum via blobs, so anyone can reconstruct the chain\'s history',
    'even if the operator stops cooperating. That is a real strength. It does not mean an invalid state',
    'root would be caught: that depends on the fraud-proof system, and',
    `<a href="${esc(LINKS.l2beat)}" rel="noopener noreferrer">L2BEAT</a> classifies this chain\'s risk`,
    'profile as "Other" because fewer than five external actors can submit challenges. Do not read data',
    'availability as covering execution correctness. It does not.'
  )
)}

${section(
  'custody',
  'On-chain balances are not brokerage balances',
  p(
    'Self-custody wallet services run through Robinhood Non-Custodial Ltd, a Cayman Islands entity that',
    'is separate from Robinhood Financial LLC and from Robinhood Crypto LLC. An on-chain balance is not',
    'held by the broker-dealer and does not carry brokerage account protections. These are related',
    'entities offering related products — not one pool of funds, and not unaffiliated third parties.',
    'Both halves are true at once; state both.'
  )
)}

${section(
  'liveness',
  'When the sequencer stalls',
  p(
    'A single sequencer orders every transaction. At ~101 ms blocks, ten seconds of silence is already',
    'anomalous. The toolkit ships a liveness monitor (<code>packages/risk</code>) that watches head',
    'advancement and cross-checks it against the sequencer feed; when it reports a stall, a well-built',
    'app disables submission and points you at the canonical exit rather than letting you broadcast into',
    'silence.'
  ),
  callout({
    icon: '↩',
    label: 'The exit that does not depend on the sequencer',
    body: p(
      'The canonical bridge withdrawal to Ethereum settles over the ~7 day optimistic challenge period.',
      'It is slow by construction, but it does not require the sequencer to accept a new transaction.',
      'Partner bridges (LayerZero and Stargate, Chainlink CCIP, Relay, Across, LiFi) exit in minutes by',
      'fronting liquidity and add their own trust model on top of the chain\'s. Faster is not safer.'
    )
  })
)}

${section(
  'open',
  'Open questions we have not verified',
  p(
    'These are the highest-value facts to confirm from primary sources, because they determine the',
    'worst case. They are listed here marked unverified rather than omitted: silence would read as',
    'safety.'
  ),
  list(
    stillOpen.map(
      (a) => `<strong>${esc(a.statement.replace(/^UNVERIFIED:\s*/, ''))}</strong> ${esc(a.mitigation)}`
    )
  ),
  p(
    `Confirm against the <a href="${esc(LINKS.chainDocs)}" rel="noopener noreferrer">chain docs</a> and`,
    `the <a href="${esc(LINKS.l2beat)}" rel="noopener noreferrer">L2BEAT page</a> before relying on any`,
    'answer. A young network\'s parameters change.'
  )
)}

${pager(
  base,
  { href: '/chain/', title: 'Robinhood Chain' },
  { href: '/charts/', title: 'Charts & data' }
)}
`
}
