/* built by nirholas x.com/nichxbt */
/**
 * robinhood-toolkit · Robinhood Crypto REST API overview page content
 * Author: nirholas · https://github.com/nirholas/robinhood-toolkit
 * License: All Rights Reserved (c) 2026 nirholas
 *
 * Every endpoint path, header name and schema field on this page was taken from
 * the live OpenAPI 3.0.1 spec served at docs.robinhood.com/crypto/trading and
 * verified on 2026-07-20. Anything the spec does not state is labelled
 * UNVERIFIED in place, with the check the reader can run themselves.
 */

import { LINKS } from '../constants.mjs'
import { callout, code, esc, href, list, p, pager, section, stats, table } from '../ui.mjs'

export const route = {
  path: '/api/',
  file: 'api/index.html',
  nav: 'REST API',
  title: 'Robinhood Crypto REST API',
  description:
    'Auth, market data, orders, portfolio and rate limits for the Robinhood Crypto Trading API, verified against the live OpenAPI spec.'
}

export function render({ base }) {
  return `
<div class="page-head">
  <p class="eyebrow">REST API</p>
  <h1>Robinhood Crypto REST API</h1>
  <p class="lede">
    The brokerage side, not the chain. Base URL <code>https://trading.robinhood.com</code>,
    Ed25519 request signing, a v1 and a v2 endpoint set that differ in more than a version number.
    Everything below was verified against the live OpenAPI 3.0.1 spec on 2026-07-20.
  </p>
</div>

${section(
  'shape',
  'What it is',
  stats([
    { label: 'Base URL', value: 'trading.robinhood.com' },
    { label: 'Auth', value: 'Ed25519', note: 'detached signature' },
    { label: 'Availability', value: 'US only' },
    { label: 'Rate limit', value: '100 req/min', note: '300 in burst' }
  ]),
  p(
    'Credentials are created at <code>robinhood.com/account/crypto</code> on web classic. You',
    'generate the keypair locally and hand Robinhood the public key, so the private key never',
    'leaves your machine. Ed25519 lives in Node\'s standard <code>node:crypto</code> module, which',
    'means a correct client needs zero dependencies.'
  ),
  callout({
    icon: '!',
    strong: true,
    label: 'This is the one surface on this site with no interactive demo.',
    body: `<p>Every call requires a signature from your private key. Putting a signing widget in a
      browser would mean asking you to paste a private key into a web page, and there is no version
      of that which is acceptable. Everything on this page is copy-to-clipboard for your own
      terminal. The read-only widgets elsewhere on the site talk to the
      <a href="${esc(href(base, '/start/'))}">chain RPC</a>, which needs no credentials at all.</p>`
  })
)}

${section(
  'auth',
  'Authentication',
  p('Three headers on every request. The signature is over a concatenated string, not over the body alone.'),
  table({
    head: ['Fact', 'Value'],
    rows: [
      ['Required headers', '<code>x-api-key</code>, <code>x-signature</code>, <code>x-timestamp</code>'],
      ['Algorithm', 'Ed25519, signature base64-encoded'],
      ['Message to sign', '<code>`${api_key}${timestamp}${path}${method}${body}`</code>'],
      ['Timestamp', 'Unix seconds, <strong>valid for 30 seconds only</strong>'],
      ['API key format', '<code>rh-api-&lt;uuid&gt;</code> for keys issued after 2024-08-13; older keys have no prefix'],
      ['Private key encoding', 'base64 of the raw 32-byte Ed25519 seed'],
      ['Public key encoding', 'base64 of the raw 32-byte public key']
    ],
    caption: 'Verified against the live OpenAPI spec, 2026-07-20.'
  }),
  callout({
    icon: '$',
    label: 'The four rules that cause almost every signature failure.',
    body: `<ul>
      <li><code>path</code> includes the query string. Sign <code>/api/v1/crypto/trading/holdings/?asset_code=BTC</code>, not the bare path.</li>
      <li><code>method</code> is uppercase.</li>
      <li>For a request with no body, the body is omitted from the message, which is the same as appending an empty string.</li>
      <li>The signed body must be byte-identical to the bytes you transmit. Serialize once, sign that string, send that string. Serializing twice produces two different strings often enough to ruin an afternoon.</li>
    </ul>`
  }),
  code({
    label: 'node · signing a request with zero dependencies',
    body: `import { createPrivateKey, sign } from 'node:crypto'

// The base64 seed from your keygen step. Load it from the environment,
// never from source. This runs in your terminal, never in a browser.
const seed = Buffer.from(process.env.RH_PRIVATE_KEY, 'base64')
const key = createPrivateKey({
  key: Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), seed]),
  format: 'der',
  type: 'pkcs8'
})

export function signedHeaders({ apiKey, path, method, body = '' }) {
  const timestamp = Math.floor(Date.now() / 1000)
  const message = \`\${apiKey}\${timestamp}\${path}\${method.toUpperCase()}\${body}\`
  return {
    'x-api-key': apiKey,
    'x-timestamp': String(timestamp),
    'x-signature': sign(null, Buffer.from(message), key).toString('base64'),
    'content-type': 'application/json'
  }
}`,
    note:
      'Copy-only. The 16-byte hex prefix is the standard PKCS#8 header for a raw Ed25519 seed, which is what lets you rebuild a key object from the 32-byte seed Robinhood expects you to store.'
  })
)}

${section(
  'market-data',
  'Market data',
  table({
    head: ['Endpoint', 'Method', 'Query params'],
    rows: [
      ['<code>/api/v1/crypto/trading/trading_pairs/</code>', 'GET', '<code>symbol</code> (repeatable), <code>limit</code>, <code>cursor</code>'],
      ['<code>/api/v1/crypto/marketdata/best_bid_ask/</code>', 'GET', '<code>symbol</code> (repeatable)'],
      ['<code>/api/v1/crypto/marketdata/estimated_price/</code>', 'GET', '<code>symbol</code>, <code>side</code>, <code>quantity</code> (all required)'],
      ['<code>/api/v2/crypto/trading/trading_pairs/</code>', 'GET', '<code>symbol</code>, <code>limit</code>, <code>cursor</code>'],
      ['<code>/api/v2/crypto/marketdata/best_bid_ask/</code>', 'GET', '<code>symbol</code> (required)'],
      ['<code>/api/v2/crypto/trading/estimated_price/</code>', 'GET', '<code>symbol</code>, <code>side</code>, <code>quantity</code> (all required)']
    ]
  }),
  list([
    '<code>side</code> is one of <code>bid</code>, <code>ask</code>, <code>both</code>.',
    '<code>quantity</code> is a comma-separated list, maximum 10 values per request, each between the pair\'s <code>min_order_size</code> and <code>max_order_size</code>.',
    '<strong>v2 is the fee-tier endpoint set.</strong> <code>V2EstimatedPrice</code> returns <code>fee_ratio</code>, <code>est_fee</code>, <code>est_total_cost</code> and <code>est_total_credit</code>. Use v2 whenever the fee needs to be inside the quote.',
    '<strong>v2 renames fields.</strong> <code>min_order_size</code> becomes <code>min_order_amount</code>, and <code>is_api_tradable</code> is new. In <code>V2Holding</code>, <code>total_quantity</code> and <code>quantity_available_for_trading</code> are strings where v1 returns numbers. That is a real type change, not a documentation slip: parse accordingly.'
  ])
)}

${section(
  'orders',
  'Orders',
  p('<code>POST /api/v1/crypto/trading/orders/</code> places an order. Required body fields per the <code>AddOrder</code> schema:'),
  table({
    head: ['Field', 'Notes'],
    rows: [
      ['<code>symbol</code>', 'Uppercase pair, for example <code>BTC-USD</code>'],
      ['<code>client_order_id</code>', 'A UUID you generate. Used for idempotency validation, so generate it before the first attempt and reuse it on retry.'],
      ['<code>side</code>', '<code>buy</code> or <code>sell</code>'],
      ['<code>type</code>', '<code>market</code>, <code>limit</code>, <code>stop_limit</code>, <code>stop_loss</code>'],
      ['<code>&lt;type&gt;_order_config</code>', 'Required object; the key name is derived from <code>type</code>. <code>market_order_config</code> accepts only <code>asset_quantity</code>.']
    ]
  }),
  p(
    'The response is an <code>OrderResponse</code>: <code>id</code>, <code>account_number</code>,',
    '<code>symbol</code>, <code>client_order_id</code>, <code>side</code>, <code>type</code>,',
    '<code>state</code>, <code>executions[]</code>, <code>average_price</code>,',
    '<code>filled_asset_quantity</code>, <code>created_at</code>, <code>updated_at</code>, plus the',
    'echoed config object. <code>state</code> is one of <code>open</code>, <code>canceled</code>,',
    '<code>partially_filled</code>, <code>filled</code>, <code>failed</code>.'
  ),
  callout({
    icon: '!',
    strong: true,
    label: 'Cancel is a request, not a guarantee.',
    body: `<p><code>POST /api/v1/crypto/trading/orders/{id}/cancel/</code> takes no body and returns a
      plain success string of the form <code>Cancel request was submitted for order {id}</code>, not
      an order object. Your code must poll the order state to learn what actually happened. Treating
      a successful cancel call as a cancelled order is a real way to end up double-filled.</p>`
  }),
  callout({
    icon: '?',
    label: 'UNVERIFIED: the single-order path.',
    body: `<p>To read one order, filter the list endpoint: <code>GET
      /api/v1/crypto/trading/orders/?id=&lt;uuid&gt;</code>. Robinhood's reference Python client also
      calls <code>GET /api/v1/crypto/trading/orders/{order_id}/</code>, but that path is not in the
      published OpenAPI paths. Prefer the <code>?id=</code> filter, which is in the spec, and test the
      path form yourself before relying on it.</p>`
  }),
  p(
    'For v2 the same shapes apply, but <code>account_number</code> is a <strong>required query',
    'parameter</strong> on <code>POST /api/v2/crypto/trading/orders/</code>.'
  )
)}

${section(
  'portfolio',
  'Portfolio and balances',
  table({
    head: ['Endpoint', 'Method', 'Notes'],
    rows: [
      ['<code>/api/v1/crypto/trading/accounts/</code>', 'GET', 'Single account object, no pagination'],
      ['<code>/api/v1/crypto/trading/holdings/</code>', 'GET', '<code>asset_code</code> (repeatable), <code>limit</code>, <code>cursor</code>'],
      ['<code>/api/v2/crypto/trading/accounts/</code>', 'GET', 'Paginated list, <code>cursor</code>, <code>limit</code>'],
      ['<code>/api/v2/crypto/trading/holdings/</code>', 'GET', '<strong><code>account_number</code> required</strong>, plus <code>asset_code</code>, <code>cursor</code>, <code>limit</code>']
    ]
  }),
  list([
    '<code>Account</code> (v1): <code>account_number</code>, <code>status</code> (<code>active</code> | <code>deactivated</code> | <code>sell_only</code>), <code>buying_power</code>, <code>buying_power_currency</code>.',
    '<code>V2Account</code> adds <code>account_type</code>, <code>is_api_tradable</code> and <code>fee_tier_status</code>.',
    '<code>FeeTierStatus</code>: <code>fee_ratio</code>, <code>thirty_day_volume</code>, <code>next_fee_tier_ratio</code> (nullable), <code>next_fee_tier_threshold</code> (nullable). Nulls mean you are already in the best tier available to you.'
  ]),
  callout({
    icon: '$',
    label: 'This balance is not your on-chain balance.',
    body: `<p>Brokerage buying power and a self-custody wallet balance are separate ledgers held by
      separate legal entities. Reconciling them as one number is a category error that will show up
      in your accounting long before it shows up in your code.
      See <a href="${esc(href(base, '/chain/'))}#trust">the trust assumptions</a>.</p>`
  })
)}

${section(
  'limits',
  'Rate limits and retries',
  stats([
    { label: 'Per minute', value: '100', note: 'per user account' },
    { label: 'Burst', value: '300', note: 'token bucket capacity' },
    { label: 'Over limit', value: 'HTTP 429' },
    { label: 'Scope', value: 'Per endpoint', note: 'limits differ by endpoint' }
  ]),
  p(
    'Rate limiting is a token bucket. Capacity starts full and refills by a fixed amount on a fixed',
    'interval up to the maximum. Two facts shape the design: limits are applied per endpoint and',
    'differ between endpoints, and the actual configuration fluctuates with service availability.',
    'The published numbers are the budget you plan against, not a constant you can pin.'
  ),
  callout({
    icon: '?',
    label: 'UNVERIFIED: rate-limit response headers.',
    body: `<p>The spec does not publish a <code>Retry-After</code> header or rate-limit headers for
      these endpoints. Inspect every response header once, not just on failure. If a header exists,
      prefer it over any client-side estimate.</p>`
  }),
  code({
    label: 'terminal · discover whether rate-limit headers exist',
    body: `curl -s -D - -o /dev/null "https://trading.robinhood.com/api/v1/crypto/trading/accounts/" \\
  -H "x-api-key: $RH_API_KEY" \\
  -H "x-timestamp: $RH_TIMESTAMP" \\
  -H "x-signature: $RH_SIGNATURE" \\
  | grep -i -E 'retry-after|ratelimit|x-rate'`
  })
)}

${section(
  'next',
  'Go deeper',
  p(
    `The <a href="${esc(href(base, '/prompts/'))}#track-20-crypto-api">20-crypto-api track</a> builds all of`,
    'this as working code: a signed client with a known-good Ed25519 test vector, the market data',
    'module, order placement and lifecycle, portfolio reads, streaming versus polling, a client-side',
    'token bucket, and an error taxonomy that says what to do with each failure rather than just',
    'logging it.'
  ),
  p(`Official reference: <a href="${esc(LINKS.cryptoDocs)}" rel="noopener noreferrer">${esc(LINKS.cryptoDocs)}</a>.`)
)}

${pager(base, { href: '/charts/', title: 'Live market view' }, { href: '/agents/', title: 'Agentic trading' })}
`
}
/* built by nirholas x.com/nichxbt */
