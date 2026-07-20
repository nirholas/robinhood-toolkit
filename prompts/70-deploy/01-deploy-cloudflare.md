<!--
  robinhood-toolkit · build prompt: deploy the site to Cloudflare Workers with static assets
  Author: nirholas · https://github.com/nirholas/robinhood-toolkit
  License: MIT (c) 2026 nirholas
-->

# 01 · Deploy to Cloudflare

## Goal

Put the tutorial site and its `/api/*` endpoints on Cloudflare Workers with
static assets, deployed by Wrangler from the command line. One Worker serves the
prebuilt static bundle and handles API routes on the same origin, so no CORS
layer is needed.

## Prerequisites

- Track `60-site` completed. `npm run build` emits a static bundle to `dist/`.
- A Cloudflare account. Free plan is sufficient.
- `npm i -D wrangler`. Do not install it globally; the config `$schema` path
  below resolves against the local `node_modules`.
- `npx wrangler login`, or a `CLOUDFLARE_API_TOKEN` env var for CI.

## Reference facts (verified)

- **Cloudflare Pages is not deprecated.** There is no deprecation notice on the
  Pages docs. What is deprecated is **Workers Sites**, an older and separate
  product. Do not confuse the two when reading old blog posts.
- This prompt recommends **Workers with static assets** over Pages for one
  concrete reason: it supports serving assets from non-root paths, which the
  tutorial site's nested routes need.
- By default a Worker with an `assets` binding serves a matching static file
  **before** it invokes your script. `run_worker_first` is what inverts that for
  chosen routes. Omitting it is the single most common cause of an API route
  returning HTML.
- `nodejs_compat` requires `compatibility_date` of `2024-09-23` or later.
- Free plan: 100,000 requests/day, 128 MB memory, and **10 ms CPU time per
  request**. The CPU ceiling is the tightest constraint across all five targets
  in this track. Wall-clock time waiting on `fetch` does not count against it;
  your own compute does.
- Cloudflare Pages bandwidth and request limits are UNVERIFIED. Cloudflare does
  not publish figures for them. Do not quote a number.

## Steps

1. Write `wrangler.jsonc` at the repo root. JSONC is the current format and
   supports comments; `wrangler.toml` still works but is the older shape.

```jsonc
// robinhood-toolkit · Cloudflare Worker + static assets config
// Author: nirholas · https://github.com/nirholas/robinhood-toolkit
// License: MIT (c) 2026 nirholas
{
  "$schema": "./node_modules/wrangler/config-schema.json",
  "name": "robinhood-toolkit-site",
  "main": "src/worker.js",
  "compatibility_date": "2026-07-20",
  "compatibility_flags": ["nodejs_compat"],
  "assets": {
    "directory": "./dist/",
    "binding": "ASSETS",
    "run_worker_first": ["/api/*"],
    "not_found_handling": "single-page-application"
  }
}
```

2. Write `src/worker.js`. It handles `/api/*` and delegates everything else to
   the `ASSETS` binding. Keep the API handlers themselves in `api/` so the same
   modules load unchanged on the Node targets in prompts 03 and 04.

```js
/**
 * robinhood-toolkit · Cloudflare Worker entry
 * Author: nirholas · https://github.com/nirholas/robinhood-toolkit
 * License: MIT (c) 2026 nirholas
 */
import { handleApi } from '../api/router.js';

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname.startsWith('/api/')) {
      try {
        return await handleApi(request, env, ctx);
      } catch (err) {
        // Boundary: never leak a stack trace to a browser.
        console.error('[api]', url.pathname, err?.message);
        return Response.json({ error: 'upstream_failed' }, { status: 502 });
      }
    }

    // Anything else is a static asset or the SPA fallback.
    return env.ASSETS.fetch(request);
  },
};
```

3. Keep `api/router.js` on Web-standard APIs only: `Request`, `Response`,
   `fetch`, `URL`, `crypto.subtle`. Reach for `nodejs_compat` (`node:buffer`,
   `node:crypto`) only where a dependency demands it. Code written to the
   platform standard is what makes prompt 06 possible.
4. Move every secret to Worker secrets. `npx wrangler secret put RH_API_KEY`
   stores it encrypted and exposes it on `env`. Never place a key in the `vars`
   block of `wrangler.jsonc`; that file is committed.
5. Add scripts to `package.json`:

```json
{
  "scripts": {
    "cf:dev": "wrangler dev",
    "cf:deploy": "npm run build && wrangler deploy"
  }
}
```

6. Deploy: `npm run cf:deploy`. Wrangler prints the
   `*.workers.dev` URL. Attach a custom domain from the Workers dashboard, or
   add a `routes` array to the config once the zone is on Cloudflare.

## Deliverable

- `wrangler.jsonc` exactly as above, with `run_worker_first` present.
- `src/worker.js` with the attribution header, delegating to `api/router.js`.
- `cf:dev` and `cf:deploy` scripts in `package.json`.
- A `README.md` section documenting the deployed URL, which secrets the Worker
  needs, and how to roll back (`wrangler rollback`).

## How to verify

```sh
npx wrangler dev            # local, http://localhost:8787
curl -s localhost:8787/api/healthz          # JSON, not HTML
curl -s -o /dev/null -w '%{http_code}\n' localhost:8787/some/deep/route  # 200
```

After deploy:

```sh
curl -s https://<name>.<subdomain>.workers.dev/api/healthz
npx wrangler tail           # live logs, confirms the Worker is invoked at all
npx wrangler deployments list
```

If `/api/healthz` returns your `index.html`, `run_worker_first` is missing or
misspelled. That is the failure mode to check first, every time.

## Gotchas

- **The 10 ms CPU limit is real and it is per request.** Signature verification,
  large JSON parses, and templating loops can exceed it. Push heavy work to an
  upstream API you `fetch`, which costs wall time rather than CPU time.
- `not_found_handling: "single-page-application"` returns `index.html` with a
  200 status for unmatched paths. That is correct for an app and wrong for a
  docs site where a genuinely missing page should 404. Prompt 06 recommends
  pre-rendering, which sidesteps the choice entirely.
- `nodejs_compat` without a `compatibility_date` of 2024-09-23 or later fails at
  deploy time with an error that does not name the date. Check the date field
  before debugging your imports.
- Workers are not Node. No `fs`, no `path`, no listening sockets. A dependency
  that touches the filesystem at import time fails at deploy, not at runtime.
- `wrangler dev --remote` runs against the real edge with real bindings; plain
  `wrangler dev` runs locally in workerd. Behavior differs around caching and
  geolocation headers. Verify anything origin-sensitive with `--remote`.
- Secrets set with `wrangler secret put` are per Worker per environment. Adding
  a named environment later means setting them again for that environment.
