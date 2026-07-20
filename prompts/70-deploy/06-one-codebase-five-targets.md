<!--
  robinhood-toolkit · build prompt: one codebase that deploys to all five targets
  Author: nirholas · https://github.com/nirholas/robinhood-toolkit
  License: MIT (c) 2026 nirholas
-->

# 06 · One codebase, five targets

## Goal

Make prompts 01 through 05 five deploy commands against **one** repository, not
five forks. You will pick the portable shape, adapt it at the edges, and prove
portability with a matrix check that catches drift before a deploy does.

This is the load-bearing prompt in the track. The other five each describe a
platform; this one describes the design that survives all of them.

## Prerequisites

- Prompts 01 through 05 read. At least two of them deployed, ideally one
  filesystem-routed target (Cloudflare or Vercel) and one process target
  (Railway or Cloud Run), because that pair exposes every real incompatibility.
- Track `60-site` completed.

## Reference facts (verified)

### The three execution models

Every target in this track is one of three things. Design decisions follow from
which one, and almost nothing else about the platform matters.

| Model | Targets | What it means for you |
|---|---|---|
| Filesystem-routed functions | Vercel (`api/` directory), Cloudflare (`functions/` or a Worker) | Routes come from file paths. No server to write. Per-request isolate, no shared memory. |
| One long-running process | Railway, Cloud Run | You write and own the HTTP server. Shared memory between requests. You handle routing, static files, and SIGTERM. |
| No server execution at all | GitHub Pages | Static files only. Every dynamic call leaves the origin. |

### The portable shape

**A single Node server that serves the built static directory and mounts
`api/**` itself.**

That artifact:

- ports to **Railway** and **Cloud Run** unchanged, because both are exactly this
  model,
- wraps into a **Cloudflare Worker** with a thin shim, because the Worker
  delegates static files to the `ASSETS` binding and calls the same API router,
- decomposes into **Vercel's** `api/` convention, because each handler is already
  an independent Web-standard function,
- and degrades to **GitHub Pages** as the static build alone, with API calls
  repointed at an absolute external origin.

The direction matters. A server decomposes into functions. Functions do not
compose back into a server without a rewrite. Build the server.

### The five cross-target gotchas

1. **API origin.** Four targets serve `/api/*` same-origin. Pages cannot. The
   fix is a build-time-injected base URL plus CORS on the real origin. Design
   for it from the start; retrofitting it means touching every fetch call site.
2. **Base path.** Only GitHub Pages **project sites** impose a `/reponame/`
   prefix. `actions/configure-pages` auto-injects the base path for Next, Nuxt,
   Gatsby, and SvelteKit, but **not for Vite**. You set `base` yourself.
3. **SPA fallback is four different mechanisms plus one impossibility.**
   `not_found_handling` (Cloudflare), `rewrites` (Vercel), a `try_files`
   equivalent in your own server (Railway, Cloud Run), and nothing real on
   Pages. The "copy `index.html` to `404.html`" trick is community folklore,
   undocumented by GitHub, and serves deep links with an HTTP 404 status.
   **Pre-rendering one real `index.html` per route is the only approach that
   works identically on all five**, and it suits a tutorial site naturally.
   Pre-render.
4. **Node pinning.** Use `engines.node` with an exact major, `"22.x"`. It is the
   one field honored by Vercel, Railpack, and GCP buildpacks alike. Avoid `>=`
   ranges: Vercel resolves them to the newest major while the others read them
   conservatively, so the same range gives you different runtimes per target.
5. **Trailing slashes.** The defaults genuinely differ across targets, and Pages'
   behavior is undocumented. Set it explicitly wherever it is settable, and
   prefer directory-style output (`/docs/setup/index.html`), which is the only
   form all five serve the same way.

## Steps

1. Fix the repository layout. Every target reads from this one tree.

```
api/
  router.js          # Web Request -> Response. The only place API logic lives.
  handlers/*.js      # one module per endpoint, imported by the router
server/
  index.mjs          # Node server: static dist/ + api/**  (prompt 03)
src/
  worker.js          # Cloudflare shim: ASSETS binding + handleApi  (prompt 01)
  api.js             # client-side apiUrl/apiFetch  (prompt 05)
site/                # source pages
dist/                # build output, gitignored
```

2. Write `api/router.js` against Web standards only: `Request`, `Response`,
   `URL`, `fetch`, `crypto.subtle`. No `fs`, no `process.cwd()`, no
   `require`. This module is the single point of API truth, imported by the
   Worker, by the Node server, and by each Vercel function.

```js
/**
 * robinhood-toolkit · portable API router
 * Author: nirholas · https://github.com/nirholas/robinhood-toolkit
 * License: MIT (c) 2026 nirholas
 */
import { healthz } from './handlers/healthz.js';
import { quote } from './handlers/quote.js';
import { blocks } from './handlers/blocks.js';

const ROUTES = new Map([
  ['/api/healthz', healthz],
  ['/api/quote', quote],
  ['/api/chain/blocks', blocks],
]);

/**
 * env is Cloudflare's binding object; on Node targets pass process.env.
 * Handlers must never read process.env directly, or they break on Workers.
 */
export async function handleApi(request, env = globalThis.process?.env ?? {}, ctx) {
  const { pathname } = new URL(request.url);
  const handler = ROUTES.get(pathname.replace(/\/$/, '') || pathname);

  if (!handler) return Response.json({ error: 'not_found', path: pathname }, { status: 404 });
  if (request.method === 'OPTIONS') return cors(new Response(null, { status: 204 }), request);

  return cors(await handler(request, env, ctx), request);
}

/** Same-origin on four targets; only GitHub Pages actually needs these headers. */
const ALLOWED = (origin) => {
  const list = (globalThis.SITE_ORIGINS ?? '').split(',').filter(Boolean);
  return list.includes(origin);
};

function cors(response, request) {
  const origin = request.headers.get('origin');
  if (!origin || !ALLOWED(origin)) return response;
  const headers = new Headers(response.headers);
  headers.set('access-control-allow-origin', origin);
  headers.set('access-control-allow-methods', 'GET,POST,OPTIONS');
  headers.set('access-control-allow-headers', 'content-type');
  headers.set('vary', 'origin');
  return new Response(response.body, { status: response.status, headers });
}
```

3. Adapt at the edges, never in the middle. Three files, each under 30 lines:
   - `src/worker.js` (prompt 01) calls `handleApi`, delegates the rest to `ASSETS`.
   - `server/index.mjs` (prompt 03) calls `handleApi`, serves `dist/` itself.
   - `api/<route>.js` on Vercel: a one-line re-export per route.

```js
/**
 * robinhood-toolkit · Vercel function shim for /api/quote
 * Author: nirholas · https://github.com/nirholas/robinhood-toolkit
 * License: MIT (c) 2026 nirholas
 */
import { quote } from './handlers/quote.js';
export const config = { runtime: 'nodejs' };
export default (request) => quote(request, process.env);
```

4. **Pre-render every route.** This is gotcha 3's resolution and it removes four
   different fallback mechanisms from the problem. Emit a real
   `dist/<route>/index.html` for each page at build time. Directory-style output
   also settles gotcha 5: every target serves `/docs/setup/` from
   `/docs/setup/index.html` identically, and no rewrite rule is involved.
   Then `not_found_handling` and the Vercel catch-all `rewrites` become a
   backstop for genuinely missing pages rather than the primary routing path.

5. Make the two build-time variables the only per-target difference:

| Variable | Cloudflare | Vercel | Railway | Cloud Run | Pages |
|---|---|---|---|---|---|
| `SITE_BASE` | `/` | `/` | `/` | `/` | `/<repo>/` or `/` |
| `API_ORIGIN` | `''` | `''` | `''` | `''` | absolute URL |

Everything else, all routing, all handlers, all client code, is identical.

6. Pin the runtime once, in `package.json`, and let all four builders read it:

```json
{
  "engines": { "node": "22.x" },
  "scripts": {
    "build": "node scripts/prerender.mjs && vite build",
    "start": "node server/index.mjs",
    "deploy:cf": "npm run build && wrangler deploy",
    "deploy:vercel": "vercel --prod",
    "deploy:railway": "railway up",
    "deploy:gcp": "npm run build && gcloud run deploy robinhood-toolkit-site --source . --region us-central1 --allow-unauthenticated",
    "verify:matrix": "node scripts/verify-targets.mjs"
  }
}
```

7. Write `scripts/verify-targets.mjs`: it hits the same assertion set against
   every deployed URL, so drift shows up as a failed check rather than as a
   support message.

```js
/**
 * robinhood-toolkit · cross-target parity check
 * Author: nirholas · https://github.com/nirholas/robinhood-toolkit
 * License: MIT (c) 2026 nirholas
 */
const TARGETS = Object.entries({
  cloudflare: process.env.URL_CLOUDFLARE,
  vercel: process.env.URL_VERCEL,
  railway: process.env.URL_RAILWAY,
  cloudrun: process.env.URL_CLOUDRUN,
  pages: process.env.URL_PAGES,
}).filter(([, url]) => Boolean(url));

// Pages has no server, so its API assertions run against API_ORIGIN instead.
const API_ORIGIN = process.env.API_ORIGIN ?? '';

const checks = [
  { name: 'home 200', path: '/', expect: (r) => r.status === 200 },
  { name: 'deep route 200', path: '/docs/setup/', expect: (r) => r.status === 200 },
  { name: 'missing route 404', path: '/nope-not-a-page/', expect: (r) => r.status === 404 },
  { name: 'asset content-type', path: '/favicon.svg', expect: (r) => r.headers.get('content-type')?.includes('svg') },
];

const apiChecks = [
  { name: 'healthz json', path: '/api/healthz', expect: async (r) => r.ok && (await r.json()).ok === true },
];

let failed = 0;

for (const [target, base] of TARGETS) {
  for (const check of checks) {
    const res = await fetch(new URL(check.path, base), { redirect: 'manual' });
    const ok = await check.expect(res);
    if (!ok) failed++;
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${target.padEnd(11)} ${check.name} (${res.status})`);
  }

  const apiBase = target === 'pages' ? API_ORIGIN : base;
  if (!apiBase) {
    console.log(`SKIP  ${target.padEnd(11)} api checks (no API_ORIGIN set)`);
    continue;
  }
  for (const check of apiChecks) {
    const res = await fetch(new URL(check.path, apiBase));
    const ok = await check.expect(res);
    if (!ok) failed++;
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${target.padEnd(11)} ${check.name} (${res.status})`);
  }
}

if (failed) {
  console.error(`\n${failed} parity check(s) failed.`);
  process.exit(1);
}
console.log('\nAll targets agree.');
```

Note the `missing route 404` check. On a target configured with an SPA fallback
it returns 200 and fails, which is the point: it tells you the fallback is
masking missing pages rather than pre-rendering them.

## Deliverable

- One repository deploying to all five targets with no branching per platform
  outside `src/worker.js`, `server/index.mjs`, and the Vercel `api/` shims.
- `api/router.js` written to Web standards, with zero Node-only imports.
- `scripts/prerender.mjs` emitting one real `index.html` per route in
  directory-style output.
- `scripts/verify-targets.mjs` and a `verify:matrix` script.
- A `docs/deploy.md` with the target comparison table below, the two build-time
  variables, and a one-line recommendation per use case.

| | Cloudflare | Vercel | Railway | Cloud Run | Pages |
|---|---|---|---|---|---|
| Model | functions | functions | process | process | static |
| Free tier | 100k req/day | 100 GB, 1M inv | ~$1 credit | 2M req/mo | 100 GB/mo |
| Real cost at rest | $0 | $0 | ~$5/mo | $0 | $0 |
| Hard constraint | 10 ms CPU/req | 12 functions | always-on billing | cold starts | no server |
| Commercial use | allowed | **prohibited on Hobby** | allowed | allowed | **prohibited** |
| Server code | shim | per-file | full | full | none |

## How to verify

```sh
# one build, five deploys, one assertion set
npm run build
npm run deploy:cf && npm run deploy:vercel && npm run deploy:railway && npm run deploy:gcp
git push origin main            # triggers the Pages workflow

URL_CLOUDFLARE=https://... \
URL_VERCEL=https://... \
URL_RAILWAY=https://... \
URL_CLOUDRUN=https://... \
URL_PAGES=https://... \
API_ORIGIN=https://... \
npm run verify:matrix
```

Then run the three checks the matrix cannot make for you:

1. `git grep -n "fetch('/api" src/` returns nothing. Every client call goes
   through `apiFetch`, or the Pages build silently calls a non-existent origin.
2. `git grep -nE "process\.env|node:" api/router.js api/handlers/` returns
   nothing. A Node-only import there breaks the Worker at deploy, not at test.
3. Load a deep link directly on all five (paste the URL, do not navigate to it).
   This is the path that exposes a missing pre-rendered page, and it is the one
   in-app navigation never exercises.

## Gotchas

- **Building for the strictest target first is cheaper than retrofitting.** The
  strictest is Cloudflare on runtime (10 ms CPU, no Node built-ins) and Pages on
  architecture (no server). Satisfy both and the other three are free. Do it the
  other way and you rewrite the API layer.
- Shared in-process state works on Railway and Cloud Run and silently does not
  on Cloudflare and Vercel, where each request may get a fresh isolate. An
  in-memory cache is not a bug on two targets and a correctness failure on the
  other two. Put shared state in an external store or design without it.
- Background work after the response is sent is a per-platform API:
  `ctx.waitUntil` on Cloudflare, `waitUntil` on Vercel, a plain promise on the
  process targets, and impossible on Pages. Do not scatter it; if you need it,
  put it behind one adapter function.
- `--set-env-vars` on Cloud Run wipes the whole environment (prompt 04) while
  `wrangler secret put` and `vercel env add` are additive. The same conceptual
  action is destructive on exactly one target. Script the deploys so nobody
  types the destructive form from memory.
- Do not let the Vercel 12-function cap shape the router. Consolidating routes
  into one entry point is the right design anyway and it removes the cap as a
  concern, but consolidate because it is a better structure, not to squeak under
  a plan limit.
- Cache-control differs per target by default. Set it explicitly in
  `server/index.mjs`, in the Worker, and in `vercel.json` headers, or hashed
  assets get revalidated on some targets and HTML gets cached on others.
- Deploy all five from the same commit or the parity check is meaningless. A
  matrix run against mixed commits reports failures that are just staleness, and
  chasing those is how people stop running the check.
