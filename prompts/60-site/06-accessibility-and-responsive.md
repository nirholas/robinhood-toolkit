<!--
  robinhood-toolkit · build prompt: WCAG 2.2 AA conformance and responsive layout
  Author: nirholas · https://github.com/nirholas/robinhood-toolkit
  License: MIT (c) 2026 nirholas
-->

# 06 · Accessibility and responsive

## Goal

Bring the site to WCAG 2.2 AA and keep it there with an automated check rather
than a one-time audit. Contrast is the first-order risk: a strict monochrome
system puts every hierarchy decision on the greys, and two adjacent ramp steps
look deliberate while failing 4.5:1. Make that failure impossible to ship.

## Prerequisites

- Prompts 01 to 05 complete.
- `npm i -D wcag-contrast @axe-core/cli` and a browser for manual passes.

## Reference facts

- Target: WCAG 2.2 Level AA. Text and images of text need **4.5:1**. Large text
  (18.66px bold or 24px and up) needs **3:1**. UI components and graphical
  objects, including chart grid lines, borders, focus indicators, and candle
  bodies, need **3:1** against adjacent colors (1.4.11).
- Verified ratios in the prompt 02 ramp:

| Pair | Ratio | Verdict |
|---|---|---|
| `grey-900` on `grey-0` | 17.93:1 | body text, light |
| `grey-600` on `grey-0` | 6.7:1 | muted text, light |
| `grey-500` on `grey-0` | 3.95:1 | **fails 4.5:1**, large text and borders only |
| `grey-300` on `grey-0` | 1.54:1 | decorative borders only, never text |
| `grey-100` on `grey-950` | 17.67:1 | body text, dark |
| `grey-400` on `grey-950` | 8.17:1 | muted text, dark |
| `grey-500` on `grey-950` | 4.92:1 | passes as small text, dark only |

  Note the asymmetry: `grey-500` passes in dark and fails in light. A token that
  is safe in one theme and not the other is the exact trap monochrome sets, and
  it is why the checker runs both themes rather than one.
- WCAG 2.2 adds criteria this site must meet: **2.4.11 Focus Not Obscured**
  (a sticky header must not cover the focused element), **2.5.7 Dragging
  Movements** (chart pan and zoom need a non-drag alternative), **2.5.8 Target
  Size** (24 by 24 CSS pixels minimum for the theme toggle, copy buttons, and
  pager links), **3.2.6 Consistent Help** (search sits in the same header slot on
  every page), and **3.3.7 Redundant Entry**.
- Breakpoints to test: **320px**, **768px**, **1440px**. 320px is the real floor
  for small phones and for a 400% zoom reflow, which 1.4.10 requires without
  two-dimensional scrolling.
- Lightweight Charts renders to canvas, which is opaque to assistive technology.
  Every chart needs a text alternative alongside it, and the TradingView
  attribution logo must stay enabled regardless (prompt 02).

## Steps

1. Write `site/scripts/check-contrast.mjs`. It reads `palette.json` and a pair
   manifest, computes every ratio, and exits non-zero on a failure. Wire it into
   `npm test` so it gates the build, not a review.
2. Declare the pair manifest explicitly rather than deriving it. Every
   foreground/background combination the site actually renders is listed with its
   required level. A pair that is not listed is a pair nobody checked, and the
   manifest makes that visible.
3. Give the reader a way to check their own additions: document
   `npm run check:contrast`, and note the two manual tools that catch what static
   analysis cannot, DevTools' contrast readout in the color picker (which
   measures the rendered pixels, including text over a gradient or an image) and
   axe DevTools for computed-state issues.
4. Semantic HTML first. One `h1` per page, no skipped heading levels, `nav` with
   distinct `aria-label` per landmark, `main` with a matching skip link, `time`
   with `datetime`, `table` with real `th` and `scope`. Reach for ARIA only where
   there is no element, which on this site means the search combobox and the
   theme toggle's pressed state.
5. Focus indicators visible in both themes. Use `:focus-visible` with the
   `--focus-ring` token, a 2px outline and a 2px offset. Never
   `outline: none` without a replacement. Set `scroll-margin-top` on headings and
   focusable elements to clear the sticky header, which is what 2.4.11 requires.
6. Keyboard-complete the whole tutorial flow: skip link, header, search combobox,
   track sidebar, prose links, code copy buttons, playground editor and Run,
   network selector, prev/next, footer. Nothing reachable by mouse may be
   unreachable by keyboard, and nothing focusable may be invisible.
7. Solve the textarea keyboard trap in the playground. A `<textarea>` swallows
   Tab. Implement the standard escape: Escape toggles the textarea's tab-capture
   off so the next Tab moves focus out, and label the behavior in the UI.
8. Respect `prefers-reduced-motion: reduce`. Cut transitions and animations to
   near zero, disable smooth scrolling, and disable any chart auto-scroll
   animation. Charts stay interactive; they just stop animating.
9. Provide a chart text alternative. Give the canvas container
   `role="img"` with an `aria-label` summarizing the series, and render a
   `<details>` block below it containing the same data as a real table. The table
   is the accessible source of truth, not a fallback.
10. Responsive layout with CSS grid and container-relative units. At 1440px it is
    three columns (track nav, prose, TOC); at 768px the TOC collapses into a
    `<details>` above the prose; at 320px the track nav becomes a disclosure and
    the prose is single-column with horizontally scrollable code blocks. Code
    blocks scroll inside their own container; the page body never scrolls
    horizontally.

```js
/**
 * robinhood-toolkit · contrast conformance check
 * Author: nirholas · https://github.com/nirholas/robinhood-toolkit
 * License: MIT (c) 2026 nirholas
 *
 * Reads the SAME palette.json that generates tokens.css, so a passing check
 * cannot drift from what ships. Run: npm run check:contrast
 */
import { readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { hex as contrast } from 'wcag-contrast';

const SITE = dirname(import.meta.dirname);
const palette = JSON.parse(await readFile(join(SITE, 'src/styles/palette.json'), 'utf8'));

const AA_TEXT = 4.5;   // 1.4.3 normal text
const AA_LARGE = 3.0;  // 1.4.3 large text
const AA_UI = 3.0;     // 1.4.11 UI components and graphical objects

/**
 * Every foreground/background pair the site renders, both themes.
 * Adding a token to tokens.css without adding its pairs here is the defect
 * this file exists to prevent.
 */
const PAIRS = [
  // light theme, bg = grey-0, raised = grey-50, code = grey-50
  ['light body',        'grey-900', 'grey-0',   AA_TEXT],
  ['light muted',       'grey-600', 'grey-0',   AA_TEXT],
  ['light subtle',      'grey-500', 'grey-0',   AA_LARGE],
  ['light on raised',   'grey-900', 'grey-50',  AA_TEXT],
  ['light muted raised','grey-600', 'grey-50',  AA_TEXT],
  ['light code',        'grey-900', 'grey-50',  AA_TEXT],
  ['light border',      'grey-500', 'grey-0',   AA_UI],
  ['light focus ring',  'grey-900', 'grey-0',   AA_UI],
  ['light candle',      'grey-900', 'grey-0',   AA_UI],

  // dark theme, bg = grey-950, raised = grey-900, code = grey-900
  ['dark body',         'grey-100', 'grey-950', AA_TEXT],
  ['dark muted',        'grey-400', 'grey-950', AA_TEXT],
  ['dark subtle',       'grey-500', 'grey-950', AA_LARGE],
  ['dark on raised',    'grey-100', 'grey-900', AA_TEXT],
  ['dark muted raised', 'grey-400', 'grey-900', AA_TEXT],
  ['dark code',         'grey-100', 'grey-900', AA_TEXT],
  ['dark border',       'grey-500', 'grey-950', AA_UI],
  ['dark focus ring',   'grey-100', 'grey-950', AA_UI],
  ['dark candle',       'grey-100', 'grey-950', AA_UI],
];

let failed = 0;
for (const [name, fgToken, bgToken, required] of PAIRS) {
  const fg = palette[fgToken];
  const bg = palette[bgToken];
  if (!fg || !bg) {
    console.error(`MISSING  ${name}: unknown token ${fg ? bgToken : fgToken}`);
    failed++;
    continue;
  }
  const ratio = contrast(fg, bg);
  const ok = ratio >= required;
  if (!ok) failed++;
  console.log(
    `${ok ? 'pass' : 'FAIL'}  ${name.padEnd(20)} ${fgToken} on ${bgToken}  ` +
      `${ratio.toFixed(2)}:1 (needs ${required}:1)`,
  );
}

if (failed) {
  console.error(`\n${failed} contrast pair(s) below WCAG 2.2 AA.`);
  process.exit(1);
}
console.log(`\n${PAIRS.length} pairs pass WCAG 2.2 AA.`);
```

Focus, motion, and target size:

```css
/**
 * robinhood-toolkit · accessibility base rules
 * Author: nirholas · https://github.com/nirholas/robinhood-toolkit
 * License: MIT (c) 2026 nirholas
 */

:where(a, button, input, textarea, select, summary, [tabindex]):focus-visible {
  outline: 2px solid var(--focus-ring);
  outline-offset: 2px;
  border-radius: var(--radius-sm);
}

/* 2.4.11 Focus Not Obscured: the sticky header must never cover the target. */
:target,
h2, h3,
:where(a, button, input, textarea, select, summary):focus-visible {
  scroll-margin-top: calc(var(--header-height) + var(--space-4));
}

/* 2.5.8 Target Size (Minimum). */
.theme-toggle,
.code-copy,
.pager a,
.search-form button {
  min-inline-size: 24px;
  min-block-size: 24px;
}

.skip-link {
  position: absolute;
  inset-inline-start: var(--space-2);
  inset-block-start: calc(-1 * var(--space-8));
  z-index: 10;
  padding: var(--space-2) var(--space-3);
  background: var(--bg-raised);
  color: var(--fg);
  transition: inset-block-start 120ms ease;
}
.skip-link:focus-visible {
  inset-block-start: var(--space-2);
}

.visually-hidden:not(:focus):not(:active) {
  clip-path: inset(50%);
  block-size: 1px;
  inline-size: 1px;
  overflow: hidden;
  position: absolute;
  white-space: nowrap;
}

/* Code blocks scroll themselves. The page body never scrolls horizontally. */
.code-block pre,
.prose table {
  overflow-x: auto;
  max-inline-size: 100%;
}

@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
    scroll-behavior: auto !important;
  }
}
```

The chart text alternative, plus the reduced-motion and non-drag requirements:

```js
/**
 * robinhood-toolkit · accessible chart wrapper
 * Author: nirholas · https://github.com/nirholas/robinhood-toolkit
 * License: MIT (c) 2026 nirholas
 */
export function makeChartAccessible(container, { label, rows, columns }) {
  // Canvas is opaque to assistive tech. Label it, then give the real data.
  container.setAttribute('role', 'img');
  container.setAttribute('aria-label', label);

  const details = document.createElement('details');
  details.className = 'chart-data';
  const summary = document.createElement('summary');
  summary.textContent = 'View chart data as a table';

  const table = document.createElement('table');
  const thead = table.createTHead().insertRow();
  for (const column of columns) {
    const th = document.createElement('th');
    th.scope = 'col';
    th.textContent = column;
    thead.append(th);
  }
  const tbody = table.createTBody();
  for (const row of rows) {
    const tr = tbody.insertRow();
    for (const cell of row) tr.insertCell().textContent = String(cell);
  }

  details.append(summary, table);
  container.after(details);
  return details;
}

/** 2.5.7 Dragging Movements: pan and zoom must not be drag-only. */
export function addChartKeyboardControls(chart, container) {
  container.tabIndex = 0;
  container.addEventListener('keydown', (event) => {
    const scale = chart.timeScale();
    const range = scale.getVisibleLogicalRange();
    if (!range) return;
    const span = range.to - range.from;
    const step = Math.max(1, Math.round(span * 0.1));

    switch (event.key) {
      case 'ArrowLeft':
        scale.setVisibleLogicalRange({ from: range.from - step, to: range.to - step });
        break;
      case 'ArrowRight':
        scale.setVisibleLogicalRange({ from: range.from + step, to: range.to + step });
        break;
      case '+': case '=':
        scale.setVisibleLogicalRange({ from: range.from + step, to: range.to - step });
        break;
      case '-':
        scale.setVisibleLogicalRange({ from: range.from - step, to: range.to + step });
        break;
      default:
        return;
    }
    event.preventDefault();
  });
}
```

## Deliverable

- `site/scripts/check-contrast.mjs` with the full pair manifest, exposed as
  `npm run check:contrast` and included in `npm test`.
- `site/src/styles/a11y.css` covering focus, skip link, target size, scroll
  margin, and reduced motion.
- Accessible chart wrapper with the data table and keyboard pan/zoom.
- The playground keyboard escape from the textarea.
- Responsive grid at 320, 768, and 1440, with no horizontal body scroll at any
  width.
- An `Accessibility` section in `site/README.md` stating the AA target, how to
  run the contrast check, and how to add a new token pair to the manifest.

## How to verify

1. `npm run check:contrast` passes and prints every pair with its ratio. Then
   break it deliberately: change `--fg-muted` to `grey-500` in the light manifest
   row and confirm the run exits non-zero naming that pair.
2. Automated sweep on the built output:
   `npx serve site/dist` then
   `npx @axe-core/cli http://localhost:3000/tutorials/00-foundations/02-network-setup-and-rpc/ --tags wcag2a,wcag2aa,wcag22aa`.
   Zero violations. Run it against a chart page and a playground page too, since
   those carry the custom widgets.
3. Keyboard-only pass with the mouse unplugged. Tab from the top of a tutorial to
   the footer. Every stop is visible, focus never disappears behind the sticky
   header, and you can reach and activate search, theme toggle, every copy
   button, the playground Run button, and both pager links. You can also Tab
   *out* of the playground editor.
4. Both themes, both directions. Repeat step 3 in dark theme. Monochrome focus
   rings are the thing that vanishes when only one theme gets tested.
5. Reduced motion: enable it at the OS level and confirm transitions stop, the
   skip link snaps rather than slides, and no chart animates. Charts remain
   interactive.
6. Zoom to 400% at a 1280px viewport width. Content reflows to a single column
   with no horizontal scrolling of the page (1.4.10). Code blocks scroll inside
   themselves; that is allowed and expected.
7. Test at exactly 320px, 768px, and 1440px. At 320px nothing overflows the
   viewport, no tap target is under 24px, and the track nav is reachable.
8. Screen reader pass on one full tutorial with VoiceOver or NVDA: the heading
   outline is correct, landmarks are labeled, the chart announces its label and
   its data table is reachable, and search results are announced as they change.
9. Desaturate a screenshot fully. Every state remains distinguishable, including
   playground success and error output, which must still read via their icon and
   text label.

## Gotchas

- Two mid-ramp greys adjacent to each other is the signature monochrome failure.
  It looks intentional in a design review and fails the ratio. If a pair is not
  in the manifest, it has not been checked.
- A token can pass in dark and fail in light, `grey-500` being the live example.
  Always check both themes; never generalize from one.
- The contrast script checks declared token pairs only. Text over a gradient,
  over an image, or over a semi-transparent overlay needs the DevTools picker,
  which samples rendered pixels. Do not treat a green CI run as full coverage.
- `outline: none` on a focus reset, with the replacement added "later", is the
  single most common AA regression. Use `:focus-visible` and never remove the
  outline without setting one in the same rule.
- A sticky header with no `scroll-margin-top` silently violates 2.4.11: focus
  moves correctly but the element is hidden under the header, so a keyboard user
  sees nothing happen.
- `<textarea>` captures Tab and becomes a keyboard trap (2.1.2). The Escape
  escape hatch is mandatory, and it needs a visible hint or nobody discovers it.
- Canvas charts are invisible to screen readers. `aria-label` alone summarizes
  but does not convey the data; the table is what makes the content available.
- `role="img"` on the chart container hides its children from assistive tech.
  That is correct for the canvas, and it is also why the data table must live
  outside the container, not inside it.
- Chart pan and zoom that only respond to drag fail 2.5.7. Keyboard controls are
  the fix, and they also give mouse users a precise alternative.
- `prefers-reduced-motion` must not disable functionality. Cutting transitions is
  correct; removing chart interactivity is a different failure.
