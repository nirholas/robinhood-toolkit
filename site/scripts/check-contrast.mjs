/* built by nirholas x.com/nichxbt */
/**
 * robinhood-toolkit · contrast conformance check
 * Author: nirholas · https://github.com/nirholas/robinhood-toolkit
 * License: All Rights Reserved (c) 2026 nirholas
 *
 * Reads the SAME src/styles/palette.json that generates tokens.css, so a
 * passing check cannot drift from what ships. The pair manifest is the
 * `contrastTargets` array in that file: every foreground/background
 * combination the site renders, in both themes, listed with its required WCAG
 * 2.2 level. A pair that is not in the manifest is a pair nobody checked, which
 * is the exact defect this file exists to make visible.
 *
 * `npm run gen` and `npm run build` already fail the build on a violation via
 * scripts/gen-tokens.mjs. This script is the reader-facing counterpart: it
 * prints every pair with its measured ratio so a contributor adding a token can
 * see the margins, and it is wired into `npm test` as the standalone gate.
 *
 * Run: npm run check:contrast
 */

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { hex as contrast } from 'wcag-contrast'

const here = dirname(fileURLToPath(import.meta.url))
const palettePath = join(here, '..', 'src/styles/palette.json')
const palette = JSON.parse(readFileSync(palettePath, 'utf8'))

/** Resolve a dotted path like "grey.600" or "state.dark.error" against the palette. */
function resolve(path) {
  const value = path.split('.').reduce((node, key) => (node == null ? node : node[key]), palette)
  return typeof value === 'string' ? value : null
}

const targets = palette.contrastTargets
if (!Array.isArray(targets) || targets.length === 0) {
  console.error('palette.json declares no contrastTargets. Nothing to check, which is itself a failure.')
  process.exit(1)
}

let failed = 0
for (const target of targets) {
  const { label, fg: fgPath, bg: bgPath, min } = target
  const fg = resolve(fgPath)
  const bg = resolve(bgPath)

  if (!fg || !bg) {
    console.error(`MISSING  ${label.padEnd(28)} unknown token ${fg ? bgPath : fgPath}`)
    failed++
    continue
  }

  const ratio = contrast(fg, bg)
  const ok = ratio >= min
  if (!ok) failed++
  console.log(
    `${ok ? 'pass' : 'FAIL'}  ${label.padEnd(28)} ${fg} on ${bg}  ` +
      `${ratio.toFixed(2)}:1 (needs ${min}:1)`
  )
}

if (failed) {
  console.error(`\n${failed} contrast pair(s) below WCAG 2.2 AA. Fix the values in ` +
    'src/styles/palette.json. Do not lower the target.')
  process.exit(1)
}
console.log(`\n${targets.length} pairs pass WCAG 2.2 AA in both themes.`)
/* built by nirholas x.com/nichxbt */
