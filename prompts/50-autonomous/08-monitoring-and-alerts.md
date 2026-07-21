<!--
  robinhood-toolkit · build prompt: monitoring, heartbeats, and alerting
  Author: nirholas · https://github.com/nirholas/robinhood-toolkit
  License: All Rights Reserved (c) 2026 nirholas
-->

# 08 · Monitoring and alerts

## Goal

Know within minutes that the agent has stopped, stalled, drifted, or started
losing money faster than expected. You will expose metrics and a health
endpoint, define alert rules with thresholds that are meaningful rather than
arbitrary, and route pages to a channel a human actually reads at 03:00.

## Prerequisites

- Prompts 01 to 07 completed. Monitoring reads the journal and the position
  book; do not build a parallel data path for it.
- An alert sink: a webhook, an email relay, or a paging service. One that works
  when your primary cloud provider is the thing that is down.

## Reference facts (verified)

| | Mainnet | Testnet |
|---|---|---|
| Chain ID | 4663 | 46630 |
| RPC | `https://rpc.mainnet.chain.robinhood.com` | `https://rpc.testnet.chain.robinhood.com` |
| Sequencer feed | `wss://feed.mainnet.chain.robinhood.com` | `wss://feed.testnet.chain.robinhood.com` |

- Crypto REST API docs: <https://docs.robinhood.com/crypto/trading>
- Robinhood operates the sequencer. If the sequencer stalls, your chain-side
  reads freeze at the last block and every price-derived metric goes flat rather
  than erroring. Monitor block height progression, not just RPC reachability. A
  200 response with a stale block is the failure you will otherwise miss.
- The venue runs 24/7, so an alert firing at 03:00 on a Sunday is a normal
  operating condition, not an edge case. Design routing for it.
- Nothing upstream monitors your agent. Robinhood does not audit connected
  agents and will not call you when your bot misbehaves.

## Steps

1. Create `src/monitor/metrics.mjs` as a small in-process registry with
   counters, gauges, and histograms, exposed in Prometheus text format. Do not
   add a metrics dependency for this; the surface is small and the fewer things
   that can crash the trading process, the better.
2. Instrument the loop with the metrics that actually predict trouble:
   `agent_tick_total`, `agent_tick_duration_seconds`, `agent_ticks_skipped_total`
   (overlap), `agent_orders_total{status}`, `agent_policy_blocks_total{rule}`,
   `agent_equity`, `agent_realized_pnl_daily`, `agent_position_drift`,
   `agent_quote_age_seconds`, `agent_chain_head_lag_seconds`.
3. Expose `/healthz` and `/metrics` on a separate port from anything public.
   `/healthz` must return unhealthy when the last successful tick is older than
   three tick intervals. A process that is alive but not ticking is down.
4. Add a dead-man's switch. The agent pings an external service on every tick;
   the external service alerts when the ping stops. This is the only check that
   survives the agent process dying, the host dying, and the network dying.
   In-process alerting cannot tell you it is dead.
5. Write alert rules in `monitor/alerts.yaml` with three severities:
   - **Page** (wake someone): no heartbeat 5 minutes, daily loss limit within 80
     percent of the stop, position drift over threshold, kill switch engaged
     unexpectedly, chain head lag over 60 seconds.
   - **Notify** (business hours, but this venue has none, so read within an
     hour): order rejection rate over 10 percent, policy block rate spike, quote
     staleness, tick duration p95 over half the tick interval.
   - **Log only**: individual blocked orders, single retries, warm-up idles.
   Anything that pages and is usually noise will get muted, and the mute will
   still be in place the night it matters. Prune the page tier ruthlessly.
6. Send a daily summary to the same channel: equity, PnL, trades, fees, block
   rate, top policy blocks. A daily heartbeat you read is how you notice slow
   degradation that no single threshold catches.
7. Test the alert path itself on a schedule. An untested alert path is an
   assumption, and it is usually wrong.

```js
/**
 * robinhood-toolkit · minimal metrics registry and health server
 * Author: nirholas · https://github.com/nirholas/robinhood-toolkit
 * License: All Rights Reserved (c) 2026 nirholas
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

export function startHealthServer({ metrics, getState, port = 9464 }) {
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
        healthy, mode: s.mode, lastTickAgoMs: staleMs, killSwitch: s.killSwitch, leaseLost: s.leaseLost,
      }));
    }
    res.writeHead(404).end();
  });
  server.listen(port, '127.0.0.1');
  server.unref();
  return server;
}
```

```js
/**
 * robinhood-toolkit · alert router with dedupe and severity routing
 * Author: nirholas · https://github.com/nirholas/robinhood-toolkit
 * License: All Rights Reserved (c) 2026 nirholas
 */
export function createAlerter({ sinks = {}, dedupeWindowMs = 900_000, fetchImpl = fetch } = {}) {
  const lastSent = new Map();

  return {
    async fire({ severity = 'notify', rule, message, context = {} }) {
      const now = Date.now();
      const last = lastSent.get(rule) ?? 0;
      if (severity !== 'page' && now - last < dedupeWindowMs) return { sent: false, reason: 'deduped' };
      lastSent.set(rule, now);

      const payload = {
        severity, rule, message, context,
        ts: new Date(now).toISOString(),
        host: process.env.HOSTNAME ?? 'local',
        mode: process.env.AGENT_MODE ?? 'paper',
      };

      const url = sinks[severity] ?? sinks.default;
      if (!url) {
        console.error(`[alert:${severity}] ${rule}: ${message}`, context);
        return { sent: false, reason: 'no_sink' };
      }

      try {
        await fetchImpl(url, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload),
        });
        return { sent: true };
      } catch (err) {
        // Alerting must never take down the trading process.
        console.error(`[alert] sink failed: ${err.message}`, payload);
        return { sent: false, reason: 'sink_error' };
      }
    },
  };
}

/** Detects a stalled sequencer: RPC answers, block height does not move. */
export function createChainLagMonitor({ publicClient, metrics, alerter, maxLagSeconds = 60 }) {
  let lastHead = null;
  let lastMovedAt = Date.now();

  return async function check() {
    const head = await publicClient.getBlockNumber();
    if (lastHead === null || head > lastHead) {
      lastHead = head;
      lastMovedAt = Date.now();
    }
    const lag = (Date.now() - lastMovedAt) / 1000;
    metrics.set('agent_chain_head_lag_seconds', lag);
    if (lag > maxLagSeconds) {
      await alerter.fire({
        severity: 'page',
        rule: 'chain_head_stalled',
        message: `chain head stuck at ${lastHead} for ${Math.round(lag)}s`,
        context: { head: lastHead?.toString() },
      });
    }
    return { head: lastHead?.toString(), lagSeconds: lag };
  };
}
```

## Deliverable

- `src/monitor/metrics.mjs`, `src/monitor/alerts.mjs`, `monitor/alerts.yaml`.
- `/healthz` and `/metrics` bound to loopback on port 9464.
- A dead-man's switch registered with an external service, documented in the
  repo README with the exact ping URL and its expected interval.
- `scripts/daily-summary.mjs` producing the daily digest from the journal.
- `test/monitor.test.js` asserting `/healthz` returns 503 when the last tick is
  stale and that a failing alert sink does not throw into the caller.

## How to verify

```sh
cd packages/agent
node --test test/monitor.test.js
node src/main.mjs &
curl -s localhost:9464/healthz | jq
curl -s localhost:9464/metrics | head -20
kill %1 && sleep 2 && curl -s localhost:9464/healthz   # connection refused, dead-man's switch should fire
node scripts/daily-summary.mjs
```

Then run a deliberate drill: stop the agent without warning and time how long it
takes for a page to reach your phone. If that number is longer than the time it
would take the agent to lose an amount you care about, the monitoring is not
finished.

## Gotchas

- **A healthy process is not a working agent.** Liveness checks pass while a
  strategy silently emits nothing because an indicator returned `null` forever.
  Alert on absence of expected activity, not only on errors.
- A stalled sequencer produces a flat price series, not an error. Every
  indicator will read it as a calm market and some strategies will size up into
  it. The chain lag monitor above is the specific defence.
- Never let alerting throw into the trading path. Wrap every sink call and
  degrade to `console.error`. An agent that crashes because its webhook is down
  has traded a small problem for a large one.
- Deduplication must not suppress pages. A repeating page is annoying; a
  suppressed one during a 90-minute incident is expensive.
- Bind the metrics server to loopback. It exposes position and PnL data and has
  no authentication.
- Alert thresholds decay. Revisit them after any change to size, tick interval,
  or strategy. A daily loss threshold set for a 10,000 account is meaningless on
  a 100,000 one.
