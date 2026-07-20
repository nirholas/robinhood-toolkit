<!--
  robinhood-toolkit · build prompt: static-first site architecture and build pipeline
  Author: nirholas · https://github.com/nirholas/robinhood-toolkit
  License: MIT (c) 2026 nirholas
-->

# 01 · Site architecture

## Goal

Stand up the tutorial site as a static, pre-rendered Vite project that emits one
real HTML file per route. No client-side router, no SPA fallback, no server
requirement. The same `dist/` directory must deploy byte-identically to
Cloudflare Workers, Vercel, Railway, Google Cloud Run, and GitHub Pages.

## Prerequisites

- Node 20+.
- `npm i -D vite` plus `markdown-it`, `gray-matter`, `shiki` for the content
  pipeline. All MIT or equivalent.
- You have read [prompts/README.md](../README.md) for the verified network
  constants. Do not restate chain IDs in site code; import them from
  `packages/network`.

## Reference facts

- Target routes at launch: `/` (landing), `/tutorials/` (index),
  `/tutorials/<track>/<slug>/` (one per prompt-derived tutorial), `/reference/`,
  `/search/`, `/404.html`.
- Deploy targets and what each one actually gives you:

| Host | Server execution | Rewrites | Directory index |
|---|---|---|---|
| Cloudflare Workers (static assets) | yes | yes | yes |
| Vercel | yes | yes | yes |
| Railway | yes (you run the process) | yes | depends on your static server config |
| Google Cloud Run | yes (you run the process) | yes | depends on your static server config |
| GitHub Pages | none | none | yes |

  GitHub Pages is the constraint that decides the architecture. It has no
  server-side execution and no rewrite mechanism, so any approach that needs a
  catch-all rewrite to `index.html` behaves differently there than on the other
  four. Pre-rendering one HTML file per route is the only approach where all five
  hosts serve the identical bytes with identical URLs. This is load-bearing:
  do not introduce a client-side router later.
- Every host in the table serves `index.html` for a directory URL. Emit
  `dist/tutorials/<slug>/index.html`, never `dist/tutorials/<slug>.html`, so the
  canonical URL has a trailing slash on all five.
- GitHub Pages project sites serve from `https://<user>.github.io/<repo>/`, so
  the build needs a configurable `base`. Custom domains and the other four hosts
  serve from `/`.

## Steps

1. Create `site/` with this layout. Generated directories are gitignored.

```
site/
  content/                    tutorials as markdown, source of truth
    00-foundations/*.md
    10-chain/*.md
  src/
    styles/{palette.json,tokens.css,base.css,components.css}
    js/{theme.js,copy.js,nav.js}
    templates/page.html
  public/                     copied verbatim, includes robots.txt
  scripts/
    build-content.mjs         markdown -> route HTML  (generated)
    build-search-index.mjs    see prompt 05
  index.html
  vite.config.js
```

2. Write `scripts/build-content.mjs`. It reads every `content/**/*.md`, parses
   frontmatter with `gray-matter`, renders the body with `markdown-it`,
   highlights code with `shiki` at build time (zero highlighting JS shipped to
   the client), and writes `site/tutorials/<track>/<slug>/index.html` using
   `src/templates/page.html`. The template contract is defined in prompt 03.
3. Run `build-content.mjs` before Vite, as a `prebuild` npm script. Vite then
   treats the generated HTML files as entry points and processes their asset
   references normally.
4. Configure `vite.config.js` with an input glob covering `index.html` plus every
   generated `tutorials/**/index.html`. Set `base` from an env var so GitHub
   Pages can build under a subpath.
5. Reference assets from HTML as absolute `/src/...` paths. Vite resolves those
   against the project root and rewrites them with `base` applied. Relative
   `../../src/...` paths from nested route directories are fragile and break the
   moment a route gains a level.
6. Build internal links through one helper so `base` is honored everywhere.
   A hardcoded `href="/tutorials/x/"` is correct on four hosts and a 404 on
   GitHub Pages project sites.
7. Keep the JS payload small. Content pages are text. Budget: under 15 KB gzip of
   first-party JS on a page with no chart and no playground. Load the theme
   toggle inline in `<head>` (it must run before first paint), and lazy-import
   everything else on interaction or intersection. Lightweight Charts and the
   playground runtime are dynamic imports, never in the shared entry chunk.
8. Emit `404.html` at the root of `dist/`. GitHub Pages and Cloudflare serve it
   automatically; configure Vercel and your Railway/Cloud Run static server to do
   the same so the miss behavior matches.
9. Add `site/README.md`: what the pipeline does, how to add a tutorial, how to
   build, and the pre-rendering constraint with the reason.

```js
/**
 * robinhood-toolkit · site build config
 * Author: nirholas · https://github.com/nirholas/robinhood-toolkit
 * License: MIT (c) 2026 nirholas
 */
import { defineConfig } from 'vite';
import { readdirSync, existsSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const generated = join(root, 'tutorials');

// build-content.mjs has already written these. Run it via `prebuild`.
// readdirSync recursive is available from Node 20.1; fs.globSync is Node 22+.
const routes = existsSync(generated)
  ? readdirSync(generated, { recursive: true })
      .map((p) => String(p).split('\\').join('/'))
      .filter((p) => p.endsWith('index.html'))
      .map((p) => `tutorials/${p}`)
  : [];

export default defineConfig({
  root,
  // '/' for Cloudflare, Vercel, Railway, Cloud Run and custom domains.
  // '/robinhood-toolkit/' for a GitHub Pages project site.
  base: process.env.SITE_BASE ?? '/',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: Object.fromEntries(
        ['index.html', '404.html', ...routes].map((r) => [r, resolve(root, r)]),
      ),
    },
  },
});
```

The content build, reduced to its essentials:

```js
/**
 * robinhood-toolkit · markdown to pre-rendered route HTML
 * Author: nirholas · https://github.com/nirholas/robinhood-toolkit
 * License: MIT (c) 2026 nirholas
 */
import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { join, dirname, basename, relative } from 'node:path';
import matter from 'gray-matter';
import MarkdownIt from 'markdown-it';
import { createHighlighter } from 'shiki';

const SITE = dirname(import.meta.dirname);
const CONTENT = join(SITE, 'content');

const highlighter = await createHighlighter({
  themes: ['github-light', 'github-dark'],
  langs: ['js', 'ts', 'json', 'bash', 'solidity', 'html', 'css'],
});

const md = new MarkdownIt({
  html: true,
  highlight(code, lang) {
    const language = highlighter.getLoadedLanguages().includes(lang) ? lang : 'text';
    // Dual themes so highlighting follows the site theme with CSS only.
    return highlighter.codeToHtml(code, {
      lang: language,
      themes: { light: 'github-light', dark: 'github-dark' },
      defaultColor: false,
    });
  },
});

async function* walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else if (entry.name.endsWith('.md')) yield full;
  }
}

const template = await readFile(join(SITE, 'src/templates/page.html'), 'utf8');

for await (const file of walk(CONTENT)) {
  const { data, content } = matter(await readFile(file, 'utf8'));
  const track = relative(CONTENT, dirname(file));
  const slug = basename(file, '.md');
  const outDir = join(SITE, 'tutorials', track, slug);

  const html = template
    .replaceAll('{{title}}', escapeHtml(data.title))
    .replaceAll('{{description}}', escapeHtml(data.description))
    .replaceAll('{{canonical}}', `/tutorials/${track}/${slug}/`)
    .replace('{{body}}', md.render(content));

  await mkdir(outDir, { recursive: true });
  await writeFile(join(outDir, 'index.html'), html);
  console.log('built /tutorials/%s/%s/', track, slug);
}

function escapeHtml(s = '') {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );
}
```

## Deliverable

- `site/` building to a `dist/` of static files, one `index.html` per route.
- `npm run build:site` runs content generation, the search index (prompt 05),
  then `vite build`.
- `site/README.md` documenting the pipeline and the pre-render constraint.
- `.gitignore` entries for `site/tutorials/`, `site/dist/`, and the generated
  search index.

## How to verify

1. `npm run build:site` then `find site/dist -name index.html` lists one file per
   route. Every tutorial URL ends in a directory, not a `.html` file.
2. Serve the output with a plain static server and click through every link:
   `npx serve site/dist`. Nothing 404s and no request falls back to a rewrite.
3. Deep-link parity. Open `/tutorials/00-foundations/02-network-setup-and-rpc/`
   directly, with no prior navigation. It renders. This is the check that fails
   the moment someone reintroduces a client-side router.
4. Disable JavaScript entirely. Every tutorial is still fully readable and every
   link still works. Charts and the playground degrade to visible fallback
   content, not to a blank box.
5. Subpath build works: `SITE_BASE=/robinhood-toolkit/ npm run build:site`, serve
   `site/dist` under that path, confirm no asset or link 404s.
6. Payload budget: on a content page, DevTools Network shows first-party JS under
   15 KB gzip and no chart library in the initial chunk.

## Gotchas

- A catch-all SPA rewrite works on four hosts and silently does not on GitHub
  Pages. Pre-rendering is not a stylistic preference here, it is the only option
  with identical behavior across all five.
- `base` is the single most common cross-host break. Test the subpath build
  before every release, not only the root build.
- Vite only processes HTML listed as an entry. A generated route missing from the
  input map ships with unhashed, unprocessed asset URLs that 404 in production.
- Order matters: content generation must run before `vite build`, and
  `emptyOutDir: true` wipes `dist/`, so nothing may write into `dist/` earlier
  in the chain.
- Highlighting at build time with dual themes keeps Shiki out of the browser
  bundle. Importing Shiki client-side adds hundreds of kilobytes for zero
  reader-visible benefit.
- Do not commit the generated `site/tutorials/` tree. Two agents regenerating it
  produce noisy conflicting diffs over derived files.
- Railway and Cloud Run serve whatever your process serves. Configure the static
  server for directory indexes and a `404.html` fallback, or those two hosts
  diverge from the other three on exactly the URLs readers share.
