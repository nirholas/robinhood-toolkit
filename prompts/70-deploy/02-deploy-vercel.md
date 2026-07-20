<!--
  robinhood-toolkit · build prompt: deploy the site to Vercel with filesystem-routed functions
  Author: nirholas · https://github.com/nirholas/robinhood-toolkit
  License: MIT (c) 2026 nirholas
-->

# 02 · Deploy to Vercel

## Goal

Deploy the same site to Vercel, where the static bundle is served from the CDN
and every file under `api/` becomes its own serverless function. Get it working
zero-config first, then add `vercel.json` only for the behaviors that need it.

## Prerequisites

- Track `60-site` completed. `npm run build` emits to `dist/`.
- A Vercel account and `npm i -D vercel`.
- `npx vercel login`, or `VERCEL_TOKEN` in CI.
- Read the licensing note below before deploying anything you intend to monetize.

## Reference facts (verified)

- Vercel is **zero-config** when `api/` sits at the repository root. Each file
  under it is deployed as an independent function. No route table required.
- **Hobby plan limits**: 100 GB bandwidth/month, 1,000,000 function
  invocations/month, 4 CPU-hours of function compute, and a hard cap of
  **12 serverless functions per deployment**. The function cap is the one that
  bites: 13 files under `api/` fails the build, not a request.
- **Commercial use is prohibited on Hobby.** The terms bar "any Deployment that
  is used for the purpose of financial gain of anyone involved in any part of the
  production of the project." A free tutorial site is within the terms. Adding
  ads, a paid tier, sponsorship, or a lead-capture form for a business is not.
  If this site earns money in any form, you are on Pro at $20/user/month.
- The Hobby **build-minute** quota has no published figure. UNVERIFIED. Do not
  plan a CI cadence around an assumed number.

## Steps

1. Confirm the layout Vercel expects. `api/` at the root, one exported handler
   per file, and the static build in `dist/`.

```
api/
  healthz.js        -> /api/healthz
  quote.js          -> /api/quote
  chain/blocks.js   -> /api/chain/blocks
dist/               -> static output
```

2. Write handlers against the Web `Request`/`Response` signature, not the older
   `(req, res)` Node signature. Same shape as the Cloudflare Worker, which is
   what lets one codebase serve both.

```js
/**
 * robinhood-toolkit · /api/healthz
 * Author: nirholas · https://github.com/nirholas/robinhood-toolkit
 * License: MIT (c) 2026 nirholas
 */
export const config = { runtime: 'nodejs' };

export default async function handler(request) {
  const url = new URL(request.url);
  return Response.json({
    ok: true,
    path: url.pathname,
    commit: process.env.VERCEL_GIT_COMMIT_SHA ?? 'local',
    region: process.env.VERCEL_REGION ?? 'local',
  });
}
```

3. Add `vercel.json` only for what zero-config cannot infer: the output
   directory, URL shape, function duration, and the SPA fallback.

```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "outputDirectory": "dist",
  "cleanUrls": true,
  "trailingSlash": false,
  "functions": {
    "api/**/*.js": { "maxDuration": 60 }
  },
  "rewrites": [{ "source": "/(.*)", "destination": "/index.html" }]
}
```

4. Count your functions before the first deploy: `find api -name '*.js' | wc -l`.
   If the count is over 12 on Hobby, consolidate. A single `api/index.js` that
   switches on `new URL(request.url).pathname` is one function and removes the
   ceiling as a design constraint.
5. Pin Node with `engines.node` in `package.json`. Use an exact major:

```json
{ "engines": { "node": "22.x" } }
```

6. Set secrets with `npx vercel env add RH_API_KEY production`. Note that
   `vercel env pull` returns **empty values for secret-type variables**, so a
   pulled `.env` file is never proof of what production actually has. Read the
   dashboard when you need certainty.
7. Deploy a preview with `npx vercel`, then promote with `npx vercel --prod`.

## Deliverable

- `api/` handlers using the Web `Request`/`Response` signature, each with an
  attribution header.
- `vercel.json` exactly as above.
- `engines.node` pinned to `22.x`.
- A `README.md` section recording the production URL, the env vars required, and
  the function count against the 12 cap.

## How to verify

```sh
npx vercel dev                              # local, filesystem routing emulated
curl -s localhost:3000/api/healthz

npx vercel --prod
curl -s https://<project>.vercel.app/api/healthz
npx vercel logs <deployment-url>
npx vercel inspect <deployment-url>         # lists the functions actually built
```

`vercel inspect` is the authoritative check that a file under `api/` became a
function. If a route 404s, look there before touching the rewrites.

## Gotchas

- **The `rewrites` catch-all does not capture `/api/*`.** Vercel matches the
  filesystem before applying rewrites, so real functions win. Ordering only
  becomes a problem when you add `"handle": "filesystem"` phases manually. Leave
  them out.
- The 12-function cap counts built functions, not routes. A `[slug].js` dynamic
  route is one function serving many paths. Use dynamic segments rather than one
  file per route.
- `cleanUrls: true` and `trailingSlash: false` together produce `/docs/setup`
  with no slash and no `.html`. Set both explicitly. Defaults differ from the
  other four targets, and inconsistent trailing slashes break canonical links
  and relative asset paths at the same time.
- `maxDuration` above 60 seconds requires a paid plan. The field is accepted at
  build time and clamped at runtime, so a long-running handler simply gets cut
  off with no obvious error.
- Do not run `npx vercel build` in a working tree you intend to commit. It writes
  bundled output over `api/*.js` in place. If a large `api/` diff appears, check
  `head -1` of the changed files for `__defProp` and restore from git.
- `process.env.VERCEL_URL` is the deployment-specific host, not your production
  domain. Use it for preview links only; never bake it into canonical URLs.
