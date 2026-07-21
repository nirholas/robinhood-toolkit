/* built by nirholas x.com/nichxbt */
/**
 * robinhood-toolkit · allowlisted read-only JSON-RPC client for the browser
 * Author: nirholas · https://github.com/nirholas/robinhood-toolkit
 * License: All Rights Reserved (c) 2026 nirholas
 *
 * Read-only by construction. Every method below reads public chain state.
 * Nothing here can sign or broadcast, and no key ever enters this module.
 *
 * This is the ONLY capability injected into playground snippet scope. The
 * allowlist is checked before fetch(), so a refused method never leaves the
 * browser: there is no network request to intercept, throttle or trust.
 */

export const ENDPOINTS = {
  mainnet: 'https://rpc.mainnet.chain.robinhood.com',
  testnet: 'https://rpc.testnet.chain.robinhood.com'
}

export const READ_ONLY_METHODS = new Set([
  'eth_chainId',
  'eth_blockNumber',
  'eth_getBalance',
  'eth_call',
  'eth_estimateGas',
  'eth_gasPrice',
  'eth_feeHistory',
  'eth_getCode',
  'eth_getStorageAt',
  'eth_getLogs',
  'eth_getBlockByNumber',
  'eth_getBlockByHash',
  'eth_getTransactionByHash',
  'eth_getTransactionReceipt',
  'eth_getTransactionCount',
  'net_version',
  'web3_clientVersion'
])

let inFlight = 0
const MAX_CONCURRENT = 4

/**
 * Call a read-only JSON-RPC method. Rejects anything off the allowlist before
 * any fetch, caps concurrent calls, and backs off on 429.
 */
export async function rpc(method, params = [], { network = 'mainnet' } = {}) {
  if (!READ_ONLY_METHODS.has(method)) {
    throw new Error(
      `"${method}" is not available in the playground. This runner is read-only. ` +
        'Copy the snippet and run it in your own terminal.'
    )
  }
  const url = ENDPOINTS[network]
  if (!url) throw new Error(`unknown network "${network}"`)

  // A tutorial page open in many tabs is a real load pattern. Queue rather than
  // fan every snippet call out at once.
  while (inFlight >= MAX_CONCURRENT) await sleep(50)
  inFlight++
  try {
    return await request(url, method, params)
  } finally {
    inFlight--
  }
}

async function request(url, method, params, attempt = 0) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    signal: timeoutSignal(10_000)
  })

  // Public RPC rate limits are UNVERIFIED. Back off rather than assume headroom.
  if (res.status === 429 && attempt < 3) {
    // Deterministic jitter, no Math.random: still spreads retries across tabs
    // that hit the limit in the same tick.
    const jitter = (attempt * 137) % 200
    await sleep(2 ** attempt * 400 + jitter)
    return request(url, method, params, attempt + 1)
  }
  if (!res.ok) throw new Error(`RPC ${res.status} ${res.statusText}`)

  const body = await res.json()
  if (body.error) throw new Error(`RPC error ${body.error.code}: ${body.error.message}`)
  return body.result
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * AbortSignal.timeout is not in every browser the site targets. Feature-detect
 * and fall back to an AbortController + setTimeout so the runner degrades
 * instead of throwing on load.
 */
function timeoutSignal(ms) {
  if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
    return AbortSignal.timeout(ms)
  }
  const controller = new AbortController()
  setTimeout(() => controller.abort(new Error(`timed out after ${ms}ms`)), ms)
  return controller.signal
}
/* built by nirholas x.com/nichxbt */
