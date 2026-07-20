/**
 * robinhood-toolkit · server-side HTML helpers for the pre-renderer
 * Author: nirholas · https://github.com/nirholas/robinhood-toolkit
 * License: MIT (c) 2026 nirholas
 *
 * These run in Node at build time only. Nothing here ships to the browser.
 */

let uid = 0

export function esc(value) {
  return String(value).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
  )
}

/** Join the configured base path with a site-absolute route. */
export function href(base, path) {
  if (/^(https?:|mailto:|#)/.test(path)) return path
  return `${base}${path.replace(/^\//, '')}`.replace(/([^:])\/{2,}/g, '$1/')
}

export function section(id, title, ...body) {
  return `<section id="${esc(id)}">
  <h2>${esc(title)}</h2>
  ${body.join('\n')}
</section>`
}

export function p(...parts) {
  return `<p>${parts.join(' ')}</p>`
}

export function list(items, { ordered = false } = {}) {
  const tag = ordered ? 'ol' : 'ul'
  return `<${tag}>\n${items.map((item) => `  <li>${item}</li>`).join('\n')}\n</${tag}>`
}

export function table({ head, rows, caption }) {
  return `<div class="table-scroll">
  <table>
    ${caption ? `<caption>${caption}</caption>` : ''}
    <thead><tr>${head.map((h) => `<th scope="col">${h}</th>`).join('')}</tr></thead>
    <tbody>
      ${rows
        .map((row) => `<tr>${row.map((cell, i) => (i === 0 ? `<th scope="row">${cell}</th>` : `<td>${cell}</td>`)).join('')}</tr>`)
        .join('\n      ')}
    </tbody>
  </table>
</div>`
}

/**
 * A code block with a working copy button. Snippets that would send a
 * transaction are copy-only by design: they are meant for the reader's own
 * terminal, never for execution in this page.
 */
export function code({ label, body, note }) {
  uid += 1
  const id = `code-${uid}`
  return `<div class="code-block">
  <div class="code-block__head">
    <span class="code-block__label">${esc(label)}</span>
    <button type="button" class="btn btn--sm copy-btn" data-copy-target="${id}">Copy</button>
  </div>
  <pre><code id="${id}">${esc(body.trim())}</code></pre>
</div>${note ? `\n<p class="muted"><small>${note}</small></p>` : ''}`
}

/**
 * Documentation callouts stay pure greyscale. The semantic color exception is
 * scoped to code output and form validation only, so weight plus a labelled
 * mono glyph carries the emphasis here.
 */
export function callout({ icon = '!', label, body, strong = false }) {
  return `<aside class="callout${strong ? ' callout--strong' : ''}">
  <span class="callout__icon" aria-hidden="true">${esc(icon)}</span>
  <div class="callout__body">
    ${label ? `<strong class="callout__label">${esc(label)}</strong>` : ''}
    ${body}
  </div>
</aside>`
}

export function cards(items, { columns = 2, base = '/' } = {}) {
  return `<ul class="card-grid${columns === 3 ? ' card-grid--3' : ''}">
${items
  .map(
    (item) => `  <li>
    <a class="card" href="${esc(href(base, item.href))}">
      <span class="card__title">${esc(item.title)}</span>
      <span class="card__body">${esc(item.body)}</span>
      ${item.meta ? `<span class="card__meta">${esc(item.meta)}</span>` : ''}
    </a>
  </li>`
  )
  .join('\n')}
</ul>`
}

export function stats(items) {
  return `<div class="stat-grid">
${items
  .map(
    (item) => `  <div class="stat">
    <span class="stat__label">${esc(item.label)}</span>
    <span class="stat__value">${esc(item.value)}</span>
    ${item.note ? `<span class="stat__note">${esc(item.note)}</span>` : ''}
  </div>`
  )
  .join('\n')}
</div>`
}

/** The shared shell for every read-only RPC widget. */
export function rpcConsole({ title, description, method, decode = 'raw', arg, to, data, decimals, symbol, buttonLabel }) {
  uid += 1
  const id = `rpc-${uid}`
  const attrs = [
    `data-rpc-method="${esc(method)}"`,
    `data-rpc-decode="${esc(decode)}"`,
    to ? `data-rpc-to="${esc(to)}"` : '',
    data ? `data-rpc-data="${esc(data)}"` : '',
    decimals ? `data-rpc-decimals="${esc(decimals)}"` : '',
    symbol ? `data-rpc-symbol="${esc(symbol)}"` : ''
  ]
    .filter(Boolean)
    .join(' ')

  return `<form class="panel" ${attrs}>
  <div class="panel__head">
    <h3 class="panel__title">${esc(title)}</h3>
    <code>${esc(method)}</code>
  </div>
  <p class="muted">${description}</p>
  ${
    arg
      ? `<div class="field">
    <label for="${id}-arg">${esc(arg.label)}</label>
    <div class="field-row">
      <input type="text" id="${id}-arg" data-rpc-arg placeholder="${esc(arg.placeholder)}"
             spellcheck="false" autocomplete="off" aria-describedby="${id}-hint ${id}-validation">
      <button type="submit" class="btn btn--primary">${esc(buttonLabel || 'Run')}</button>
    </div>
    <span class="field__hint" id="${id}-hint">${arg.hint}</span>
    <span class="validation" id="${id}-validation" data-validation data-state="idle" role="status">
      <i class="validation__icon" data-validation-icon aria-hidden="true"></i>
      <span data-validation-text></span>
    </span>
  </div>`
      : `<div class="btn-row"><button type="submit" class="btn btn--primary">${esc(buttonLabel || 'Run')}</button></div>`
  }
  <div class="output" data-rpc-output data-state="pending" role="status" aria-live="polite" hidden>
    <div class="output__head">
      <i class="output__icon" data-output-icon aria-hidden="true">•</i>
      <span data-output-label>Idle</span>
    </div>
    <pre></pre>
  </div>
</form>`
}

export function pager(base, prev, next) {
  const link = (item, dir) =>
    item
      ? `<a href="${esc(href(base, item.href))}">
      <span class="pager__dir">${dir}</span>
      <span class="pager__title">${esc(item.title)}</span>
    </a>`
      : ''
  return `<nav class="pager" aria-label="Page navigation">
  ${link(prev, 'Previous')}
  ${link(next, 'Next')}
</nav>`
}
