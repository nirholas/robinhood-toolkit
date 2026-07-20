<!--
  robinhood-toolkit · build prompt: incident response for an autonomous trader
  Author: nirholas · https://github.com/nirholas/robinhood-toolkit
  License: MIT (c) 2026 nirholas
-->

# 05 · Incident response

## Goal

Build the tooling and the written runbook that let one person stop a
misbehaving agent, contain the damage, establish what happened, and decide
whether to resume, at 03:00 on a Sunday, without reading source code. You will
implement a halt command that works in under ten seconds, a flatten command, a
containment procedure for a suspected key compromise, and the post-mortem
process that turns each incident into a control.

## Prerequisites

- All of `50-autonomous` and `80-safety` 01 to 04. Incident response consumes
  the kill switch, the journal, the position book, and the alerting.
- A written on-call contact, even if it is one person. An escalation path with
  nobody on it is not a path.

## Reference facts (verified)

| | Mainnet | Testnet |
|---|---|---|
| Chain ID | 4663 | 46630 |
| RPC | `https://rpc.mainnet.chain.robinhood.com` | `https://rpc.testnet.chain.robinhood.com` |
| Explorer | `https://robinhoodchain.blockscout.com` | `https://explorer.testnet.chain.robinhood.com` |
| Sequencer feed | `wss://feed.mainnet.chain.robinhood.com` | `wss://feed.testnet.chain.robinhood.com` |

- Crypto REST API docs: <https://docs.robinhood.com/crypto/trading>
- **There is no market close to end an incident for you.** On an equities venue
  a runaway loop stops at 16:00 ET regardless of your response time. Here, the
  only thing that stops it is you. Response time is directly proportional to
  loss.
- Robinhood does not supervise connected agents. There is no venue risk desk
  that will call you, halt your account, or reverse an erroneous order. Assume
  no external intervention, ever.
- On-chain transactions are final. There is no chargeback, no reversal, and no
  support path that undoes a sent transaction. Containment means stopping
  further sends, not undoing prior ones.
- Robinhood operates the sequencer and the proposer on this chain. A sequencer
  outage is a plausible incident class for you and one you cannot fix. Your
  runbook needs a "the chain is not moving" branch that does not involve
  debugging your own code.

## Severity levels

| Level | Definition | Response |
|---|---|---|
| **SEV1** | Uncontrolled spending, suspected key compromise, or position drift indicating an unknown actor | Halt immediately, then investigate. Do not diagnose first. |
| **SEV2** | Agent is trading incorrectly but bounded by policy: wrong signals, repeated rejections, stale data | Halt, then investigate within the hour. |
| **SEV3** | Degraded but not trading incorrectly: monitoring gaps, slow ticks, alert noise | Investigate during the next working block. Do not halt. |

The default action for SEV1 and SEV2 is halt. Halting a working agent costs you
some missed opportunity. Not halting a broken one costs principal. The
asymmetry is not close, and it is worth internalizing before you are the person
deciding at 03:00.

## Steps

1. Write `RUNBOOK.md` at the repository root. It must be readable by someone
   half asleep who did not write the code: the halt command in the first ten
   lines, the severity table, one section per incident class, and the exact
   commands to run. Not prose about philosophy. Commands.
2. Implement `scripts/halt.mjs`: writes the kill switch file, sets the halt flag
   in the shared store so every instance sees it, cancels open orders, and
   confirms the halt took effect by polling until no instance reports healthy.
   Halting must not depend on the agent process being responsive.
3. Provide a halt path that works when Node does not run: `touch ./KILL` must be
   sufficient. The script is the convenience; the file is the guarantee.
4. Implement `scripts/flatten.mjs`: closes every open position to the quote
   asset with market orders, one at a time, with a confirmation prompt and a
   dry-run default. **Flatten is a separate decision from halt.** Halting is
   always correct under uncertainty; flattening crystallizes losses and can be
   the wrong move in a temporary dislocation. Never automate flatten as a
   response to an alert.
5. Implement `scripts/contain-key.mjs` for suspected key compromise: revoke the
   KMS signing permission first (that is the actual containment), then sweep the
   hot wallet to cold, then revoke the REST credential, then rotate. Order
   matters. Sweeping before revoking races the attacker for the same balance and
   you will lose that race.
6. Implement `scripts/incident-snapshot.mjs`: captures the journal tail, open
   positions, recent fills, policy verdicts, metrics, chain head, and the
   process environment minus secrets, into one timestamped directory. Run it
   **before** you change anything. Evidence you did not capture is evidence you
   destroyed.
7. Schedule a quarterly drill. Halt production deliberately, time it end to end,
   and fix whatever was slower than expected. An untested runbook is a document,
   not a capability.
8. Write the post-mortem template and the rule that every SEV1 and SEV2 closes
   with a merged change: a new policy rule, a new alert, or a new test. An
   incident that produces only a document will happen again.

```js
/**
 * robinhood-toolkit · halt command
 * Author: nirholas · https://github.com/nirholas/robinhood-toolkit
 * License: MIT (c) 2026 nirholas
 */
import { writeFileSync } from 'node:fs';

const KILL_FILE = process.env.KILL_SWITCH_FILE ?? './KILL';
const HEALTH_URL = process.env.AGENT_HEALTH_URL ?? 'http://127.0.0.1:9464/healthz';

export async function halt({ reason, store, broker, timeoutMs = 30_000 }) {
  const startedAt = Date.now();
  const steps = [];

  // 1. Local file first. Works even if every network dependency is down.
  writeFileSync(KILL_FILE, `halted ${new Date().toISOString()}\nreason: ${reason}\n`);
  steps.push({ step: 'kill_file', ok: true, path: KILL_FILE });

  // 2. Shared flag so other instances halt too.
  try {
    await store.compareAndSet('agent:halt', null, { halted: true, reason, ts: Date.now() });
    steps.push({ step: 'shared_halt_flag', ok: true });
  } catch (err) {
    steps.push({ step: 'shared_halt_flag', ok: false, error: err.message });
  }

  // 3. Cancel resting orders. Best effort: a failure here does not block the halt.
  try {
    const open = await broker.getOpenOrders();
    for (const o of open) await broker.cancelOrder(o.id ?? o.clientOrderId).catch(() => {});
    steps.push({ step: 'cancel_open_orders', ok: true, count: open.length });
  } catch (err) {
    steps.push({ step: 'cancel_open_orders', ok: false, error: err.message });
  }

  // 4. Verify. A halt you did not confirm is a halt you did not perform.
  let confirmed = false;
  while (Date.now() - startedAt < timeoutMs) {
    const res = await fetch(HEALTH_URL).then((r) => r.json()).catch(() => null);
    if (!res || res.killSwitch === true) { confirmed = true; break; }
    await new Promise((r) => setTimeout(r, 500));
  }
  steps.push({ step: 'confirm_halted', ok: confirmed, elapsedMs: Date.now() - startedAt });

  if (!confirmed) {
    console.error('HALT NOT CONFIRMED. Escalate: stop the process or the container directly.');
  }
  return { halted: confirmed, reason, steps, elapsedMs: Date.now() - startedAt };
}
```

`RUNBOOK.md` opens like this. Nothing above it, no preamble:

```markdown
# RUNBOOK

## STOP THE AGENT RIGHT NOW

    touch ./KILL          # on the agent host, takes effect next tick
    node scripts/halt.mjs --reason "describe briefly"   # halts every instance and confirms

If neither works:

    systemctl stop rh-agent          # systemd
    docker stop rh-agent             # container
    <revoke the KMS signing permission>   # last resort, stops chain sends dead

Halting is always safe. Halt first, diagnose second.
```

## Deliverable

- `RUNBOOK.md` at the repository root, with the halt commands in the first ten
  lines, the severity table, and one section per incident class: runaway
  ordering, position drift, key compromise, sequencer stall, venue outage,
  crash loop, monitoring blind spot.
- `scripts/halt.mjs`, `scripts/flatten.mjs` (dry-run default),
  `scripts/contain-key.mjs`, `scripts/incident-snapshot.mjs`.
- `docs/postmortem-template.md` and an `incidents/` directory.
- A quarterly drill entry on a real calendar with a named owner.

## How to verify

Run the drill and time each step:

```sh
# 1. halt, timed. Target: under 10 seconds from decision to confirmed stop.
time node scripts/halt.mjs --reason "quarterly drill"
curl -s localhost:9464/healthz | jq '.killSwitch'   # true

# 2. evidence capture
node scripts/incident-snapshot.mjs --out incidents/$(date -u +%Y%m%dT%H%M%SZ)

# 3. flatten, dry run only during a drill
node scripts/flatten.mjs --dry-run

# 4. resume, deliberately
rm ./KILL && node scripts/resume.mjs --confirm
```

Then verify the halt worked from the other direction: with `./KILL` present,
start a fresh agent process and confirm it refuses to place orders rather than
starting clean and ignoring the file. A kill switch that only affects a running
process does not survive the restart that follows every incident.

## Gotchas

- **Halt before you diagnose.** The instinct to understand the problem first is
  the expensive one. The agent keeps trading while you read logs, and this venue
  gives you no closing bell to bail you out.
- A halt that is not confirmed did not happen. Poll health until the agent
  acknowledges, and escalate to stopping the process if it does not.
- Do not automate flatten. Wiring a "close everything" action to an alert
  threshold means a bad price print or a stale feed can liquidate your book at
  the worst available price. Halt is automatic; flatten is a human decision.
- For key compromise, revoke signing permission first. Every other step races an
  attacker who is already inside, and sweeping funds is a race you lose because
  they do not need to think about it.
- Capture evidence before restarting. A restart clears in-memory state, rotates
  logs, and destroys the exact context that explains the incident. The snapshot
  script takes seconds and is the difference between a real post-mortem and a
  guess.
- Journal writes stop when the agent stops, so the last few seconds before a
  crash may be buffered and lost. Check the buffer flush behaviour in
  `80-safety/04` and prefer a shorter flush interval on production.
- Resuming is a decision that needs a reason. Add a `--confirm` flag and require
  the operator to record why they believe the cause is fixed, into the journal.
  "It seemed to stop happening" is how the second incident starts.
- A sequencer stall is not your bug and not your fix. Halt, wait, monitor block
  height, and resume when the chain moves. Do not deploy code changes into a
  chain outage.
