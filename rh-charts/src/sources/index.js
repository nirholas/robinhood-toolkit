/* built by nirholas x.com/nichxbt */
/**
 * robinhood-toolkit · candle source registry
 * Author: nirholas · https://github.com/nirholas/robinhood-toolkit
 * License: All Rights Reserved (c) 2026 nirholas
 *
 * A CandleSource implements:
 *   id: string
 *   fetchBars(spec, { interval, limit }) -> Promise<Bar[]>
 *   subscribe?(spec, onBar) -> unsubscribe()
 *
 * `spec` is { chainId, pairAddress, baseSymbol?, quoteSymbol? }.
 * This is OUR interface, not a TradingView one. Lightweight Charts defines no
 * datafeed protocol; see the prompt body.
 */

const registry = new Map();

export function registerSource(source) {
  if (!source?.id || typeof source.fetchBars !== 'function') {
    throw new Error('A CandleSource needs an id and a fetchBars(spec, opts) method');
  }
  registry.set(source.id, source);
  return source;
}

export function getSource(id) {
  const s = registry.get(id);
  if (!s) {
    throw new Error(`No candle source "${id}". Registered: ${[...registry.keys()].join(', ') || 'none'}`);
  }
  return s;
}

export function listSources() {
  return [...registry.keys()];
}
/* built by nirholas x.com/nichxbt */
