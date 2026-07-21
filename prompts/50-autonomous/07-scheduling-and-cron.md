<!--
  robinhood-toolkit · build prompt: scheduling, single-instance leases, restart safety
  Author: nirholas · https://github.com/nirholas/robinhood-toolkit
  License: All Rights Reserved (c) 2026 nirholas
-->

# 07 · Scheduling and cron

## Goal

Run the agent unattended without ever running it twice. You will build a
distributed lease so only one instance trades at a time, make restarts safe by
persisting cooldown and position state, and provide deployment recipes for a
long-lived process and for a scheduled invocation.

## Prerequisites

- Prompts 01, 04, 05, and 06 completed.
- One of: a systemd host, a container platform, or a scheduler that can invoke a
  process. Track `70-deploy` covers the platform mechanics; this prompt covers
  what the agent needs from any of them.
- A shared store for the lease if you run more than one host: Redis, Postgres,
  or an object store with conditional writes. A local file lock is sufficient
  only for a single-host deployment, and you must know which case you are in.

## Reference facts (verified)

| | Mainnet | Testnet |
|---|---|---|
| Chain ID | 4663 | 46630 |
| RPC | `https://rpc.mainnet.chain.robinhood.com` | `https://rpc.testnet.chain.robinhood.com` |

- Crypto REST API docs: <https://docs.robinhood.com/crypto/trading>
- **There is no market close.** On an equities venue, a scheduler bug that
  double-starts a bot causes damage until 16:00 ET and then stops. Here it runs
  until the account is empty. The single-instance lease is therefore a safety
  control, not an operational nicety.
- Blocks arrive roughly every 101 ms. Any schedule coarser than a second is
  effectively a sampling decision, so state your tick interval as a strategy
  parameter and record it in the journal rather than treating it as deployment
  trivia.
- Time zones do not apply to this venue. Schedule and log in UTC everywhere. A
  daily loss limit that resets at "midnight local" moves twice a year under
  daylight saving and will reset mid-drawdown at the worst possible moment.

## Steps

1. Decide the execution model and write it down in the repo:
   - **Long-lived process** (recommended): one process, internal timer from
     prompt 01, restarted by the supervisor on crash. Best for sub-minute ticks
     and stateful strategies.
   - **Scheduled invocation**: the scheduler starts a process, it does one tick,
     it exits. Best for ticks of 5 minutes or longer and for platforms that bill
     per second. Requires all state to be external.
   Mixing the two silently is how you end up with two agents trading one book.
2. Create `src/lease.mjs`. Acquire a named lease with a TTL before the first
   tick, renew it every `ttl/3`, and release it on shutdown. If renewal fails,
   stop trading immediately: another instance may already hold it.
3. Make the lease fail closed. If the lease store is unreachable, do not trade.
   An agent that assumes it holds the lease when it cannot check is the exact
   double-trading scenario the lease exists to prevent.
4. Persist restart-sensitive state to the same store: `lastFillAt` per symbol
   (cooldowns), the daily realized loss counter and its UTC day key, and the
   position book. On boot, load it, reconcile against the venue (prompt 06), and
   only then start ticking.
5. Add a startup crash-loop guard. If the process has restarted more than N
   times in M minutes, refuse to start and require manual clearing. A crash loop
   at a 101 ms chain plus an eager retry policy can generate a lot of orders.
6. Emit a heartbeat on every tick for prompt 08 to alert on. A scheduler that
   silently stopped invoking your agent looks identical to a calm market.
7. Write the deployment units. Every one of them must set `AGENT_MODE`
   explicitly rather than relying on the default, so the mode is visible in the
   deployment config during an incident.

```js
/**
 * robinhood-toolkit · single-instance lease
 * Author: nirholas · https://github.com/nirholas/robinhood-toolkit
 * License: All Rights Reserved (c) 2026 nirholas
 */
import { randomUUID } from 'node:crypto';

/**
 * store must implement:
 *   get(key) -> { holder, expiresAt } | null
 *   compareAndSet(key, expected, next) -> boolean
 * A Redis SET NX PX, a Postgres row with an optimistic version, or an
 * object-store conditional write all satisfy this.
 */
export function createLease({ store, key = 'agent:trading:lease', ttlMs = 30_000, onLost }) {
  const holder = `${process.env.HOSTNAME ?? 'local'}:${process.pid}:${randomUUID().slice(0, 8)}`;
  let renewTimer = null;
  let held = false;

  async function tryAcquire() {
    const now = Date.now();
    const current = await store.get(key); // throws if store is unreachable: fail closed
    if (current && current.holder !== holder && current.expiresAt > now) return false;
    return store.compareAndSet(key, current, { holder, expiresAt: now + ttlMs });
  }

  return {
    holder,
    get held() {
      return held;
    },

    async acquire() {
      held = await tryAcquire();
      if (!held) return false;
      renewTimer = setInterval(async () => {
        try {
          const ok = await tryAcquire();
          if (!ok) throw new Error('lease taken by another instance');
        } catch (err) {
          held = false;
          clearInterval(renewTimer);
          console.error(`[lease] lost: ${err.message}. Halting trading.`);
          await onLost?.(err);
        }
      }, Math.floor(ttlMs / 3));
      renewTimer.unref?.();
      return true;
    },

    async release() {
      if (renewTimer) clearInterval(renewTimer);
      held = false;
      const current = await store.get(key).catch(() => null);
      if (current?.holder === holder) await store.compareAndSet(key, current, null).catch(() => {});
    },
  };
}

/** Refuses to start after repeated fast restarts. */
export async function crashLoopGuard({ store, key = 'agent:restarts', windowMs = 600_000, max = 5 }) {
  const now = Date.now();
  const record = (await store.get(key)) ?? { stamps: [] };
  const stamps = [...record.stamps, now].filter((t) => now - t < windowMs);
  await store.compareAndSet(key, record, { stamps });
  if (stamps.length > max) {
    throw new Error(`crash loop: ${stamps.length} starts in ${windowMs / 60000}m. Clear ${key} to resume.`);
  }
  return stamps.length;
}
```

Long-lived process, systemd:

```sh
# robinhood-toolkit · agent service unit
# Author: nirholas · https://github.com/nirholas/robinhood-toolkit
# License: All Rights Reserved (c) 2026 nirholas
# /etc/systemd/system/rh-agent.service
[Unit]
Description=robinhood-toolkit trading agent
After=network-online.target

[Service]
Type=simple
User=agent
WorkingDirectory=/opt/rh-agent
Environment=AGENT_MODE=paper
Environment=TZ=UTC
EnvironmentFile=/etc/rh-agent/env
ExecStart=/usr/bin/node src/main.mjs
Restart=on-failure
RestartSec=15
StartLimitIntervalSec=600
StartLimitBurst=5
KillSignal=SIGTERM
TimeoutStopSec=60

[Install]
WantedBy=multi-user.target
```

Scheduled invocation, crontab:

```sh
# robinhood-toolkit · scheduled single-tick invocation
# Author: nirholas · https://github.com/nirholas/robinhood-toolkit
# License: All Rights Reserved (c) 2026 nirholas
CRON_TZ=UTC
*/5 * * * * cd /opt/rh-agent && AGENT_MODE=paper AGENT_MAX_TICKS=1 /usr/bin/node src/main.mjs >> /var/log/rh-agent.log 2>&1
```

## Deliverable

- `src/lease.mjs` with `createLease` and `crashLoopGuard`.
- `src/state-store.mjs` with one adapter interface and at least two
  implementations (file for single host, Redis or Postgres for multi host).
- `deploy/rh-agent.service` and `deploy/crontab` with the units above.
- `test/lease.test.js` asserting a second acquirer is refused while the first
  lease is live, and that an unreachable store results in no trading.

## How to verify

```sh
cd packages/agent
node --test test/lease.test.js

# start two instances against the same store; the second must refuse to tick
AGENT_MODE=paper node src/main.mjs &
AGENT_MODE=paper node src/main.mjs   # logs "lease held by <other>", exits
```

Then kill the first instance and confirm the second acquires within one TTL.
Finally, restart the agent mid-session and confirm from the journal that
cooldowns and the daily loss counter survived the restart rather than resetting
to zero.

## Gotchas

- **Restart resets are the sneakiest bug in this track.** In-memory cooldowns
  and an in-memory daily loss counter both reset to a permissive state on
  restart. A crash loop then becomes an unlimited trading loop with every safety
  counter cleared on each pass. Persist both, keyed to a UTC day.
- `SIGKILL` skips your shutdown handler and leaves the lease held until TTL
  expiry. Set `TimeoutStopSec` generously and make lease TTL short enough that
  recovery is fast, but longer than your worst-case tick.
- A scheduled invocation that overruns its interval is the same overlap bug as
  prompt 01's `inFlight` guard, one layer up. The lease handles it; do not rely
  on the schedule being faster than the work.
- Do not use `@reboot` cron entries for a trading agent. A host reboot should
  require a deliberate start, especially after an unexplained crash.
- Log in UTC and set `TZ=UTC` in the unit. Mixed time zones across the journal,
  the venue's timestamps, and your alerts make a post-mortem nearly impossible.
- If you run a canary and a production instance, they need different lease keys
  and different accounts, or the canary will simply never trade and you will
  learn nothing from it.
