/* built by nirholas x.com/nichxbt */
/**
 * robinhood-toolkit · live Robinhood Chain market view
 * Author: nirholas · https://github.com/nirholas/robinhood-toolkit
 * License: All Rights Reserved (c) 2026 nirholas
 *
 * Charting is Lightweight Charts v5 (Apache 2.0, TradingView). The library's
 * license and README require TradingView be credited as the product creator
 * with a link to https://www.tradingview.com/. The built-in attributionLogo
 * layout option satisfies that and is left ON deliberately; the page also
 * carries a visible text link. Do not pass attributionLogo: false.
 *
 * Data is DexScreener REST, live, no fallback sample data anywhere. Because
 * DexScreener exposes no OHLCV endpoint, nothing here draws candles. The two
 * series below are a derived price-window line and a derived volume-bucket
 * histogram, both labelled as derived in the UI.
 */

import { createChart, LineSeries, HistogramSeries, ColorType, LineStyle, CrosshairMode } from 'lightweight-charts'
import { token } from './theme.js'
import {
  DEFAULT_PAIR,
  deriveVolumeBuckets,
  derivePriceWindows,
  fetchPair,
  formatAge,
  formatCount,
  formatPercent,
  formatUsd,
  searchPairs
} from './dexscreener.js'

const ICONS = { pending: '•', success: '✓', error: '✕', warning: '⚠' }

function chartTheme() {
  return {
    background: token('--chart-bg'),
    text: token('--chart-text'),
    grid: token('--chart-grid'),
    border: token('--chart-border'),
    crosshair: token('--chart-crosshair'),
    series: token('--chart-series'),
    up: token('--chart-up'),
    down: token('--chart-down')
  }
}

function baseChartOptions(theme) {
  return {
    autoSize: true,
    layout: {
      // License requirement. Leave this on.
      attributionLogo: true,
      background: { type: ColorType.Solid, color: theme.background },
      textColor: theme.text,
      fontFamily: getComputedStyle(document.body).fontFamily
    },
    grid: {
      vertLines: { color: theme.grid },
      horzLines: { color: theme.grid }
    },
    rightPriceScale: { borderColor: theme.border },
    timeScale: { borderColor: theme.border, timeVisible: true, secondsVisible: false },
    crosshair: {
      mode: CrosshairMode.Normal,
      vertLine: { color: theme.crosshair, width: 1, style: LineStyle.Dotted, labelBackgroundColor: theme.series },
      horzLine: { color: theme.crosshair, width: 1, style: LineStyle.Dotted, labelBackgroundColor: theme.series }
    },
    handleScale: { axisPressedMouseMove: false },
    localization: {
      priceFormatter: (value) => formatUsd(value)
    }
  }
}

function escapeHtml(value) {
  return String(value).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
  )
}

function setStatus(node, state, label, message) {
  node.dataset.state = state
  node.hidden = false
  node.querySelector('[data-output-icon]').textContent = ICONS[state] || ICONS.pending
  node.querySelector('[data-output-label]').textContent = label
  node.querySelector('pre').textContent = message
}

/** Short form of an address. The full value always stays in a title attribute. */
function shortAddress(address) {
  const value = String(address || '')
  return /^0x[0-9a-fA-F]{40}$/.test(value) ? `${value.slice(0, 8)}...${value.slice(-6)}` : value
}

/**
 * A symbol from an API response is attacker-chosen and not unique. Never render
 * one without the address that actually identifies the asset: Robinhood Chain
 * carries four separate tokens using the ticker USDG.
 */
function tokenLabel(token) {
  if (!token) return '?'
  return `${escapeHtml(token.symbol || '?')} <span class="token-addr" title="${escapeHtml(token.address || '')}">${escapeHtml(
    shortAddress(token.address)
  )}</span>`
}

function statTile(label, value, note) {
  return `
    <div class="stat">
      <span class="stat__label">${escapeHtml(label)}</span>
      <span class="stat__value">${escapeHtml(value)}</span>
      ${note ? `<span class="stat__note">${escapeHtml(note)}</span>` : ''}
    </div>`
}

function renderStats(container, pair) {
  const base = pair.baseToken?.symbol || '?'
  const quote = pair.quoteToken?.symbol || '?'
  const change24 = Number(pair.priceChange?.h24)
  const txns24 = pair.txns?.h24 || { buys: 0, sells: 0 }

  container.innerHTML = [
    statTile(
      'Price (USD)',
      formatUsd(pair.priceUsd),
      `1 ${base} (${shortAddress(pair.baseToken?.address)}) in ${quote}: ${pair.priceNative}`
    ),
    statTile(
      '24h change',
      `${Number.isFinite(change24) && change24 >= 0 ? '▲' : '▼'} ${formatPercent(pair.priceChange?.h24)}`,
      'arrow plus sign, not color'
    ),
    statTile('6h change', formatPercent(pair.priceChange?.h6)),
    statTile('1h change', formatPercent(pair.priceChange?.h1)),
    statTile('24h volume', formatUsd(pair.volume?.h24)),
    statTile('Liquidity', formatUsd(pair.liquidity?.usd)),
    statTile('FDV', formatUsd(pair.fdv)),
    statTile('Market cap', formatUsd(pair.marketCap)),
    statTile('24h buys', formatCount(txns24.buys)),
    statTile('24h sells', formatCount(txns24.sells)),
    statTile('DEX', `${pair.dexId || 'unknown'}${pair.labels?.length ? ` ${pair.labels.join(' ')}` : ''}`),
    statTile('Pair age', formatAge(pair.pairCreatedAt))
  ].join('')
}

const EXPLORER = 'https://robinhoodchain.blockscout.com/address'

function renderHeader(container, pair) {
  const base = pair.baseToken || {}
  const quote = pair.quoteToken || {}
  container.innerHTML = `
    <div>
      <h2 class="panel__title">${escapeHtml(base.name || 'Unknown token')} / ${escapeHtml(quote.name || 'Unknown token')}</h2>
      <p class="muted">
        Ticker <code>${escapeHtml(base.symbol || '?')}</code> / <code>${escapeHtml(quote.symbol || '?')}</code>.
        Names and tickers come from the token contracts and are chosen by whoever deployed them.
        The addresses below are the only identifying facts here.
      </p>
      <ul class="token-identity">
        <li>
          <span class="token-identity__role">Base</span>
          <a href="${EXPLORER}/${escapeHtml(base.address || '')}" rel="noopener noreferrer" target="_blank"><code>${escapeHtml(base.address || 'unknown')}</code></a>
        </li>
        <li>
          <span class="token-identity__role">Quote</span>
          <a href="${EXPLORER}/${escapeHtml(quote.address || '')}" rel="noopener noreferrer" target="_blank"><code>${escapeHtml(quote.address || 'unknown')}</code></a>
        </li>
        <li>
          <span class="token-identity__role">Pair</span>
          <a href="${escapeHtml(pair.url)}" rel="noopener noreferrer nofollow" target="_blank"><code>${escapeHtml(pair.pairAddress)}</code></a>
        </li>
      </ul>
    </div>`
}

function renderBucketTable(container, buckets) {
  container.innerHTML = `
    <table>
      <caption>
        Non-overlapping buckets computed by subtracting DexScreener's cumulative trailing windows.
        Buy and sell counts are API fields; the bucket split is derived.
      </caption>
      <thead>
        <tr><th scope="col">Bucket</th><th scope="col">Volume</th><th scope="col">Buys</th><th scope="col">Sells</th><th scope="col">Window direction</th></tr>
      </thead>
      <tbody>
        ${buckets
          .map(
            (bucket) => `
          <tr>
            <th scope="row">${escapeHtml(bucket.label)}</th>
            <td>${escapeHtml(formatUsd(bucket.volumeUsd))}</td>
            <td>${escapeHtml(formatCount(bucket.buys))}</td>
            <td>${escapeHtml(formatCount(bucket.sells))}</td>
            <td>${bucket.direction === 'up' ? '▲ up' : '▼ down'}</td>
          </tr>`
          )
          .join('')}
      </tbody>
    </table>`
}

/** Owns both chart instances and re-themes them in place on toggle. */
function createCharts(priceEl, volumeEl) {
  let theme = chartTheme()
  const priceChart = createChart(priceEl, baseChartOptions(theme))
  const volumeChart = createChart(volumeEl, {
    ...baseChartOptions(theme),
    rightPriceScale: { borderColor: theme.border, scaleMargins: { top: 0.2, bottom: 0 } }
  })

  const priceSeries = priceChart.addSeries(LineSeries, {
    color: theme.series,
    lineWidth: 2,
    pointMarkersVisible: true,
    priceLineVisible: false,
    lastValueVisible: true
  })

  const volumeSeries = volumeChart.addSeries(HistogramSeries, {
    priceFormat: { type: 'volume' },
    priceLineVisible: false
  })

  // Both charts share a time axis, so keep them locked together.
  let syncing = false
  const link = (from, to) => {
    from.timeScale().subscribeVisibleLogicalRangeChange((range) => {
      if (syncing || !range) return
      syncing = true
      to.timeScale().setVisibleLogicalRange(range)
      syncing = false
    })
  }
  link(priceChart, volumeChart)
  link(volumeChart, priceChart)

  let lastBuckets = []

  function retheme() {
    theme = chartTheme()
    const options = baseChartOptions(theme)
    priceChart.applyOptions(options)
    volumeChart.applyOptions({
      ...options,
      rightPriceScale: { borderColor: theme.border, scaleMargins: { top: 0.2, bottom: 0 } }
    })
    priceSeries.applyOptions({ color: theme.series })
    if (lastBuckets.length) volumeSeries.setData(toHistogramData(lastBuckets, theme))
  }

  function toHistogramData(buckets, activeTheme) {
    return buckets.map((bucket) => ({
      time: bucket.time,
      value: bucket.volumeUsd,
      color: bucket.direction === 'up' ? activeTheme.up : activeTheme.down
    }))
  }

  window.addEventListener('themechange', retheme)

  return {
    update(pair) {
      const points = derivePriceWindows(pair)
      lastBuckets = deriveVolumeBuckets(pair)
      priceSeries.setData(points.map(({ time, value }) => ({ time, value })))
      volumeSeries.setData(toHistogramData(lastBuckets, theme))
      priceChart.timeScale().fitContent()
      volumeChart.timeScale().fitContent()
      return { points, buckets: lastBuckets }
    }
  }
}

export function initCharts() {
  const root = document.querySelector('[data-charts-root]')
  if (!root) return

  const status = root.querySelector('[data-chart-status]')
  const skeleton = root.querySelector('[data-chart-skeleton]')
  const live = root.querySelector('[data-chart-live]')
  const header = root.querySelector('[data-pair-header]')
  const stats = root.querySelector('[data-pair-stats]')
  const bucketTable = root.querySelector('[data-bucket-table]')
  const priceEl = root.querySelector('[data-chart-price]')
  const volumeEl = root.querySelector('[data-chart-volume]')
  const updated = root.querySelector('[data-updated-at]')
  const retry = root.querySelector('[data-chart-retry]')

  const searchForm = root.querySelector('[data-pair-search]')
  const searchInput = searchForm.querySelector('input[type="search"]')
  const searchValidation = searchForm.querySelector('[data-validation]')
  const searchResults = root.querySelector('[data-search-pairs]')

  let charts = null
  let currentPair = DEFAULT_PAIR
  let inFlight = null

  function setSearchValidation(state, message) {
    searchValidation.dataset.state = state
    searchValidation.querySelector('[data-validation-icon]').textContent = state === 'idle' ? '' : ICONS[state] || ''
    searchValidation.querySelector('[data-validation-text]').textContent = message
  }

  async function load(pairAddress) {
    currentPair = pairAddress
    inFlight?.abort()
    inFlight = new AbortController()

    skeleton.hidden = false
    live.hidden = true
    retry.hidden = true
    setStatus(status, 'pending', 'Loading', `GET /latest/dex/pairs/robinhood/${pairAddress}`)

    try {
      const pair = await fetchPair(pairAddress, { signal: inFlight.signal })
      renderHeader(header, pair)
      renderStats(stats, pair)

      if (!charts) charts = createCharts(priceEl, volumeEl)
      const { points, buckets } = charts.update(pair)
      renderBucketTable(bucketTable, buckets)

      skeleton.hidden = true
      live.hidden = false
      updated.textContent = new Date().toLocaleTimeString()
      setStatus(
        status,
        'success',
        'Live data loaded',
        `${points.length} price points and ${buckets.length} volume buckets built from the DexScreener response for ` +
          `${pair.baseToken?.name} (${shortAddress(pair.baseToken?.address)}) / ` +
          `${pair.quoteToken?.name} (${shortAddress(pair.quoteToken?.address)}).`
      )
    } catch (error) {
      if (error.name === 'AbortError') return
      skeleton.hidden = true
      live.hidden = true
      retry.hidden = false
      setStatus(
        status,
        'error',
        'Could not load market data',
        `${error.message}\n\nDexScreener is a public API with no key and no CORS restriction, so this is usually a ` +
          'transient network failure or an unindexed pair address. Use Retry, or search for a different pair above.'
      )
    }
  }

  retry.addEventListener('click', () => load(currentPair))

  searchInput.addEventListener('input', () => {
    const value = searchInput.value.trim()
    if (!value) {
      searchInput.removeAttribute('aria-invalid')
      setSearchValidation('idle', '')
    } else if (value.length < 2) {
      searchInput.setAttribute('aria-invalid', 'true')
      setSearchValidation('warning', 'Enter at least two characters.')
    } else {
      searchInput.removeAttribute('aria-invalid')
      setSearchValidation('idle', '')
    }
  })

  searchForm.addEventListener('submit', async (event) => {
    event.preventDefault()
    const query = searchInput.value.trim()
    if (query.length < 2) {
      searchInput.setAttribute('aria-invalid', 'true')
      setSearchValidation('error', 'Enter at least two characters to search.')
      searchInput.focus()
      return
    }

    // A pair address is unambiguous, so resolve it directly instead of hoping
    // the cross-chain search surfaces it.
    if (/^0x[0-9a-fA-F]{40}$/.test(query)) {
      searchResults.innerHTML = ''
      setSearchValidation('idle', '')
      load(query)
      return
    }

    searchResults.innerHTML = '<li class="muted">Searching DexScreener...</li>'
    try {
      const pairs = await searchPairs(query)
      if (!pairs.length) {
        searchResults.innerHTML = ''
        setSearchValidation(
          'warning',
          `No Robinhood Chain pair matched "${query}". The search endpoint ranks across every chain DexScreener indexes, ` +
            'so a term dominated by pairs on other chains can push Robinhood Chain results out of the response. ' +
            'Try a token symbol that trades here, a DEX name such as "uniswap", or paste a pair address.'
        )
        return
      }
      setSearchValidation('success', `${pairs.length} Robinhood Chain pair${pairs.length === 1 ? '' : 's'} found.`)
      searchResults.innerHTML = pairs
        .slice(0, 10)
        .map(
          (pair) => `
        <li>
          <button type="button" class="btn btn--sm" data-load-pair="${escapeHtml(pair.pairAddress)}"
                  title="${escapeHtml(pair.baseToken?.name || '')} (${escapeHtml(pair.baseToken?.address || '')})">
            ${tokenLabel(pair.baseToken)} / ${escapeHtml(pair.quoteToken?.symbol || '?')}
            <span class="muted">${escapeHtml(formatUsd(pair.liquidity?.usd))} liquidity</span>
          </button>
        </li>`
        )
        .join('')
    } catch (error) {
      searchResults.innerHTML = ''
      setSearchValidation('error', `Search failed: ${error.message}. Check your connection and try again.`)
    }
  })

  searchResults.addEventListener('click', (event) => {
    const button = event.target.closest('[data-load-pair]')
    if (!button) return
    load(button.dataset.loadPair)
    root.querySelector('[data-chart-live]').scrollIntoView({ behavior: 'smooth', block: 'start' })
  })

  load(DEFAULT_PAIR)
}
/* built by nirholas x.com/nichxbt */
