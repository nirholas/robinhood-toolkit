/**
 * robinhood-toolkit · client-side filter for the prompt index
 * Author: nirholas · https://github.com/nirholas/robinhood-toolkit
 * License: All Rights Reserved (c) 2026 nirholas
 *
 * The whole index is pre-rendered into the HTML at build time. This only hides
 * and shows what is already there, so the page is complete and readable with
 * JavaScript disabled.
 */

export function initPromptsFilter() {
  const root = document.querySelector('[data-prompts-root]')
  if (!root) return

  const input = root.querySelector('[data-prompt-filter]')
  const chips = [...root.querySelectorAll('[data-track-chip]')]
  // Sections only. Matching on [data-track] alone would also select the list
  // items, and hiding those as empty sections hides the entire index.
  const tracks = [...root.querySelectorAll('[data-track-section]')]
  const items = [...root.querySelectorAll('[data-prompt-item]')]
  const count = root.querySelector('[data-prompt-count]')
  const empty = root.querySelector('[data-prompt-empty]')

  let activeTrack = 'all'

  function apply() {
    const query = input.value.trim().toLowerCase()
    let visible = 0

    for (const item of items) {
      const inTrack = activeTrack === 'all' || item.dataset.track === activeTrack
      const haystack = item.dataset.search || ''
      const matches = !query || haystack.includes(query)
      const show = inTrack && matches
      item.hidden = !show
      if (show) visible += 1
    }

    for (const track of tracks) {
      const anyVisible = [...track.querySelectorAll('[data-prompt-item]')].some((item) => !item.hidden)
      track.hidden = !anyVisible
    }

    count.textContent = `${visible} of ${items.length} prompt${items.length === 1 ? '' : 's'}`
    empty.hidden = visible > 0
  }

  input.addEventListener('input', apply)

  for (const chip of chips) {
    chip.addEventListener('click', () => {
      activeTrack = chip.dataset.trackChip
      for (const other of chips) other.setAttribute('aria-pressed', String(other === chip))
      apply()
    })
  }

  apply()
}
