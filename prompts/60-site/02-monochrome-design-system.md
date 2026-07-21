<!--
  robinhood-toolkit · build prompt: strict monochrome design system and theme tokens
  Author: nirholas · https://github.com/nirholas/robinhood-toolkit
  License: All Rights Reserved (c) 2026 nirholas
-->

# 02 · Monochrome design system

## Goal

Build the token layer the whole site renders from: a pure greyscale ramp, a type
scale, a spacing scale, an inverted dark token set, a theme toggle that beats the
OS setting in both directions, and an explicit chart token mapping for
Lightweight Charts. After this prompt, no component CSS contains a raw color, a
raw font size, or a raw pixel gap.

## Prerequisites

- Prompt 01 complete. `site/src/styles/` exists and is imported by the page
  template.
- `npm i -D wcag-contrast` for the generator's built-in ratio assertions.

## Reference facts

- **Strict monochrome is a hard requirement from the project owner.** Pure
  greyscale only. No accent hue anywhere in the base system. Hierarchy is carried
  entirely by contrast, weight, and spacing. Do not introduce a brand hue, a
  tinted grey, or a colored link state.
- **The one permitted exception** is semantic state where greyscale would be an
  accessibility failure: error, success, and warning in code output and form
  validation. Two conditions apply, both mandatory:
  1. Color is never the only signal. Every semantic state pairs the color with an
     icon plus a text label. This is WCAG 1.4.1 Use of Color, and it is also what
     makes the states legible to a reader who has the site in monochrome by
     preference rather than by design.
  2. The exception does not leak. Semantic colors are usable only in code output
     panes and form validation messages. They are not available for links,
     buttons, headings, charts, badges, or navigation.
- Contrast boundaries in the ramp below, computed against the theme backgrounds:
  `grey-500` on `grey-0` is 3.95:1, which passes 3:1 for large text and UI
  borders but fails 4.5:1 for body text. `grey-600` on `grey-0` is 6.7:1 and
  `grey-400` on `grey-950` is 8.2:1, so those are the muted-text tokens. Prompt 06
  turns this into an enforced check.
- Lightweight Charts does not inherit CSS. Every color it draws is an explicit
  option, so the theme mapping has to be handed to it in JS and reapplied when
  the theme changes.
- Lightweight Charts is Apache 2.0 and its license requires naming TradingView as
  the product creator with a link to <https://www.tradingview.com/>. The built-in
  `layout.attributionLogo` option satisfies this and defaults to `true`. Any page
  rendering a chart must leave it on. Passing `attributionLogo: false` is a
  license violation, not a style choice.

## Steps

1. Create `site/src/styles/palette.json` as the single source of truth for every
   grey. One file, consumed by both the CSS generator and the contrast checker in
   prompt 06, so the two can never drift.
2. Write `site/scripts/gen-tokens.mjs`, which reads `palette.json` and emits
   `src/styles/tokens.css`. Run it from `prebuild` alongside the content build.
3. Define the semantic token layer in `tokens.css`. Components reference only
   semantic names (`--fg`, `--fg-muted`, `--bg`, `--bg-raised`, `--border`), never
   ramp steps. Swapping a theme then means reassigning the semantic layer, not
   auditing every component.
4. Emit the dark token set three times, in this cascade order:
   `:root` (light defaults), `@media (prefers-color-scheme: dark)` under
   `:root:not([data-theme='light'])`, then `:root[data-theme='dark']`. That
   ordering is what makes a manual toggle beat the OS setting in **both**
   directions. A bare `prefers-color-scheme` block with no `:not()` guard wins
   over `[data-theme='light']` on an OS-dark machine and the toggle appears
   broken one way only.
5. Set `color-scheme: light dark` per theme so form controls, scrollbars, and the
   focus ring follow.
6. Define the type scale as tokens on a 1.25 ratio from a 16px base, and the
   spacing scale on a 4px base. Component CSS uses only these. A magic number in
   component CSS is a defect.
7. Write `site/src/js/theme.js` and inline it in `<head>` before any stylesheet
   link. It reads `localStorage.theme`, sets `data-theme` on
   `document.documentElement`, and exposes a toggle. Running it in the body or
   deferring it produces a flash of the wrong theme on every load.
8. Write `site/src/js/chart-theme.js` exporting `chartOptionsFor(theme)` and
   `seriesOptionsFor(theme)`, reading the same CSS custom properties via
   `getComputedStyle` so the chart mapping cannot drift from the CSS.
9. Decide and document the candle encoding. Green/up and red/down are unavailable
   in a monochrome system, and are a color-alone signal anyway. **Use fill:
   direction up renders hollow (transparent body, foreground-colored border and
   wick), direction down renders solid foreground.** Fill is a shape difference
   that survives greyscale, low vision, and print. Two distinct greys are the
   fallback if a series type does not support hollow bodies, and in that case the
   two greys must differ by at least 3:1 from each other and from the background.
10. Write `site/src/styles/components.css` for the primitives: prose, code block,
    callout, button, input, table, card. Tokens only.

`palette.json`, the single source of truth:

```json
{
  "grey-0":    "#ffffff",
  "grey-50":   "#fafafa",
  "grey-100":  "#f4f4f4",
  "grey-200":  "#e6e6e6",
  "grey-300":  "#d0d0d0",
  "grey-400":  "#a8a8a8",
  "grey-500":  "#808080",
  "grey-600":  "#5c5c5c",
  "grey-700":  "#3d3d3d",
  "grey-800":  "#262626",
  "grey-900":  "#171717",
  "grey-950":  "#0d0d0d",
  "grey-1000": "#000000"
}
```

`tokens.css`, the semantic layer and both themes:

```css
/**
 * robinhood-toolkit · design tokens
 * Author: nirholas · https://github.com/nirholas/robinhood-toolkit
 * License: All Rights Reserved (c) 2026 nirholas
 *
 * GENERATED by scripts/gen-tokens.mjs from src/styles/palette.json.
 * Edit the JSON, not this file.
 */

:root {
  /* Ramp. Components must not reference these directly. */
  --grey-0: #ffffff;   --grey-50: #fafafa;  --grey-100: #f4f4f4;
  --grey-200: #e6e6e6; --grey-300: #d0d0d0; --grey-400: #a8a8a8;
  --grey-500: #808080; --grey-600: #5c5c5c; --grey-700: #3d3d3d;
  --grey-800: #262626; --grey-900: #171717; --grey-950: #0d0d0d;
  --grey-1000: #000000;

  /* Type scale, 1.25 ratio from 16px. */
  --fs-xs: 0.75rem;   --fs-sm: 0.875rem; --fs-base: 1rem;
  --fs-md: 1.25rem;   --fs-lg: 1.5625rem; --fs-xl: 1.9531rem;
  --fs-2xl: 2.4414rem;
  --lh-tight: 1.2; --lh-normal: 1.6; --lh-prose: 1.7;
  --fw-normal: 400; --fw-medium: 500; --fw-bold: 700;

  /* Spacing scale, 4px base. */
  --space-1: 0.25rem; --space-2: 0.5rem;  --space-3: 0.75rem;
  --space-4: 1rem;    --space-5: 1.5rem;  --space-6: 2rem;
  --space-7: 3rem;    --space-8: 4rem;

  --radius-sm: 3px; --radius-md: 6px;
  --measure: 68ch;
  --border-width: 1px;

  --font-sans: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  --font-mono: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;

  /* Semantic layer, light theme. This is the only layer components read. */
  --bg: var(--grey-0);
  --bg-raised: var(--grey-50);
  --bg-sunken: var(--grey-100);
  --bg-code: var(--grey-50);
  --fg: var(--grey-900);
  --fg-muted: var(--grey-600);   /* 6.7:1 on --bg */
  --fg-subtle: var(--grey-500);  /* 3.95:1, large text and UI only */
  --border: var(--grey-300);
  --border-strong: var(--grey-500);
  --focus-ring: var(--grey-900);
  --selection-bg: var(--grey-200);

  color-scheme: light;
}

/* OS preference, but only when the reader has not chosen light explicitly. */
@media (prefers-color-scheme: dark) {
  :root:not([data-theme='light']) {
    --bg: var(--grey-950);
    --bg-raised: var(--grey-900);
    --bg-sunken: var(--grey-1000);
    --bg-code: var(--grey-900);
    --fg: var(--grey-100);
    --fg-muted: var(--grey-400);   /* 8.2:1 on --bg */
    --fg-subtle: var(--grey-500);  /* 4.9:1 on --bg */
    --border: var(--grey-700);
    --border-strong: var(--grey-500);
    --focus-ring: var(--grey-100);
    --selection-bg: var(--grey-700);
    color-scheme: dark;
  }
}

/* Explicit choice wins over the OS in both directions. Must come last. */
:root[data-theme='dark'] {
  --bg: var(--grey-950);
  --bg-raised: var(--grey-900);
  --bg-sunken: var(--grey-1000);
  --bg-code: var(--grey-900);
  --fg: var(--grey-100);
  --fg-muted: var(--grey-400);
  --fg-subtle: var(--grey-500);
  --border: var(--grey-700);
  --border-strong: var(--grey-500);
  --focus-ring: var(--grey-100);
  --selection-bg: var(--grey-700);
  color-scheme: dark;
}

/*
 * THE ONE EXCEPTION TO MONOCHROME.
 * Semantic state in code output and form validation only. Greyscale here would
 * be an accessibility failure: a reader cannot tell a passing run from a thrown
 * error by weight alone. Every use MUST pair the color with an icon and a text
 * label, so the color is reinforcement and never the signal (WCAG 1.4.1).
 * These tokens are not available to links, buttons, headings, charts, badges,
 * or navigation. Do not widen this list.
 */
:root {
  --state-error: #b3261e;
  --state-success: #1b5e20;
  --state-warning: #7a4f01;
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme='light']) {
    --state-error: #f2b8b5;
    --state-success: #a5d6a7;
    --state-warning: #e3b341;
  }
}
:root[data-theme='dark'] {
  --state-error: #f2b8b5;
  --state-success: #a5d6a7;
  --state-warning: #e3b341;
}
```

The theme toggle, inlined in `<head>`:

```html
<script>
  /* robinhood-toolkit · theme bootstrap. Inline and synchronous by design:
     deferring this flashes the wrong theme on every page load. */
  (function () {
    try {
      var t = localStorage.getItem('theme');
      if (t === 'light' || t === 'dark') {
        document.documentElement.setAttribute('data-theme', t);
      }
    } catch (e) {
      /* Storage blocked. Fall through to the OS preference. */
    }
  })();
</script>
```

```js
/**
 * robinhood-toolkit · theme toggle
 * Author: nirholas · https://github.com/nirholas/robinhood-toolkit
 * License: All Rights Reserved (c) 2026 nirholas
 */
const root = document.documentElement;

export function currentTheme() {
  const explicit = root.getAttribute('data-theme');
  if (explicit === 'light' || explicit === 'dark') return explicit;
  return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function setTheme(theme) {
  root.setAttribute('data-theme', theme);
  try {
    localStorage.setItem('theme', theme);
  } catch {}
  // Charts do not inherit CSS. They subscribe to this.
  dispatchEvent(new CustomEvent('themechange', { detail: { theme } }));
}

export function initThemeToggle(button) {
  const sync = () => {
    const t = currentTheme();
    button.setAttribute('aria-pressed', String(t === 'dark'));
    button.setAttribute('aria-label', `Switch to ${t === 'dark' ? 'light' : 'dark'} theme`);
  };
  button.addEventListener('click', () => {
    setTheme(currentTheme() === 'dark' ? 'light' : 'dark');
    sync();
  });
  // Follow the OS while the reader has made no explicit choice.
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', sync);
  sync();
}
```

The chart token mapping. Values are read from the same CSS custom properties, so
the chart cannot drift from the stylesheet:

```js
/**
 * robinhood-toolkit · Lightweight Charts theme mapping
 * Author: nirholas · https://github.com/nirholas/robinhood-toolkit
 * License: All Rights Reserved (c) 2026 nirholas
 */
const token = (name) =>
  getComputedStyle(document.documentElement).getPropertyValue(name).trim();

/** Layout, grid, scales. Call on create and again on every themechange. */
export function chartOptionsFor() {
  return {
    layout: {
      background: { color: token('--bg') },
      textColor: token('--fg-muted'),
      fontFamily: token('--font-sans'),
      // TradingView attribution, required by the Apache 2.0 license terms.
      // Default is true. Never set this to false.
      attributionLogo: true,
    },
    grid: {
      vertLines: { color: token('--border') },
      horzLines: { color: token('--border') },
    },
    rightPriceScale: { borderColor: token('--border-strong') },
    timeScale: { borderColor: token('--border-strong') },
    crosshair: {
      vertLine: { color: token('--fg-subtle'), labelBackgroundColor: token('--fg') },
      horzLine: { color: token('--fg-subtle'), labelBackgroundColor: token('--fg') },
    },
  };
}

/**
 * Candles in a monochrome system.
 * Up   = hollow: transparent body, foreground border and wick.
 * Down = solid foreground.
 * Fill is a shape difference, so it survives greyscale, low vision, and print.
 * Green/red would be both off-system and a color-alone signal.
 */
export function seriesOptionsFor() {
  const fg = token('--fg');
  return {
    upColor: 'rgba(0,0,0,0)',
    borderUpColor: fg,
    wickUpColor: fg,
    downColor: fg,
    borderDownColor: fg,
    wickDownColor: fg,
  };
}

/** Wire once per chart instance. */
export function bindChartTheme(chart, series) {
  const apply = () => {
    chart.applyOptions(chartOptionsFor());
    if (series) series.applyOptions(seriesOptionsFor());
  };
  addEventListener('themechange', apply);
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', apply);
  return () => removeEventListener('themechange', apply);
}
```

## Deliverable

- `site/src/styles/palette.json`, `scripts/gen-tokens.mjs`, generated
  `tokens.css`, and `components.css` built entirely from tokens.
- `site/src/js/theme.js` plus the inline head bootstrap in the page template.
- `site/src/js/chart-theme.js` exporting the mapping and the rebind helper.
- A `Design system` section in `site/README.md` stating the strict-monochrome
  rule, the semantic-state exception and its two conditions, the candle encoding
  decision, and the attribution requirement.

## How to verify

1. No raw colors escaped into components:
   `grep -nE '#[0-9a-fA-F]{3,8}|rgb\(|hsl\(' site/src/styles/components.css`
   returns nothing. The only hex literals in the tree are `palette.json` and the
   three documented state tokens.
2. No magic numbers: `grep -nE ':\s*[0-9]+px' site/src/styles/components.css`
   returns nothing except `--border-width` usage.
3. Toggle beats the OS in both directions. On an OS set to dark, choose light and
   reload: the page stays light. On an OS set to light, choose dark and reload:
   it stays dark. Then clear `localStorage.theme` and confirm it follows the OS
   again.
4. No flash of wrong theme: hard-reload with the cache disabled on a throttled
   connection, in both themes. Any flash means the bootstrap is not inline and
   synchronous in `<head>`.
5. Charts retheme live. Open a chart page, toggle the theme, and confirm the
   background, grid, text, borders, and candles all update with no reload.
6. Attribution present: the TradingView logo renders in the chart pane.
   `grep -rn 'attributionLogo' site/src` shows no occurrence set to `false`.
7. Greyscale audit: take a screenshot, desaturate it fully, and compare. Nothing
   outside code-output and form-validation states may change appearance.

## Gotchas

- `@media (prefers-color-scheme: dark)` without the `:not([data-theme='light'])`
  guard has higher weight than the plain `:root` block, so a reader on an
  OS-dark machine cannot force light. The toggle then looks broken in exactly one
  direction, which is easy to miss when you test on a light machine.
- `:root[data-theme='dark']` must come after the media block in source order.
  Same specificity, so source order decides.
- `getComputedStyle` returns the resolved value only after the stylesheet has
  applied. Call `chartOptionsFor()` after first paint, not during module
  evaluation at the top of a deferred script.
- Lightweight Charts inherits nothing from CSS. If you skip `bindChartTheme`, the
  chart silently keeps the theme it was created with and looks broken after a
  toggle.
- `attributionLogo: false` removes required attribution. Treat it as a license
  violation. Do not add it even temporarily for a screenshot.
- Two mid-ramp greys next to each other look intentional and fail contrast. Any
  new pair goes through the prompt 06 checker before it ships.
- `color-scheme` is what themes native scrollbars, form controls, and the default
  focus ring. Omitting it leaves light-mode widgets on a dark page.
- Do not add hover states that introduce a hue. Hover in this system is a change
  in background step, border weight, or underline, never a color.
