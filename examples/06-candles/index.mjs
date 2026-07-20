/**
 * robinhood-toolkit · example 06: OHLCV candles in the terminal
 * Author: nirholas · https://github.com/nirholas/robinhood-toolkit
 * License: MIT (c) 2026 nirholas
 *
 * Fetch OHLCV bars for a Robinhood Chain pool from GeckoTerminal and draw them
 * as a candlestick chart, then confirm the last close against the pool's live
 * on-chain price so the chart is never the only source in the room.
 *
 * Five things about this API that cost time to discover
 * -----------------------------------------------------
 *   1. Rows come back NEWEST FIRST. Plot them in the order given and your chart
 *      runs backwards, which looks like a plausible chart. Reverse them.
 *   2. Timestamps are in SECONDS, not milliseconds. Passing them straight to
 *      new Date() lands you in January 1970.
 *   3. There is no "15m" timeframe. The path segment is a base timeframe
 *      (minute, hour, day) and the width comes from ?aggregate=N. 15m is
 *      minute + aggregate=15.
 *   4. Prices default to USD, NOT to the quote token. For this pool the USD
 *      series reads about 3.0e-5 while the quote-denominated series reads about
 *      1.58e-8, a factor of roughly 1,900 apart. Compare a USD bar against an
 *      on-chain slot0 price and you get a ~100% "drift" that looks like a bug
 *      in your math. Pass currency=token to price in the quote token, which is
 *      what slot0 gives you. This program defaults to currency=token so the
 *      chart and the chain are directly comparable.
 *   5. The rate limit is roughly 30 requests per minute on the free tier, so
 *      this program enforces a 2.1 second floor between calls rather than
 *      discovering the limit as a 429 in production.
 *
 * Read-only. No key, no signing, no spend.
 *
 * Usage:
 *   node index.mjs
 *   node index.mjs --pool 0xPoolAddress
 *   node index.mjs --timeframe hour --aggregate 4 --limit 48
 *   node index.mjs --currency usd      # price in USD instead of the quote token
 */

import { createPublicClient, getAddress, http, isAddress } from 'viem'
import { knownTokenAt, readTokenMetadata, robinhoodChain, USDG, WETH } from 'robinhood-chain'

/**
 * Default pool: WETH against the IMPOSTOR "USDG" at 0x8218d73C..., on-chain
 * name "Useless Stupid Degen Gamblers". Not the canonical Global Dollar. It is
 * chosen because it has continuous real volume, and the program labels it
 * honestly rather than by its ticker.
 */
const DEFAULT_POOL = '0x95f9B0AF9282A22F7ef57058e65098db3f667f95'

// GeckoTerminal keys this chain by the string slug "robinhood".
const NETWORK = 'robinhood'
const API = 'https://api.geckoterminal.com/api/v2'

/** Free tier is about 30 requests per minute. 2.1s between calls stays under it. */
const MIN_REQUEST_INTERVAL_MS = 2100

const VALID_TIMEFRAMES = ['minute', 'hour', 'day']
const VALID_CURRENCIES = ['token', 'usd']

function arg(flag, fallback) {
  const index = process.argv.indexOf(flag)
  return index !== -1 && process.argv[index + 1] ? process.argv[index + 1] : fallback
}

const POOL = arg('--pool', DEFAULT_POOL)
const TIMEFRAME = arg('--timeframe', 'minute')
const AGGREGATE = Number(arg('--aggregate', 15))
const LIMIT = Number(arg('--limit', 48))
// Default to token, not the API's own default of usd, so the chart is
// denominated the same way slot0 is and the two can be compared directly.
const CURRENCY = arg('--currency', 'token')

const client = createPublicClient({ chain: robinhoodChain, transport: http(process.env.RH_RPC || undefined) })

function fail(message, error) {
  console.error(`\n  ${message}`)
  if (error) console.error(`  ${error.shortMessage || error.message}`)
  console.error('')
  process.exit(1)
}

if (!isAddress(POOL, { strict: false })) fail(`"${POOL}" is not a valid pool address.`)
if (!VALID_TIMEFRAMES.includes(TIMEFRAME)) {
  fail(
    `"${TIMEFRAME}" is not a valid timeframe. Use one of: ${VALID_TIMEFRAMES.join(', ')}.\n` +
      '  There is no "15m" timeframe. For 15-minute bars use --timeframe minute --aggregate 15.',
  )
}
if (!Number.isInteger(AGGREGATE) || AGGREGATE < 1) fail(`--aggregate must be a positive integer, got "${AGGREGATE}".`)
if (!Number.isInteger(LIMIT) || LIMIT < 1 || LIMIT > 1000) fail(`--limit must be between 1 and 1000, got "${LIMIT}".`)
if (!VALID_CURRENCIES.includes(CURRENCY)) {
  fail(`--currency must be one of: ${VALID_CURRENCIES.join(', ')}. Got "${CURRENCY}".`)
}

const pool = getAddress(POOL)

// ---------------------------------------------------------------------------
// Rate-limited fetch
// ---------------------------------------------------------------------------

let lastRequestAt = 0

/** Fetch with a hard floor between calls, so the free-tier limit is never tested. */
async function rateLimitedFetch(url) {
  const waitFor = lastRequestAt + MIN_REQUEST_INTERVAL_MS - Date.now()
  if (waitFor > 0) {
    await new Promise((resolve) => setTimeout(resolve, waitFor))
  }
  lastRequestAt = Date.now()

  const response = await fetch(url, {
    headers: { accept: 'application/json;version=20230302' },
    signal: AbortSignal.timeout(20_000),
  })

  if (response.status === 429) {
    const retryAfter = response.headers.get('retry-after')
    fail(
      'GeckoTerminal rate limit hit (HTTP 429).' +
        (retryAfter ? ` Retry after ${retryAfter}s.` : '') +
        `\n  The free tier allows about 30 requests per minute. This program already` +
        `\n  spaces calls ${MIN_REQUEST_INTERVAL_MS}ms apart, so something else is sharing your IP quota.`,
    )
  }
  if (!response.ok) {
    fail(`GeckoTerminal returned HTTP ${response.status} ${response.statusText} for ${url}`)
  }
  return response.json()
}

// ---------------------------------------------------------------------------
// Fetch the bars
// ---------------------------------------------------------------------------

const ohlcvUrl =
  `${API}/networks/${NETWORK}/pools/${pool}/ohlcv/${TIMEFRAME}` +
  `?aggregate=${AGGREGATE}&limit=${LIMIT}&currency=${CURRENCY}`

let payload
try {
  payload = await rateLimitedFetch(ohlcvUrl)
} catch (error) {
  if (error?.name === 'TimeoutError') fail('GeckoTerminal timed out after 20s. Try again.')
  fail('Could not reach the GeckoTerminal API. Check your network connection.', error)
}

const rows = payload?.data?.attributes?.ohlcv_list
if (!Array.isArray(rows) || rows.length === 0) {
  fail(
    `GeckoTerminal returned no OHLCV rows for ${pool} on "${NETWORK}".\n` +
      '  Either the pool is not indexed or it has no trades in this window.\n' +
      '  Try a wider bar: --timeframe hour --aggregate 4',
  )
}

// Trap 1: rows arrive newest first. Reverse to chronological order before
// anything downstream treats the array as a time series.
// Trap 2: timestamps are SECONDS. Multiply before constructing a Date.
const candles = rows
  .map(([ts, open, high, low, close, volume]) => ({
    time: new Date(ts * 1000),
    open: Number(open),
    high: Number(high),
    low: Number(low),
    close: Number(close),
    volume: Number(volume),
  }))
  .reverse()

const meta = payload?.meta ?? {}
const baseAddress = meta.base?.address ? getAddress(meta.base.address) : null
const quoteAddress = meta.quote?.address ? getAddress(meta.quote.address) : null

// ---------------------------------------------------------------------------
// Identify the tokens on-chain rather than trusting the feed's labels
// ---------------------------------------------------------------------------

let baseToken = null
let quoteToken = null
if (baseAddress && quoteAddress) {
  try {
    ;[baseToken, quoteToken] = await Promise.all([
      readTokenMetadata(client, baseAddress),
      readTokenMetadata(client, quoteAddress),
    ])
  } catch {
    // A feed label we cannot confirm on-chain is reported as unconfirmed rather
    // than silently promoted to fact.
  }
}

function describe(token, fallbackSymbol) {
  if (!token) return `${fallbackSymbol ?? '?'} (not confirmed on-chain)`
  const known = knownTokenAt(token.address)
  if (known?.address === WETH.address) return `${token.symbol} (canonical WETH)`
  if (known?.address === USDG.address) return `${token.symbol} (canonical Global Dollar)`
  if (known?.impersonates) return `${token.symbol} (IMPOSTOR: ${JSON.stringify(token.name)})`
  return `${token.symbol} (${JSON.stringify(token.name)}, unverified)`
}

const barLabel = AGGREGATE === 1 ? TIMEFRAME : `${AGGREGATE} ${TIMEFRAME}`
const denomination =
  CURRENCY === 'usd' ? 'USD' : `${quoteToken?.symbol ?? meta.quote?.symbol ?? 'the quote token'} (currency=token)`

console.log(`\n  ${describe(baseToken, meta.base?.symbol)} / ${describe(quoteToken, meta.quote?.symbol)}`)
console.log(`  Pool ${pool}`)
if (baseAddress) console.log(`  Base ${baseAddress}`)
console.log(`  ${candles.length} bars of ${barLabel}, priced in ${denomination}`)
console.log(`  ${candles[0].time.toISOString()}  ..  ${candles.at(-1).time.toISOString()}`)

// ---------------------------------------------------------------------------
// Draw the chart
// ---------------------------------------------------------------------------

const HEIGHT = 18

const highest = Math.max(...candles.map((c) => c.high))
const lowest = Math.min(...candles.map((c) => c.low))
const span = highest - lowest || highest || 1

/** Map a price to a row index, 0 at the top of the chart. */
function rowFor(price) {
  const ratio = (price - lowest) / span
  return Math.min(HEIGHT - 1, Math.max(0, Math.round((1 - ratio) * (HEIGHT - 1))))
}

/** Significant-figure formatting, because these prices run to 1e-8. */
function price(value) {
  if (!Number.isFinite(value)) return 'n/a'
  if (value === 0) return '0'
  if (Math.abs(value) >= 1000) return value.toFixed(2)
  if (Math.abs(value) >= 1) return value.toFixed(4)
  return value.toPrecision(6)
}

const axisWidth = Math.max(price(highest).length, price(lowest).length)
const grid = Array.from({ length: HEIGHT }, () => Array(candles.length).fill(' '))

for (const [column, candle] of candles.entries()) {
  const highRow = rowFor(candle.high)
  const lowRow = rowFor(candle.low)
  const openRow = rowFor(candle.open)
  const closeRow = rowFor(candle.close)

  const bodyTop = Math.min(openRow, closeRow)
  const bodyBottom = Math.max(openRow, closeRow)
  const rising = candle.close >= candle.open

  for (let row = highRow; row <= lowRow; row += 1) {
    // Wick outside the body, filled body between open and close. A doji (open
    // equals close within one row) still renders a mark rather than vanishing.
    grid[row][column] = row >= bodyTop && row <= bodyBottom ? (rising ? '#' : '@') : '|'
  }
}

console.log('')
for (let row = 0; row < HEIGHT; row += 1) {
  const value = highest - (span * row) / (HEIGHT - 1)
  const axis = row === 0 || row === HEIGHT - 1 || row % 4 === 0 ? price(value).padStart(axisWidth) : ' '.repeat(axisWidth)
  console.log(`  ${axis} |${grid[row].join('')}`)
}
console.log(`  ${' '.repeat(axisWidth)} +${'-'.repeat(candles.length)}`)
console.log(
  `  ${' '.repeat(axisWidth)}  ${candles[0].time.toISOString().slice(11, 16)}` +
    `${' '.repeat(Math.max(1, candles.length - 11))}${candles.at(-1).time.toISOString().slice(11, 16)} UTC`,
)
console.log(`\n  # rising bar   @ falling bar   | wick`)

// ---------------------------------------------------------------------------
// Summary statistics
// ---------------------------------------------------------------------------

const first = candles[0]
const last = candles.at(-1)
const change = ((last.close - first.open) / first.open) * 100
const volume = candles.reduce((sum, c) => sum + c.volume, 0)
const rising = candles.filter((c) => c.close >= c.open).length

console.log('')
console.log(`  open    ${price(first.open)}`)
console.log(`  close   ${price(last.close)}`)
console.log(`  high    ${price(highest)}`)
console.log(`  low     ${price(lowest)}`)
console.log(`  change  ${change >= 0 ? '+' : ''}${change.toFixed(2)}% over ${candles.length} bars`)
console.log(`  bars    ${rising} rising, ${candles.length - rising} falling`)
console.log(`  volume  ${volume.toLocaleString('en-US', { maximumFractionDigits: 2 })} (quote units, per the feed)`)

// ---------------------------------------------------------------------------
// Confirm the last close against the chain
// ---------------------------------------------------------------------------

const UNISWAP_V3_POOL_ABI = [
  {
    name: 'slot0',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [
      { name: 'sqrtPriceX96', type: 'uint160' },
      { name: 'tick', type: 'int24' },
      { name: 'observationIndex', type: 'uint16' },
      { name: 'observationCardinality', type: 'uint16' },
      { name: 'observationCardinalityNext', type: 'uint16' },
      { name: 'feeProtocol', type: 'uint8' },
      { name: 'unlocked', type: 'bool' },
    ],
  },
  { name: 'token0', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
]

const SCALE = 10n ** 30n
const Q192 = 2n ** 192n

// Only meaningful when the bars are denominated in the quote token. A USD
// series and a slot0 price are different units, and comparing them produces a
// meaningless ~100% "drift".
if (baseToken && quoteToken && CURRENCY === 'token') {
  const [slot0Result, token0Result] = await client.multicall({
    contracts: [
      { address: pool, abi: UNISWAP_V3_POOL_ABI, functionName: 'slot0' },
      { address: pool, abi: UNISWAP_V3_POOL_ABI, functionName: 'token0' },
    ],
    allowFailure: true,
  })

  if (slot0Result.status === 'success' && token0Result.status === 'success') {
    const sqrtPriceX96 = slot0Result.result[0]
    const token0Address = getAddress(token0Result.result)
    const baseIsToken0 = token0Address === baseToken.address

    const decimals0 = baseIsToken0 ? baseToken.decimals : quoteToken.decimals
    const decimals1 = baseIsToken0 ? quoteToken.decimals : baseToken.decimals

    // Scale before dividing: see example 05 for why this is not optional.
    const p0in1 = (sqrtPriceX96 * sqrtPriceX96 * SCALE * 10n ** BigInt(decimals0)) / (Q192 * 10n ** BigInt(decimals1))
    const onChain = baseIsToken0 ? p0in1 : (SCALE * SCALE) / p0in1
    const onChainFloat = Number(onChain) / Number(SCALE)

    const drift = Math.abs(onChainFloat - last.close) / last.close * 100

    console.log('')
    console.log(`  Last bar close  ${price(last.close)}  (GeckoTerminal)`)
    console.log(`  Live pool price ${price(onChainFloat)}  (slot0, read just now)`)
    console.log(`  Drift ${drift.toFixed(2)}%`)
    console.log('')
    console.log('  The last bar is still open, so some drift is expected and healthy.')
    console.log('  A chart is a convenience. The chain is the source of truth: settle')
    console.log('  every number that moves money against slot0, never against a feed.')

    if (drift > 25) {
      console.log('')
      console.log('  Drift above 25% is not staleness, it is a unit mismatch. Check that the')
      console.log('  bars and slot0 are denominated in the same token before trusting either.')
    }
  }
} else if (CURRENCY === 'usd') {
  console.log('')
  console.log('  Skipping the on-chain check: these bars are priced in USD and slot0 is')
  console.log('  priced in the quote token. Re-run with --currency token to compare them.')
}

console.log('')
