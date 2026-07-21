/* built by nirholas x.com/nichxbt */
/**
 * robinhood-toolkit · tutorial frontmatter contract
 * Author: nirholas · https://github.com/nirholas/robinhood-toolkit
 * License: All Rights Reserved (c) 2026 nirholas
 *
 * One contract, validated at build time. A missing or malformed field fails the
 * build with the filename in the message. Silent defaults are the failure mode
 * this guards against: they produce pages with empty <title> tags that nobody
 * notices for months.
 */

const REQUIRED = ['title', 'description', 'track', 'order', 'updated']
const NETWORKS = new Set(['mainnet', 'testnet'])
const BOOLEANS = ['chart', 'playground', 'draft']

export function validateFrontmatter(data, file) {
  const fail = (msg) => {
    throw new Error(`${file}: ${msg}`)
  }

  for (const key of REQUIRED) {
    if (data[key] === undefined || data[key] === '') fail(`missing frontmatter "${key}"`)
  }
  if (typeof data.title !== 'string') fail('"title" must be a string')
  if (typeof data.description !== 'string') fail('"description" must be a string')
  if (typeof data.track !== 'string') fail('"track" must be a string')
  if (typeof data.order !== 'number') fail('"order" must be a number')
  if (Number.isNaN(Date.parse(data.updated))) fail('"updated" must be an ISO date')

  if (data.network !== undefined && !NETWORKS.has(data.network)) {
    fail(`"network" must be mainnet or testnet, got ${JSON.stringify(data.network)}`)
  }
  for (const key of BOOLEANS) {
    if (data[key] !== undefined && typeof data[key] !== 'boolean') {
      fail(`"${key}" must be a boolean`)
    }
  }
  if (data.prerequisites !== undefined) {
    if (!Array.isArray(data.prerequisites) || data.prerequisites.some((r) => typeof r !== 'string')) {
      fail('"prerequisites" must be an array of route paths')
    }
  }
  // The lede paragraph and the meta description render from this one field, so
  // the cap is a real constraint on both at once.
  if (data.description.length > 160) {
    fail(`"description" is ${data.description.length} chars, meta description caps at 160`)
  }
  return data
}
/* built by nirholas x.com/nichxbt */
