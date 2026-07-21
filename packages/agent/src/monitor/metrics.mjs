/**
 * robinhood-toolkit · minimal metrics registry and health server
 * Author: nirholas · https://github.com/nirholas/robinhood-toolkit
 * License: All Rights Reserved (c) 2026 nirholas
 *
 * No external dependency on purpose: the metrics surface is small, and the
 * fewer things that can crash the trading process, the better.
 */
import { createServer } from 'node:http';

export function createMetrics() {
  const counters = new Map();
  const gauges = new Map();
  const histograms = new Map();
  const key = (name, labels) =>
    labels && Object.keys(labels).length
      ? `${name}{${Object.entries(labels).map(([k, v]) => `${k}="${v}"`).join(',')}}`
      : name;

  return {
    inc(name, labels, by = 1) {
      const k = key(name, labels);
      counters.set(k, (counters.get(k) ?? 0) + by);
    },
    set(name, value, labels) {
      gauges.set(key(name, labels), value);
    },
    observe(name, value, labels) {
      const k = key(name, labels);
      const h = histograms.get(k) ?? { sum: 0, count: 0, buckets: new Map() };
      h.sum += value;
      h.count += 1;
      for (const b of [0.05, 0.1, 0.5, 1, 2.5, 5, 10]) {
        if (value <= b) h.buckets.set(b, (h.buckets.get(b) ?? 0) + 1);
      }
      histograms.set(k, h);
    },
    render() {
      const lines = [];
      for (const [k, v] of counters) lines.push(`${k} ${v}`);
      for (const [k, v] of gauges) lines.push(`${k} ${v}`);
      for (const [k, h] of histograms) {
        const base = k.includes('{') ? k.slice(0, k.indexOf('{')) : k;
        for (const [b, c] of [...h.buckets].sort((a, z) => a[0] - z[0])) {
          lines.push(`${base}_bucket{le="${b}"} ${c}`);
        }
        lines.push(`${base}_sum ${h.sum}`, `${base}_count ${h.count}`);
      }
      return lines.join('\n') + '\n';
    },
  };
}

/**
 * Bind /metrics and /healthz to loopback. Never bind publicly: this exposes
 * position and PnL data and has no authentication.
 *
 * /healthz returns 503 (unhealthy) when the last successful tick is older than
 * three tick intervals — a process that is alive but not ticking is down.
 */
export function startHealthServer({ metrics, getState, port = 9464, host = '127.0.0.1' }) {
  const server = createServer((req, res) => {
    if (req.url === '/metrics') {
      res.writeHead(200, { 'content-type': 'text/plain; version=0.0.4' });
      return res.end(metrics.render());
    }
    if (req.url === '/healthz') {
      const s = getState();
      const staleMs = Date.now() - s.lastTickAt;
      const healthy = staleMs < s.tickMs * 3 && !s.killSwitch && !s.leaseLost;
      res.writeHead(healthy ? 200 : 503, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({
        healthy,
        mode: s.mode,
        lastTickAgoMs: staleMs,
        killSwitch: s.killSwitch,
        leaseLost: s.leaseLost,
      }));
    }
    res.writeHead(404).end();
  });
  server.listen(port, host);
  server.unref();
  return server;
}
