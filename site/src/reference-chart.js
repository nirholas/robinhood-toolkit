/* built by nirholas x.com/nichxbt */
/**
 * robinhood-toolkit · chart router: CEX widget vs DEX embed
 * Author: nirholas · https://github.com/nirholas/robinhood-toolkit
 * License: All Rights Reserved (c) 2026 nirholas
 *
 * The routing decision is made explicitly here, never by accident. A DEX pair
 * on Robinhood Chain can only be rendered by the DexScreener embed; a CEX
 * reference symbol (market context for the underlying asset) is what the
 * TradingView widget is for. When prefer:'cex' finds no listing we fall
 * through to the embed rather than rendering TradingView's "Invalid symbol".
 */
import { mountReferenceWidget, referenceSymbolFor } from './reference-widget.js'
import { mountDexEmbed } from './dex-embed.js'

/**
 * @param {HTMLElement} container
 * @param {{ pairAddress: string, baseSymbol: string, prefer?: 'dex'|'cex' }} spec
 * @returns {{ destroy: () => void }}
 */
export function mountChart(container, spec) {
  const { pairAddress, baseSymbol, prefer = 'dex' } = spec

  if (prefer === 'cex') {
    const symbol = referenceSymbolFor(baseSymbol)
    if (symbol) return mountReferenceWidget(container, symbol)
    // No CEX listing exists. Fall through rather than rendering "Invalid symbol".
  }
  return mountDexEmbed(container, pairAddress)
}
/* built by nirholas x.com/nichxbt */
