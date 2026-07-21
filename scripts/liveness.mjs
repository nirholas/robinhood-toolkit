#!/usr/bin/env node
/**
 * robinhood-toolkit · standalone sequencer liveness monitor
 * Author: nirholas · https://github.com/nirholas/robinhood-toolkit
 * License: MIT (c) 2026 nirholas
 *
 * Run:
 *   node scripts/liveness.mjs                 # mainnet, RPC + feed cross-check
 *   node scripts/liveness.mjs --testnet
 *   node scripts/liveness.mjs --no-feed
 *   node scripts/liveness.mjs --interval 1000
 *   node scripts/liveness.mjs --rpc https://unreachable.invalid   # prove the failure path
 *
 * Prints one line per tick. Exit codes: leave it running; Ctrl-C to stop.
 */

import { monitorLiveness, robinhoodChain, robinhoodTestnet } from '../packages/risk/src/liveness.js'

function parseArgs(argv) {
  const args = { testnet: false, feed: true, intervalMs: 2_000, rpcUrl: undefined }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--testnet') args.testnet = true
    else if (a === '--no-feed') args.feed = false
    else if (a === '--interval') args.intervalMs = Number(argv[++i]) || args.intervalMs
    else if (a === '--rpc') args.rpcUrl = argv[++i]
    else if (a === '--help' || a === '-h') args.help = true
  }
  return args
}

const args = parseArgs(process.argv.slice(2))

if (args.help) {
  console.log(`Robinhood Chain sequencer liveness monitor

  --testnet          monitor testnet (default: mainnet)
  --no-feed          skip the WebSocket feed cross-check
  --interval <ms>    poll cadence (default 2000)
  --rpc <url>        override the RPC endpoint (point at an unreachable host to
                     confirm the monitor reports "unreachable" instead of hanging)
  -h, --help         this text`)
  process.exit(0)
}

const chain = args.testnet ? robinhoodTestnet : robinhoodChain

const glyph = { healthy: '✓', degraded: '~', stalled: '✗', unreachable: '⚠', unknown: '?' }

console.error(
  `monitoring ${chain.name} (chain ${chain.id}) every ${args.intervalMs}ms · feed=${args.feed ? 'on' : 'off'}${
    args.rpcUrl ? ` · rpc=${args.rpcUrl}` : ''
  }\n`,
)

const stop = monitorLiveness(
  (s) => {
    const mark = glyph[s.status] ?? '?'
    const parts = [
      `${mark} ${s.status.padEnd(11)}`,
      `head=${s.head ?? '—'}`,
      `silent=${s.silentForMs ?? 0}ms`,
      `feed=${s.feedStatus}`,
      `submit=${s.canSubmit ? 'ON' : 'OFF'}`,
    ]
    if (s.divergence) parts.push(`DIVERGENCE:${s.divergence}`)
    if (s.error) parts.push(`err="${s.error}"`)
    console.log(parts.join('  '))
    if (s.status === 'stalled' || s.status === 'unreachable') {
      console.log(`     ↳ exit: ${s.exit.path} (~${s.exit.periodDays} days)`)
    }
  },
  { chain, intervalMs: args.intervalMs, feed: args.feed, rpcUrl: args.rpcUrl },
)

const shutdown = () => {
  stop()
  console.error('\nstopped')
  process.exit(0)
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
