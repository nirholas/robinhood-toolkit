/**
 * robinhood-toolkit · pre-renderer
 * Author: nirholas · https://github.com/nirholas/robinhood-toolkit
 * License: MIT (c) 2026 nirholas
 *
 * Writes one real HTML file per route into the Vite root, plus the static
 * search index. Vite then treats each file as a multi-page build input, which
 * is why dist/ contains genuine documents rather than a shell plus a router.
 *
 * Run directly with `npm run gen`. vite.config.js also calls it before every
 * dev server start and every build, so the generated tree is never stale.
 */

import { mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { generateTokens } from './gen-tokens.mjs'
import { readPrompts } from './read-prompts.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const siteRoot = join(here, '..')

/** Normalise a configured base into a leading-and-trailing-slashed path. */
export function normaliseBase(raw) {
  if (!raw || raw === '/') return '/'
  return `/${raw.replace(/^\/+|\/+$/g, '')}/`
}

/**
 * Reduce prompt markdown to prose. Fenced code, tables and heading syntax add
 * noise to both the ranking and the excerpt a reader sees in the results list.
 */
function markdownToPlainText(markdown) {
  return markdown
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/^\s*\|.*\|\s*$/gm, ' ')
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/^\s{0,3}[-*+]\s+/gm, '')
    .replace(/^\s{0,3}>\s?/gm, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[`*_]/g, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Strip tags and collapse whitespace so the search index holds readable text. */
function toPlainText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
}

function buildSearchIndex({ pages, rendered, prompts, base }) {
  const entries = []

  for (const page of pages) {
    if (page.path === '/404.html') continue
    const text = toPlainText(rendered.get(page.path))
    entries.push({
      url: `${base}${page.path.replace(/^\//, '')}`,
      title: page.title,
      kind: 'page',
      excerpt: page.description,
      text: text.slice(0, 6000)
    })
  }

  for (const track of prompts.tracks) {
    for (const item of track.items) {
      entries.push({
        url: item.url,
        title: item.title.replace(/^\d+\s*·\s*/, ''),
        kind: 'prompt',
        track: `${track.id} ${track.label}`,
        excerpt: item.summary,
        text: markdownToPlainText(item.body).slice(0, 4000)
      })
    }
  }

  return entries
}

export async function buildContent({ base: rawBase = process.env.SITE_BASE, quiet = false, fresh = false } = {}) {
  const base = normaliseBase(rawBase)

  generateTokens({ quiet })

  const prompts = readPrompts()
  // Node caches ES modules by specifier, so a dev-server rebuild after a content
  // edit needs a unique specifier or it re-renders the previous version.
  const bust = fresh ? `?t=${Date.now()}` : ''
  const { pages, routes } = await import(`../content/routes.mjs${bust}`)
  const { renderDocument } = await import(`../content/layout.mjs${bust}`)

  const rendered = new Map()

  for (const page of pages) {
    const body = page.render({ base, prompts, routes })
    rendered.set(page.path, body)

    const html = renderDocument({ route: page, routes, base, body })
    const outPath = join(siteRoot, page.file)
    mkdirSync(dirname(outPath), { recursive: true })
    writeFileSync(outPath, html)
  }

  const index = buildSearchIndex({ pages, rendered, prompts, base })
  mkdirSync(join(siteRoot, 'public'), { recursive: true })
  writeFileSync(join(siteRoot, 'public/search-index.json'), JSON.stringify(index))

  // GitHub Pages runs Jekyll unless told not to, and Jekyll silently drops any
  // path beginning with an underscore, including Vite's asset directory in some
  // configurations. Cheap to emit, expensive to debug when missing.
  writeFileSync(join(siteRoot, 'public/.nojekyll'), '')

  if (!quiet) {
    console.log(
      `content: ${pages.length} pages pre-rendered at base "${base}", ` +
        `${prompts.total} prompts across ${prompts.tracks.length} tracks, ` +
        `${index.length} search entries`
    )
  }

  return { pages, routes, prompts, base, index }
}

/** Remove every generated artefact, derived from the route registry itself. */
export async function cleanContent() {
  const { routes } = await import('../content/routes.mjs')
  for (const route of routes) {
    // Delete the whole route directory, or the bare file for a root-level page.
    const target = route.file.includes('/') ? route.file.split('/')[0] : route.file
    rmSync(join(siteRoot, target), { recursive: true, force: true })
  }
  rmSync(join(siteRoot, 'public/search-index.json'), { force: true })
  rmSync(join(siteRoot, 'src/styles/tokens.css'), { force: true })
}

if (import.meta.url === `file://${process.argv[1]}`) {
  if (process.argv.includes('--clean')) {
    await cleanContent()
    console.log('content: generated files removed')
  } else {
    await buildContent()
  }
}
