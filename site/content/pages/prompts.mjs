/* built by nirholas x.com/nichxbt */
/**
 * robinhood-toolkit · build prompt index page content
 * Author: nirholas · https://github.com/nirholas/robinhood-toolkit
 * License: All Rights Reserved (c) 2026 nirholas
 *
 * Nothing on this page is hardcoded. scripts/read-prompts.mjs walks the
 * ../prompts tree at build time, parses each file's H1 and Goal paragraph, and
 * this renders whatever it found. Add a prompt file, rebuild, and it appears.
 */

import { callout, esc, href, p, pager, section } from '../ui.mjs'

export const route = {
  path: '/prompts/',
  file: 'prompts/index.html',
  nav: 'Prompts',
  modules: 'prompts',
  title: 'Build prompts',
  description:
    'A browsable index of every build prompt in the toolkit, generated at build time from the prompts directory. Each one is a self-contained task with verified facts, steps, a deliverable and a verification procedure.'
}

export function render({ base, prompts }) {
  const trackChips = [
    `<button type="button" class="chip" data-track-chip="all" aria-pressed="true">All tracks</button>`,
    ...prompts.tracks.map(
      (track) =>
        `<button type="button" class="chip" data-track-chip="${esc(track.id)}" aria-pressed="false">${esc(track.id)}</button>`
    )
  ].join('\n      ')

  const trackSections = prompts.tracks
    .map(
      (track) => `
  <section class="track" id="track-${esc(track.id)}" data-track-section="${esc(track.id)}">
    <div class="track__head">
      <h2>${esc(track.label)}</h2>
      <span class="track__count">${track.items.length} prompt${track.items.length === 1 ? '' : 's'}</span>
      <span class="muted"><code>prompts/${esc(track.id)}/</code></span>
    </div>
    <ul class="prompt-list">
${track.items
  .map(
    (item) => `      <li data-prompt-item data-track="${esc(track.id)}" data-search="${esc(
      `${item.number} ${item.title} ${item.summary} ${track.id} ${track.label}`.toLowerCase()
    )}">
        <a class="prompt-item" href="${esc(item.url)}" rel="noopener noreferrer">
          <span class="prompt-item__num">${esc(item.number)}</span>
          <span class="prompt-item__title">${esc(item.title.replace(/^\d+\s*·\s*/, ''))}</span>
          <p class="prompt-item__summary">${esc(item.summary)}</p>
        </a>
      </li>`
  )
  .join('\n')}
    </ul>
  </section>`
    )
    .join('\n')

  return `
<div class="page-head">
  <p class="eyebrow">Prompts</p>
  <h1>${prompts.total} build prompts</h1>
  <p class="lede">
    Each file is a self-contained, actionable build task. Hand one to a coding agent or work it
    yourself. Every prompt states its goal, prerequisites, verified reference facts, the exact
    deliverable, and how to verify the result. This index is generated from the
    <code>prompts/</code> directory at build time, so it cannot drift from what is actually there.
  </p>
</div>

<div data-prompts-root>
  <div class="filter-bar">
    <label class="visually-hidden" for="prompt-filter">Filter prompts</label>
    <input type="search" id="prompt-filter" data-prompt-filter placeholder="Filter by title, summary, or track"
           autocomplete="off">
    <span class="muted" data-prompt-count role="status">${prompts.total} of ${prompts.total} prompts</span>
  </div>

  <div class="filter-bar" role="group" aria-label="Filter by track">
      ${trackChips}
  </div>

  <p class="search-empty" data-prompt-empty hidden>
    No prompt matches that filter. Clear the text field or pick a different track.
  </p>

${trackSections}
</div>

${section(
  'ground-rules',
  'Ground rules every prompt follows',
  p(
    'Facts in these prompts were verified against live sources on 2026-07-20. Network parameters',
    'were confirmed by direct RPC calls, not copied from documentation. Where a fact could not be',
    'verified it is labelled <code>UNVERIFIED</code> inline, together with the check you can run',
    'yourself.'
  ),
  callout({
    icon: '>',
    label: 'How to use one',
    body: `<p>Pick a track that matches what you are building, open the lowest-numbered prompt you have
      not done, and read its prerequisites first: prompts within a track build on each other. Hand the
      whole file to a coding agent verbatim, or work it manually. Either way, do not skip the
      verification section at the end; it is the part that tells you whether the thing you built
      actually works.</p>`
  }),
  p(
    `The tracks live in the repository at`,
    `<a href="https://github.com/nirholas/robinhood-toolkit/tree/main/prompts" rel="noopener noreferrer">nirholas/robinhood-toolkit/prompts</a>.`,
    'Each entry above links to its source file.'
  )
)}

${pager(base, { href: '/agents/', title: 'Agentic trading' }, { href: '/deploy/', title: 'Deploy to five targets' })}
`
}
/* built by nirholas x.com/nichxbt */
