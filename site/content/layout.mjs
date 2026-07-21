/**
 * robinhood-toolkit · document shell for every pre-rendered page
 * Author: nirholas · https://github.com/nirholas/robinhood-toolkit
 * License: All Rights Reserved (c) 2026 nirholas
 *
 * Emits a complete, standalone HTML document per route. No client router, no
 * SPA fallback, no hydration: what the reader receives is the finished page.
 * That is what makes one dist/ deploy identically to GitHub Pages (no server
 * execution at all) and to Cloudflare, Vercel, Railway and Cloud Run.
 */

import { esc, href } from './ui.mjs'

export const SITE_NAME = 'robinhood-toolkit'
export const REPO_URL = 'https://github.com/nirholas/robinhood-toolkit'

/**
 * Applies the stored theme before first paint. Inline and blocking on purpose:
 * a deferred module would let the wrong theme paint for a frame.
 */
const THEME_BOOTSTRAP = `(function(){try{var m=localStorage.getItem('rht-theme');if(m==='light'||m==='dark'){document.documentElement.setAttribute('data-theme',m);document.documentElement.style.colorScheme=m;}}catch(e){}})();`

function navItems(routes) {
  return routes.filter((route) => route.nav)
}

function nav(routes, current, base) {
  return `<ul>
${navItems(routes)
  .map(
    (route) => `      <li><a href="${esc(href(base, route.path))}"${
      route.path === current ? ' aria-current="page"' : ''
    }>${esc(route.nav)}</a></li>`
  )
  .join('\n')}
    </ul>`
}

function header(routes, current, base) {
  return `<header class="site-header">
  <div class="page site-header__inner">
    <a class="brand" href="${esc(href(base, '/'))}">
      ${esc(SITE_NAME)}
      <span class="brand__mark">4663</span>
    </a>
    <nav class="site-nav" aria-label="Primary">
      ${nav(routes, current, base)}
    </nav>
    <div class="header-actions">
      <button type="button" class="search-trigger" data-search-trigger aria-label="Search the site">
        <span aria-hidden="true">⌕</span>
        <span class="search-trigger__label">Search</span>
        <kbd>Ctrl K</kbd>
      </button>
      <button type="button" class="btn btn--icon" data-theme-toggle aria-label="Switch theme">
        <svg class="theme-toggle__icon theme-toggle__icon--moon" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5Z" />
        </svg>
        <svg class="theme-toggle__icon theme-toggle__icon--sun" viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
        </svg>
      </button>
    </div>
  </div>
</header>
<nav class="mobile-nav" aria-label="Primary, compact">
  <div>${nav(routes, current, base)}</div>
</nav>`
}

function searchDialog() {
  return `<dialog class="search-dialog" data-search-dialog aria-label="Search the site">
  <form method="dialog" class="search-dialog__field">
    <span aria-hidden="true">⌕</span>
    <label class="visually-hidden" for="site-search-input">Search pages and build prompts</label>
    <input type="search" id="site-search-input" placeholder="Search pages and build prompts"
           autocomplete="off" spellcheck="false" enterkeyhint="go">
    <button type="submit" class="btn btn--sm" value="close">Close</button>
  </form>
  <p class="search-empty" data-search-status data-state="idle">Type to search pages and build prompts.</p>
  <ul class="search-results" data-search-results></ul>
  <div class="search-dialog__foot">
    <span><kbd>↑</kbd> <kbd>↓</kbd> to move</span>
    <span><kbd>Enter</kbd> to open</span>
    <span><kbd>Esc</kbd> to close</span>
    <span>Static index, no backend.</span>
  </div>
</dialog>`
}

function footer(base) {
  return `<footer class="site-footer">
  <div class="page site-footer__inner">
    <div>
      <p><strong>${esc(SITE_NAME)}</strong> · All Rights Reserved © 2026 <a href="https://github.com/nirholas">nirholas</a></p>
      <p>
        Not affiliated with, endorsed by, or sponsored by Robinhood Markets, Inc. or any of its
        subsidiaries. "Robinhood" is used nominatively to identify the platforms this toolkit targets.
        Nothing here is financial advice.
      </p>
      <p>
        Charts by <a href="https://www.tradingview.com/" rel="noopener noreferrer">TradingView</a>
        Lightweight Charts (Apache 2.0). Market data from
        <a href="https://dexscreener.com/" rel="noopener noreferrer">DexScreener</a>.
      </p>
    </div>
    <ul>
      <li><a href="${esc(REPO_URL)}" rel="noopener noreferrer">Source</a></li>
      <li><a href="${esc(REPO_URL)}/tree/main/prompts" rel="noopener noreferrer">Prompts</a></li>
      <li><a href="https://docs.robinhood.com/chain/" rel="noopener noreferrer">Chain docs</a></li>
      <li><a href="${esc(href(base, '/deploy/'))}">Deploy</a></li>
    </ul>
  </div>
</footer>`
}

export function renderDocument({ route, routes, base, body, canonical }) {
  const title = `${route.title} · ${SITE_NAME}`
  return `<!doctype html>
<!--
  robinhood-toolkit · generated page: ${route.path}
  Author: nirholas · https://github.com/nirholas/robinhood-toolkit
  License: All Rights Reserved (c) 2026 nirholas

  GENERATED FILE. Do not edit. Source: content/pages${route.path === '/' ? '/home' : route.path.replace(/\/$/, '')}.mjs
  Regenerate with: npm run gen
-->
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(route.description)}">
<meta name="site-base" content="${esc(base)}">
<meta name="color-scheme" content="light dark">
${canonical ? `<link rel="canonical" href="${esc(canonical)}">` : ''}
<meta property="og:type" content="website">
<meta property="og:title" content="${esc(route.title)}">
<meta property="og:description" content="${esc(route.description)}">
<meta property="og:site_name" content="${esc(SITE_NAME)}">
<meta name="twitter:card" content="summary">
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='6' fill='%23171717'/%3E%3Ctext x='16' y='22' font-family='monospace' font-size='15' fill='%23ffffff' text-anchor='middle'%3ER%3C/text%3E%3C/svg%3E">
<script>${THEME_BOOTSTRAP}</script>
<script type="module" src="/src/main.js"></script>
</head>
<body${route.modules ? ` data-modules="${esc(route.modules)}"` : ''}>
<a class="skip-link" href="#main">Skip to content</a>
${header(routes, route.path, base)}
<main id="main" class="page" tabindex="-1">
${body}
</main>
${footer(base)}
${searchDialog()}
</body>
</html>
`
}
