/* built by nirholas x.com/nichxbt */
/**
 * robinhood-toolkit · TradingView reference widget (centralized exchanges only)
 * Author: nirholas · https://github.com/nirholas/robinhood-toolkit
 * License: All Rights Reserved (c) 2026 nirholas
 *
 * Charts by TradingView (https://www.tradingview.com/). The copyright element
 * rendered below is an attribution condition of free widget use. Do not remove.
 *
 * Widgets are CEX-only: they accept EXCHANGE:SYMBOL identifiers resolvable in
 * TradingView's own symbol database and nothing else. They cannot chart a
 * Robinhood Chain pool address, a token address, or your own candle array.
 * For DEX pairs use dex-embed.js or the Lightweight Charts path (charts.js).
 */

const TV_SRC = 'https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js'

/** Symbols this project charts. Extend deliberately; a wrong one renders empty. */
export const CEX_SYMBOLS = {
  ETH: 'COINBASE:ETHUSD',
  BTC: 'COINBASE:BTCUSD',
  SOL: 'COINBASE:SOLUSD'
}

/** Map a Robinhood Chain token to a CEX reference symbol, or null if none. */
export function referenceSymbolFor(tokenSymbol) {
  const key = String(tokenSymbol || '').toUpperCase().replace(/^W/, '') // WETH -> ETH
  return CEX_SYMBOLS[key] ?? null
}

/**
 * Mount a TradingView advanced-chart widget.
 * @param {HTMLElement} container
 * @param {string} symbol  EXCHANGE:SYMBOL, e.g. 'COINBASE:ETHUSD'
 * @returns {{ destroy: () => void }}
 */
export function mountReferenceWidget(container, symbol, { interval = '60' } = {}) {
  if (!/^[A-Z0-9_]+:[A-Z0-9._]+$/i.test(symbol)) {
    throw new Error(
      `TradingView widgets require EXCHANGE:SYMBOL, got "${symbol}". ` +
        'Pool and token addresses are not supported. Use a DEX embed or ' +
        'Lightweight Charts instead.'
    )
  }

  container.innerHTML = ''

  const wrap = document.createElement('div')
  wrap.className = 'tradingview-widget-container'
  wrap.style.height = '100%'

  const target = document.createElement('div')
  target.className = 'tradingview-widget-container__widget'
  target.style.height = 'calc(100% - 32px)'
  wrap.appendChild(target)

  // ATTRIBUTION: required by TradingView's free widget terms. Do not remove.
  const credit = document.createElement('div')
  credit.className = 'tradingview-widget-copyright'
  credit.innerHTML =
    '<a href="https://www.tradingview.com/" rel="noopener nofollow" target="_blank">' +
    '<span class="blue-text">Track all markets on TradingView</span></a>'
  wrap.appendChild(credit)

  const script = document.createElement('script')
  script.src = TV_SRC
  script.async = true
  script.type = 'text/javascript'
  script.innerHTML = JSON.stringify({
    autosize: true,
    symbol,
    interval,
    timezone: 'Etc/UTC',
    theme: 'dark',
    style: '1',
    locale: 'en',
    hide_side_toolbar: true,
    allow_symbol_change: false,
    save_image: false
  })
  wrap.appendChild(script)

  container.appendChild(wrap)

  return {
    destroy() {
      container.innerHTML = ''
    }
  }
}
/* built by nirholas x.com/nichxbt */
