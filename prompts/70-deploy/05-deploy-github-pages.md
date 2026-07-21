<!-- built by nirholas x.com/nichxbt -->
<!--
  robinhood-toolkit · build prompt: publish the static site to GitHub Pages
  Author: nirholas · https://github.com/nirholas/robinhood-toolkit
  License: All Rights Reserved (c) 2026 nirholas
-->

# 05 · Deploy to GitHub Pages

## Goal

Publish the static build to GitHub Pages from a workflow, with the API calls
repointed at an external origin. Pages is the only target in this track that
executes no server code at all, which makes it the constraint that shapes the
portable design in prompt 06.

## Prerequisites

- Track `60-site` completed.
- A GitHub repository with Pages enabled: Settings, Pages, Source set to
  **GitHub Actions** (not "Deploy from a branch").
- One of the other four targets already deployed and reachable, to serve
  `/api/*`. Pages cannot serve it. Deploy prompt 01, 03, or 04 first.

## Reference facts (verified)

- **No server-side execution.** No functions, no rewrites, no redirects, no
  headers you control. Static files over CDN and nothing else.
- The modern deploy path is the `actions/configure-pages@v5` plus
  `actions/upload-pages-artifact` plus `actions/deploy-pages` trio, with
  `permissions: pages: write` and `id-token: write`, targeting a `github-pages`
  environment. The old `gh-pages` branch push still works but is the legacy path.
- **`.nojekyll` is mandatory for a Vite build.** Jekyll silently drops
  directories whose names start with an underscore. Vite emits them. Without the
  file you get a green build that serves a blank page, with no error anywhere.
  This is the single most common Pages failure.
- `actions/configure-pages` auto-injects a base path for Next, Nuxt, Gatsby, and
  SvelteKit. It does **not** do this for Vite. You set `base` yourself.
- Limits: 1 GB site size, 100 GB/month soft bandwidth limit, roughly 10 builds
  per hour. Commercial use is prohibited: Pages is not for running an online
  business or a commercial storefront.
- Pages' trailing-slash redirect semantics and the HTTP status returned for a
  custom `404.html` are UNVERIFIED. GitHub does not document either. Do not
  design routing around an assumption about them.

## Steps

1. Decide the URL shape first, because it determines `base`:
   - **Project site**, `https://<user>.github.io/<repo>/`, needs `base: '/<repo>/'`.
   - **User or org site** (`<user>.github.io` repo) or a custom domain, needs
     `base: '/'`.
   Getting this wrong yields a page that loads with every asset 404ing.

2. Make the base path build-time configurable in `vite.config.js`:

```js
/**
 * robinhood-toolkit · Vite config with deploy-target base path and API origin
 * Author: nirholas · https://github.com/nirholas/robinhood-toolkit
 * License: All Rights Reserved (c) 2026 nirholas
 */
import { defineConfig } from 'vite';

export default defineConfig({
  // '/' for custom domains and every non-Pages target; '/<repo>/' for a project site.
  base: process.env.SITE_BASE ?? '/',
  build: { outDir: 'dist' },
  define: {
    // Same origin everywhere except Pages, which must call out to a real server.
    __API_ORIGIN__: JSON.stringify(process.env.API_ORIGIN ?? ''),
  },
});
```

3. Route every client fetch through one helper so the origin swap is a single
   build-time decision rather than a find-and-replace:

```js
/**
 * robinhood-toolkit · API base resolution
 * Author: nirholas · https://github.com/nirholas/robinhood-toolkit
 * License: All Rights Reserved (c) 2026 nirholas
 */
const ORIGIN = __API_ORIGIN__; // '' means same-origin

export function apiUrl(path) {
  return `${ORIGIN}${path.startsWith('/') ? path : `/${path}`}`;
}

export async function apiFetch(path, init) {
  const res = await fetch(apiUrl(path), init);
  if (!res.ok) throw new Error(`${path} failed: ${res.status}`);
  return res.json();
}
```

4. Add `public/.nojekyll` as an empty file. It must be in the published
   artifact, so put it in `public/` where Vite copies it to `dist/` verbatim. Do
   not create it in `dist/` by hand; the build wipes that directory.
5. Write `.github/workflows/pages.yml`:

```yaml
# robinhood-toolkit · GitHub Pages build and deploy
# Author: nirholas · https://github.com/nirholas/robinhood-toolkit
# License: All Rights Reserved (c) 2026 nirholas
name: Deploy to GitHub Pages

on:
  push:
    branches: [main]
  workflow_dispatch:

permissions:
  contents: read
  pages: write
  id-token: write

concurrency:
  group: pages
  cancel-in-progress: false

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
      - run: npm ci
      - name: Build
        env:
          SITE_BASE: /${{ github.event.repository.name }}/
          API_ORIGIN: ${{ vars.API_ORIGIN }}
        run: npm run build
      - uses: actions/configure-pages@v5
      - uses: actions/upload-pages-artifact@v3
        with:
          path: dist

  deploy:
    needs: build
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    steps:
      - id: deployment
        uses: actions/deploy-pages@v4
```

6. Set the repository variable `API_ORIGIN` (Settings, Secrets and variables,
   Actions, Variables) to the origin of a deployed target from prompt 01, 03, or
   04. It is a variable, not a secret: it is a public URL and it gets baked into
   client JavaScript regardless.
7. Add CORS on that origin. The API server must send
   `Access-Control-Allow-Origin` for the Pages host and answer `OPTIONS`
   preflights, or every request fails in the browser while `curl` succeeds.
8. For a custom domain, add `public/CNAME` containing the hostname, and set the
   DNS records GitHub specifies. Then set `SITE_BASE` back to `/`.

## Deliverable

- `.github/workflows/pages.yml` exactly as above.
- `public/.nojekyll`, empty and committed.
- `vite.config.js` with configurable `base` and `__API_ORIGIN__`.
- `src/api.js` with `apiUrl` and `apiFetch`, and no bare `fetch('/api/...')`
  anywhere else in the client.
- CORS allowlisting the Pages origin on the API server, committed in that
  server's code.

## How to verify

```sh
# reproduce the Pages build locally before pushing
SITE_BASE=/robinhood-toolkit/ API_ORIGIN=https://api.example.com npm run build
ls dist/.nojekyll                      # must exist
grep -r 'api.example.com' dist/assets | head -1   # origin was baked in
npx serve dist                         # asset paths resolve under the base
```

After the workflow runs, load the Pages URL, open DevTools, and check three
things: no 404s on assets (base path is right), the API calls go to the external
origin (origin injection worked), and no CORS errors in the console. Then load a
deep link directly rather than by navigating to it, since that is the path that
exposes any missing pre-rendered page.

## Gotchas

- **The blank-page-with-a-green-check failure is always `.nojekyll`.** Check it
  before anything else.
- `SITE_BASE` must have a **leading and trailing slash**: `/repo/`. Vite treats
  `repo/` as relative and emits paths that break on nested routes.
- The workflow bakes `API_ORIGIN` into the bundle at build time. Changing the
  variable requires a rebuild; there is no runtime config on Pages.
- Anything secret in the client bundle is public. Pages has no server, so there
  is nowhere to hide a key. Every API the Pages build calls must be safe to call
  from an anonymous browser, rate-limited server-side.
- The "copy `index.html` to `404.html`" SPA trick is community folklore. GitHub
  does not document it, and it serves deep links with an HTTP 404 status, which
  search engines act on. Prompt 06 recommends pre-rendering instead.
- A repository set to "Deploy from a branch" ignores this workflow entirely and
  the run succeeds while nothing changes. Confirm the source is GitHub Actions.
- Commercial use is prohibited. If the site monetizes, use one of the other four
  targets.
<!-- built by nirholas x.com/nichxbt -->
