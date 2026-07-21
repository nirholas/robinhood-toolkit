/* built by nirholas x.com/nichxbt */
/**
 * robinhood-toolkit · playground worker
 * Author: nirholas · https://github.com/nirholas/robinhood-toolkit
 * License: All Rights Reserved (c) 2026 nirholas
 *
 * Workers have no DOM, no cookies, and no access to the site's localStorage.
 * The only capability injected into snippet scope is the read-only rpc().
 *
 * Instantiate it the Vite way so the import below is bundled and hashed:
 *   new Worker(new URL('./playground-worker.js', import.meta.url), { type: 'module' })
 * A worker parked in public/ is served unprocessed, and its bare or absolute
 * imports resolve in dev then 404 in the production build.
 */
import { rpc } from './rpc.js'

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor

self.onmessage = async (event) => {
  const { id, source, network } = event.data
  const logs = []
  const console = {
    log: (...args) => logs.push(args.map(format).join(' ')),
    error: (...args) => logs.push(args.map(format).join(' ')),
    warn: (...args) => logs.push(args.map(format).join(' '))
  }

  try {
    const fn = new AsyncFunction('rpc', 'console', source)
    const value = await fn((m, p) => rpc(m, p, { network }), console)
    self.postMessage({ id, ok: true, logs, value: value === undefined ? null : format(value) })
  } catch (error) {
    self.postMessage({ id, ok: false, logs, error: String(error?.message ?? error) })
  }
}

function format(value) {
  if (typeof value === 'string') return value
  if (typeof value === 'bigint') return `${value}n`
  try {
    return JSON.stringify(value, (_k, v) => (typeof v === 'bigint' ? `${v}n` : v), 2)
  } catch {
    return String(value)
  }
}
/* built by nirholas x.com/nichxbt */
