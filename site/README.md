<!--
  robinhood-toolkit · documentation site: how to run and deploy it
  Author: nirholas · https://github.com/nirholas/robinhood-toolkit
  License: MIT (c) 2026 nirholas
-->

# robinhood-toolkit site

The documentation and tutorial site for [robinhood-toolkit](../README.md). Vite plus vanilla
JavaScript, no framework, pre-rendered to one real HTML file per route, strict monochrome, and a
live market view backed by the DexScreener REST API.

```sh
cd site
npm install
npm run dev        # http://localhost:3000
npm run build      # -> site/dist
npm run preview    # serve the built output
```

## Why it is built this way

**Pre-rendering is load-bearing, not a preference.** The same `dist/` directory must deploy
identically to Cloudflare Workers, Vercel, Railway, Google Cloud Run and GitHub Pages. SPA fallback
is four different mechanisms across those hosts plus one impossibility: GitHub Pages has no server
execution at all, and the "copy `index.html` to `404.html`" trick is undocumented folklore that
serves deep links with an HTTP 404 status. Emitting one real `index.html` per route is the only
approach that behaves the same on all five, and it suits a documentation site naturally.

There is therefore no client-side router, no hydration, and no shell page. Every page is complete
HTML on arrival. JavaScript adds the theme toggle, search, copy buttons, the read-only RPC consoles
and the charts, and every page except `/charts/` is fully readable with JavaScript disabled.

## Layout

| Path | What it is |
|---|---|
| `content/routes.mjs` | The route registry. Adding a page means adding a module here and nothing else. |
| `content/pages/*.mjs` | One module per route: metadata plus a `render()` returning the page body. |
| `content/layout.mjs` | The document shell: head, header, nav, search dialog, footer. |
| `content/ui.mjs` | Build-time HTML helpers (tables, code blocks, callouts, cards, RPC consoles). |
| `content/constants.mjs` | Verified network constants and contract addresses. |
| `scripts/build-content.mjs` | The pre-renderer. Writes the HTML tree and the search index. |
| `scripts/gen-tokens.mjs` | Generates `src/styles/tokens.css` and enforces the contrast gate. |
| `scripts/read-prompts.mjs` | Walks `../prompts/**/*.md` at build time for the `/prompts` index. |
| `scripts/serve.mjs` | Zero-dependency static server for Railway and Cloud Run. |
| `src/*.js` | Browser modules: theme, search, copy, RPC console, DexScreener client, charts. |
| `src/styles/palette.json` | The single source of truth for every colour in the site. |

Generated files (`index.html`, `start/`, `chain/`, `charts/`, `api/`, `agents/`, `prompts/`,
`deploy/`, `404.html`, `src/styles/tokens.css`, `public/search-index.json`) are gitignored. Never
edit them; edit the module that produces them and rerun `npm run gen`.

## The design system

Strict monochrome. Pure greyscale, no accent hue anywhere in the base system. Contrast, weight and
spacing carry all hierarchy.

- `src/styles/palette.json` defines the grey ramp and a list of foreground/background pairs with
  their WCAG targets. `scripts/gen-tokens.mjs` computes every ratio with the `wcag-contrast` package
  and **throws if any pair misses its target**, which fails the build. Near-greys are easy to get
  wrong by eye, so nothing here is eyeballed. 29 pairs are currently enforced.
- Light and dark are one inverted token set. `prefers-color-scheme` is the default signal, and
  `:root[data-theme="dark"]` / `:root[data-theme="light"]` overrides let the manual toggle win in
  both directions. The choice persists in `localStorage` and is applied by a blocking inline script
  before first paint, so there is no flash.
- Component CSS contains no raw colours, font sizes or pixel gaps. Everything is a token.
- **The one permitted exception** to monochrome is semantic state (error, success, warning) in code
  output panes and form validation, where greyscale would be an accessibility failure. Colour is
  never the only signal: every state pairs it with a mono icon glyph and a text label. The exception
  does not leak into links, buttons, headings, charts, badges or navigation. Documentation callouts
  are pure greyscale on purpose.

## The charts page

Live data from DexScreener, which indexes Robinhood Chain under the string chain id `robinhood`,
not the numeric 4663. Two endpoints, no API key:

```
GET https://api.dexscreener.com/latest/dex/pairs/robinhood/<pairAddress>
GET https://api.dexscreener.com/latest/dex/search?q=<query>
```

**DexScreener has no OHLCV endpoint, so the page draws no candles.** Synthesising plausible candles
from the price-change percentages would be trivial and would be a lie. Instead it renders every
field the API actually returns, plus two series that are labelled in the UI as derived:

- a volume histogram, where each bucket is one cumulative trailing window minus the next smaller
  one, clamped at zero;
- a price line, where each point is `priceUsd / (1 + change/100)` for a trailing window, which
  reconstructs where price sat when that window opened. Only the final point is a live quote.

The same numbers are always available as a real table, because a canvas is opaque to a screen
reader. Up versus down cannot be green versus red in a monochrome system, so it is two clearly
separated greys plus a printed legend and an arrow in the table.

**The default pair is a ticker-collision demo.** Robinhood Chain currently carries four separate
contracts reporting `symbol() == "USDG"`, three of which also report `name() == "Global Dollar"`.
The default pair's base token is the 18-decimal impostor, not the canonical 6-decimal USDG at
`0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168`. The page says so prominently and shows the contract
address next to every symbol it receives from the API. Resolve by address, never by ticker.

**Lightweight Charts attribution is a licence term, not a style choice.** The library is Apache 2.0
and requires crediting TradingView with a link. `layout.attributionLogo` defaults to `true` and is
left on deliberately; the page also carries a visible text link. Passing `false` is a licence
violation.

## Security boundary

Every interactive snippet on this site is **read-only**. The RPC consoles call
`https://rpc.mainnet.chain.robinhood.com` with a hard allowlist of read methods (`eth_chainId`,
`eth_blockNumber`, `eth_gasPrice`, `eth_getBalance`, `eth_getCode`, `eth_getTransactionCount`,
`eth_call`). There is no signer, no wallet connection and no write path anywhere in the site.

Input is refused before it leaves the browser if it is shaped like a 32-byte private key or a seed
phrase. Snippets that would send a transaction, and everything on the REST API page, are
copy-to-clipboard only, for the reader's own terminal.

## Search

`scripts/build-content.mjs` writes `public/search-index.json` at build time, covering every page
body and every build prompt. `src/search.js` fetches it lazily on first open and ranks client-side.
No hosted search service and no backend, which is what lets it work unchanged on GitHub Pages.
Open it with <kbd>Ctrl</kbd>/<kbd>Cmd</kbd> <kbd>K</kbd> or <kbd>/</kbd>.

## Deploying

`npm run build` is the only build command any target needs.

### Cloudflare Workers

```sh
npm run build
npx wrangler deploy
```

`wrangler.toml` sets `not_found_handling = "404-page"`. Do not switch it to
`single-page-application`: that would rewrite every unmatched path to `index.html` with an HTTP 200
and hide broken links behind the landing page.

### Vercel

```sh
npx vercel --cwd site
npx vercel --cwd site --prod
```

`vercel.json` has no `rewrites` block on purpose. Every route is a real file, so default filesystem
routing already resolves `/start/` to `start/index.html`.

### Railway and Google Cloud Run

Both give you a process. `scripts/serve.mjs` is that process: zero dependencies, correct
directory-index resolution, immutable caching for hashed assets, a real 404 status for the 404 page,
and SIGTERM draining so rolling deploys do not cut live requests. It binds `process.env.PORT`.

```sh
npm run build
PORT=8080 npm run serve

# Cloud Run, using the included Dockerfile
gcloud run deploy robinhood-toolkit-site --source site --region us-central1 --allow-unauthenticated
```

### GitHub Pages

Project sites serve from `/<reponame>/`, and GitHub's `configure-pages` action does **not** inject a
base path for Vite the way it does for Next, Nuxt, Gatsby and SvelteKit. Set it yourself:

```sh
SITE_BASE=/robinhood-toolkit/ npm run build
```

Every internal link, asset URL and the search index fetch is written through that base at build
time, so the same commit deploys to a root domain or a project path with no code change. A
`.nojekyll` file is emitted into `dist/` automatically, without which Pages runs Jekyll and silently
drops paths beginning with an underscore.

Publish `site/dist` with whatever mechanism you already use for this repository. This project does
not use GitHub Actions.

## Verifying a change

```sh
npm run gen      # regenerate pages, tokens and the search index
npm run build    # fails on any contrast-gate violation
npm run preview
```

Checks worth repeating after a design or content change, all of which were run against this build:

- every page at 320px, 768px and 1440px with no horizontal document overflow;
- every text/background pair against WCAG 2.2 AA in both themes, with CSS transitions settled;
- the theme override winning over the OS preference in both directions, and persisting across
  navigation;
- <kbd>Tab</kbd> reaching the skip link first, and a visible focus ring on every interactive element;
- the charts page reaching its populated state against the live API, and re-rendering both charts on
  a theme toggle;
- the RPC consoles returning chain ID 4663, and refusing a private-key-shaped input;
- a subpath build served under `/robinhood-toolkit/` with search and navigation intact.

## Adding a page

1. Write `content/pages/<name>.mjs` exporting `route` (path, file, nav label, title, description,
   optional `modules`) and `render({ base, prompts, routes })`.
2. Register it in `content/routes.mjs`.
3. Add its output path to `.gitignore`.
4. `npm run build`. The nav, the search index and the sitemap of real files follow automatically.

Attribution headers are required on every source and documentation file. See
[ATTRIBUTION.md](../ATTRIBUTION.md), and run `npm run check:headers` from the repository root.
