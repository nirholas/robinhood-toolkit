/* built by nirholas x.com/nichxbt */
/**
 * robinhood-toolkit · liveness-to-UI wiring
 * Author: nirholas · https://github.com/nirholas/robinhood-toolkit
 * License: All Rights Reserved (c) 2026 nirholas
 *
 * robinhood-toolkit · package: robinhood-risk
 *
 * Connects the liveness monitor to a submit control. When the monitor reports a
 * stall (or an unreachable RPC), submission is disabled and the reason is shown
 * alongside the canonical exit path and its seven-day period.
 *
 * The point is to never let a user broadcast into a stalled sequencer and read
 * the silence as their own mistake. A disabled button with a reason is honest; a
 * live button that swallows the transaction is not.
 */

import { CANONICAL_EXIT, canSubmitIn, monitorLiveness } from './liveness.js'

/**
 * Headless: turn a status object into user-facing copy. Exported so it can be
 * unit-tested and reused in non-DOM contexts (a CLI banner, a server response).
 *
 * @returns {{ canSubmit: boolean, tone: 'ok'|'warn'|'blocked', headline: string, detail: string|null, exit: object|null }}
 */
export function livenessMessage(status) {
  switch (status?.status) {
    case 'healthy':
      return { canSubmit: true, tone: 'ok', headline: 'Sequencer healthy', detail: null, exit: null }
    case 'degraded':
      return {
        canSubmit: true,
        tone: 'warn',
        headline: 'Sequencer degraded',
        detail: `No new block for ${Math.round((status.silentForMs ?? 0) / 1000)}s. Submission is still allowed but confirmations may lag.`,
        exit: null,
      }
    case 'stalled':
      return {
        canSubmit: false,
        tone: 'blocked',
        headline: 'Sequencer stalled — submission disabled',
        detail: `No new block for ${Math.round((status.silentForMs ?? 0) / 1000)}s. Do not broadcast; the transaction would sit unordered. Your only assured exit is the canonical path below.`,
        exit: status.exit ?? CANONICAL_EXIT,
      }
    case 'unreachable':
      return {
        canSubmit: false,
        tone: 'blocked',
        headline: 'RPC unreachable — submission disabled',
        detail: `Cannot read chain head${status.error ? ` (${status.error})` : ''}. Submission is blocked until the endpoint responds.`,
        exit: status.exit ?? CANONICAL_EXIT,
      }
    default:
      return { canSubmit: false, tone: 'blocked', headline: 'Sequencer status unknown', detail: 'Submission disabled until liveness is confirmed.', exit: CANONICAL_EXIT }
  }
}

/** Render the exit block as an HTML string, or empty string when there is none. */
function exitHTML(exit, esc) {
  if (!exit) return ''
  return `<p class="rh-liveness__exit"><strong>${esc(exit.path)}</strong> — approximately ${esc(exit.periodDays)} days. ${esc(exit.note)}</p>`
}

const escText = (v) =>
  String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/**
 * Bind a live monitor to a submit button and a status element. On every tick it
 * updates `button.disabled` and writes the status into `statusEl`.
 *
 * @param {object} options
 * @param {HTMLButtonElement | HTMLButtonElement[]} options.button  Control(s) to gate.
 * @param {HTMLElement} [options.statusEl]  Where to write the status message. Optional.
 * @param {(msg: object) => void} [options.onStatus]  Extra callback per tick.
 * @param {...} [monitor options]  Forwarded to monitorLiveness (chain, intervalMs, rpcUrl, client, ...).
 * @returns {() => void} stop
 */
export function bindLivenessToSubmit(options = {}) {
  const { button, statusEl, onStatus, ...monitorOptions } = options
  const buttons = Array.isArray(button) ? button : button ? [button] : []

  const apply = (status) => {
    const msg = livenessMessage(status)
    for (const b of buttons) {
      b.disabled = !msg.canSubmit
      b.setAttribute('aria-disabled', String(!msg.canSubmit))
      if (!msg.canSubmit) b.title = msg.headline
      else b.removeAttribute('title')
    }
    if (statusEl) {
      statusEl.setAttribute('role', 'status')
      statusEl.setAttribute('aria-live', 'polite')
      statusEl.dataset.tone = msg.tone
      statusEl.innerHTML = `
<p class="rh-liveness__headline">${escText(msg.headline)}</p>
${msg.detail ? `<p class="rh-liveness__detail">${escText(msg.detail)}</p>` : ''}
${exitHTML(msg.exit, escText)}`.trim()
    }
    onStatus?.(status)
  }

  // Fail closed until the first real tick: a control must not be submittable
  // before liveness is known.
  apply({ status: 'unknown' })

  return monitorLiveness(apply, monitorOptions)
}

export { canSubmitIn }
/* built by nirholas x.com/nichxbt */
