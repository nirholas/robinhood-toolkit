/* built by nirholas x.com/nichxbt */
/**
 * robinhood-toolkit · DexScreener iframe embed
 * Author: nirholas · https://github.com/nirholas/robinhood-toolkit
 * License: All Rights Reserved (c) 2026 nirholas
 *
 * UNDOCUMENTED, UNVERSIONED. DexScreener publishes no embed API. These
 * parameters worked on 2026-07-20 and may change without notice. Always
 * degrade to a plain link rather than leaving an empty frame on screen.
 *
 * The chart inside the iframe is TradingView Advanced Charts rendered under
 * DexScreener's license, which does not extend to us. We embed their page, we
 * do not deploy their library. Do not scrape the frame: cross-origin framing
 * gives no DOM access and it is against their terms. For data, use the JSON
 * API in dexscreener.js.
 */

const DEFAULTS = {
  embed: '1',
  theme: 'dark',
  chartTheme: 'dark',
  chartType: 'usd',
  interval: '15',
  trades: '0',
  info: '0',
  chartLeftToolbar: '0'
}

export function dexEmbedUrl(pairAddress, { chainId = 'robinhood', ...overrides } = {}) {
  const params = new URLSearchParams({ ...DEFAULTS, ...overrides })
  return `https://dexscreener.com/${chainId}/${pairAddress}?${params}`
}

/**
 * Mount the embed with a link fallback shown until the frame loads.
 * @param {HTMLElement} container
 * @param {string} pairAddress
 * @param {{ chainId?: string, [param: string]: string }} [opts]
 * @returns {{ destroy: () => void }}
 */
export function mountDexEmbed(container, pairAddress, opts = {}) {
  const url = dexEmbedUrl(pairAddress, opts)
  const plain = `https://dexscreener.com/${opts.chainId ?? 'robinhood'}/${pairAddress}`

  container.innerHTML = ''
  container.style.position = 'relative'

  const fallback = document.createElement('div')
  fallback.style.cssText =
    'position:absolute;inset:0;display:grid;place-items:center;' +
    'font:11px ui-monospace,monospace;color:#a1a1a1;background:#0a0a0a'
  fallback.innerHTML =
    `<a href="${plain}" target="_blank" rel="noopener" style="color:#a1a1a1">` +
    'Open chart on DexScreener</a>'
  container.appendChild(fallback)

  const frame = document.createElement('iframe')
  frame.src = url
  frame.title = `DexScreener chart for ${pairAddress}`
  frame.loading = 'lazy'
  frame.style.cssText = 'position:relative;width:100%;height:100%;border:0;display:block'
  frame.addEventListener('load', () => {
    fallback.style.display = 'none'
  })
  container.appendChild(frame)

  // If it has not loaded in 8s, assume the undocumented embed changed and
  // leave the link visible rather than showing an empty box.
  const timer = setTimeout(() => {
    if (!frame.contentWindow) fallback.style.display = 'grid'
  }, 8000)

  return {
    destroy() {
      clearTimeout(timer)
      container.innerHTML = ''
    }
  }
}
/* built by nirholas x.com/nichxbt */
