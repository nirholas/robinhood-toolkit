/* built by nirholas x.com/nichxbt */
/**
 * robinhood-toolkit · resolve Chainlink feed addresses for Robinhood Chain
 * Author: nirholas · https://github.com/nirholas/robinhood-toolkit
 * License: All Rights Reserved (c) 2026 nirholas
 *
 * Two ways to name a feed, and env always wins over the directory:
 *
 *   1. Environment, one variable per pair, for pinning an exact address in
 *      production. CHAINLINK_FEED_ETH_USD=0x... and CHAINLINK_HEARTBEAT_ETH_USD=86400.
 *   2. Chainlink's machine-readable reference directory for chain 4663, which
 *      Robinhood's own docs name as the source of truth. Confirmed live on
 *      2026-07-21 at the URL below; a dated snapshot ships beside this file as an
 *      offline fallback so resolution never depends on a network round trip.
 *
 * A feed address that did not come from Chainlink's directory is not a feed
 * address. Do not paste one in from anywhere else.
 */
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { getAddress, isAddress } from 'viem'

/**
 * The reference-data directory renders the same rows shown on
 * https://docs.chain.link/data-feeds/price-feeds/addresses?network=robinhood
 * Whether this JSON path stays stable is Chainlink's call, so the loader falls
 * back to the bundled snapshot on any fetch failure.
 */
export const DIRECTORY_URL = 'https://reference-data-directory.vercel.app/feeds-robinhood-mainnet.json'

/** The snapshot that ships with this example. Same array shape as the live URL. */
const SNAPSHOT_PATH = fileURLToPath(new URL('./feeds.robinhood-mainnet.json', import.meta.url))

/** Env var suffix for a pair: "ETH_USD", "eth/usd", "Robinhood NVDA / USD" -> "ROBINHOOD_NVDA_USD". */
function envSuffix(pair) {
  return pair.toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '')
}

/**
 * Canonical key for matching a query against a directory feed name. Strips the
 * "Robinhood" issuer prefix and the "Exchange Rate" suffix so that "NVDA_USD"
 * finds "Robinhood NVDA / USD" and "ETH_USD" finds "ETH / USD".
 */
function feedKey(name) {
  return name
    .toUpperCase()
    .replace(/\bROBINHOOD\b/g, '')
    .replace(/\bEXCHANGE\s+RATE\b/g, '')
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
}

/**
 * Feed proxy address from environment only. Throws with instructions when unset,
 * so a missing address fails loud at the boundary instead of resolving to
 * undefined. Use resolveFeed() when you want the directory fallback.
 */
export function feedAddress(pair) {
  const key = `CHAINLINK_FEED_${envSuffix(pair)}`
  const value = process.env[key]
  if (!value) {
    throw new Error(
      `${key} is not set. Resolve the ${pair} feed proxy address for chain 4663 from ` +
        'https://docs.chain.link/data-feeds/price-feeds/addresses?network=robinhood and record its ' +
        'decimals, heartbeat, and deviation threshold in oracle/FEEDS.md.',
    )
  }
  if (!isAddress(value)) throw new Error(`${key} is not a valid address: ${value}`)
  return getAddress(value)
}

/**
 * Heartbeat in seconds from environment only. Every Robinhood Chain feed
 * observed on 2026-07-21 reported an 86400s (24h) heartbeat, but there is no
 * safe default, so this throws rather than guessing. Read the exact value for
 * your pair from the Chainlink feed page.
 */
export function feedHeartbeat(pair) {
  const key = `CHAINLINK_HEARTBEAT_${envSuffix(pair)}`
  const value = Number(process.env[key])
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${key} is not set. Read the heartbeat for ${pair} from the Chainlink feed page.`)
  }
  return value
}

/** Process-lifetime cache of the directory, keyed by canonical feed key. */
let directoryCache = null

async function readSnapshot() {
  return JSON.parse(await readFile(SNAPSHOT_PATH, 'utf8'))
}

/**
 * Load the feed directory once per process. Tries the live URL, falls back to
 * the bundled snapshot on any failure so resolution works offline and in tests.
 * Pass { refresh: true } to force a re-fetch, or a custom fetchImpl for testing.
 */
export async function loadDirectory({ refresh = false, fetchImpl = globalThis.fetch } = {}) {
  if (directoryCache && !refresh) return directoryCache

  let feeds
  try {
    if (!fetchImpl) throw new Error('no fetch available')
    const res = await fetchImpl(DIRECTORY_URL)
    if (!res.ok) throw new Error(`directory HTTP ${res.status}`)
    feeds = await res.json()
    if (!Array.isArray(feeds) || feeds.length === 0) throw new Error('directory payload empty')
  } catch {
    feeds = await readSnapshot()
  }

  const byKey = new Map()
  for (const feed of feeds) {
    if (!feed?.proxyAddress || !isAddress(feed.proxyAddress)) continue
    byKey.set(feedKey(feed.name), {
      description: feed.name,
      address: getAddress(feed.proxyAddress),
      decimals: feed.decimals,
      heartbeat: feed.heartbeat,
    })
  }
  directoryCache = byKey
  return byKey
}

/**
 * One feed's metadata from the directory. Throws with the list of available
 * pairs when the pair is unknown, which is what a typo actually looks like.
 */
export async function directoryFeed(pair, opts) {
  const dir = await loadDirectory(opts)
  const entry = dir.get(feedKey(pair))
  if (!entry) {
    const available = [...dir.keys()].sort().join(', ')
    throw new Error(`no Robinhood Chain feed matches "${pair}". Available: ${available}`)
  }
  return entry
}

/**
 * Resolve a pair to { address, heartbeat, decimals, description, source },
 * preferring an explicit env override and falling back to the directory. This
 * is the interface read.mjs consumes.
 */
export async function resolveFeed(pair, opts) {
  const addressKey = `CHAINLINK_FEED_${envSuffix(pair)}`
  const heartbeatKey = `CHAINLINK_HEARTBEAT_${envSuffix(pair)}`
  const hasEnvAddress = Boolean(process.env[addressKey])

  if (hasEnvAddress) {
    // Env pins the address; heartbeat may still come from the directory if the
    // operator did not pin it explicitly.
    let heartbeat = Number(process.env[heartbeatKey])
    let decimals
    let description
    if (!Number.isFinite(heartbeat) || heartbeat <= 0) {
      const entry = await directoryFeed(pair, opts).catch(() => null)
      heartbeat = entry?.heartbeat
      decimals = entry?.decimals
      description = entry?.description
      if (!Number.isFinite(heartbeat) || heartbeat <= 0) heartbeat = feedHeartbeat(pair)
    }
    return { address: feedAddress(pair), heartbeat, decimals, description, source: 'env' }
  }

  const entry = await directoryFeed(pair, opts)
  return { ...entry, source: 'directory' }
}
