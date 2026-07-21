<!--
  robinhood-toolkit · build prompt: static search index and site navigation
  Author: nirholas · https://github.com/nirholas/robinhood-toolkit
  License: All Rights Reserved (c) 2026 nirholas
-->

# 05 · Search and navigation

## Goal

Ship search that works with no server: a search index built at deploy time,
shipped as a static JSON file, queried by a small client-side matcher. Plus the
navigation the index feeds, track sidebar, breadcrumbs, prev/next, and a
`/search/` results page that works from a plain form submit.

## Prerequisites

- Prompts 01 and 03 complete. Content and frontmatter exist.
- `npm i minisearch` (MIT, actively maintained, serializes an index to JSON and
  reloads it client-side). Do not hand-roll an inverted index; this is a solved
  problem.

## Reference facts

- **No hosted search service.** Algolia, Typesense Cloud, and every similar
  option need an API key and a network dependency the site cannot carry: the
  build must deploy to GitHub Pages with zero backend, and a key in a static
  bundle is a key you have published. A prebuilt index is also faster for a
  corpus this size and works offline.
- MiniSearch serializes with `JSON.stringify(miniSearch)` and reloads with
  `MiniSearch.loadJSON(json, options)`. **The options object passed to
  `loadJSON` must match the one used at build time**, specifically `fields`,
  `storeFields`, and any `tokenize` or `processTerm` functions. A mismatch
  produces wrong results silently, with no error.
- Index size is the constraint that matters. `storeFields` copies whole field
  values into the index, so storing body text turns a 60 KB index into a
  multi-megabyte one. Store only what the result list renders.
- The index must exclude `draft: true` pages. Excluding a draft from the build
  but not the index publishes its title and URL.
- `/search/` is a real pre-rendered route, so a plain form submit with
  `?q=` works with JavaScript disabled and with the index still loading. The
  inline dropdown is enhancement on top of that.

## Steps

1. Write `site/scripts/build-search-index.mjs`. It walks the same
   `content/**/*.md` set as the content build, strips markdown to plain text,
   builds a MiniSearch index, and writes `site/public/search-index.json`.
   Run it from `prebuild`, after the content build.
2. Index one record per **heading section**, not per page. Section-level records
   let a result deep-link to `#anchor` and keep each record short enough that
   relevance scoring is meaningful. A 4000-word page as a single record matches
   everything and ranks nothing.
3. Keep `storeFields` to `title`, `section`, `url`, `track`, and a truncated
   `snippet`. Body text is searchable via `fields` without being stored.
4. Export the shared options object from one module imported by both the build
   script and the client. This is the only structural defense against the
   loadJSON mismatch above.
5. Write `site/src/js/search.js`: lazy-fetch the index on first focus of the
   search input, never on page load. The index is dead weight for a reader who
   never searches, and it is the largest asset on the site.
6. Implement the combobox with correct ARIA: `role="combobox"` with
   `aria-expanded`, `aria-controls`, and `aria-activedescendant` on the input,
   `role="listbox"` on the results, `role="option"` on each result. Prompt 06
   covers the keyboard contract.
7. Build `/search/` as a pre-rendered page that reads `?q=` on load, runs the
   same matcher, and renders full results. Handle three states explicitly: no
   query, no matches, and index-failed-to-load.
8. Enable `prefix: true` and `fuzzy: 0.2` on queries so partial words and small
   typos match. Boost `title` over `section` over `body`.
9. Generate the track sidebar, breadcrumbs, and prev/next from the same
   frontmatter set at build time, sorted by `track` then `order`. Mark the
   current page with `aria-current="page"`.
10. Add `sitemap.xml` and `llms.txt` from the same record set while you have it
    in memory. Both are static files and cost nothing extra.

```js
/**
 * robinhood-toolkit · shared search index configuration
 * Author: nirholas · https://github.com/nirholas/robinhood-toolkit
 * License: All Rights Reserved (c) 2026 nirholas
 *
 * Imported by BOTH the build script and the client. MiniSearch.loadJSON must
 * receive the same options used to build the index or results are silently
 * wrong. One module, no drift.
 */
export const SEARCH_OPTIONS = {
  fields: ['title', 'section', 'body', 'track'],
  storeFields: ['title', 'section', 'url', 'track', 'snippet'],
  searchOptions: {
    boost: { title: 4, section: 2, track: 1 },
    prefix: true,
    fuzzy: 0.2,
  },
};

export const INDEX_URL = '/search-index.json';
```

```js
/**
 * robinhood-toolkit · build the static search index
 * Author: nirholas · https://github.com/nirholas/robinhood-toolkit
 * License: All Rights Reserved (c) 2026 nirholas
 */
import { readFile, writeFile, readdir, stat } from 'node:fs/promises';
import { join, dirname, basename, relative } from 'node:path';
import matter from 'gray-matter';
import MiniSearch from 'minisearch';
import { SEARCH_OPTIONS } from '../src/js/search-options.js';

const SITE = dirname(import.meta.dirname);
const CONTENT = join(SITE, 'content');

async function* walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else if (entry.name.endsWith('.md')) yield full;
  }
}

/** One record per h2/h3 section, so results deep-link and rank meaningfully. */
function toSections(markdown, page) {
  const lines = markdown.split('\n');
  const sections = [];
  let current = { heading: null, anchor: '', lines: [] };

  const push = () => {
    const body = current.lines.join(' ').replace(/\s+/g, ' ').trim();
    if (!body && !current.heading) return;
    sections.push({
      id: `${page.url}${current.anchor}`,
      url: `${page.url}${current.anchor}`,
      title: page.title,
      track: page.track,
      section: current.heading ?? 'Introduction',
      body,
      snippet: body.slice(0, 180),
    });
  };

  let inFence = false;
  for (const line of lines) {
    if (line.startsWith('```')) inFence = !inFence;
    const heading = !inFence && /^#{2,3}\s+(.*)$/.exec(line);
    if (heading) {
      push();
      const text = heading[1].trim();
      current = { heading: text, anchor: `#${slugify(text)}`, lines: [] };
    } else {
      current.lines.push(stripMarkdown(line));
    }
  }
  push();
  return sections;
}

const stripMarkdown = (line) =>
  line
    .replace(/`{1,3}[^`]*`{1,3}/g, ' ')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[#*_>|-]/g, ' ');

const slugify = (s) =>
  s.toLowerCase().replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '-');

const documents = [];
for await (const file of walk(CONTENT)) {
  const { data, content } = matter(await readFile(file, 'utf8'));
  if (data.draft) continue; // Never index unpublished work.
  const track = relative(CONTENT, dirname(file));
  const slug = basename(file, '.md');
  documents.push(
    ...toSections(content, {
      url: `/tutorials/${track}/${slug}/`,
      title: data.title,
      track,
    }),
  );
}

const index = new MiniSearch(SEARCH_OPTIONS);
index.addAll(documents);

const out = join(SITE, 'public/search-index.json');
await writeFile(out, JSON.stringify(index));
const { size } = await stat(out);
console.log(`search index: ${documents.length} sections, ${(size / 1024).toFixed(1)} KB`);
if (size > 1_500_000) {
  throw new Error('search index over 1.5 MB. Trim storeFields or split by track.');
}
```

The client matcher, loaded on first interaction:

```js
/**
 * robinhood-toolkit · client-side search
 * Author: nirholas · https://github.com/nirholas/robinhood-toolkit
 * License: All Rights Reserved (c) 2026 nirholas
 */
import MiniSearch from 'minisearch';
import { SEARCH_OPTIONS, INDEX_URL } from './search-options.js';

let indexPromise = null;

/** Fetched on first focus, not on page load. Idempotent. */
export function loadIndex() {
  if (!indexPromise) {
    const url = new URL(INDEX_URL.slice(1), document.baseURI); // honors Vite base
    indexPromise = fetch(url)
      .then((r) => {
        if (!r.ok) throw new Error(`search index ${r.status}`);
        return r.text();
      })
      .then((json) => MiniSearch.loadJSON(json, SEARCH_OPTIONS));
  }
  return indexPromise;
}

export async function search(query, limit = 8) {
  if (!query || query.trim().length < 2) return [];
  const index = await loadIndex();
  return index.search(query, SEARCH_OPTIONS.searchOptions).slice(0, limit);
}

export function initSearch(input, listbox) {
  input.addEventListener('focus', loadIndex, { once: true });

  let token = 0;
  input.addEventListener('input', async () => {
    const mine = ++token;
    let results = [];
    try {
      results = await search(input.value);
    } catch {
      render(listbox, input, null); // index failed, show the fallback link
      return;
    }
    if (mine !== token) return; // a newer keystroke already won
    render(listbox, input, results);
  });
}

function render(listbox, input, results) {
  listbox.textContent = '';

  if (results === null) {
    const li = document.createElement('li');
    li.className = 'search-empty';
    li.textContent = 'Search is unavailable. Browse the tutorial index instead.';
    listbox.append(li);
  } else if (results.length === 0) {
    const li = document.createElement('li');
    li.className = 'search-empty';
    li.textContent = input.value.trim().length < 2
      ? 'Type at least two characters.'
      : `No results for "${input.value}". Try a chain, contract, or API term.`;
    listbox.append(li);
  } else {
    for (const [i, r] of results.entries()) {
      const li = document.createElement('li');
      li.id = `search-option-${i}`;
      li.setAttribute('role', 'option');
      li.setAttribute('aria-selected', 'false');

      const a = document.createElement('a');
      a.href = r.url;
      a.textContent = `${r.title} · ${r.section}`;
      const p = document.createElement('p');
      p.className = 'search-snippet';
      p.textContent = r.snippet; // textContent: index values are never trusted HTML
      li.append(a, p);
      listbox.append(li);
    }
  }

  input.setAttribute('aria-expanded', String(listbox.childElementCount > 0));
}
```

## Deliverable

- `site/scripts/build-search-index.mjs` wired into `prebuild`, emitting
  `site/public/search-index.json` with a size assertion.
- `site/src/js/search-options.js` imported by both sides.
- `site/src/js/search.js` plus the header combobox and the `/search/` route.
- Build-time track sidebar, breadcrumbs, and prev/next.
- `sitemap.xml` and `llms.txt` generated from the same record set.
- A `Search` section in `site/README.md` covering the no-backend constraint and
  how to add a field to the index without breaking `loadJSON`.

## How to verify

1. `npm run build:site` prints the section count and index size. The size
   assertion fails the build if the index grows past the budget.
2. Search a term that appears only in a mid-page section and confirm the result
   deep-links to the correct `#anchor`, and that the browser scrolls to it.
3. Deploy to GitHub Pages, or serve with `SITE_BASE=/robinhood-toolkit/`, and
   confirm the index still loads. This is where a hardcoded `/search-index.json`
   breaks and `document.baseURI` resolution does not.
4. Disable JavaScript, type into the header input, press Enter. `/search/?q=...`
   loads and renders results server-free from the pre-rendered page, or states
   plainly that results need JavaScript. It must not be a blank page.
5. All three enhanced states render: a two-character minimum message, a
   no-matches message naming the query, and the index-failure fallback. Force the
   last one by blocking `search-index.json` in DevTools.
6. Set `draft: true` on a page, rebuild, and confirm its title appears nowhere in
   `search-index.json`: `grep -c "$TITLE" site/public/search-index.json` is 0.
7. Options-drift guard: add a field to `SEARCH_OPTIONS.fields`, rebuild, and
   confirm search still works. Because both sides import the same module, it
   should. If it breaks, the client is not using the shared object.
8. Network tab shows `search-index.json` requested only after the input is
   focused, never on page load.

## Gotchas

- `MiniSearch.loadJSON` with options that differ from the build produces
  plausible but wrong results and throws nothing. The shared module is the fix;
  do not inline the options object in two places, even briefly.
- `storeFields` including `body` is the standard way this index becomes
  multi-megabyte. Store the truncated snippet instead.
- Section-splitting must skip fenced code blocks. A `# comment` line inside a
  bash block otherwise starts a phantom section with a nonsense anchor.
- Anchor slugs have to match what `markdown-it-anchor` generates, or every deep
  link lands at the top of the page. Use the same slugify function in both
  places, or read the ids back out of the rendered HTML.
- Async result races: a slow keystroke resolving after a fast one renders stale
  results. The monotonic token in the sample handles it; a bare `await` does not.
- Snippets are inserted with `textContent`, never `innerHTML`. Content is
  repo-authored, but an index value reaching `innerHTML` is one contributed
  tutorial away from being an XSS vector.
- Do not preload the index on page load "for speed". It is the largest asset on
  the site and most readers never search.
- `fuzzy: 0.2` on very short queries returns noise. The two-character minimum is
  what keeps the dropdown useful.
