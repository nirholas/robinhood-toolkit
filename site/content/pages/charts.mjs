/* built by nirholas x.com/nichxbt */
/**
 * robinhood-toolkit · live market view page content
 * Author: nirholas · https://github.com/nirholas/robinhood-toolkit
 * License: All Rights Reserved (c) 2026 nirholas
 *
 * The DOM below is the contract that src/charts.js wires itself to. Every state
 * the module can be in has real markup here: skeleton, error with a retry
 * action, empty search result, and populated.
 */

import { CONTRACTS, LINKS } from '../constants.mjs'
import { callout, code, esc, href, list, p, pager, section, table } from '../ui.mjs'
import { DEFAULT_PAIR } from '../../src/dexscreener.js'

/** The canonical USDG deployment, and the impostor that shares its ticker. */
const CANONICAL_USDG = CONTRACTS.usdg
const DEFAULT_PAIR_BASE = '0x8218d73C00567A01481495Ad6c5143e00D5BB5b4'

export const route = {
  path: '/charts/',
  file: 'charts/index.html',
  nav: 'Charts',
  modules: 'charts',
  title: 'Live market view',
  description:
    'Live Robinhood Chain market data from the DexScreener REST API rendered with TradingView Lightweight Charts, in strict monochrome, with every derived series labelled as derived.'
}

export function render({ base }) {
  return `
<div class="page-head">
  <p class="eyebrow">Charts</p>
  <h1>Live market view</h1>
  <p class="lede">
    Real data from the DexScreener REST API, fetched in your browser right now. DexScreener indexes
    Robinhood Chain under the string chain id <code>robinhood</code>, not the numeric 4663. There is
    no sample-data fallback anywhere on this page: if the API is unreachable you get an error and a
    retry button, not fabricated numbers.
  </p>
  <p class="lede">
    The pair loaded by default is a real, actively traded Uniswap v3 pool. Its base token calls
    itself <code>USDG</code> and is <strong>not</strong> the canonical USDG. That is not a flaw in
    the demo, it is the demo.
  </p>
</div>

<div data-charts-root>

  ${section(
    'ticker-collision',
    'Read this before you trust a ticker',
    callout({
      icon: '$',
      strong: true,
      label: 'Robinhood Chain currently has four separate tokens using the ticker USDG, and three of them call themselves "Global Dollar".',
      body: `<p>Verified on 2026-07-20 by querying
        <code>GET /latest/dex/search?q=USDG</code> and filtering to <code>chainId "robinhood"</code>, then
        confirming each token's <code>symbol()</code>, <code>name()</code> and <code>decimals()</code>
        on-chain via <code>eth_call</code>. Both the symbol and the name are set by whoever deployed
        the contract. Neither is unique, and neither is verified by anyone.</p>`
    }),
    table({
      head: ['Address', 'name()', 'decimals()', 'What it is'],
      rows: [
        [
          `<code>${esc(CANONICAL_USDG)}</code>`,
          'Global Dollar',
          '6',
          'The canonical USDG deployment, listed in this toolkit\'s network constants.'
        ],
        [
          `<code>${esc(DEFAULT_PAIR_BASE)}</code>`,
          'Useless Stupid Degen Gamblers',
          '18',
          'An unrelated meme token that claims the USDG ticker. It is the base token of the demo pair loaded below.'
        ],
        ['<code>0x1383b43AeD527485F191b60060f5b5471F71B1ca</code>', 'Global Dollar', 'n/a', 'Claims both the ticker and the canonical name.'],
        ['<code>0x63575aA902DE35ef2dc3a3D32355233bbb44CDa7</code>', 'Global Dollar', 'n/a', 'Claims both the ticker and the canonical name.']
      ],
      caption:
        'Observed live on 2026-07-20. The list is not fixed: anyone can deploy another one this afternoon. Decimals were read on-chain for the two tokens the pages below reference; the other two were observed through the DexScreener index only.'
    }),
    p(
      '<strong>The consequence is the whole point of this page.</strong> A chart, a price feed, a',
      'portfolio tracker or a strategy that resolves assets by ticker is silently pricing an unknown',
      'asset, and it will not error. It will return a number. The two tokens above do not even share',
      'a decimals value, so arithmetic keyed on the wrong one is wrong by six orders of magnitude',
      'before anyone notices the asset was wrong at all.'
    ),
    p(
      'Everything rendered below therefore shows the contract address next to any symbol it received',
      'from the API. Resolve by address, always.'
    )
  )}

  ${section(
    'search',
    'Find a pair',
    p(
      'The search endpoint covers every chain DexScreener indexes. Results below are filtered to',
      '<code>chainId === "robinhood"</code> and sorted by liquidity.'
    ),
    `<form class="panel" data-pair-search>
      <div class="field">
        <label for="pair-query">Search Robinhood Chain pairs</label>
        <div class="field-row">
          <input type="search" id="pair-query" placeholder="token symbol, name, or pair address"
                 autocomplete="off" spellcheck="false" aria-describedby="pair-query-hint pair-query-validation">
          <button type="submit" class="btn btn--primary">Search</button>
        </div>
        <span class="field__hint" id="pair-query-hint">
          Hits <code>GET /latest/dex/search?q=&lt;query&gt;</code> live, no key required, then filters to
          <code>chainId "robinhood"</code>. Try <code>uniswap</code> or <code>USDG</code>. A 40-hex pair
          address is loaded directly instead of searched.
        </span>
        <span class="validation" id="pair-query-validation" data-validation data-state="idle" role="status">
          <i class="validation__icon" data-validation-icon aria-hidden="true"></i>
          <span data-validation-text></span>
        </span>
      </div>
      <ul class="btn-row" data-search-pairs role="list"></ul>
    </form>`
  )}

  ${section(
    'market',
    'Market data',
    `<div class="output" data-chart-status data-state="pending" role="status" aria-live="polite">
      <div class="output__head">
        <i class="output__icon" data-output-icon aria-hidden="true">•</i>
        <span data-output-label>Loading</span>
      </div>
      <pre></pre>
    </div>

    <div class="btn-row">
      <button type="button" class="btn" data-chart-retry hidden>Retry the request</button>
    </div>

    <noscript>
      <div class="callout callout--strong">
        <span class="callout__icon" aria-hidden="true">!</span>
        <div class="callout__body">
          <strong class="callout__label">This view needs JavaScript.</strong>
          <p>It reads a live API at view time, so there is nothing meaningful to pre-render. Every
          other page on this site is complete without JavaScript. The underlying request is
          <code>GET https://api.dexscreener.com/latest/dex/pairs/robinhood/${esc(DEFAULT_PAIR)}</code>
          and you can run it in a terminal.</p>
        </div>
      </div>
    </noscript>

    <div data-chart-skeleton aria-hidden="true">
      <div class="stat-grid">
        ${Array.from({ length: 8 })
          .map(
            () => `<div class="stat">
          <span class="stat__label"><span class="skeleton skeleton-line skeleton-line--label">.</span></span>
          <span class="stat__value"><span class="skeleton skeleton-line skeleton-line--value">.</span></span>
        </div>`
          )
          .join('\n        ')}
      </div>
      <div class="chart-frame">
        <div class="chart-canvas skeleton"></div>
      </div>
    </div>

    <div data-chart-live hidden>
      <div class="panel__head" data-pair-header></div>
      <div class="stat-grid" data-pair-stats></div>

      <h3>Price at the start of each trailing window</h3>
      <div class="chart-frame">
        <div class="chart-canvas" data-chart-price role="img"
             aria-label="Line chart of USD price reconstructed at the start of each DexScreener trailing window. The equivalent numbers are in the table below."></div>
        <div class="chart-legend">
          <span class="chart-legend__item"><span class="chart-legend__swatch chart-legend__swatch--line"></span> USD price (4 derived points plus the live price)</span>
        </div>
      </div>

      <h3>Volume by non-overlapping bucket</h3>
      <div class="chart-frame">
        <div class="chart-canvas" data-chart-volume role="img"
             aria-label="Histogram of USD volume per non-overlapping time bucket. The equivalent numbers are in the table below."></div>
        <div class="chart-legend">
          <span class="chart-legend__item"><span class="chart-legend__swatch chart-legend__swatch--up"></span> Window price change was up</span>
          <span class="chart-legend__item"><span class="chart-legend__swatch chart-legend__swatch--down"></span> Window price change was down</span>
          <span class="chart-legend__item">Two greys, never green and red. Direction is also printed in the table.</span>
        </div>
      </div>

      <div class="table-scroll" data-bucket-table></div>

      <p class="derived-note">
        <strong>What is sourced and what is derived.</strong>
        Price, price change, volume, transaction counts, liquidity, FDV and market cap are returned
        verbatim by DexScreener. The volume buckets are derived: DexScreener reports cumulative
        trailing windows, so a bucket is one window minus the next smaller one, clamped at zero.
        The price line is derived: each point is the current price divided by
        <code>1 + change/100</code> for that window, which reconstructs where price sat when the
        window opened. Only the final point is a live quote.
      </p>

      <p class="attribution-strip">
        <span>Charting by
          <a href="${esc(LINKS.tradingview)}" rel="noopener noreferrer">TradingView</a>
          (<a href="${esc(LINKS.lightweightCharts)}" rel="noopener noreferrer">Lightweight Charts</a>, Apache 2.0).</span>
        <span>Market data by <a href="https://dexscreener.com/" rel="noopener noreferrer">DexScreener</a>.</span>
        <span>Updated <time data-updated-at>never</time>.</span>
      </p>`
  )}
</div>

${section(
  'no-candles',
  'Why there are no candlesticks here',
  callout({
    icon: '$',
    strong: true,
    label: 'DexScreener has no OHLCV endpoint.',
    body: `<p>There is no open, high, low or close to fetch, so this page does not draw candles. It
      would be trivial to synthesise plausible-looking ones from the price change percentages, and
      it would be a lie. What you see instead is every field the API actually returns, plus two
      clearly-labelled derived series built by arithmetic you can check against the table.</p>`
  }),
  p(
    'If you need real candles on this chain, you have to build the datafeed yourself: index swap',
    'events from the pool contracts, bucket them into your own OHLCV store, and serve that to a',
    'charting library. That is a real project, and it is what the',
    `<a href="${esc(href(base, '/prompts/'))}#track-40-charting">40-charting track</a> walks through.`
  )
)}

${section(
  'monochrome',
  'Charting inside a monochrome system',
  p(
    'Lightweight Charts does not inherit CSS. Every colour it draws is an explicit option passed in',
    'JavaScript, so the theme has to be handed to it and re-applied whenever the theme changes.',
    'Toggle the theme in the header and watch both charts re-render in place.'
  ),
  list([
    '<strong>Up and down cannot be green and red.</strong> They are two clearly separated greys, and the direction is repeated as an arrow and a word in the table so colour is never the only signal.',
    '<strong>Both charts expose the same numbers as a real table.</strong> A canvas is opaque to a screen reader; the table is the accessible equivalent, not a fallback.',
    '<strong>The TradingView attribution logo stays on.</strong> The Apache 2.0 licence and the library README require crediting TradingView with a link. The <code>layout.attributionLogo</code> option defaults to true and this page leaves it that way. Passing false is a licence violation, not a style choice.'
  ]),
  code({
    label: 'src/charts.js · theme handoff',
    body: `const theme = {
  background: token('--chart-bg'),
  text: token('--chart-text'),
  grid: token('--chart-grid'),
  up: token('--chart-up'),
  down: token('--chart-down')
}

chart.applyOptions({
  layout: {
    attributionLogo: true,          // license requirement, leave it on
    background: { type: ColorType.Solid, color: theme.background },
    textColor: theme.text
  }
})

window.addEventListener('themechange', retheme)`
  })
)}

${section(
  'endpoints',
  'The endpoints this page calls',
  table({
    head: ['Call', 'Endpoint', 'Used for'],
    rows: [
      ['Pair lookup', '<code>GET /latest/dex/pairs/robinhood/&lt;pairAddress&gt;</code>', 'Everything in the stat grid and both series.'],
      ['Search', '<code>GET /latest/dex/search?q=&lt;query&gt;</code>', 'The pair picker. Results filtered to chainId "robinhood".']
    ],
    caption: `Base URL <code>https://api.dexscreener.com</code>. No API key. The default pair is <code>${esc(DEFAULT_PAIR)}</code>, a Uniswap v3 pool on Robinhood Chain.`
  }),
  code({
    label: 'terminal · the exact request this page makes on load',
    body: `curl -s 'https://api.dexscreener.com/latest/dex/pairs/robinhood/${DEFAULT_PAIR}' | jq '.pair | {
  priceUsd, priceChange, volume, txns, liquidity, fdv, marketCap
}'`
  })
)}

${pager(base, { href: '/chain/', title: 'Robinhood Chain guide' }, { href: '/api/', title: 'Robinhood Crypto REST API' })}
`
}
/* built by nirholas x.com/nichxbt */
