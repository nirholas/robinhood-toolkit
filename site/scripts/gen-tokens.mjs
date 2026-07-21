/**
 * robinhood-toolkit · design token generator and WCAG contrast gate
 * Author: nirholas · https://github.com/nirholas/robinhood-toolkit
 * License: All Rights Reserved (c) 2026 nirholas
 *
 * Reads src/styles/palette.json, asserts every declared foreground/background
 * pair against its WCAG 2.2 target, and emits src/styles/tokens.css. A failing
 * pair throws, which fails the build. Monochrome makes near-greys easy to get
 * wrong by eye, so nothing here is eyeballed.
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { hex } from 'wcag-contrast'

const here = dirname(fileURLToPath(import.meta.url))
const siteRoot = join(here, '..')
const palettePath = join(siteRoot, 'src/styles/palette.json')
const outPath = join(siteRoot, 'src/styles/tokens.css')

const HEADER = `/**
 * robinhood-toolkit · generated design tokens
 * Author: nirholas · https://github.com/nirholas/robinhood-toolkit
 * License: All Rights Reserved (c) 2026 nirholas
 *
 * GENERATED FILE. Do not edit.
 * Source: src/styles/palette.json · Generator: scripts/gen-tokens.mjs
 */`

/** Resolve a dotted path like "grey.600" or "state.dark.error" against the palette. */
function resolve(palette, path) {
  const value = path.split('.').reduce((node, key) => (node == null ? node : node[key]), palette)
  if (typeof value !== 'string') throw new Error(`palette.json has no color at "${path}"`)
  return value
}

function checkContrast(palette) {
  const failures = []
  const results = []
  for (const target of palette.contrastTargets) {
    const fg = resolve(palette, target.fg)
    const bg = resolve(palette, target.bg)
    const ratio = hex(fg, bg)
    results.push({ ...target, fg, bg, ratio })
    if (ratio < target.min) {
      failures.push(
        `  ${target.label}: ${fg} on ${bg} is ${ratio.toFixed(2)}:1, needs ${target.min}:1`
      )
    }
  }
  if (failures.length) {
    throw new Error(
      `Contrast gate failed for ${failures.length} pair(s):\n${failures.join('\n')}\n` +
        'Fix the values in src/styles/palette.json. Do not lower the target.'
    )
  }
  return results
}

/* Type scale: 1.200 minor third off a 16px base, rounded to whole px equivalents
   expressed in rem so browser font-size preferences are respected. */
const TYPE_SCALE = {
  '3xs': '0.6875rem',
  '2xs': '0.75rem',
  xs: '0.8125rem',
  sm: '0.875rem',
  base: '1rem',
  md: '1.125rem',
  lg: '1.3125rem',
  xl: '1.5625rem',
  '2xl': '1.875rem',
  '3xl': '2.25rem',
  '4xl': '2.75rem',
  '5xl': '3.375rem'
}

/* Spacing scale: 4px base, doubling structure. Component CSS references these
   only. A raw px gap in a component is a bug. */
const SPACE_SCALE = {
  0: '0',
  1: '0.25rem',
  2: '0.5rem',
  3: '0.75rem',
  4: '1rem',
  5: '1.5rem',
  6: '2rem',
  7: '2.5rem',
  8: '3rem',
  9: '4rem',
  10: '5rem',
  11: '6.5rem',
  12: '8rem'
}

const LINE_HEIGHTS = { tight: '1.15', snug: '1.3', normal: '1.6', relaxed: '1.75' }
const WEIGHTS = { regular: '400', medium: '500', semibold: '600', bold: '700' }
const RADII = { sm: '3px', md: '6px', lg: '10px', pill: '999px' }
const MEASURES = { prose: '68ch', narrow: '46ch', page: '76rem' }

function block(indent, pairs) {
  return Object.entries(pairs)
    .map(([k, v]) => `${indent}${k}: ${v};`)
    .join('\n')
}

function greyVars(palette) {
  return block(
    '    ',
    Object.fromEntries(Object.entries(palette.grey).map(([step, value]) => [`--grey-${step}`, value]))
  )
}

/** Semantic layer for a theme. Components never touch --grey-* directly. */
function semantic(palette, mode) {
  const g = (step) => `var(--grey-${step})`
  const s = palette.state[mode]
  const light = mode === 'light'
  return block('    ', {
    '--bg': light ? g(0) : g(950),
    '--bg-raised': light ? g(50) : g(900),
    '--bg-sunken': light ? g(100) : g(850),
    '--bg-inverted': light ? g(900) : g(50),
    '--bg-overlay': light ? 'rgba(23, 23, 23, 0.55)' : 'rgba(0, 0, 0, 0.7)',
    '--fg': light ? g(900) : g(50),
    '--fg-muted': light ? g(600) : g(400),
    '--fg-quiet': light ? g(700) : g(300),
    '--fg-inverted': light ? g(0) : g(950),
    '--border': light ? g(200) : g(800),
    '--border-strong': light ? g(400) : g(700),
    '--border-interactive': light ? g(500) : g(500),
    '--focus-ring': light ? g(1000) : g(0),
    '--focus-ring-offset': light ? g(0) : g(950),
    '--shadow-sm': light
      ? '0 1px 2px rgba(0, 0, 0, 0.08)'
      : '0 1px 2px rgba(0, 0, 0, 0.6)',
    '--shadow-md': light
      ? '0 4px 16px rgba(0, 0, 0, 0.10)'
      : '0 4px 16px rgba(0, 0, 0, 0.7)',
    '--state-error': s.error,
    '--state-success': s.success,
    '--state-warning': s.warning,
    /* Chart tokens. Lightweight Charts does not inherit CSS, so JS reads these
       off the computed style and re-applies them on every theme change. */
    '--chart-bg': light ? g(0) : g(950),
    '--chart-text': light ? g(600) : g(400),
    '--chart-grid': light ? g(100) : g(850),
    '--chart-border': light ? g(300) : g(700),
    '--chart-crosshair': light ? g(500) : g(500),
    '--chart-series': light ? g(900) : g(50),
    /* Up vs down cannot be green vs red in a monochrome system. Two clearly
       separated greys, always accompanied by a printed legend. */
    '--chart-up': light ? g(900) : g(50),
    '--chart-down': light ? g(400) : g(600)
  })
}

function render(palette) {
  return `${HEADER}

:root {
  color-scheme: light dark;

  /* Grey ramp: the entire base palette. No hues. */
${greyVars(palette)}

  /* Type scale (1.200 minor third, 16px base) */
${block('  ', Object.fromEntries(Object.entries(TYPE_SCALE).map(([k, v]) => [`--text-${k}`, v])))}

  /* Spacing scale (4px base) */
${block('  ', Object.fromEntries(Object.entries(SPACE_SCALE).map(([k, v]) => [`--space-${k}`, v])))}

  /* Line heights */
${block('  ', Object.fromEntries(Object.entries(LINE_HEIGHTS).map(([k, v]) => [`--leading-${k}`, v])))}

  /* Weights */
${block('  ', Object.fromEntries(Object.entries(WEIGHTS).map(([k, v]) => [`--weight-${k}`, v])))}

  /* Radii */
${block('  ', Object.fromEntries(Object.entries(RADII).map(([k, v]) => [`--radius-${k}`, v])))}

  /* Measures */
${block('  ', Object.fromEntries(Object.entries(MEASURES).map(([k, v]) => [`--measure-${k}`, v])))}

  /* Motion. Every duration collapses to 0 under prefers-reduced-motion. */
  --ease: cubic-bezier(0.2, 0, 0.2, 1);
  --duration-fast: 120ms;
  --duration-base: 200ms;
  --duration-slow: 320ms;

  --font-sans: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  --font-mono: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace;

  /* Light is the default token set. */
${semantic(palette, 'light')}
}

/* OS preference is the default signal. */
@media (prefers-color-scheme: dark) {
  :root {
${semantic(palette, 'dark')}
  }
}

/* The manual toggle stamps data-theme on the root and must win in BOTH
   directions, including dark OS preference plus an explicit light choice. */
:root[data-theme="dark"] {
  color-scheme: dark;
${semantic(palette, 'dark')}
}

:root[data-theme="light"] {
  color-scheme: light;
${semantic(palette, 'light')}
}

@media (prefers-reduced-motion: reduce) {
  :root {
    --duration-fast: 0ms;
    --duration-base: 0ms;
    --duration-slow: 0ms;
  }
}
`
}

export function generateTokens({ quiet = false } = {}) {
  const palette = JSON.parse(readFileSync(palettePath, 'utf8'))
  const results = checkContrast(palette)
  mkdirSync(dirname(outPath), { recursive: true })
  writeFileSync(outPath, render(palette))
  if (!quiet) {
    const worst = results.reduce((a, b) => (a.ratio / a.min < b.ratio / b.min ? a : b))
    console.log(
      `tokens: ${results.length} contrast pairs pass (tightest margin: ${worst.label} at ${worst.ratio.toFixed(2)}:1 against a ${worst.min}:1 target)`
    )
  }
  return results
}

if (import.meta.url === `file://${process.argv[1]}`) {
  generateTokens()
}
