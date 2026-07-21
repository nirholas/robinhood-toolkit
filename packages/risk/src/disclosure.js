/**
 * robinhood-toolkit · trust-assumption disclosure component
 * Author: nirholas · https://github.com/nirholas/robinhood-toolkit
 * License: MIT (c) 2026 nirholas
 *
 * robinhood-toolkit · package: robinhood-risk
 *
 * Renders TRUST_MODEL. Framework-free so it drops into any stack. Two entry
 * points share one template:
 *   - disclosureHTML(...)  -> string, for server rendering and for tests that
 *                             run without a DOM.
 *   - mountDisclosure(...) -> parses that string into a live element.
 *
 * Accessibility requirements this satisfies, and why each is load-bearing:
 *   - Readable at 320px: the layout is single-column and flows; no fixed widths.
 *   - Keyboard navigable: every interactive element is a real <a>/<button>; the
 *     component adds nothing that traps focus.
 *   - Semantic markup: <section> / <h2> / <ul> / <article> / <h3>, not <div>
 *     soup, so assistive tech gets real structure.
 *   - No color-only severity: severity is spelled out in text AND prefixed with
 *     a distinct glyph. A user who cannot see the color still gets the level.
 *   - No collapsed-by-default hiding of a high-severity item: nothing here is
 *     behind a <details>. Every assumption, especially the high-severity ones,
 *     is on screen without a click. A disclosure that needs a click is not one.
 */

import { bySeverity } from './assumptions.js'

const SEVERITY_META = {
  high: { label: 'High', glyph: '▲', note: 'Failure would be high-impact.' },
  medium: { label: 'Medium', glyph: '■', note: 'Failure would be material.' },
  low: { label: 'Low', glyph: '●', note: 'Failure would be limited.' },
}

/** Minimal HTML escaping for text interpolated into the template. */
export function esc(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** One assumption as an <article>. */
function assumptionHTML(a) {
  const meta = SEVERITY_META[a.severity] ?? SEVERITY_META.low
  const affects = a.affects.map((x) => `<li>${esc(x)}</li>`).join('')
  const verified = a.verified
    ? '<span class="rh-badge rh-badge--verified">Verified</span>'
    : '<span class="rh-badge rh-badge--unverified">Unverified — confirm from a primary source</span>'

  return `
<article class="rh-assumption rh-assumption--${esc(a.severity)}" id="risk-${esc(a.id)}">
  <div class="rh-assumption__head">
    <span class="rh-sev rh-sev--${esc(a.severity)}">
      <span class="rh-sev__glyph" aria-hidden="true">${meta.glyph}</span>
      <span class="rh-sev__label">${esc(meta.label)} severity</span>
    </span>
    ${verified}
  </div>
  <h3 class="rh-assumption__title">${esc(a.statement)}</h3>
  <div class="rh-assumption__body">
    <p class="rh-assumption__field"><span class="rh-label">Affects</span></p>
    <ul class="rh-affects">${affects}</ul>
    <p class="rh-assumption__field">
      <span class="rh-label">What you can do</span>
      <span class="rh-mitigation">${esc(a.mitigation)}</span>
    </p>
  </div>
</article>`
}

/**
 * The whole model as an HTML string, high severity first.
 *
 * @param {object} [options]
 * @param {readonly object[]} [options.model]   Defaults to bySeverity().
 * @param {string} [options.heading]            Section heading text.
 * @param {number} [options.headingLevel]       2 by default. The section owns an <h2>.
 * @returns {string}
 */
export function disclosureHTML({ model = bySeverity(), heading = 'What you are trusting', headingLevel = 2 } = {}) {
  const h = Math.min(Math.max(headingLevel, 1), 4)
  const items = model.map(assumptionHTML).join('\n')
  return `
<section class="rh-disclosure" aria-labelledby="rh-disclosure-heading">
  <h${h} id="rh-disclosure-heading" class="rh-disclosure__heading">${esc(heading)}</h${h}>
  <p class="rh-disclosure__lede">
    Every item below is an assumption you accept when you transact on this chain.
    High-severity items are listed first. Nothing here is hidden behind a click.
  </p>
  ${items}
</section>`
}

/**
 * Style for the component. Self-contained, theme-aware, and it never encodes
 * severity in color alone — color reinforces the text label, it does not replace
 * it. Inject once via injectDisclosureStyles(), or ship your own CSS against the
 * documented class names.
 */
export const DISCLOSURE_CSS = `
.rh-disclosure { max-width: 44rem; margin: 0 auto; line-height: 1.5; }
.rh-disclosure__heading { margin: 0 0 .25rem; }
.rh-disclosure__lede { margin: 0 0 1rem; opacity: .85; }
.rh-assumption {
  border: 1px solid currentColor;
  border-left-width: 6px;
  border-radius: 8px;
  padding: .85rem 1rem;
  margin: 0 0 .85rem;
}
.rh-assumption--high { border-left-color: #b00020; }
.rh-assumption--medium { border-left-color: #8a6d00; }
.rh-assumption--low { border-left-color: #3a6ea5; }
.rh-assumption__head {
  display: flex; flex-wrap: wrap; gap: .5rem; align-items: center;
  margin-bottom: .4rem;
}
.rh-sev { display: inline-flex; align-items: center; gap: .35rem; font-weight: 600; font-size: .82rem; }
.rh-sev__glyph { font-size: .9em; }
.rh-sev--high { color: #b00020; }
.rh-sev--medium { color: #8a6d00; }
.rh-sev--low { color: #3a6ea5; }
.rh-badge {
  font-size: .72rem; font-weight: 600; padding: .12rem .5rem;
  border: 1px solid currentColor; border-radius: 999px; white-space: nowrap;
}
.rh-badge--unverified { color: #8a6d00; }
.rh-badge--verified { opacity: .7; }
.rh-assumption__title { margin: 0 0 .5rem; font-size: 1rem; line-height: 1.35; }
.rh-label {
  display: inline-block; font-size: .72rem; letter-spacing: .04em;
  text-transform: uppercase; opacity: .7; margin-right: .4rem;
}
.rh-affects { margin: 0 0 .5rem; padding-left: 1.1rem; }
.rh-affects li { margin: .1rem 0; }
.rh-mitigation { }
@media (max-width: 360px) {
  .rh-assumption { padding: .75rem .8rem; }
  .rh-assumption__head { gap: .35rem; }
}
`

/** Inject DISCLOSURE_CSS into <head> once. No-op outside a DOM or if already present. */
export function injectDisclosureStyles(doc = globalThis.document) {
  if (!doc?.head) return
  if (doc.getElementById('rh-disclosure-styles')) return
  const style = doc.createElement('style')
  style.id = 'rh-disclosure-styles'
  style.textContent = DISCLOSURE_CSS
  doc.head.appendChild(style)
}

/**
 * Build a live disclosure element from the template. Requires a DOM.
 *
 * @param {object} [options]  Same shape as disclosureHTML, plus:
 * @param {boolean} [options.injectStyles]  Inject DISCLOSURE_CSS. Default true.
 * @param {Document} [options.document]
 * @returns {HTMLElement}
 */
export function mountDisclosure(options = {}) {
  const doc = options.document ?? globalThis.document
  if (!doc) throw new Error('mountDisclosure requires a DOM; use disclosureHTML() for server rendering')
  if (options.injectStyles !== false) injectDisclosureStyles(doc)
  const wrapper = doc.createElement('div')
  wrapper.innerHTML = disclosureHTML(options).trim()
  return wrapper.firstElementChild
}
