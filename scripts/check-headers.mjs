/**
 * robinhood-toolkit · attribution header linter
 * Author: nirholas · https://github.com/nirholas/robinhood-toolkit
 * License: All Rights Reserved (c) 2026 nirholas
 */

import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { extname } from 'node:path'

const CHECKED = new Set(['.md', '.js', '.mjs', '.ts', '.tsx', '.jsx', '.sol', '.sh', '.yaml', '.yml', '.toml', '.css'])
const SKIP = [/^LICENSE$/, /^\.github\//, /(^|\/)node_modules\//, /(^|\/)dist\//, /^CHANGELOG\.md$/]

const MARKER = 'robinhood-toolkit ·'
const AUTHOR = 'Author: nirholas'
const LICENSE = 'License: All Rights Reserved (c) 2026 nirholas'

function tracked() {
  return execFileSync('git', ['ls-files'], { encoding: 'utf8' })
    .split('\n')
    .filter(Boolean)
    .filter((f) => CHECKED.has(extname(f)))
    .filter((f) => !SKIP.some((re) => re.test(f)))
}

const missing = []

for (const file of tracked()) {
  // The header must sit in the opening region of the file, not buried later.
  const head = readFileSync(file, 'utf8').slice(0, 600)
  const gaps = []
  if (!head.includes(MARKER)) gaps.push('project marker')
  if (!head.includes(AUTHOR)) gaps.push('author line')
  if (!head.includes(LICENSE)) gaps.push('license line')
  if (gaps.length) missing.push({ file, gaps })
}

if (missing.length) {
  console.error(`\nMissing attribution header in ${missing.length} file(s):\n`)
  for (const { file, gaps } of missing) console.error(`  ${file}  (${gaps.join(', ')})`)
  console.error('\nFormat per file type is documented in ATTRIBUTION.md\n')
  process.exit(1)
}

console.log(`Attribution headers present in all ${tracked().length} checked files.`)
