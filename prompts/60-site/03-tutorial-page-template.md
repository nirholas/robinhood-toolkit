<!-- built by nirholas x.com/nichxbt -->
<!--
  robinhood-toolkit · build prompt: the tutorial page template and content contract
  Author: nirholas · https://github.com/nirholas/robinhood-toolkit
  License: All Rights Reserved (c) 2026 nirholas
-->

# 03 · Tutorial page template

## Goal

Define one HTML template and one frontmatter contract that every tutorial renders
through. A new tutorial should be a markdown file and nothing else: no bespoke
HTML, no per-page CSS, no per-page script wiring. The template owns the skeleton,
the metadata, the code-block affordances, the prev/next chain, and the
attribution footer.

## Prerequisites

- Prompt 01 (the content build calls this template) and prompt 02 (tokens exist).
- `npm i -D gray-matter markdown-it markdown-it-anchor shiki`.

## Reference facts

- Content lives in `site/content/<track>/<slug>.md` and renders to
  `/tutorials/<track>/<slug>/`. Track directories mirror the prompt tracks in
  [prompts/README.md](../README.md).
- Verified network constants used in tutorial samples: mainnet chain ID 4663 at
  `https://rpc.mainnet.chain.robinhood.com`, testnet 46630 at
  `https://rpc.testnet.chain.robinhood.com`. Repo ground rule 2 applies to every
  sample on the site: it must run as written.
- Repo ground rule 4: every file the template emits, and the template itself,
  carries the attribution header from [ATTRIBUTION.md](../../ATTRIBUTION.md).
  `npm run check:headers` enforces it.
- Any page that renders a chart must keep `layout.attributionLogo` on. The
  frontmatter flag that opts a page into charts is what makes this auditable in
  one grep instead of per-page review.
- Prose measure is `--measure` (68ch). Code blocks and charts break out wider;
  body text does not.

## Steps

1. Define the frontmatter contract and validate it at build time. A missing or
   malformed field fails the build. Silent defaults produce pages with empty
   `<title>` tags that nobody notices for months.

| Field | Required | Purpose |
|---|---|---|
| `title` | yes | `<h1>`, `<title>`, OG title, search index |
| `description` | yes | meta description, OG, search snippet |
| `track` | yes | breadcrumb, prev/next ordering, index grouping |
| `order` | yes | position within the track |
| `updated` | yes | ISO date, rendered and emitted as `dateModified` |
| `network` | no | `mainnet` or `testnet`, renders a network badge |
| `chart` | no | boolean, lazy-loads Lightweight Charts on this page only |
| `playground` | no | boolean, lazy-loads the runner from prompt 04 |
| `prerequisites` | no | array of route paths, rendered as a linked list |
| `draft` | no | boolean, excluded from build, index, and search |

2. Write `site/src/templates/page.html`. Placeholders are replaced by the content
   build. Keep it a real HTML document with a real document outline: `header`,
   `nav`, `main`, `article`, `aside` for the on-page table of contents, `footer`.
3. Put the theme bootstrap from prompt 02 inline in `<head>`, before any
   stylesheet. Everything else is deferred or dynamically imported.
4. Generate the table of contents at build time from the `h2`/`h3` nodes.
   `markdown-it-anchor` gives each heading a stable slug id. Build-time generation
   means the TOC is in the HTML for readers with no JS and for crawlers.
5. Add a copy button to every code block during the content build, not at
   runtime. The button is real markup in the pre-rendered HTML; only the click
   handler is JS. A JS-injected button means a reader without JS sees nothing and
   a reader on a slow connection sees layout shift.
6. Render prev/next from the sorted `track` plus `order` set. Both links are real
   `<a>` elements resolved at build time.
7. Emit JSON-LD `TechArticle` with `headline`, `description`, `dateModified`, and
   `author` set to the repo author from ATTRIBUTION.md. One `<script type="application/ld+json">`,
   no library.
8. Load per-page features from the frontmatter flags. The template emits
   `data-chart` and `data-playground` attributes on `<body>`, and the shared entry
   script dynamic-imports only what the attributes ask for.
9. Footer carries the attribution line and the All Rights Reserved notice, and links back to the
   repo. On chart pages the TradingView attribution is satisfied by the in-chart
   logo, so do not duplicate it in the footer, and do not treat a footer credit as
   a substitute for the logo.

```html
<!--
  robinhood-toolkit · tutorial page template
  Author: nirholas · https://github.com/nirholas/robinhood-toolkit
  License: All Rights Reserved (c) 2026 nirholas
-->
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>{{title}} · robinhood-toolkit</title>
    <meta name="description" content="{{description}}" />
    <link rel="canonical" href="https://robinhood-toolkit.dev{{canonical}}" />
    <meta property="og:title" content="{{title}}" />
    <meta property="og:description" content="{{description}}" />
    <meta property="og:type" content="article" />

    <script>
      /* Theme bootstrap. Inline and synchronous: see prompt 02. */
      (function () {
        try {
          var t = localStorage.getItem('theme');
          if (t === 'light' || t === 'dark')
            document.documentElement.setAttribute('data-theme', t);
        } catch (e) {}
      })();
    </script>

    <link rel="stylesheet" href="/src/styles/tokens.css" />
    <link rel="stylesheet" href="/src/styles/base.css" />
    <link rel="stylesheet" href="/src/styles/components.css" />
    <script type="module" src="/src/js/page.js"></script>

    <script type="application/ld+json">
      {{jsonld}}
    </script>
  </head>

  <body data-chart="{{chart}}" data-playground="{{playground}}">
    <a class="skip-link" href="#content">Skip to content</a>

    <header class="site-header">
      <a class="site-mark" href="/">robinhood-toolkit</a>
      <nav aria-label="Primary">{{primaryNav}}</nav>
      <form class="search-form" role="search" action="/search/">
        <label class="visually-hidden" for="q">Search tutorials</label>
        <input id="q" name="q" type="search" placeholder="Search" autocomplete="off" />
      </form>
      <button type="button" class="theme-toggle" data-theme-toggle aria-pressed="false">
        <span aria-hidden="true">◐</span>
      </button>
    </header>

    <div class="layout">
      <nav class="track-nav" aria-label="Tutorials">{{trackNav}}</nav>

      <main id="content">
        <article class="prose">
          <nav class="breadcrumb" aria-label="Breadcrumb">{{breadcrumb}}</nav>
          <h1>{{title}}</h1>
          <p class="lede">{{description}}</p>
          <p class="page-meta">
            <span class="badge">{{track}}</span>
            {{networkBadge}}
            <time datetime="{{updated}}">Updated {{updatedHuman}}</time>
          </p>
          {{prerequisites}}
          {{body}}
        </article>

        <nav class="pager" aria-label="Tutorial">
          {{prevLink}}
          {{nextLink}}
        </nav>
      </main>

      <aside class="toc" aria-labelledby="toc-heading">
        <h2 id="toc-heading">On this page</h2>
        {{toc}}
      </aside>
    </div>

    <footer class="site-footer">
      <p>
        robinhood-toolkit · Author:
        <a href="https://github.com/nirholas/robinhood-toolkit">nirholas</a> ·
        All Rights Reserved (c) 2026 nirholas
      </p>
    </footer>
  </body>
</html>
```

Frontmatter validation, wired into the content build from prompt 01:

```js
/**
 * robinhood-toolkit · tutorial frontmatter contract
 * Author: nirholas · https://github.com/nirholas/robinhood-toolkit
 * License: All Rights Reserved (c) 2026 nirholas
 */
const REQUIRED = ['title', 'description', 'track', 'order', 'updated'];
const NETWORKS = new Set(['mainnet', 'testnet']);

export function validateFrontmatter(data, file) {
  const fail = (msg) => {
    throw new Error(`${file}: ${msg}`);
  };

  for (const key of REQUIRED) {
    if (data[key] === undefined || data[key] === '') fail(`missing frontmatter "${key}"`);
  }
  if (typeof data.order !== 'number') fail('"order" must be a number');
  if (Number.isNaN(Date.parse(data.updated))) fail('"updated" must be an ISO date');
  if (data.network && !NETWORKS.has(data.network)) {
    fail(`"network" must be mainnet or testnet, got ${data.network}`);
  }
  if (data.description.length > 160) {
    fail(`"description" is ${data.description.length} chars, meta description caps at 160`);
  }
  return data;
}
```

Copy buttons added at build time, so they exist in the pre-rendered HTML:

```js
/**
 * robinhood-toolkit · code block affordances
 * Author: nirholas · https://github.com/nirholas/robinhood-toolkit
 * License: All Rights Reserved (c) 2026 nirholas
 */
export function decorateCodeBlocks(html) {
  return html.replace(
    /<pre([^>]*)>/g,
    (_m, attrs) =>
      `<div class="code-block"><button type="button" class="code-copy" ` +
      `aria-label="Copy code to clipboard">Copy</button><pre${attrs}>`,
  ).replaceAll('</pre>', '</pre></div>');
}
```

```js
/**
 * robinhood-toolkit · page entry, loads only what the page declares
 * Author: nirholas · https://github.com/nirholas/robinhood-toolkit
 * License: All Rights Reserved (c) 2026 nirholas
 */
import { initThemeToggle } from './theme.js';
import { initCopyButtons } from './copy.js';

const toggle = document.querySelector('[data-theme-toggle]');
if (toggle) initThemeToggle(toggle);
initCopyButtons();

if (document.body.dataset.chart === 'true') {
  import('./chart.js').then((m) => m.initCharts());
}
if (document.body.dataset.playground === 'true') {
  import('./playground.js').then((m) => m.initPlaygrounds());
}
```

```js
/**
 * robinhood-toolkit · copy-to-clipboard for code blocks
 * Author: nirholas · https://github.com/nirholas/robinhood-toolkit
 * License: All Rights Reserved (c) 2026 nirholas
 */
export function initCopyButtons(root = document) {
  for (const button of root.querySelectorAll('.code-copy')) {
    button.addEventListener('click', async () => {
      const code = button.parentElement.querySelector('pre')?.innerText ?? '';
      try {
        await navigator.clipboard.writeText(code);
        announce(button, 'Copied');
      } catch {
        // Clipboard API needs a secure context and can be denied by policy.
        announce(button, 'Press Ctrl+C');
      }
    });
  }
}

function announce(button, message) {
  const previous = button.textContent;
  button.textContent = message;
  // Screen readers get the change because the button is the live region.
  button.setAttribute('aria-live', 'polite');
  setTimeout(() => {
    button.textContent = previous;
    button.removeAttribute('aria-live');
  }, 1500);
}
```

## Deliverable

- `site/src/templates/page.html` with every placeholder documented in
  `site/README.md`.
- Frontmatter validation wired into the content build, failing the build on a
  contract violation.
- `src/js/page.js`, `copy.js`, and the build-time TOC, breadcrumb, pager, and
  code-block decoration.
- At least two real tutorials in `site/content/` proving the contract, one with
  `chart: true` and one with `playground: true`.

## How to verify

1. Add a markdown file with no other change, rebuild, and the route exists with
   working prev/next, breadcrumb, and TOC. If any of those needed a manual edit,
   the template is not owning enough.
2. Break the contract deliberately: remove `title` from a file and confirm the
   build fails with the filename in the message. Set `order` to a string and
   confirm the same.
3. View source on a built page. The TOC, copy buttons, prev/next, and JSON-LD are
   all present in the HTML, not injected by script.
4. Disable JS. The page is fully readable, headings link, navigation works. Only
   the copy buttons and the theme toggle go inert.
5. `npm run check:headers` passes for the template and every new source file.
6. On a `chart: true` page, DevTools Network shows the chart chunk loading. On a
   content page it does not appear at all.
7. Every code sample on both proof tutorials runs as written. Copy each one into a
   terminal or the browser console and execute it.

## Gotchas

- Placeholder replacement with `String.replace` substitutes `$&`, `$1`, and
  friends inside the replacement value. Body HTML containing a `$&` silently
  corrupts. Use `replaceAll` with a function replacement, or a real template
  engine.
- Escape every interpolated frontmatter value. A title containing `<` or a quote
  breaks the document or the meta tag. The `escapeHtml` helper from prompt 01 is
  not optional.
- JSON-LD needs `JSON.stringify` output, not hand-assembled string
  concatenation. An unescaped quote in a description produces invalid JSON that
  no validator in the pipeline catches.
- `pre.innerText` preserves rendered line breaks; `textContent` collapses the
  structure Shiki emits. Copying a multi-line sample with `textContent` yields
  code that does not run.
- `navigator.clipboard` requires a secure context. It is undefined on plain HTTP,
  including some LAN dev setups. Handle the rejection with a real fallback
  message rather than a silent no-op.
- Do not let `draft: true` pages reach the search index. Excluding them from the
  build but not the index publishes the title and the URL of unpublished work.
- The lede paragraph and the meta description drift apart the moment they are
  authored separately. Render both from the one `description` field.
<!-- built by nirholas x.com/nichxbt -->
