/* built by nirholas x.com/nichxbt */
/**
 * robinhood-toolkit · site entry, loaded by every pre-rendered page
 * Author: nirholas · https://github.com/nirholas/robinhood-toolkit
 * License: All Rights Reserved (c) 2026 nirholas
 *
 * Progressive enhancement only. Every page is a real HTML document that reads
 * and navigates correctly with this file blocked; nothing here creates content
 * that is not already in the markup.
 */

import './styles/base.css'
import './styles/components.css'
import { initTheme } from './theme.js'
import { initSearch } from './search.js'
import { initCopyButtons } from './copy.js'

initTheme()
initSearch()
initCopyButtons()

/* Page-specific modules are attached by the pre-renderer through a data
   attribute on <body>, so a page only pays for what it uses. */
const modules = {
  rpc: () => import('./rpc-console.js').then((m) => m.initRpcConsoles()),
  charts: () => import('./charts.js').then((m) => m.initCharts()),
  prompts: () => import('./prompts-filter.js').then((m) => m.initPromptsFilter())
}

for (const name of (document.body.dataset.modules || '').split(/\s+/).filter(Boolean)) {
  const load = modules[name]
  if (load) {
    load().catch((error) => {
      console.error(`Module "${name}" failed to load:`, error)
    })
  }
}
/* built by nirholas x.com/nichxbt */
