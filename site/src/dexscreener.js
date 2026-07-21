/* built by nirholas x.com/nichxbt */
/**
 * robinhood-toolkit · DexScreener client and honest series derivation
 * Author: nirholas · https://github.com/nirholas/robinhood-toolkit
 * License: All Rights Reserved (c) 2026 nirholas
 *
 * DexScreener indexes Robinhood Chain under the string chain id "robinhood",
 * not the numeric 4663. Both endpoints used here were verified live:
 *
 *   GET /latest/dex/search?q=<query>
 *   GET /latest/dex/pairs/robinhood/<pairAddress>
 *
 * IMPORTANT: DexScreener has no OHLCV endpoint. There are no candles to fetch,
 * so this module does not invent any. What it does have is four cumulative
 * trailing windows (m5, h1, h6, h24) for volume, transaction counts and price
 * change. Everything below is either a value the API returned verbatim, or a
 * subtraction of two of those windows, and every derived series is tagged
 * derived:true so the UI can say so out loud.
 */

export const DEXSCREENER_BASE = 'https://api.dexscreener.com/latest/dex'
export const DEXSCREENER_CHAIN = 'robinhood'

/** Verified live Uniswap v3 pair on Robinhood Chain, used as the default view. */
export const DEFAULT_PAIR = '0x95f9B0AF9282A22F7ef57058e65098db3f667f95'

const WINDOWS = [
  { key: 'h24', seconds: 86400, label: '24h' },
  { key: 'h6', seconds: 21600, label: '6h' },
  { key: 'h1', seconds: 3600, label: '1h' },
  { key: 'm5', seconds: 300, label: '5m' }
]

async function getJson(url, signal) {
  const response = await fetch(url, { headers: { accept: 'application/json' }, signal })
  if (!response.ok) {
    throw new Error(`DexScreener returned HTTP ${response.status} ${response.statusText}`)
  }
  return response.json()
}

/** Search every chain, then keep only Robinhood Chain pairs. */
export async function searchPairs(query, { signal } = {}) {
  const url = `${DEXSCREENER_BASE}/search?q=${encodeURIComponent(query)}`
  const data = await getJson(url, signal)
  const pairs = Array.isArray(data?.pairs) ? data.pairs : []
  return pairs
    .filter((pair) => pair.chainId === DEXSCREENER_CHAIN)
    .sort((a, b) => (b.liquidity?.usd || 0) - (a.liquidity?.usd || 0))
}

export async function fetchPair(pairAddress, { signal } = {}) {
  const url = `${DEXSCREENER_BASE}/pairs/${DEXSCREENER_CHAIN}/${encodeURIComponent(pairAddress)}`
  const data = await getJson(url, signal)
  const pair = data?.pair || data?.pairs?.[0]
  if (!pair) {
    throw new Error(`No pair indexed at ${pairAddress} on Robinhood Chain.`)
  }
  return pair
}

/**
 * Turn the four cumulative trailing volume windows into four non-overlapping
 * buckets by subtraction. h24 is cumulative over h6, so the 6h-to-24h bucket is
 * h24 minus h6, and so on. Clamped at zero: the windows are sampled at slightly
 * different times upstream and can disagree at the margin.
 */
export function deriveVolumeBuckets(pair, now = Date.now()) {
  const volume = pair.volume || {}
  const txns = pair.txns || {}
  const change = pair.priceChange || {}
  const buckets = []

  for (let i = 0; i < WINDOWS.length; i += 1) {
    const window = WINDOWS[i]
    const inner = WINDOWS[i + 1]
    const outerVolume = Number(volume[window.key] || 0)
    const innerVolume = inner ? Number(volume[inner.key] || 0) : 0
    const value = Math.max(0, outerVolume - innerVolume)

    const outerTx = txns[window.key] || { buys: 0, sells: 0 }
    const innerTx = inner ? txns[inner.key] || { buys: 0, sells: 0 } : { buys: 0, sells: 0 }

    const start = now - window.seconds * 1000
    const end = inner ? now - inner.seconds * 1000 : now

    buckets.push({
      label: inner ? `${window.label} to ${inner.label} ago` : `last ${window.label}`,
      window: window.key,
      volumeUsd: value,
      buys: Math.max(0, outerTx.buys - innerTx.buys),
      sells: Math.max(0, outerTx.sells - innerTx.sells),
      // Direction is the trailing window's own price change, which is a real
      // API field. It describes the window, not the bucket.
      direction: Number(change[window.key] || 0) >= 0 ? 'up' : 'down',
      time: Math.floor(end / 1000),
      startTime: Math.floor(start / 1000),
      derived: true
    })
  }

  return buckets
}

/**
 * Reconstruct the price at the start of each trailing window from the current
 * price and that window's percentage change: p_then = p_now / (1 + pct/100).
 * Five real points, four of them inferred from real fields. Not a candle chart,
 * and never presented as one.
 */
export function derivePriceWindows(pair, now = Date.now()) {
  const priceNow = Number(pair.priceUsd)
  if (!Number.isFinite(priceNow) || priceNow <= 0) return []
  const change = pair.priceChange || {}
  const points = []

  for (const window of WINDOWS) {
    const pct = Number(change[window.key])
    if (!Number.isFinite(pct)) continue
    const denominator = 1 + pct / 100
    if (denominator <= 0) continue
    points.push({
      time: Math.floor((now - window.seconds * 1000) / 1000),
      value: priceNow / denominator,
      label: `${window.label} ago`,
      derived: true
    })
  }

  points.push({ time: Math.floor(now / 1000), value: priceNow, label: 'now', derived: false })

  // Lightweight Charts requires strictly ascending, de-duplicated timestamps.
  const seen = new Set()
  return points
    .sort((a, b) => a.time - b.time)
    .filter((point) => {
      if (seen.has(point.time)) return false
      seen.add(point.time)
      return true
    })
}

/* ------------------------------------------------------------ formatting --- */

export function formatUsd(value) {
  const number = Number(value)
  if (!Number.isFinite(number)) return 'n/a'
  if (number === 0) return '$0'
  if (number < 0.01) {
    return `$${number.toPrecision(4)}`
  }
  return `$${number.toLocaleString('en-US', { maximumFractionDigits: number < 1000 ? 2 : 0 })}`
}

export function formatPercent(value) {
  const number = Number(value)
  if (!Number.isFinite(number)) return 'n/a'
  const sign = number > 0 ? '+' : ''
  return `${sign}${number.toLocaleString('en-US', { maximumFractionDigits: 2 })}%`
}

export function formatCount(value) {
  const number = Number(value)
  if (!Number.isFinite(number)) return 'n/a'
  return number.toLocaleString('en-US')
}

export function formatAge(timestamp) {
  if (!timestamp) return 'unknown'
  const days = Math.floor((Date.now() - timestamp) / 86400000)
  if (days >= 1) return `${days}d old`
  const hours = Math.floor((Date.now() - timestamp) / 3600000)
  return `${Math.max(hours, 0)}h old`
}
/* built by nirholas x.com/nichxbt */
