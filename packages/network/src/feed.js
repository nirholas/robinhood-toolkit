/**
 * robinhood-toolkit · sequencer feed reader (reconnect + gap detection)
 * Author: nirholas · https://github.com/nirholas/robinhood-toolkit
 * License: All Rights Reserved (c) 2026 nirholas
 *
 * Reader for the Arbitrum Nitro broadcaster feed. Reconnects with exponential
 * backoff and jitter. Keys off `sequenceNumber` for ordering: a gap means you
 * dropped frames and must backfill over RPC. The frame schema is observed
 * behavior, not a documented contract — keep the parser tolerant.
 *
 * Run standalone:
 *   FEED_URL=wss://feed.testnet.chain.robinhood.com node src/feed.js
 */
import WebSocket from 'ws';

const DEFAULT_URL = 'wss://feed.testnet.chain.robinhood.com';

/**
 * @param {object} [opts]
 * @param {string} [opts.url]                feed websocket URL
 * @param {(batch: object) => void} [opts.onBatch]  called per decoded frame
 * @param {(gap: {expected: number, got: number}) => void} [opts.onGap]
 * @returns {{ close: () => void }}
 */
export function readFeed(opts = {}) {
  const url = opts.url ?? process.env.FEED_URL ?? DEFAULT_URL;
  let attempt = 0;
  let lastSeq = null;
  let ws;
  let closed = false;

  function connect() {
    if (closed) return;
    ws = new WebSocket(url);

    ws.on('open', () => {
      attempt = 0;
      console.log('[feed] connected', url);
    });

    ws.on('message', (raw) => {
      let frame;
      try {
        frame = JSON.parse(raw.toString());
      } catch {
        console.log('[feed] non-JSON frame', raw.toString().slice(0, 200));
        return;
      }

      for (const msg of frame.messages ?? []) {
        const seq = msg.sequenceNumber;
        if (typeof seq === 'number' && lastSeq !== null && seq > lastSeq + 1) {
          const gap = { expected: lastSeq + 1, got: seq };
          console.warn(`[feed] sequence gap: expected ${gap.expected}, got ${gap.got} — backfill over RPC`);
          opts.onGap?.(gap);
        }
        if (typeof seq === 'number') lastSeq = seq;
      }

      opts.onBatch?.(frame);
    });

    ws.on('close', () => {
      if (closed) return;
      const delay = Math.min(30_000, 2 ** attempt++ * 500) + Math.random() * 250;
      console.warn(`[feed] closed, reconnecting in ${Math.round(delay)}ms`);
      setTimeout(connect, delay);
    });

    ws.on('error', (err) => console.error('[feed] error', err.message));
  }

  connect();

  return {
    close() {
      closed = true;
      ws?.close();
    },
  };
}

// Executed directly: probe the feed and print frames.
if (import.meta.url === `file://${process.argv[1]}`) {
  readFeed({ onBatch: (frame) => console.dir(frame, { depth: 3 }) });
}
