<!-- built by nirholas x.com/nichxbt -->
<!--
  robinhood-toolkit · build prompt: real-time price updates
  Author: nirholas · https://github.com/nirholas/robinhood-toolkit
  License: All Rights Reserved (c) 2026 nirholas
-->

# 06 · Real-time price updates

## Goal

Stream live prices into a chart. Three transports, ordered by latency: the
Robinhood Chain sequencer feed as a block trigger, `eth_getLogs` polling, and
DexScreener snapshot polling. End state: a `createLiveFeed()` that keeps a
forming candle current and survives disconnects, tab backgrounding, and RPC
failures.

## Prerequisites

- Prompt 04 finished: the adapter with `pushPrice` and `pushBar`.
- Prompt 05 finished: `src/sources/onchain.js` with `priceFromSqrtX96` and
  `poolMeta`.
- `npm install ws@^8` for Node. Browsers use the built-in `WebSocket`.

## Reference facts (verified)

### There is no WebSocket JSON-RPC. `eth_subscribe` is not available.

Verified on 2026-07-20: opening a WebSocket against
`wss://rpc.mainnet.chain.robinhood.com` returns
`Unexpected server response: 400`. The RPC is HTTP only.

Consequences, and they shape this entire prompt:

- **`eth_subscribe('logs', ...)` and `eth_subscribe('newHeads')` are not
  available.** Every tutorial built on `provider.on('block', ...)` with a WSS
  provider will not work here.
- ethers' `provider.on('block')` over an HTTP provider silently degrades to
  polling on a 4-second default timer. It works, but you should choose that
  interval deliberately rather than inherit it.
- The lowest-latency notification available is the **sequencer feed**, below.

### The sequencer feed (verified live)

`wss://feed.mainnet.chain.robinhood.com` connects with no auth and streams
continuously. Verified message envelope:

```json
{
  "version": 1,
  "messages": [{
    "sequenceNumber": 14999807,
    "message": {
      "message": {
        "header": {
          "kind": 3,
          "sender": "0xa4b000000000000000000073657175656e636572",
          "blockNumber": 25576404,
          "timestamp": 1784580434,
          "requestId": null,
          "baseFeeL1": 0
        },
        "l2Msg": "AwAAAAAAAAFYBPkBVIK+roQHJw4Agx..."
      },
      "delayedMessagesRead": 0
    },
    "blockHash": "0xf8e15ced...",
    "signatureV2": null,
    "blockMetadata": null
  }]
}
```

Verified facts about it:

- **`sequenceNumber` is the L2 block number.** It matched `eth_blockNumber` and
  incremented by exactly 1 per message.
- **`header.timestamp` is the block timestamp in UNIX seconds.** This is the one
  place you get a usable timestamp for free. Prompt 05 established that
  `blockTimestamp` on log objects is always `0x0`.
- `header.sender` is the sequencer address
  `0xa4b000000000000000000073657175656e636572` on every message.
- **`l2Msg` is base64-encoded, compressed Arbitrum batch data.** Decoding it to
  individual transactions means implementing Arbitrum's L2 message framing and
  decompression. **This prompt does not do that, and neither should you.** The
  cost is high, the format is an implementation detail that can change, and
  there is a much cheaper path: use the feed purely as a low-latency "block
  N landed at time T" trigger, then pull that block's logs over HTTP RPC. You
  get feed latency with decoder-free correctness.
- The feed is a **centralized sequencer** stream. It reflects sequencer
  intent, not Ethereum settlement. A message here is a soft confirmation and
  nothing more. Say so in your UI if you present it as live.

### `series.update()` semantics

From prompt 02 and the v5 typings, restated because live updating is where it
bites:

- `update(bar)` with a `time` **equal** to the last bar replaces it. This is how
  a forming candle grows.
- `update(bar)` with a `time` **after** the last bar appends a new one.
- `update(bar)` with a `time` **before** the last bar **throws**. Filter stale
  data before it reaches the chart.

## Steps

### 1. Confirm the feed and the absence of WSS RPC

```sh
npm install ws@^8

# The feed streams. Expect JSON with sequenceNumber and header.timestamp.
node -e "
const WebSocket=require('ws');
const ws=new WebSocket('wss://feed.mainnet.chain.robinhood.com');
let n=0;
ws.on('open',()=>console.log('feed open'));
ws.on('message',(d)=>{
  const m=JSON.parse(d.toString()).messages[0];
  console.log('block',m.sequenceNumber,'ts',m.message.message.header.timestamp);
  if(++n>=3) process.exit(0);
});
ws.on('error',(e)=>{console.error('feed error',e.message);process.exit(1)});
"

# The RPC is NOT a websocket. Expect a 400.
node -e "
const WebSocket=require('ws');
const ws=new WebSocket('wss://rpc.mainnet.chain.robinhood.com');
ws.on('open',()=>{console.log('unexpected: WSS RPC works');process.exit(0)});
ws.on('error',(e)=>{console.log('expected failure:',e.message);process.exit(0)});
"
```

Run both before writing code. The second is what stops you designing around
`eth_subscribe`.

### 2. Wrap the sequencer feed

`src/live/sequencer-feed.js`:

```js
/**
 * robinhood-toolkit · Robinhood Chain sequencer feed client
 * Author: nirholas · https://github.com/nirholas/robinhood-toolkit
 * License: All Rights Reserved (c) 2026 nirholas
 *
 * Emits { blockNumber, timestamp } per sequenced block. Does NOT decode l2Msg:
 * that is compressed Arbitrum batch data. Use this as a low-latency trigger to
 * pull logs over HTTP RPC.
 *
 * Trust: this is a CENTRALIZED sequencer stream. Messages are soft
 * confirmations, not Ethereum settlement.
 */

const WS = globalThis.WebSocket ?? (await import('ws')).default;

export const RH_MAINNET_FEED = 'wss://feed.mainnet.chain.robinhood.com';
export const RH_TESTNET_FEED = 'wss://feed.testnet.chain.robinhood.com';

/**
 * @param {(block: {blockNumber:number, timestamp:number}) => void} onBlock
 * @param {{url?:string, onStatus?:(s:string)=>void, maxBackoffMs?:number}} [opts]
 * @returns {() => void} unsubscribe
 */
export function connectSequencerFeed(onBlock, opts = {}) {
  const { url = RH_MAINNET_FEED, onStatus = () => {}, maxBackoffMs = 30_000 } = opts;

  let ws = null;
  let stopped = false;
  let attempt = 0;
  let reconnectTimer = null;
  let watchdog = null;
  let lastBlock = 0;

  function armWatchdog() {
    clearTimeout(watchdog);
    // Blocks are ~94ms. Thirty seconds of silence means the socket is dead
    // even if it never emitted a close event, which happens on mobile networks.
    watchdog = setTimeout(() => {
      onStatus('stalled');
      try { ws?.close(); } catch { /* already gone */ }
    }, 30_000);
  }

  function open() {
    if (stopped) return;
    onStatus(attempt === 0 ? 'connecting' : `reconnecting#${attempt}`);

    ws = new WS(url);

    ws.addEventListener?.('open', onOpen) ?? ws.on('open', onOpen);
    ws.addEventListener?.('message', onMessage) ?? ws.on('message', onMessage);
    ws.addEventListener?.('close', onClose) ?? ws.on('close', onClose);
    ws.addEventListener?.('error', onError) ?? ws.on('error', onError);
  }

  function onOpen() {
    attempt = 0;
    onStatus('live');
    armWatchdog();
  }

  function onMessage(evt) {
    armWatchdog();
    const raw = evt?.data ?? evt;
    let body;
    try {
      body = JSON.parse(typeof raw === 'string' ? raw : raw.toString());
    } catch {
      return;   // non-JSON frame, ignore rather than tear down the socket
    }

    for (const m of body?.messages ?? []) {
      const header = m?.message?.message?.header;
      const blockNumber = Number(m?.sequenceNumber);
      const timestamp = Number(header?.timestamp);
      if (!Number.isFinite(blockNumber) || !Number.isFinite(timestamp)) continue;
      if (blockNumber <= lastBlock) continue;    // feed replays on reconnect
      lastBlock = blockNumber;
      onBlock({ blockNumber, timestamp, blockHash: m.blockHash ?? null });
    }
  }

  function onError() {
    onStatus('error');
  }

  function onClose() {
    clearTimeout(watchdog);
    if (stopped) return;
    onStatus('disconnected');
    const delay = Math.min(maxBackoffMs, 500 * 2 ** attempt) * (0.5 + Math.random());
    attempt += 1;
    reconnectTimer = setTimeout(open, delay);
  }

  open();

  return () => {
    stopped = true;
    clearTimeout(reconnectTimer);
    clearTimeout(watchdog);
    try { ws?.close(); } catch { /* already closed */ }
    onStatus('stopped');
  };
}
```

### 3. Build the live feed

Feed triggers the pull, RPC supplies the truth, DexScreener backstops both.

`src/live/live-feed.js`:

```js
/**
 * robinhood-toolkit · live price feed for a Uniswap v3 pool
 * Author: nirholas · https://github.com/nirholas/robinhood-toolkit
 * License: All Rights Reserved (c) 2026 nirholas
 *
 * Transports, in order of preference:
 *   1. sequencer feed  -> block trigger  -> eth_getLogs for that range
 *   2. RPC block polling (if the feed is unreachable)
 *   3. DexScreener snapshot polling (if the RPC is unreachable)
 */
import { JsonRpcProvider, Interface } from 'ethers';
import { connectSequencerFeed } from './sequencer-feed.js';
import { priceFromSqrtX96, RH_MAINNET_RPC, RH_MAINNET_CHAIN_ID } from '../sources/onchain.js';
import { getPair } from '../dexscreener.js';

const SWAP_IFACE = new Interface([
  'event Swap(address indexed sender, address indexed recipient, int256 amount0, int256 amount1, uint160 sqrtPriceX96, uint128 liquidity, int24 tick)',
]);
const SWAP_TOPIC = SWAP_IFACE.getEvent('Swap').topicHash;

/**
 * @param {{pairAddress:string, chainId?:string}} spec
 * @param {{
 *   onPrice: (tick: {price:number, timestamp:number, volume:number, source:string}) => void,
 *   onStatus?: (s: string) => void,
 *   rpcUrl?: string,
 *   maxBlockSpan?: number,
 *   snapshotMs?: number,
 * }} opts
 */
export function createLiveFeed(spec, opts) {
  const {
    onPrice,
    onStatus = () => {},
    rpcUrl = RH_MAINNET_RPC,
    maxBlockSpan = 2000,
    snapshotMs = 15_000,
  } = opts;

  const provider = new JsonRpcProvider(rpcUrl, RH_MAINNET_CHAIN_ID, { staticNetwork: true });

  let meta = null;
  let cursor = null;
  let stopped = false;
  let draining = false;
  let pending = null;          // highest block seen while a drain is running
  let disconnectFeed = null;
  let pollTimer = null;
  let snapshotTimer = null;
  let consecutiveRpcErrors = 0;
  let mode = 'feed';

  async function ensureMeta() {
    if (meta) return meta;
    const { poolMeta } = await import('../sources/onchain.js');
    meta = await poolMeta(spec.pairAddress);
    return meta;
  }

  /**
   * Pull swaps in (cursor, head]. Coalesces: if a drain is already running the
   * new head is queued rather than starting a second overlapping request.
   */
  async function drain(head) {
    if (stopped) return;
    if (draining) { pending = Math.max(pending ?? 0, head); return; }
    draining = true;

    try {
      const m = await ensureMeta();
      if (cursor === null) cursor = head - 1;

      let from = cursor + 1;
      // After a long tab-background the gap can be enormous (~36,000 blocks per
      // hour). Do not try to backfill it; jump to the tail and resync.
      if (head - from > maxBlockSpan) {
        from = head - maxBlockSpan;
        onStatus('resynced');
      }
      if (from > head) return;

      const logs = await provider.send('eth_getLogs', [{
        address: spec.pairAddress,
        topics: [SWAP_TOPIC],
        fromBlock: '0x' + from.toString(16),
        toBlock: '0x' + head.toString(16),
      }]);

      consecutiveRpcErrors = 0;

      if (logs.length > 0) {
        // blockTimestamp on logs is always 0x0 (prompt 05). Resolve real ones.
        const blockNumbers = [...new Set(logs.map((l) => l.blockNumber))];
        const blocks = await Promise.all(
          blockNumbers.map((bn) => provider.send('eth_getBlockByNumber', [bn, false])),
        );
        const times = new Map(
          blocks.filter(Boolean).map((b) => [b.number, parseInt(b.timestamp, 16)]),
        );

        for (const log of logs) {
          const ts = times.get(log.blockNumber);
          if (ts === undefined) continue;
          const ev = SWAP_IFACE.decodeEventLog('Swap', log.data, log.topics);
          const price = priceFromSqrtX96(ev.sqrtPriceX96, m.decimals0, m.decimals1);
          if (!Number.isFinite(price) || price <= 0) continue;
          const volume = Number(ev.amount0 < 0n ? -ev.amount0 : ev.amount0) / 10 ** m.decimals0;
          onPrice({ price, timestamp: ts, volume, source: 'onchain' });
        }
      }

      cursor = head;
    } catch (err) {
      consecutiveRpcErrors += 1;
      onStatus(`rpc-error:${consecutiveRpcErrors}`);
      // The RPC is genuinely down. Fall back to snapshots rather than going dark.
      if (consecutiveRpcErrors >= 5 && mode !== 'snapshot') startSnapshotFallback();
    } finally {
      draining = false;
      const queued = pending;
      pending = null;
      if (queued !== null && !stopped) drain(queued);
    }
  }

  /** Last resort: DexScreener current price. Coarse, but never nothing. */
  function startSnapshotFallback() {
    if (snapshotTimer) return;
    mode = 'snapshot';
    onStatus('snapshot-fallback');
    const tick = async () => {
      if (stopped) return;
      try {
        const pair = await getPair(spec.pairAddress, spec.chainId ?? 'robinhood');
        if (pair?.priceNative) {
          // priceNative is quote-per-base; on-chain price is token1-per-token0.
          onPrice({
            price: 1 / pair.priceNative,
            timestamp: Math.floor(Date.now() / 1000),
            volume: 0,
            source: 'dexscreener',
          });
        }
      } catch { /* keep polling */ }
      if (!stopped) snapshotTimer = setTimeout(tick, snapshotMs);
    };
    snapshotTimer = setTimeout(tick, 0);
  }

  /** Used when the sequencer feed itself cannot be reached. */
  function startBlockPolling(intervalMs = 3000) {
    if (pollTimer) return;
    mode = 'poll';
    onStatus('rpc-polling');
    const tick = async () => {
      if (stopped) return;
      try {
        const head = await provider.getBlockNumber();
        if (cursor === null || head > cursor) await drain(head);
      } catch { /* handled in drain */ }
      if (!stopped) pollTimer = setTimeout(tick, intervalMs);
    };
    pollTimer = setTimeout(tick, 0);
  }

  let feedEverConnected = false;
  const feedWatchdog = setTimeout(() => {
    if (!feedEverConnected && !stopped) startBlockPolling();
  }, 10_000);

  disconnectFeed = connectSequencerFeed(
    ({ blockNumber }) => {
      feedEverConnected = true;
      clearTimeout(feedWatchdog);
      if (pollTimer) { clearTimeout(pollTimer); pollTimer = null; mode = 'feed'; }
      drain(blockNumber);
    },
    { onStatus: (s) => onStatus(`feed:${s}`) },
  );

  // Tab backgrounding throttles timers and can suspend the socket entirely.
  // Force an immediate resync on return rather than trusting a stale cursor.
  const onVisibility = () => {
    if (document.visibilityState === 'visible' && !stopped) {
      provider.getBlockNumber().then(drain).catch(() => {});
    }
  };
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', onVisibility);
  }

  return {
    get mode() { return mode; },
    destroy() {
      stopped = true;
      clearTimeout(feedWatchdog);
      clearTimeout(pollTimer);
      clearTimeout(snapshotTimer);
      disconnectFeed?.();
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', onVisibility);
      }
      onStatus('stopped');
    },
  };
}
```

### 4. Wire it to the chart

`src/live/wire.js`:

```js
/**
 * robinhood-toolkit · connect a live feed to a chart adapter
 * Author: nirholas · https://github.com/nirholas/robinhood-toolkit
 * License: All Rights Reserved (c) 2026 nirholas
 */
import { createLiveFeed } from './live-feed.js';

/**
 * @param {ReturnType<import('../adapter.js').createAdapter>} adapter
 * @param {{pairAddress:string, chainId?:string}} spec
 * @param {{ onStatus?: (s:string)=>void }} [opts]
 */
export function goLive(adapter, spec, opts = {}) {
  const { onStatus = () => {} } = opts;

  const feed = createLiveFeed(spec, {
    onStatus,
    onPrice: ({ price, timestamp, volume }) => {
      // pushPrice folds the tick into the forming bucket, rolls over at the
      // boundary, and drops stale ticks. See prompt 04.
      adapter.pushPrice(price, timestamp, volume);
    },
  });

  return feed;
}
```

Full page wiring:

```js
import { createPriceChart } from '../chart.js';
import { createAdapter } from '../adapter.js';
import { goLive } from './live/wire.js';
import '../sources/geckoterminal.js';

const spec = { chainId: 'robinhood', pairAddress: '0x52e65B17fB6E5BA00Ed806f37Afcd2DaA50271Ca' };

const view = createPriceChart(document.querySelector('#chart'), { priceDecimals: 4 });
const adapter = createAdapter(view);
const status = document.querySelector('#status');

// History first, then the live tail. Never go live on an empty chart: the first
// tick becomes bar one and the user sees a single candle with no context.
await adapter.load({ sourceId: 'geckoterminal', spec, interval: '1h', limit: 300 });

const feed = goLive(adapter, spec, {
  onStatus: (s) => {
    status.textContent = s;
    status.dataset.state = s.startsWith('feed:live') ? 'ok' : 'degraded';
  },
});

window.addEventListener('beforeunload', () => { feed.destroy(); adapter.destroy(); view.destroy(); });
```

## Deliverable

- `src/live/sequencer-feed.js`: reconnecting feed client with exponential
  backoff, jitter, a stall watchdog, and replay deduplication.
- `src/live/live-feed.js`: `createLiveFeed()` with the three-tier transport
  chain, drain coalescing, resync on large gaps, and visibility handling.
- `src/live/wire.js`: `goLive(adapter, spec)`.
- A visible connection-status indicator in the UI showing which transport is
  active. Users must be able to tell live from degraded.

## How to verify

1. The feed logs increasing block numbers with sane timestamps:
   `node -e "..."` from step 1. `header.timestamp` should be within a few
   seconds of `Math.floor(Date.now()/1000)`.
2. The WSS RPC probe fails with a 400. If it ever succeeds, this chain gained
   `eth_subscribe` and this design can be simplified.
3. Open the chart on the live USDG/WETH pool. The last candle's close moves and
   the wick extends without the bar count changing, until the interval rolls
   over and exactly one new bar appears.
4. Bucket rollover: set interval to `1m` and watch across a minute boundary.
   One new candle, no gap, no duplicate.
5. Kill the network for 60 seconds. Status goes `feed:disconnected`, then
   `feed:reconnecting#n`, then `feed:live`. The chart resyncs with no
   `Cannot update oldest data` error in the console.
6. Background the tab for 5 minutes and return. Status shows `resynced` and the
   chart catches up rather than attempting a 36,000-block backfill.
7. Force the fallback: point `rpcUrl` at `http://127.0.0.1:1`. After five
   failures the status becomes `snapshot-fallback` and prices still update from
   DexScreener.

## Gotchas

- **No `eth_subscribe`. The RPC is HTTP only.** Verified with a 400 on the WSS
  URL. Any design assuming log subscriptions has to be reworked.
- **Do not decode `l2Msg`.** It is compressed Arbitrum batch data and reversing
  it is a project, not a step. Use the feed as a block trigger and pull logs
  over HTTP.
- **`update()` throws on a timestamp before the last bar.** Out-of-order or
  replayed feed messages will trigger it. `pushPrice` filters stale ticks and
  the feed client dedupes by block number. Keep both.
- **The feed replays on reconnect.** Without the `blockNumber <= lastBlock`
  guard you reprocess blocks and double-count volume.
- **Coalesce your drains.** Blocks arrive every ~94ms. Firing an `eth_getLogs`
  per block means ten overlapping requests per second, and they will return out
  of order and corrupt the forming bar. The `draining`/`pending` pair fixes it.
- **Never backfill a long gap on resume.** An hour backgrounded is ~36,000
  blocks. Jump to the tail, mark the state `resynced`, and let history come from
  a `load()` if the user needs it.
- **A closed socket is not the only failure.** Sockets go silent while staying
  open, especially on mobile. The 30-second stall watchdog catches it.
- **Load history before going live.** A live feed on an empty chart produces one
  candle at whatever price ticks first, which looks broken.
- **The sequencer is centralized.** Feed messages are soft confirmations from a
  single operator, not Ethereum finality. If your UI says "live", make sure it
  does not also imply "settled".
- DexScreener `priceNative` is quote-per-base while on-chain price from
  `sqrtPriceX96` is token1-per-token0. When falling back between them, invert.
  Getting this wrong produces a chart that jumps by orders of magnitude at the
  exact moment of failover, which is a confusing bug to chase.
<!-- built by nirholas x.com/nichxbt -->
