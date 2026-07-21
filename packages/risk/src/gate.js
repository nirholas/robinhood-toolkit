/* built by nirholas x.com/nichxbt */
/**
 * robinhood-toolkit · pre-transaction disclosure gate
 * Author: nirholas · https://github.com/nirholas/robinhood-toolkit
 * License: All Rights Reserved (c) 2026 nirholas
 *
 * robinhood-toolkit · package: robinhood-risk
 *
 * Before a user's FIRST value-moving action — a first bridge, a first mainnet
 * send — they see the exit-latency and operator-centralization assumptions and
 * acknowledge them. Once per user, persisted, not a modal on every action.
 *
 * The persistence key carries a version. When the gate's assumption set changes
 * materially, bump ACK_VERSION so returning users are asked once more rather than
 * carrying a stale acknowledgment forward. A silent copy change is not a reason
 * to bump; a change to WHAT they are acknowledging is.
 *
 * The state layer (hasAcknowledged / recordAcknowledgment) is headless and takes
 * an injectable storage, so it is testable without a browser and reusable server
 * side. The DOM layer builds the modal on top of it.
 */

import { gateAssumptions } from './assumptions.js'
import { disclosureHTML, injectDisclosureStyles } from './disclosure.js'

export const ACK_VERSION = 1
export const ACK_STORAGE_KEY = `rh-risk-ack:v${ACK_VERSION}`

/** localStorage by default; injectable for tests and non-browser callers. */
function defaultStorage() {
  return globalThis.localStorage ?? null
}

/**
 * Has this user already acknowledged the current gate version?
 * A missing or unreadable storage returns false — absent proof of acknowledgment
 * means not acknowledged, so the gate errs toward showing.
 */
export function hasAcknowledged(storage = defaultStorage()) {
  try {
    return storage?.getItem(ACK_STORAGE_KEY) != null
  } catch {
    return false
  }
}

/**
 * Persist an acknowledgment. Records the acknowledged ids and a caller-supplied
 * timestamp (epoch ms). Returns the stored record, or null if storage is
 * unavailable — the caller can decide whether an unpersistable ack should still
 * let the action through.
 */
export function recordAcknowledgment(storage = defaultStorage(), { at } = {}) {
  const record = {
    version: ACK_VERSION,
    ids: gateAssumptions().map((a) => a.id),
    at: at ?? null,
  }
  try {
    storage?.setItem(ACK_STORAGE_KEY, JSON.stringify(record))
    return record
  } catch {
    return null
  }
}

/** Clear the stored acknowledgment. Useful for testing and for a "reset" affordance. */
export function clearAcknowledgment(storage = defaultStorage()) {
  try {
    storage?.removeItem(ACK_STORAGE_KEY)
  } catch {
    /* nothing to clear */
  }
}

/**
 * Gate a value-moving action behind a one-time acknowledgment.
 *
 * Resolves true immediately if already acknowledged. Otherwise renders the modal
 * and resolves true once the user acknowledges (and false if they dismiss it).
 * A dismissed gate must leave the action UNtaken — treat false as "do not
 * proceed", never as a soft default.
 *
 * @param {object} [options]
 * @param {Storage} [options.storage]
 * @param {Document} [options.document]
 * @param {HTMLElement} [options.mount]     Where to append the modal. Default document.body.
 * @param {() => number} [options.now]      Injectable clock for the ack timestamp.
 * @returns {Promise<boolean>}
 */
export function requireDisclosure(options = {}) {
  const storage = options.storage ?? defaultStorage()
  if (hasAcknowledged(storage)) return Promise.resolve(true)

  const doc = options.document ?? globalThis.document
  if (!doc) {
    // No DOM and no prior acknowledgment: we cannot show the required disclosure,
    // so we must not silently let a value-moving action through.
    return Promise.resolve(false)
  }

  const now = options.now ?? (() => Date.now())
  injectDisclosureStyles(doc)

  return new Promise((resolve) => {
    const overlay = doc.createElement('div')
    overlay.className = 'rh-gate__overlay'
    overlay.setAttribute('role', 'dialog')
    overlay.setAttribute('aria-modal', 'true')
    overlay.setAttribute('aria-labelledby', 'rh-disclosure-heading')

    overlay.innerHTML = `
<div class="rh-gate__panel">
  ${disclosureHTML({
    model: gateAssumptions(),
    heading: 'Before you move value on this chain',
  }).trim()}
  <div class="rh-gate__actions">
    <button type="button" class="rh-gate__btn rh-gate__btn--secondary" data-rh-dismiss>Not now</button>
    <button type="button" class="rh-gate__btn rh-gate__btn--primary" data-rh-ack>I understand — continue</button>
  </div>
</div>`

    injectGateStyles(doc)
    const parent = options.mount ?? doc.body
    parent.appendChild(overlay)

    const ackBtn = overlay.querySelector('[data-rh-ack]')
    const dismissBtn = overlay.querySelector('[data-rh-dismiss]')

    const cleanup = (result) => {
      doc.removeEventListener('keydown', onKey)
      overlay.remove()
      resolve(result)
    }
    const onKey = (e) => {
      if (e.key === 'Escape') cleanup(false)
    }

    ackBtn?.addEventListener('click', () => {
      recordAcknowledgment(storage, { at: now() })
      cleanup(true)
    })
    dismissBtn?.addEventListener('click', () => cleanup(false))
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) cleanup(false)
    })
    doc.addEventListener('keydown', onKey)

    // Move focus into the dialog for keyboard users.
    ackBtn?.focus?.()
  })
}

/**
 * Wrap an action so it only runs after acknowledgment. Sugar over
 * requireDisclosure for the common "gate this button" case.
 *
 * @param {() => any} action
 * @param {object} [options]  Passed to requireDisclosure.
 * @returns {Promise<any>}    The action's result, or undefined if the gate was dismissed.
 */
export async function gated(action, options = {}) {
  const ok = await requireDisclosure(options)
  return ok ? action() : undefined
}

export const GATE_CSS = `
.rh-gate__overlay {
  position: fixed; inset: 0; z-index: 9999;
  display: flex; align-items: center; justify-content: center;
  padding: 1rem; overflow: auto;
  background: rgba(0, 0, 0, .55);
}
.rh-gate__panel {
  background: Canvas; color: CanvasText;
  max-width: 40rem; width: 100%;
  border-radius: 12px; padding: 1.25rem;
  box-shadow: 0 12px 40px rgba(0, 0, 0, .35);
}
.rh-gate__actions { display: flex; flex-wrap: wrap; gap: .6rem; justify-content: flex-end; margin-top: 1rem; }
.rh-gate__btn {
  font: inherit; font-weight: 600; cursor: pointer;
  padding: .55rem 1rem; border-radius: 8px; border: 1px solid currentColor;
}
.rh-gate__btn--secondary { background: transparent; }
.rh-gate__btn--primary { background: CanvasText; color: Canvas; }
@media (max-width: 360px) {
  .rh-gate__actions { flex-direction: column-reverse; }
  .rh-gate__btn { width: 100%; }
}
`

function injectGateStyles(doc) {
  if (!doc?.head || doc.getElementById('rh-gate-styles')) return
  const style = doc.createElement('style')
  style.id = 'rh-gate-styles'
  style.textContent = GATE_CSS
  doc.head.appendChild(style)
}
/* built by nirholas x.com/nichxbt */
