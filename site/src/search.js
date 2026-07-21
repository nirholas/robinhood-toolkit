/* built by nirholas x.com/nichxbt */
/**
 * robinhood-toolkit · client-side search over the build-time static index
 * Author: nirholas · https://github.com/nirholas/robinhood-toolkit
 * License: All Rights Reserved (c) 2026 nirholas
 *
 * No hosted search service and no backend of any kind: scripts/build-content.mjs
 * writes public/search-index.json at build time and this fetches it lazily on
 * first open. That is what lets search work identically on GitHub Pages and on
 * every server-backed target.
 */

const MAX_RESULTS = 12

let indexPromise = null
let entries = []
let activeIndex = 0

function basePath() {
  const meta = document.querySelector('meta[name="site-base"]')
  return meta?.content || '/'
}

function loadIndex() {
  if (!indexPromise) {
    const url = `${basePath()}search-index.json`.replace(/\/{2,}/g, '/')
    indexPromise = fetch(url, { headers: { accept: 'application/json' } })
      .then((res) => {
        if (!res.ok) throw new Error(`Search index responded ${res.status}`)
        return res.json()
      })
      .catch((error) => {
        indexPromise = null
        throw error
      })
  }
  return indexPromise
}

function terms(query) {
  return query
    .toLowerCase()
    .split(/[^a-z0-9.+#-]+/)
    .filter((t) => t.length > 1)
}

function score(entry, queryTerms) {
  const title = entry.title.toLowerCase()
  const excerpt = entry.excerpt.toLowerCase()
  const text = entry.text.toLowerCase()
  let total = 0
  for (const term of queryTerms) {
    let termScore = 0
    if (title.startsWith(term)) termScore += 14
    if (title.includes(term)) termScore += 10
    if (entry.track && entry.track.toLowerCase().includes(term)) termScore += 4
    if (excerpt.includes(term)) termScore += 4
    const hits = text.split(term).length - 1
    if (hits) termScore += Math.min(hits, 6)
    // Every term must appear somewhere. Partial matches are noise at this size.
    if (termScore === 0) return 0
    total += termScore
  }
  return total
}

export function searchIndex(query, all = entries) {
  const queryTerms = terms(query)
  if (!queryTerms.length) return []
  return all
    .map((entry) => ({ entry, score: score(entry, queryTerms) }))
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score || a.entry.title.localeCompare(b.entry.title))
    .slice(0, MAX_RESULTS)
    .map((r) => r.entry)
}

function escapeHtml(value) {
  return value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
}

function highlight(value, queryTerms) {
  let html = escapeHtml(value)
  for (const term of queryTerms) {
    const safe = term.replace(/[.*+?^${}()|[\]\\-]/g, '\\$&')
    html = html.replace(new RegExp(`(${safe})`, 'gi'), '<mark>$1</mark>')
  }
  return html
}

function contextExcerpt(entry, queryTerms) {
  const lower = entry.text.toLowerCase()
  for (const term of queryTerms) {
    const at = lower.indexOf(term)
    if (at > -1) {
      const start = Math.max(0, at - 60)
      const slice = entry.text.slice(start, start + 180).trim()
      return (start > 0 ? '... ' : '') + slice
    }
  }
  return entry.excerpt
}

export function initSearch() {
  const dialog = document.querySelector('[data-search-dialog]')
  const trigger = document.querySelector('[data-search-trigger]')
  if (!dialog || !trigger) return

  const input = dialog.querySelector('input[type="search"]')
  const list = dialog.querySelector('[data-search-results]')
  const status = dialog.querySelector('[data-search-status]')

  function renderMessage(message, state) {
    list.innerHTML = ''
    status.hidden = false
    status.textContent = message
    status.dataset.state = state || 'idle'
  }

  function renderResults(results, queryTerms) {
    activeIndex = 0
    if (!results.length) {
      renderMessage('No matches. Try a chain ID, an endpoint name, or a track name.', 'idle')
      return
    }
    status.hidden = true
    list.innerHTML = results
      .map(
        (entry, i) => `
      <li data-active="${i === 0}">
        <a href="${escapeHtml(entry.url)}">
          <span class="search-results__title">
            <span>${highlight(entry.title, queryTerms)}</span>
            <span class="search-results__kind">${escapeHtml(entry.kind)}</span>
          </span>
          <span class="search-results__excerpt">${highlight(contextExcerpt(entry, queryTerms), queryTerms)}</span>
        </a>
      </li>`
      )
      .join('')
  }

  function moveActive(delta) {
    const items = [...list.querySelectorAll('li')]
    if (!items.length) return
    activeIndex = (activeIndex + delta + items.length) % items.length
    items.forEach((li, i) => {
      li.dataset.active = String(i === activeIndex)
    })
    items[activeIndex].scrollIntoView({ block: 'nearest' })
  }

  function run() {
    const query = input.value.trim()
    if (!query) {
      renderMessage('Type to search pages and build prompts.', 'idle')
      return
    }
    if (!entries.length) return
    renderResults(searchIndex(query), terms(query))
  }

  async function open() {
    dialog.showModal()
    input.value = ''
    renderMessage('Loading the search index...', 'idle')
    try {
      if (!entries.length) entries = await loadIndex()
      renderMessage('Type to search pages and build prompts.', 'idle')
    } catch (error) {
      renderMessage(`Search index failed to load (${error.message}). Reload the page to retry.`, 'error')
      return
    }
    input.focus()
  }

  trigger.addEventListener('click', open)

  input.addEventListener('input', run)

  input.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      // Chromium consumes Escape inside <input type="search"> to clear the
      // field, so it never reaches the dialog's own cancel handling. Close
      // explicitly or the documented Esc shortcut silently does nothing.
      event.preventDefault()
      dialog.close()
    } else if (event.key === 'ArrowDown') {
      event.preventDefault()
      moveActive(1)
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      moveActive(-1)
    } else if (event.key === 'Enter') {
      const active = list.querySelector('li[data-active="true"] a')
      if (active) {
        event.preventDefault()
        window.location.href = active.href
      }
    }
  })

  document.addEventListener('keydown', (event) => {
    const key = event.key.toLowerCase()
    const inField = ['INPUT', 'TEXTAREA'].includes(document.activeElement?.tagName)
    if ((event.metaKey || event.ctrlKey) && key === 'k') {
      event.preventDefault()
      if (!dialog.open) open()
    } else if (key === '/' && !inField && !dialog.open) {
      event.preventDefault()
      open()
    }
  })

  // Clicking the backdrop closes. The dialog element itself fills the visible
  // box, so a click landing on <dialog> is a click outside the panel.
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) dialog.close()
  })
}
/* built by nirholas x.com/nichxbt */
