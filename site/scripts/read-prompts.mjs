/* built by nirholas x.com/nichxbt */
/**
 * robinhood-toolkit · build-time reader for the ../prompts tree
 * Author: nirholas · https://github.com/nirholas/robinhood-toolkit
 * License: All Rights Reserved (c) 2026 nirholas
 *
 * Walks prompts/<track>/<nn>-<slug>.md, parses each file's H1 title and first
 * real paragraph, and returns a grouped structure. Nothing about the prompt
 * index is hardcoded: adding a file to the tree adds it to the site on the next
 * build, and removing one removes it.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
export const PROMPTS_DIR = join(here, '../../prompts')
export const REPO_TREE_URL = 'https://github.com/nirholas/robinhood-toolkit/blob/main/prompts'

/** Human labels for the numeric track prefixes, derived from the directory name. */
function trackLabel(dirName) {
  return dirName
    .replace(/^\d+-/, '')
    .split('-')
    .join(' ')
    .replace(/\bapi\b/gi, 'API')
    .replace(/\bmcp\b/gi, 'MCP')
    .replace(/^./, (c) => c.toUpperCase())
}

/**
 * Strip the attribution comment, take the first H1 as the title, and take the
 * first paragraph after the "## Goal" heading as the summary. Goal sections are
 * the convention in this repo and are consistently the best one-line answer to
 * "what does this prompt build".
 */
export function parsePrompt(markdown) {
  const withoutHeader = markdown.replace(/<!--[\s\S]*?-->/g, '').trim()
  const lines = withoutHeader.split('\n')

  let title = ''
  for (const line of lines) {
    const match = /^#\s+(.+)$/.exec(line.trim())
    if (match) {
      title = match[1].trim()
      break
    }
  }

  const goalAt = lines.findIndex((line) => /^##\s+Goal\s*$/i.test(line.trim()))
  const start = goalAt === -1 ? lines.findIndex((line) => /^#\s+/.test(line.trim())) + 1 : goalAt + 1

  const paragraph = []
  for (let i = start; i < lines.length; i += 1) {
    const line = lines[i].trim()
    if (!line) {
      if (paragraph.length) break
      continue
    }
    if (line.startsWith('#')) {
      if (paragraph.length) break
      continue
    }
    paragraph.push(line)
  }

  const summary = paragraph
    .join(' ')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/[`*_]/g, '')
    .replace(/\s+/g, ' ')
    .trim()

  return { title, summary, body: withoutHeader }
}

export function readPrompts(dir = PROMPTS_DIR) {
  const tracks = []
  let total = 0

  const trackDirs = readdirSync(dir)
    .filter((entry) => statSync(join(dir, entry)).isDirectory())
    .sort()

  for (const trackDir of trackDirs) {
    const files = readdirSync(join(dir, trackDir))
      .filter((file) => file.endsWith('.md') && file.toLowerCase() !== 'readme.md')
      .sort()

    if (!files.length) continue

    const items = files.map((file) => {
      const raw = readFileSync(join(dir, trackDir, file), 'utf8')
      const { title, summary, body } = parsePrompt(raw)
      const number = /^(\d+)/.exec(file)?.[1] || ''
      return {
        file,
        number,
        slug: file.replace(/\.md$/, ''),
        title: title || file.replace(/\.md$/, ''),
        summary,
        body,
        url: `${REPO_TREE_URL}/${trackDir}/${file}`
      }
    })

    total += items.length
    tracks.push({
      id: trackDir,
      label: trackLabel(trackDir),
      url: `${REPO_TREE_URL}/${trackDir}`,
      items
    })
  }

  return { tracks, total }
}
/* built by nirholas x.com/nichxbt */
