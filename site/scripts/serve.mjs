/**
 * robinhood-toolkit · static file server for the process-model targets
 * Author: nirholas · https://github.com/nirholas/robinhood-toolkit
 * License: MIT (c) 2026 nirholas
 *
 * Railway and Google Cloud Run both give you a container and expect you to own
 * the HTTP server. This is that server: zero dependencies, serves dist/ with
 * correct directory-index resolution, immutable caching for content-hashed
 * assets, revalidation for HTML, a real 404 page with a real 404 status, and a
 * clean SIGTERM shutdown so a rolling deploy does not cut live requests.
 *
 *   PORT=8080 node scripts/serve.mjs
 */

import { createReadStream, existsSync, statSync } from 'node:fs'
import { createServer } from 'node:http'
import { dirname, extname, join, normalize, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const DIST = resolve(process.env.STATIC_DIR || join(here, '../dist'))
const PORT = Number(process.env.PORT || 8080)
const HOST = process.env.HOST || '0.0.0.0'

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json; charset=utf-8'
}

/** Resolve a URL path to a file inside DIST, or null. Blocks traversal. */
function resolveFile(urlPath) {
  const decoded = decodeURIComponent(urlPath.split('?')[0])
  const candidate = resolve(join(DIST, normalize(decoded)))
  if (candidate !== DIST && !candidate.startsWith(DIST + '/')) return null

  if (existsSync(candidate)) {
    const stat = statSync(candidate)
    if (stat.isFile()) return candidate
    // Directory: serve its index.html. This is what makes /start/ work without
    // any rewrite rule, on every target, identically.
    const index = join(candidate, 'index.html')
    if (existsSync(index)) return index
  }

  // /start -> /start/index.html, so a missing trailing slash still resolves.
  const withIndex = `${candidate}/index.html`
  if (existsSync(withIndex)) return withIndex

  return null
}

function cacheControl(file) {
  // Vite emits content-hashed filenames into assets/, so those are immutable.
  if (/\/assets\/[^/]+\.[0-9a-f]{8,}\./.test(file)) return 'public, max-age=31536000, immutable'
  if (file.endsWith('.html')) return 'public, max-age=0, must-revalidate'
  return 'public, max-age=3600'
}

function send(res, status, file) {
  const type = MIME[extname(file)] || 'application/octet-stream'
  res.writeHead(status, {
    'content-type': type,
    'content-length': statSync(file).size,
    'cache-control': cacheControl(file),
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'strict-origin-when-cross-origin'
  })
  createReadStream(file).pipe(res)
}

const server = createServer((req, res) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { allow: 'GET, HEAD', 'content-type': 'text/plain; charset=utf-8' })
    res.end('Method not allowed\n')
    return
  }

  if (req.url === '/healthz') {
    res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' })
    res.end('ok\n')
    return
  }

  const file = resolveFile(req.url || '/')
  if (file) {
    send(res, 200, file)
    return
  }

  // A genuine 404, with the 404 page as the body. Not an index.html rewrite:
  // this site has a real file per route, so an unmatched path really is missing.
  const notFound = join(DIST, '404.html')
  if (existsSync(notFound)) {
    send(res, 404, notFound)
    return
  }
  res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
  res.end('Not found\n')
})

if (!existsSync(DIST)) {
  console.error(`No build output at ${DIST}. Run "npm run build" first.`)
  process.exit(1)
}

server.listen(PORT, HOST, () => {
  console.log(`serving ${DIST} on http://${HOST}:${PORT}`)
})

// Both platforms send SIGTERM and then wait. Draining here is the difference
// between a clean rolling deploy and a handful of dropped requests per release.
for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, () => {
    console.log(`${signal} received, draining connections`)
    server.close(() => process.exit(0))
    setTimeout(() => process.exit(0), 10_000).unref()
  })
}
