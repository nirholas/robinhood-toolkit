/**
 * robinhood-toolkit · deploy targets page content
 * Author: nirholas · https://github.com/nirholas/robinhood-toolkit
 * License: MIT (c) 2026 nirholas
 */

import { callout, code, esc, href, list, p, pager, section, table } from '../ui.mjs'

export const route = {
  path: '/deploy/',
  file: 'deploy/index.html',
  nav: 'Deploy',
  title: 'Deploy to five targets',
  description:
    'One dist/ directory, five hosts: Cloudflare Workers, Vercel, Railway, Google Cloud Run and GitHub Pages, with the routing gotcha that breaks a naive port between them.'
}

export function render({ base }) {
  return `
<div class="page-head">
  <p class="eyebrow">Deploy</p>
  <h1>One codebase, five targets</h1>
  <p class="lede">
    This site is built to deploy identically to Cloudflare Workers, Vercel, Railway, Google Cloud Run
    and GitHub Pages. Every config below is real and lives in the repo. The architecture is not an
    accident: one constraint decides the whole thing.
  </p>
</div>

${section(
  'models',
  'Three execution models, not five platforms',
  p(
    'Every target is one of three things, and almost nothing else about the platform matters to your',
    'design.'
  ),
  table({
    head: ['Model', 'Targets', 'What it means for you'],
    rows: [
      [
        'Filesystem-routed functions',
        'Vercel, Cloudflare',
        'Routes come from file paths. No server to write. Per-request isolate, no shared memory.'
      ],
      [
        'One long-running process',
        'Railway, Cloud Run',
        'You write and own the HTTP server. Shared memory between requests. You handle routing, static files, and SIGTERM.'
      ],
      [
        'No server execution at all',
        'GitHub Pages',
        'Static files only. Every dynamic call leaves the origin.'
      ]
    ]
  }),
  callout({
    icon: '$',
    strong: true,
    label: 'GitHub Pages is the constraint that decides the architecture.',
    body: `<p>SPA fallback is four different mechanisms plus one impossibility:
      <code>not_found_handling</code> on Cloudflare, <code>rewrites</code> on Vercel, a
      <code>try_files</code> equivalent in your own server on Railway and Cloud Run, and nothing real
      on Pages. The "copy index.html to 404.html" trick is community folklore, undocumented by GitHub,
      and serves deep links with an HTTP 404 status. <strong>Pre-rendering one real
      <code>index.html</code> per route is the only approach that works identically on all five</strong>,
      and it suits a documentation site naturally. That is why this site has no client-side router.</p>`
  })
)}

${section(
  'build',
  'The build',
  code({
    label: 'terminal',
    body: `cd site
npm install
npm run build        # -> site/dist, one real HTML file per route
npm run preview      # serve dist/ locally exactly as a host would`
  }),
  p(
    '<code>vite.config.js</code> generates every page before the bundle runs, so',
    '<code>npm run build</code> is the only command any target needs. The output is a plain',
    'directory of HTML, CSS, JS and one JSON search index. Nothing in it requires a runtime.'
  ),
  code({
    label: 'site/dist after a build',
    body: `dist/
├── index.html            # /
├── start/index.html      # /start/
├── chain/index.html      # /chain/
├── charts/index.html     # /charts/
├── api/index.html        # /api/
├── agents/index.html     # /agents/
├── prompts/index.html    # /prompts/
├── deploy/index.html     # /deploy/
├── 404.html
├── search-index.json     # the static search index, no backend
└── assets/               # hashed CSS and JS`
  })
)}

${section(
  'cloudflare',
  'Cloudflare Workers',
  p('Static assets served by the Workers assets binding. No Worker script needed for a purely static build.'),
  code({
    label: 'site/wrangler.toml',
    body: `name = "robinhood-toolkit-site"
compatibility_date = "2026-01-01"

[assets]
directory = "./dist"
not_found_handling = "404-page"`
  }),
  code({
    label: 'terminal',
    body: `npm run build
npx wrangler deploy`
  }),
  callout({
    icon: '!',
    label: 'Use 404-page, not single-page-application.',
    body: '<p><code>single-page-application</code> rewrites every unmatched path to <code>index.html</code> with a 200, which would hide broken links behind the landing page. This site has a real file per route, so an unmatched path genuinely is a 404 and should say so.</p>'
  })
)}

${section(
  'vercel',
  'Vercel',
  code({
    label: 'site/vercel.json',
    body: `{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "buildCommand": "npm run build",
  "outputDirectory": "dist",
  "cleanUrls": true,
  "trailingSlash": true
}`
  }),
  code({
    label: 'terminal',
    body: `npx vercel --cwd site
npx vercel --cwd site --prod`
  }),
  p(
    'No <code>rewrites</code> block. Every route is a real file, so Vercel\'s default filesystem',
    'routing already resolves <code>/start/</code> to <code>start/index.html</code>. Adding a catch-all',
    'rewrite here would be the same mistake as the SPA setting on Cloudflare.'
  )
)}

${section(
  'railway-cloudrun',
  'Railway and Google Cloud Run',
  p(
    'Both are the same model: you own a process. One small Node server serves <code>dist/</code> with',
    'correct directory-index resolution, immutable caching for hashed assets, revalidation for HTML,',
    'and a clean SIGTERM shutdown so a rolling deploy does not cut live requests.'
  ),
  code({
    label: 'terminal',
    body: `npm run build
PORT=8080 npm run serve      # what both platforms run`
  }),
  code({
    label: 'site/Dockerfile · used by Cloud Run, works on Railway too',
    body: `FROM node:22-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/dist ./dist
COPY --from=build /app/scripts/serve.mjs ./scripts/serve.mjs
EXPOSE 8080
CMD ["node", "scripts/serve.mjs"]`
  }),
  code({
    label: 'terminal · Cloud Run',
    body: `gcloud run deploy robinhood-toolkit-site \\
  --source site \\
  --region us-central1 \\
  --allow-unauthenticated`
  }),
  callout({
    icon: '!',
    label: 'Bind the port the platform gives you.',
    body: '<p>Both platforms inject <code>PORT</code>. A server that hardcodes 3000 fails its health check and the deploy rolls back with a message that does not mention the port. <code>scripts/serve.mjs</code> reads <code>process.env.PORT</code> and binds <code>0.0.0.0</code>.</p>'
  })
)}

${section(
  'github-pages',
  'GitHub Pages',
  p(
    'The strictest target and the reason for the whole architecture. No server execution, so no',
    'rewrites, no redirects, and no runtime of any kind. A pre-rendered site does not need any of',
    'them.'
  ),
  callout({
    icon: '$',
    strong: true,
    label: 'Project sites impose a /reponame/ path prefix, and Vite is not auto-configured for it.',
    body: `<p>GitHub's <code>configure-pages</code> action injects a base path for Next, Nuxt, Gatsby
      and SvelteKit, but <strong>not for Vite</strong>. You set it yourself. This site reads it from
      an environment variable so the same commit deploys to a root domain and to a project path
      without a code change.</p>`
  }),
  code({
    label: 'terminal · build for https://<user>.github.io/robinhood-toolkit/',
    body: `SITE_BASE=/robinhood-toolkit/ npm run build`
  }),
  code({
    label: 'site/vite.config.js · the relevant line',
    body: `// Trailing slash required. "/" for a root domain, "/reponame/" for a project site.
const base = process.env.SITE_BASE || '/'`
  }),
  list([
    'Every internal link, script tag and asset URL is written through that base at build time, so nothing hardcodes a root-relative path.',
    'The search index is fetched as <code>${base}search-index.json</code>, read from a <code>&lt;meta name="site-base"&gt;</code> tag the pre-renderer emits. That is what keeps client-side search working with no backend.',
    'A <code>.nojekyll</code> file is emitted into <code>dist/</code>. Without it Pages runs Jekyll, which silently drops any file or directory beginning with an underscore.',
    'Deep links work with a real HTTP 200 because every route is a real directory with a real <code>index.html</code>.'
  ])
)}

${section(
  'gotchas',
  'The cross-target gotchas',
  table({
    head: ['Gotcha', 'What breaks', 'The fix'],
    rows: [
      [
        'API origin',
        'Four targets serve <code>/api/*</code> same-origin. Pages cannot.',
        'Build-time-injected base URL plus CORS on the real origin. Design for it from the start; retrofitting means touching every fetch call site. This site sidesteps it entirely by calling only public third-party APIs.'
      ],
      [
        'Base path',
        'Only GitHub Pages project sites impose a prefix, and Vite is not auto-configured for it.',
        'Set <code>base</code> yourself from an env var. Never hardcode a root-relative URL.'
      ],
      [
        'SPA fallback',
        'Four mechanisms plus one impossibility on Pages.',
        'Pre-render one real file per route. It is the only approach identical on all five.'
      ],
      [
        'Node pinning',
        'Ranges resolve differently per platform.',
        '<code>engines.node</code> with an exact major. It is the one field Vercel, Railpack and GCP buildpacks all honour.'
      ],
      [
        'Trailing slashes',
        'A host that redirects <code>/start</code> to <code>/start/</code> and one that does not will disagree about canonical URLs.',
        'Emit directories with <code>index.html</code>, link with the trailing slash everywhere, and let each host resolve it natively.'
      ]
    ]
  }),
  p(
    `The <a href="${esc(href(base, '/prompts/'))}#track-70-deploy">70-deploy track</a> is six prompts, one per`,
    'target plus the synthesis: the exact config each host needs, and the one gotcha that breaks a',
    'naive port between them.'
  )
)}

${pager(base, { href: '/prompts/', title: 'Build prompts' }, { href: '/', title: 'Overview' })}
`
}
