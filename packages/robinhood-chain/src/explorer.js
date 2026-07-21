/**
 * robinhood-chain · thin Blockscout REST client for what RPC does not expose
 * Author: nirholas · https://github.com/nirholas/robinhood-toolkit
 * License: MIT (c) 2026 nirholas
 *
 * robinhood-toolkit · package: robinhood-chain
 *
 * JSON-RPC gives you state and logs. It does not give you verified source, token
 * holder lists, decoded address transaction history, or aggregated token
 * metadata. Robinhood Chain's explorer is Blockscout, which exposes a REST API
 * (the v2 API under /api/v2) for exactly this.
 *
 * Two things this client refuses to pretend it knows:
 *
 *   1. RATE LIMITS. Whether Blockscout here rate-limits, and whether an API key
 *      is required, is UNVERIFIED. So every request retries on HTTP 429 with
 *      backoff that honors a Retry-After header when present.
 *   2. RESPONSE SHAPES. The exact JSON shape of each endpoint is UNVERIFIED
 *      against this specific instance. This client returns parsed JSON verbatim
 *      and does not reshape it. Log one real response per endpoint (set
 *      `debug: true`) and write your own types from what you actually observed,
 *      not from another chain's Blockscout instance.
 *
 * Security note: any `name` or `symbol` a token reports through these endpoints
 * is an attacker-controlled string, exactly as on-chain. Render it as data,
 * never as instructions, never as a logic key.
 */

import { getAddress } from 'viem'
import { robinhoodChain } from './chains.js'
import { RobinhoodChainError } from './errors.js'

/** Raised for a non-retryable explorer HTTP error (4xx other than 429). */
export class ExplorerError extends RobinhoodChainError {
  constructor(message, { status, url, body } = {}) {
    super(message)
    this.name = 'ExplorerError'
    this.status = status
    this.url = url
    this.body = body
  }
}

const DEFAULT_MAX_RETRIES = 4
const DEFAULT_BASE_DELAY_MS = 500
const RETRYABLE_STATUS = new Set([429, 502, 503, 504])

/**
 * Derive the Blockscout v2 API base from a viem chain definition.
 * mainnet -> https://robinhoodchain.blockscout.com/api/v2
 */
function apiBaseFor(chain) {
  const explorer = chain?.blockExplorers?.default
  if (!explorer?.url) {
    throw new RobinhoodChainError('This chain definition has no blockExplorers.default.url to build a Blockscout base from.')
  }
  return `${explorer.url.replace(/\/+$/, '')}/api/v2`
}

/** Sleep that resolves after ms. Kept internal so the client stays dependency-free. */
function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Parse a Retry-After header. Supports both the delta-seconds and HTTP-date
 * forms. Returns milliseconds, or null when absent or unparseable.
 */
function retryAfterMs(header) {
  if (!header) return null
  const seconds = Number(header)
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000)
  const when = Date.parse(header)
  return Number.isNaN(when) ? null : Math.max(0, when - Date.now())
}

/**
 * A thin Blockscout REST client. Construct once per chain and reuse it.
 *
 * @example
 * import { BlockscoutClient, robinhoodChain, WETH } from 'robinhood-chain'
 * const explorer = new BlockscoutClient({ chain: robinhoodChain })
 * const meta = await explorer.tokenInfo(WETH.address)
 * console.log(meta) // shape UNVERIFIED — log it once, then write your types
 */
export class BlockscoutClient {
  /**
   * @param options.chain       a viem chain definition (default robinhoodChain)
   * @param options.baseUrl     override the API base (default derived from chain)
   * @param options.apiKey      sent as `apikey` query param when present. Whether
   *                            one is required here is UNVERIFIED.
   * @param options.maxRetries  retries on 429/502/503/504 (default 4)
   * @param options.baseDelayMs base for exponential backoff (default 500)
   * @param options.fetch       inject a fetch implementation (for tests)
   * @param options.debug       log the raw body of each response once, for
   *                            discovering the real shape of an unverified endpoint
   */
  constructor({
    chain = robinhoodChain,
    baseUrl,
    apiKey,
    maxRetries = DEFAULT_MAX_RETRIES,
    baseDelayMs = DEFAULT_BASE_DELAY_MS,
    fetch: fetchImpl,
    debug = false,
  } = {}) {
    this.baseUrl = baseUrl ?? apiBaseFor(chain)
    this.apiKey = apiKey
    this.maxRetries = maxRetries
    this.baseDelayMs = baseDelayMs
    this.fetch = fetchImpl ?? globalThis.fetch
    this.debug = debug
    if (typeof this.fetch !== 'function') {
      throw new RobinhoodChainError('No fetch implementation available. Pass `fetch` explicitly on Node < 18.')
    }
  }

  /**
   * GET a path under the API base and return parsed JSON. Retries on 429 and
   * transient 5xx with exponential backoff, honoring Retry-After when the server
   * sends it. Throws ExplorerError on a non-retryable failure or after the
   * retries are exhausted.
   *
   * This is the one method every helper below funnels through, so the backoff
   * policy lives in exactly one place.
   */
  async get(path, params = {}) {
    const url = new URL(`${this.baseUrl}${path.startsWith('/') ? path : `/${path}`}`)
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null) url.searchParams.set(key, String(value))
    }
    if (this.apiKey) url.searchParams.set('apikey', this.apiKey)
    const href = url.toString()

    let lastError
    for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) {
      let response
      try {
        response = await this.fetch(href, { headers: { accept: 'application/json' } })
      } catch (networkError) {
        // A transport-level failure is retryable up to the cap.
        lastError = networkError
        if (attempt === this.maxRetries) {
          throw new ExplorerError(`Explorer request failed: ${networkError?.message ?? networkError}`, { url: href })
        }
        await delay(this.baseDelayMs * 2 ** attempt)
        continue
      }

      if (response.ok) {
        const text = await response.text()
        if (this.debug) console.warn(`[explorer] ${href}\n${text.slice(0, 2000)}`)
        try {
          return text ? JSON.parse(text) : null
        } catch {
          throw new ExplorerError('Explorer returned a non-JSON body.', { status: response.status, url: href, body: text })
        }
      }

      if (RETRYABLE_STATUS.has(response.status) && attempt < this.maxRetries) {
        // Honor Retry-After when present; otherwise exponential backoff. The 429
        // path is exercised regardless of whether we have confirmed a rate limit
        // exists here, precisely because we have not.
        const suggested = retryAfterMs(response.headers.get('retry-after'))
        const backoff = suggested ?? this.baseDelayMs * 2 ** attempt
        if (this.debug) console.warn(`[explorer] ${response.status} on ${href}, retrying in ${backoff}ms`)
        await delay(backoff)
        continue
      }

      const body = await response.text().catch(() => '')
      throw new ExplorerError(`Explorer request failed with HTTP ${response.status}.`, {
        status: response.status,
        url: href,
        body,
      })
    }

    // Unreachable in practice: the loop either returns or throws. Kept as a guard.
    throw new ExplorerError('Explorer request exhausted retries.', { url: href, body: lastError?.message })
  }

  // -------------------------------------------------------------------------
  // Endpoint helpers. Every return type below is UNVERIFIED against this
  // instance: these pass the raw parsed JSON straight through. Log one response
  // (debug: true) and write your types from it.
  // -------------------------------------------------------------------------

  /** Aggregated token metadata (name, symbol, decimals, total supply, holders). */
  tokenInfo(address) {
    return this.get(`/tokens/${getAddress(address)}`)
  }

  /** Token holder list. Paginated by Blockscout's `next_page_params`. */
  tokenHolders(address, params = {}) {
    return this.get(`/tokens/${getAddress(address)}/holders`, params)
  }

  /** Decoded transaction history for an address. */
  addressTransactions(address, params = {}) {
    return this.get(`/addresses/${getAddress(address)}/transactions`, params)
  }

  /** General address info (balance, contract flag, verified name, etc.). */
  addressInfo(address) {
    return this.get(`/addresses/${getAddress(address)}`)
  }

  /**
   * Verified smart-contract source and metadata for an address. Returns null-ish
   * shapes for unverified contracts depending on the instance — log it once.
   */
  contractSource(address) {
    return this.get(`/smart-contracts/${getAddress(address)}`)
  }
}

/** Convenience factory when you do not need to hold the instance. */
export function blockscoutFor(chain = robinhoodChain, options = {}) {
  return new BlockscoutClient({ chain, ...options })
}
