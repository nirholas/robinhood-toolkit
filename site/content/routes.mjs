/* built by nirholas x.com/nichxbt */
/**
 * robinhood-toolkit · route registry
 * Author: nirholas · https://github.com/nirholas/robinhood-toolkit
 * License: All Rights Reserved (c) 2026 nirholas
 *
 * The single source of truth for what pages exist. The pre-renderer writes one
 * real HTML file per entry, vite.config.js turns the same list into its
 * multi-page build inputs, and the nav in every page header is built from it.
 * Adding a page means adding a module here and nothing else.
 */

import * as home from './pages/home.mjs'
import * as start from './pages/start.mjs'
import * as chain from './pages/chain.mjs'
import * as risk from './pages/risk.mjs'
import * as charts from './pages/charts.mjs'
import * as api from './pages/api.mjs'
import * as agents from './pages/agents.mjs'
import * as prompts from './pages/prompts.mjs'
import * as deploy from './pages/deploy.mjs'
import * as notFound from './pages/not-found.mjs'

const modules = [home, start, chain, risk, charts, api, agents, prompts, deploy, notFound]

/** Route metadata only. Safe to import from vite.config.js. */
export const routes = modules.map((mod) => mod.route)

/** Route metadata plus its render function. Used by the pre-renderer. */
export const pages = modules.map((mod) => ({ ...mod.route, render: mod.render }))
/* built by nirholas x.com/nichxbt */
