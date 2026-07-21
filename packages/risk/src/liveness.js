/* built by nirholas x.com/nichxbt */
/**
 * robinhood-toolkit · sequencer liveness monitor
 * Author: nirholas · https://github.com/nirholas/robinhood-toolkit
 * License: All Rights Reserved (c) 2026 nirholas
 *
 * robinhood-toolkit · package: robinhood-risk
 *
 * Tracks two independent signals and reports them separately:
 *
 *   1. RPC head advancement over a rolling window   -> status
 *   2. Sequencer WebSocket feed activity            -> feedStatus
 *
 * A full stall (RPC head frozen) is a different failure from a feed that goes
 * quiet while RPC keeps advancing, or the reverse. Collapsing them into one
 * "down" flag throws away the information that tells a user what is actually
 * happening, so they stay distinct here and combine into an explicit
 * `divergence` field.
 *
 * READ-ONLY. This module observes; it never signs or submits.
 *
 * Thresholds are tuned for a ~101 ms chain. On mainnet, ten seconds of silence
 * is roughly a hundred missed blocks — anomalous, not noise. Thresholds carried
 * over from a 12-second L1 would be useless here.
 */

import { createPublicClient, http } from 'viem'

import { robinhoodChain, robinhoodTestnet } from '../../robinhood-chain/src/chains.js'

export { robinhoodChain, robinhoodTestnet }

// ~101 ms blocks. These thresholds are generous by two orders of magnitude,
// which is what makes detection fast and cheap without false positives.
export const DEGRADED_MS = 5_000
export const STALLED_MS = 30_000
// A feed that has said nothing for this long is treated as silent even if the
// socket is still nominally open.
export const FEED_SILENT_MS = 10_000

/**
 * Pure classifier for the RPC head signal. Exported so CI can assert the
 * boundaries without spinning up a client or waiting on wall-clock time.
 *
 * @param {number} silentForMs  Milliseconds since the head last advanced.
 * @param {{degradedMs?: number, stalledMs?: number}} [thresholds]
 * @returns {'healthy' | 'degraded' | 'stalled'}
 */
export function classify(silentForMs, { degradedMs = DEGRADED_MS, stalledMs = STALLED_MS } = {}) {
  if (silentForMs >= stalledMs) return 'stalled'
  if (silentForMs >= degradedMs) return 'degraded'
  return 'healthy'
}

/**
 * The canonical exit a user still has when the sequencer stalls. Surfaced by the
 * UI so the seven-day reality is on screen at the moment it matters, not buried.
 */
export const CANONICAL_EXIT = {
  path: 'Canonical bridge withdrawal to Ethereum',
  periodDays: 7,
  note:
    'The canonical withdrawal path does not depend on the sequencer accepting a ' +
    'new transaction, but it settles over the ~7 day optimistic challenge period. ' +
    'It is slow by construction. Partner bridges are faster and carry their own ' +
    'trust model; faster is not safer.',
}

/** Whether submission should be allowed in a given RPC status. */
export const canSubmitIn = (status) => status === 'healthy' || status === 'degraded'

/**
 * Resolve a WebSocket implementation. Prefers a global (browser, or Node >= 22),
 * then the optional `ws` dependency. Returns null when neither is available, in
 * which case feed cross-checking is silently disabled rather than throwing.
 */
async function resolveWebSocket() {
  if (typeof globalThis.WebSocket === 'function') return globalThis.WebSocket
  try {
    const mod = await import('ws')
    return mod.WebSocket ?? mod.default
  } catch {
    return null
  }
}

/**
 * Best-effort extraction of a monotonic position from a sequencer feed frame.
 * The exact feed wire format is UNVERIFIED for this chain, so this stays
 * defensive: any numeric sequenceNumber it can find counts as progress, and a
 * frame it cannot parse still counts as the feed being alive (a message arrived).
 * Override via the `parseFeedMessage` option once the format is confirmed.
 *
 * @returns {number | null} A sequence number if found, else null.
 */
export function defaultParseFeedMessage(raw) {
  let frame
  try {
    frame = JSON.parse(typeof raw === 'string' ? raw : raw.toString())
  } catch {
    return null
  }
  const seqOf = (m) => (typeof m?.sequenceNumber === 'number' ? m.sequenceNumber : null)
  if (Array.isArray(frame?.messages) && frame.messages.length) {
    const nums = frame.messages.map(seqOf).filter((n) => n != null)
    if (nums.length) return Math.max(...nums)
  }
  return seqOf(frame)
}

/**
 * Combine the two signals into a single divergence classification. A stall where
 * the feed is still live, or a live head with a dead feed, are the interesting
 * cases: they mean the two views of the chain disagree.
 *
 * @returns {null | 'rpc-stalled-feed-live' | 'feed-silent-rpc-advancing'}
 */
export function classifyDivergence(status, feedStatus) {
  if (status === 'stalled' && feedStatus === 'live') return 'rpc-stalled-feed-live'
  if (status === 'healthy' && feedStatus === 'silent') return 'feed-silent-rpc-advancing'
  return null
}

/**
 * Start monitoring. Calls `onStatus` on every tick with a plain object. Returns a
 * stop function that clears the timer and closes the feed socket.
 *
 * @param {(status: object) => void} onStatus
 * @param {object} [options]
 * @param {import('viem').Chain} [options.chain]        Defaults to mainnet.
 * @param {number} [options.intervalMs]                 Poll cadence. Default 2000.
 * @param {number} [options.degradedMs]                 Override degraded threshold.
 * @param {number} [options.stalledMs]                  Override stalled threshold.
 * @param {number} [options.feedSilentMs]               Override feed-silent threshold.
 * @param {boolean} [options.feed]                      Cross-check the WS feed. Default true.
 * @param {string} [options.rpcUrl]                     Override RPC endpoint (e.g. an unreachable host to prove the failure path).
 * @param {string} [options.feedUrl]                    Override feed WS endpoint.
 * @param {object} [options.client]                     Inject a viem-compatible client (getBlockNumber). For tests.
 * @param {() => number} [options.now]                  Injectable clock. For tests.
 * @param {(raw: any) => number|null} [options.parseFeedMessage]
 * @returns {() => void} stop
 */
export function monitorLiveness(onStatus, options = {}) {
  const {
    chain = robinhoodChain,
    intervalMs = 2_000,
    degradedMs = DEGRADED_MS,
    stalledMs = STALLED_MS,
    feedSilentMs = FEED_SILENT_MS,
    feed = true,
    rpcUrl,
    feedUrl,
    now = () => Date.now(),
    parseFeedMessage = defaultParseFeedMessage,
  } = options

  const client =
    options.client ??
    createPublicClient({
      chain,
      transport: http(rpcUrl, {
        // ~101 ms blocks: a small batch window keeps a burst of reads to one round trip.
        batch: { wait: 16 },
        retryCount: 2,
        retryDelay: 150,
        timeout: 10_000,
      }),
    })

  let lastBlock = null
  let lastAdvanceAt = now()
  let stopped = false

  // --- Feed state (only meaningful when feed cross-checking is enabled) ---
  const feedEnabled = feed
  let feedSocket = null
  let feedState = feedEnabled ? 'connecting' : 'disabled'
  let lastFeedAt = now()
  let lastFeedSeq = null

  if (feedEnabled) connectFeed()

  const timer = setInterval(tick, intervalMs)
  // Do not keep a Node process alive solely for the monitor.
  if (typeof timer?.unref === 'function') timer.unref()

  async function tick() {
    if (stopped) return
    try {
      const head = await client.getBlockNumber({ cacheTime: 0 })
      const t = now()

      if (lastBlock === null || head > lastBlock) {
        lastBlock = head
        lastAdvanceAt = t
      }

      const silentFor = t - lastAdvanceAt
      const status = classify(silentFor, { degradedMs, stalledMs })
      const feedStatus = currentFeedStatus(t)
      const divergence = classifyDivergence(status, feedStatus)

      onStatus({
        status,
        head: head.toString(),
        silentForMs: silentFor,
        feedStatus,
        feedSeq: lastFeedSeq,
        divergence,
        chainId: chain.id,
        canSubmit: canSubmitIn(status),
        exit: status === 'stalled' ? CANONICAL_EXIT : undefined,
        checkedAt: isoAt(t),
      })
    } catch (err) {
      // An unreachable or misbehaving RPC must report, never throw or hang. A
      // caller that swallows this is the exact bug the failure path guards against.
      onStatus({
        status: 'unreachable',
        error: err?.shortMessage ?? err?.message ?? String(err),
        feedStatus: currentFeedStatus(now()),
        chainId: chain.id,
        canSubmit: false,
        exit: CANONICAL_EXIT,
        checkedAt: isoAt(now()),
      })
    }
  }

  function currentFeedStatus(t) {
    if (!feedEnabled) return 'disabled'
    if (feedState === 'connecting' || feedState === 'disconnected') return feedState
    return t - lastFeedAt <= feedSilentMs ? 'live' : 'silent'
  }

  async function connectFeed() {
    const Impl = await resolveWebSocket()
    if (!Impl || stopped) {
      feedState = Impl ? 'disconnected' : 'disabled'
      return
    }
    const url = feedUrl ?? chain.rpcUrls?.default?.webSocket?.[0]
    if (!url) {
      feedState = 'disabled'
      return
    }
    try {
      feedSocket = new Impl(url)
    } catch {
      feedState = 'disconnected'
      return
    }
    const onOpen = () => {
      if (stopped) return
      feedState = 'live'
      lastFeedAt = now()
    }
    const onMessage = (ev) => {
      if (stopped) return
      feedState = 'live'
      lastFeedAt = now()
      const seq = parseFeedMessage(ev?.data ?? ev)
      if (typeof seq === 'number' && (lastFeedSeq === null || seq > lastFeedSeq)) lastFeedSeq = seq
    }
    const onClose = () => {
      if (!stopped) feedState = 'disconnected'
    }
    // Support both the browser (addEventListener) and ws (on) event shapes.
    if (typeof feedSocket.addEventListener === 'function') {
      feedSocket.addEventListener('open', onOpen)
      feedSocket.addEventListener('message', onMessage)
      feedSocket.addEventListener('close', onClose)
      feedSocket.addEventListener('error', onClose)
    } else if (typeof feedSocket.on === 'function') {
      feedSocket.on('open', onOpen)
      feedSocket.on('message', (data) => onMessage({ data }))
      feedSocket.on('close', onClose)
      feedSocket.on('error', onClose)
    }
  }

  return function stop() {
    stopped = true
    clearInterval(timer)
    try {
      feedSocket?.close?.()
    } catch {
      /* already gone */
    }
  }
}

/**
 * ISO timestamp for a given epoch ms. Isolated so the injected clock flows all
 * the way through to `checkedAt` in tests.
 */
function isoAt(ms) {
  return new Date(ms).toISOString()
}
/* built by nirholas x.com/nichxbt */
