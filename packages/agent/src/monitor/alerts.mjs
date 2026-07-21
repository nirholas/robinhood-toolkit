/**
 * robinhood-toolkit · alert router, dead-man's switch, and chain-lag monitor
 * Author: nirholas · https://github.com/nirholas/robinhood-toolkit
 * License: All Rights Reserved (c) 2026 nirholas
 *
 * Hard rule for everything in this file: alerting must never throw into the
 * trading path. Every outbound call is wrapped; on failure we degrade to
 * console.error and return a result object. An agent that crashes because its
 * webhook is down has traded a small problem for a large one.
 */

/**
 * Routes alerts to a per-severity sink with dedupe. Pages are never deduped:
 * a repeated page is annoying, a suppressed one during a 90-minute incident is
 * expensive.
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

/**
 * Dead-man's switch. The agent pings an external service on every tick; that
 * service alerts when the ping stops. This is the only check that survives the
 * agent process dying, the host dying, and the network dying — in-process
 * alerting cannot tell you it is dead.
 *
 * Configure `url` (and `intervalSeconds` for documentation/expectation) from a
 * pull-based watchdog such as healthchecks.io, Better Uptime, Dead Man's Snitch,
 * or a PagerDuty heartbeat. Register the *expected* interval there so a missed
 * ping fires the page.
 */
export function createDeadMansSwitch({ url, intervalSeconds, fetchImpl = fetch, metrics } = {}) {
  return {
    intervalSeconds,
    async ping(context = {}) {
      metrics?.set('agent_heartbeat_last_ping_seconds', Math.floor(Date.now() / 1000));
      if (!url) return { sent: false, reason: 'no_url' };
      try {
        await fetchImpl(url, { method: 'POST', body: JSON.stringify(context) });
        return { sent: true };
      } catch (err) {
        // The external watchdog will notice the missing ping; never throw here.
        console.error(`[heartbeat] ping failed: ${err.message}`);
        return { sent: false, reason: 'ping_error' };
      }
    },
  };
}

/**
 * Alert on the *absence* of expected activity, not only on errors. A healthy
 * process is not a working agent: liveness passes while a strategy silently
 * emits nothing because an indicator returned null forever. Call `seen()`
 * whenever the strategy produces real output (a signal, an order, a decision).
 * `check()` pages when nothing has been seen for longer than `maxSilentMs`.
 */
export function createActivityMonitor({ alerter, maxSilentMs = 3_600_000, clock = Date }) {
  let lastActivityAt = clock.now();
  return {
    seen() { lastActivityAt = clock.now(); },
    async check() {
      const silentMs = clock.now() - lastActivityAt;
      if (silentMs > maxSilentMs) {
        await alerter.fire({
          severity: 'page',
          rule: 'no_strategy_activity',
          message: `no strategy activity for ${Math.round(silentMs / 1000)}s`,
          context: { silentMs },
        });
      }
      return { silentMs };
    },
  };
}

/**
 * Detects a stalled sequencer: RPC answers, block height does not move. A
 * stalled sequencer produces a flat price series, not an error — every
 * indicator reads it as a calm market and some strategies will size up into it.
 */
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
