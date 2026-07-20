/**
 * robinhood-toolkit · 404 page content
 * Author: nirholas · https://github.com/nirholas/robinhood-toolkit
 * License: MIT (c) 2026 nirholas
 *
 * Emitted as a real dist/404.html. Cloudflare serves it via not_found_handling,
 * Vercel and GitHub Pages serve it by convention, and scripts/serve.mjs serves
 * it with a genuine 404 status on Railway and Cloud Run.
 */

import { cards, p } from '../ui.mjs'

export const route = {
  path: '/404.html',
  file: '404.html',
  nav: null,
  title: 'Page not found',
  description: 'That page does not exist on this site.'
}

export function render({ base, prompts }) {
  return `
<div class="page-head">
  <p class="eyebrow">404</p>
  <h1>That page does not exist</h1>
  <p class="lede">
    Every route on this site is a real pre-rendered file, so a missing page is genuinely missing
    rather than a routing failure. Here is everything that does exist.
  </p>
</div>

${cards(
  [
    { title: 'Overview', body: 'What Robinhood Chain and Robinhood Crypto are, and what this toolkit covers.', href: '/' },
    { title: 'Quick start', body: 'Reach the chain and verify chain ID 4663 in under a minute.', href: '/start/' },
    { title: 'Chain guide', body: 'Network params, contract deploys, registries, and trust assumptions.', href: '/chain/' },
    { title: 'Live market view', body: 'Real DexScreener data for Robinhood Chain pairs.', href: '/charts/' },
    { title: 'REST API', body: 'Auth, market data, orders, portfolio, and rate limits.', href: '/api/' },
    { title: 'Agents', body: 'Agentic trading over MCP, and the supervision gap you own.', href: '/agents/' },
    { title: `${prompts.total} build prompts`, body: 'Self-contained build tasks across every track.', href: '/prompts/' },
    { title: 'Deploy', body: 'One dist/ directory onto five different hosts.', href: '/deploy/' }
  ],
  { columns: 3, base }
)}

${p('You can also press <kbd>Ctrl</kbd> <kbd>K</kbd> anywhere on this site to search every page and every build prompt.')}
`
}
