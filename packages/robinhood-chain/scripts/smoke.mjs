/* built by nirholas x.com/nichxbt */
/**
 * robinhood-chain · live smoke test
 * Author: nirholas · https://github.com/nirholas/robinhood-toolkit
 * License: All Rights Reserved (c) 2026 nirholas
 *
 * robinhood-toolkit · package: robinhood-chain
 *
 * Read-only. Confirms the chain ID, the Multicall3 deployment, the shipped
 * token constants, and that the live USDG ticker collision is rejected.
 *
 *   node scripts/smoke.mjs
 */

import { createPublicClient, http } from 'viem'

import {
  MULTICALL3_ADDRESS,
  NotCanonicalTokenError,
  USDG,
  WETH,
  assertCanonicalToken,
  formatToken,
  hasMulticall3,
  readTokenMetadata,
  robinhoodChain,
  scanLogs,
} from '../index.js'

const FAKE_USDG = '0x8218d73C00567A01481495Ad6c5143e00D5BB5b4'

const client = createPublicClient({
  chain: robinhoodChain,
  transport: http(process.env.RH_MAINNET_RPC ?? robinhoodChain.rpcUrls.default.http[0], { timeout: 20_000 }),
})

const chainId = await client.getChainId()
console.log(`chain id            ${chainId}  ${chainId === robinhoodChain.id ? 'OK' : 'MISMATCH'}`)
console.log(`head block          ${await client.getBlockNumber()}`)
console.log(`multicall3          ${(await hasMulticall3(client)) ? `deployed at ${MULTICALL3_ADDRESS}` : 'MISSING'}`)

for (const token of [USDG, WETH]) {
  const meta = await readTokenMetadata(client, token.address)
  const match = meta.decimals === token.decimals && meta.name === token.name
  console.log(
    `${token.symbol.padEnd(6)} ${meta.address}  name ${JSON.stringify(meta.name).padEnd(17)} ` +
      `decimals ${String(meta.decimals).padEnd(3)} ${match ? 'OK' : 'MISMATCH'}`,
  )
}

const impostor = await readTokenMetadata(client, FAKE_USDG)
console.log(
  `\nticker collision, both live and both answering to "USDG":\n` +
    `  ${USDG.address}  ${JSON.stringify(USDG.name)}  ${USDG.decimals} decimals\n` +
    `  ${impostor.address}  ${JSON.stringify(impostor.name)}  ${impostor.decimals} decimals`,
)
console.log(
  `  same raw amount 1500000n formats as ${formatToken(1_500_000n, USDG.decimals)} vs ` +
    `${formatToken(1_500_000n, impostor.decimals)}`,
)

try {
  await assertCanonicalToken(client, FAKE_USDG, USDG)
  console.error('  FAIL: the impostor was accepted as canonical USDG')
  process.exitCode = 1
} catch (error) {
  if (!(error instanceof NotCanonicalTokenError)) throw error
  console.log(`  assertCanonicalToken rejected it: ${error.mismatches.map((m) => m.field).join(', ')} mismatch  OK`)
}

const head = await client.getBlockNumber()
const { logs, stats } = await scanLogs({ client, address: WETH.address, fromBlock: head - 2000n, toBlock: head })
console.log(
  `\nlog scan            ${logs.length} WETH logs over 2001 blocks in ${stats.elapsedMs}ms, ` +
    `${stats.chunksScanned} chunks, ${stats.halvings} halvings`,
)
/* built by nirholas x.com/nichxbt */
