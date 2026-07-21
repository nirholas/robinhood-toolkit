/**
 * robinhood-toolkit · regenerate reports/bridge-tokens.json from the live chain
 * Author: nirholas · https://github.com/nirholas/robinhood-toolkit
 * License: All Rights Reserved (c) 2026 nirholas
 *
 * robinhood-toolkit · package: bridge
 *
 * Reads WETH and USDG live off Robinhood Chain mainnet and writes the
 * verifyToken() output to reports/bridge-tokens.json. Regenerate on demand:
 *
 *   npm run report --workspace bridge
 *   # or from the package: node scripts/report.mjs
 */

import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { TOKENS, verifyToken } from '../src/tokens.js'
import { ROBINHOOD_MAINNET_ID } from 'robinhood-chain'

const here = dirname(fileURLToPath(import.meta.url))
const outPath = resolve(here, '../../../reports/bridge-tokens.json')

const registry = TOKENS[ROBINHOOD_MAINNET_ID]
const symbols = Object.keys(registry)

console.log(`Verifying ${symbols.length} token(s) on chain ${ROBINHOOD_MAINNET_ID}...`)

const tokens = {}
for (const symbol of symbols) {
  const { address } = registry[symbol]
  const verified = await verifyToken(address)
  tokens[symbol] = verified
  console.log(
    `  ${symbol.padEnd(5)} ${verified.address}  ${verified.name} / ${verified.symbol}  ` +
      `decimals=${verified.decimals}  bytecode=${verified.bytecodeSize}B`,
  )
}

const report = {
  chainId: ROBINHOOD_MAINNET_ID,
  generatedAt: new Date().toISOString(),
  source: 'live on-chain read via bridge/verifyToken()',
  tokens,
}

mkdirSync(dirname(outPath), { recursive: true })
writeFileSync(outPath, JSON.stringify(report, null, 2) + '\n')
console.log(`\nWrote ${outPath}`)
