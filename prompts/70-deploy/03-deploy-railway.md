<!--
  robinhood-toolkit · build prompt: deploy the Node server to Railway with Railpack
  Author: nirholas · https://github.com/nirholas/robinhood-toolkit
  License: MIT (c) 2026 nirholas
-->

# 03 · Deploy to Railway

## Goal

Run the site as a single long-lived Node process on Railway. One container
serves the static build and mounts `api/**` itself. This is the first target in
the track with a real server, and the artifact you build here ports to Cloud Run
in prompt 04 with no code changes.

## Prerequisites

- Track `60-site` completed.
- A Railway account and `npm i -D @railway/cli`.
- `npx railway login`, then `npx railway link` inside the repo.
- A payment method on file. Read the cost section before deploying; the free
  credit does not cover an always-on process.

## Reference facts (verified)

- Railway's default builder is **Railpack**, not Nixpacks. Nixpacks is the older
  builder and is still selectable, but new projects get Railpack. Guides that
  say "Railway uses Nixpacks" are out of date.
- Railway injects `PORT`. Bind to it. Bind to `0.0.0.0`, never `127.0.0.1`, or
  the healthcheck fails while the process looks healthy in the logs.
- **Cost, stated plainly.** A free plan exists with $1 of credit per month. At
  $10 per GB of RAM per month, a 512 MB always-on Node process consumes roughly
  $5/month, exhausting $1 in about five days. Treat Railway as a **$5/month**
  target. It is not a free tier for a long-lived process, whatever the plan page
  implies.
- Whether Railway bills while a service is asleep is UNVERIFIED. Do not rely on
  sleep to bring the bill under the free credit.
- Healthchecks: Railway polls `healthcheckPath` before routing traffic to a new
  deployment. Without one you get zero-downtime deploys that route to a process
  still booting.

## Steps

1. Write the portable server. This exact file is also the Cloud Run entry point
   in prompt 04 and the local dev server. It is the center of gravity for the
   whole track.

```js
/**
 * robinhood-toolkit · portable Node server: static bundle + api/** on one origin
 * Author: nirholas · https://github.com/nirholas/robinhood-toolkit
 * License: MIT (c) 2026 nirholas
 */
import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { handleApi } from '../api/router.js';

const PORT = Number(process.env.PORT) || 8080;
const ROOT = join(process.cwd(), 'dist');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.png': 'image/png',
  '.webp': 'image/webp',
};

/** Resolve a URL path to a file inside ROOT, or null. Directory-style output. */
async function resolveFile(pathname) {
  const clean = normalize(decodeURIComponent(pathname)).replace(/^(\.\.[/\\])+/, '');
  const candidates = clean.endsWith('/')
    ? [join(ROOT, clean, 'index.html')]
    : [join(ROOT, clean), join(ROOT, `${clean}.html`), join(ROOT, clean, 'index.html')];

  for (const file of candidates) {
    if (!file.startsWith(ROOT)) continue; // path traversal guard
    try {
      const s = await stat(file);
      if (s.isFile()) return file;
    } catch {
      /* next candidate */
    }
  }
  return null;
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host ?? 'localhost'}`);

  if (url.pathname === '/api/healthz') {
    res.writeHead(200, { 'content-type': 'application/json' });
    return res.end(JSON.stringify({ ok: true, uptime: process.uptime() }));
  }

  if (url.pathname.startsWith('/api/')) {
    try {
      const response = await handleApi(new Request(url, { method: req.method, headers: req.headers }));
      res.writeHead(response.status, Object.fromEntries(response.headers));
      return res.end(Buffer.from(await response.arrayBuffer()));
    } catch (err) {
      console.error('[api]', url.pathname, err?.message);
      res.writeHead(502, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ error: 'upstream_failed' }));
    }
  }

  const file = await resolveFile(url.pathname);
  if (!file) {
    res.writeHead(404, { 'content-type': 'text/html; charset=utf-8' });
    return res.end('<!doctype html><title>404</title><h1>404</h1>');
  }

  const immutable = /\.[0-9a-f]{8,}\./.test(file); // hashed asset filenames
  res.writeHead(200, {
    'content-type': MIME[extname(file)] ?? 'application/octet-stream',
    'cache-control': immutable ? 'public, max-age=31536000, immutable' : 'public, max-age=0, must-revalidate',
  });
  createReadStream(file).pipe(res);
});

server.listen(PORT, '0.0.0.0', () => console.log(`[server] listening on 0.0.0.0:${PORT}`));

// Railway and Cloud Run both send SIGTERM. Drain, do not drop.
process.on('SIGTERM', () => server.close(() => process.exit(0)));
```

2. Write `railway.json` at the repo root.

```json
{
  "$schema": "https://railway.com/railway.schema.json",
  "build": {
    "builder": "RAILPACK",
    "buildCommand": "npm run build"
  },
  "deploy": {
    "startCommand": "node server/index.mjs",
    "healthcheckPath": "/api/healthz",
    "restartPolicyType": "ON_FAILURE"
  }
}
```

3. Pin Node in `package.json` with `"engines": { "node": "22.x" }`. Railpack
   reads it. An exact major is the one form every builder in this track agrees
   on.
4. Set variables: `npx railway variables --set RH_API_KEY=...`. Railway variables
   are per service and per environment. Reference a database's connection string
   with `${{Postgres.DATABASE_URL}}` rather than pasting a literal.
5. Deploy with `npx railway up`, then `npx railway domain` to get a public
   `*.up.railway.app` hostname, or attach a custom domain from the dashboard.

## Deliverable

- `server/index.mjs` exactly as above, with the attribution header.
- `railway.json` exactly as above.
- `engines.node` pinned to `22.x`.
- A `README.md` section stating the deployed URL, the required variables, and
  the honest monthly cost estimate for the chosen memory limit.

## How to verify

```sh
PORT=8080 node server/index.mjs
curl -s localhost:8080/api/healthz
curl -s -o /dev/null -w '%{http_code}\n' localhost:8080/docs/setup

npx railway up
npx railway logs
curl -s https://<service>.up.railway.app/api/healthz
```

Then confirm the healthcheck is actually gating: deploy a build with a
deliberately broken `startCommand` and check that Railway marks the deployment
failed and keeps the previous one serving traffic. If the broken build goes
live, `healthcheckPath` is not wired.

## Gotchas

- **Binding to `127.0.0.1` is the classic Railway failure.** The process starts,
  logs "listening", and every healthcheck times out. Bind `0.0.0.0`.
- Do not hardcode a port. Read `process.env.PORT` with a fallback and never set
  `PORT` yourself as a service variable.
- `npm run build` must be able to run with devDependencies present. Railpack
  installs them for the build stage, but if you have set `NPM_CONFIG_PRODUCTION`
  or `NODE_ENV=production` as a service variable, the Vite build fails with a
  missing-module error that reads like a broken lockfile.
- Railway restarts on crash under `ON_FAILURE`. Combined with an agent process
  that trades, that is a crash loop with real money attached. Anything from
  track `50-autonomous` needs the lease and crash-loop guard from prompt 50/07
  before it goes on a restarting platform.
- The healthcheck path must be served by your app, not by a static file. If
  `/api/healthz` is resolved from `dist/`, the check passes while the API layer
  is dead.
- Memory is what you pay for. Set an explicit limit in the service settings
  rather than leaving it to default, or a leak turns into an invoice.
