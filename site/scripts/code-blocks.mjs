/* built by nirholas x.com/nichxbt */
/**
 * robinhood-toolkit · code block affordances
 * Author: nirholas · https://github.com/nirholas/robinhood-toolkit
 * License: All Rights Reserved (c) 2026 nirholas
 *
 * The copy button is real markup in the pre-rendered HTML, added here at build
 * time, not injected at runtime. A JS-injected button means a reader without JS
 * sees nothing and a reader on a slow connection sees layout shift; only the
 * click handler in src/js/copy.js is JavaScript.
 */

export function decorateCodeBlocks(html) {
  return html
    .replace(
      /<pre([^>]*)>/g,
      (_m, attrs) =>
        `<div class="code-block"><button type="button" class="code-copy" ` +
        `aria-label="Copy code to clipboard">Copy</button><pre${attrs}>`
    )
    .replaceAll('</pre>', '</pre></div>')
}
/* built by nirholas x.com/nichxbt */
