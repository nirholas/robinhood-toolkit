<!--
  robinhood-toolkit · build prompt: a fail-closed policy engine for agent orders
  Author: nirholas · https://github.com/nirholas/robinhood-toolkit
  License: MIT (c) 2026 nirholas
-->

# 02 · Policy guardrails

## Goal

Build the component that stands between an agent's intent and a real order. It
evaluates every intent against a declarative policy, returns an explicit verdict
with the reasons, and **denies on any evaluation error**. No order reaches a
broker without passing through it, including exits, manual overrides, and
retries.

## Prerequisites

- `prompts/50-autonomous/01-strategy-loop-architecture.md` for the `Policy` port
  the loop calls.
- No runtime dependency required. The engine below is self-contained by design.

## Existing option

`@three-ws/agent-guards` on npm is a published policy engine covering this same
problem space (notional caps, allowlists, spend limits, kill switches) and is
worth evaluating before you write your own. Check its weekly downloads, last
publish date, and license against your requirements the way you would any
dependency.

This prompt still builds a self-contained engine, deliberately. A guardrail is
the last thing you want to discover has a transitive dependency, a breaking
minor release, or an install failure at 03:00. Roughly 200 lines of pure
functions with no imports is cheap to own, cheap to audit, and cannot break
because of somebody else's release. Use the package if it fits; do not create a
hard dependency on it for the deny path.

## Reference facts (verified)

| | Mainnet | Testnet |
|---|---|---|
| Chain ID | 4663 | 46630 |
| RPC | `https://rpc.mainnet.chain.robinhood.com` | `https://rpc.testnet.chain.robinhood.com` |

- Crypto REST API docs: <https://docs.robinhood.com/crypto/trading>
- **Robinhood does not supervise, audit, or risk-check connected agents.** There
  is no upstream limit that stops a runaway loop. Every constraint in this file
  is one you wrote, and it is the only one that exists.
- The venue trades 24/7. On an equities venue, a daily loss limit has a natural
  boundary at the session close and a runaway loop stops on its own. Here, the
  daily loss stop and the cooldown are the boundary. Set them as though nothing
  else will ever intervene, because nothing else will.

## The six controls

| Control | Blocks | Why it exists |
|---|---|---|
| Max order notional | Any single order above a value cap | A fat-finger or a units bug (0.001 vs 1.0) is the largest single-order risk |
| Daily realized-loss stop | All orders once cumulative realized loss for the UTC day exceeds a limit | The only control that bounds total damage from a strategy that is simply wrong |
| Asset allowlist / denylist | Symbols outside the allowlist, or on the denylist | A strategy bug or a bad market-data feed can produce a symbol you never intended to trade |
| Cooldown between fills | Orders in the same symbol within N seconds of the last fill | Bounds order rate. The primary defence against a loop firing at block cadence |
| Confirm-above threshold | Orders above a notional that require out-of-band human approval | Lets you run small size autonomously and large size supervised, without two codebases |
| Global kill switch | Everything | The one control an operator can engage in seconds without a deploy |

Every one of these is a hard deny except confirm-above, which is a deny pending
approval. There is no warn-only tier. A control that logs and proceeds is not a
control.

## Steps

1. Create `src/policy/engine.mjs`. `evaluate(intent, ctx)` returns
   `{ allow, violations, requiresConfirmation, evaluatedAt }`. Never a bare
   boolean: the loop and the journal both need the reasons.
2. Wrap the entire evaluation in try/catch and **return deny on any throw**.
   Write the test for this first. The failure mode you are preventing is a null
   dereference inside a rule causing an exception that some caller catches and
   treats as "no violations found".
3. Make every rule a pure function `(intent, ctx) => violation | null`. Rules do
   no IO. State they need (daily PnL, last fill times, balances) arrives through
   `ctx`, which the loop assembles. Rules that fetch cannot be tested
   deterministically and can hang the deny path.
4. Load policy from `policy.json`, validate it at startup, and **refuse to start
   on an invalid or missing policy**. Defaulting to a permissive policy when the
   file is absent is the same bug as failing open, moved to boot time.
5. Key the daily loss counter to a UTC day string and persist it (prompt
   `50-autonomous/07`). An in-memory counter resets on restart, which converts a
   crash loop into unlimited losses.
6. Implement the confirmation path as a real out-of-band step: write a pending
   record, alert, and require an explicit approval token before the order
   proceeds. A confirmation prompt that the agent can answer itself is
   decoration.
7. Make the kill switch checked first and from two independent sources (file and
   env), matching prompt `50-autonomous/01`. During an incident, the file is
   often the only lever available.
8. Log every evaluation to the audit journal (`80-safety/04`), allows included.
   Only recording denials makes it impossible to prove afterwards that a given
   order was evaluated at all.

```js
/**
 * robinhood-toolkit · fail-closed policy engine
 * Author: nirholas · https://github.com/nirholas/robinhood-toolkit
 * License: MIT (c) 2026 nirholas
 */
import { existsSync } from 'node:fs';

export const DEFAULT_POLICY = Object.freeze({
  maxOrderNotional: 100,
  dailyRealizedLossLimit: 200,
  allowlist: ['BTC-USD', 'ETH-USD'],
  denylist: [],
  cooldownMs: 60_000,
  confirmAboveNotional: 50,
  killSwitchFile: './KILL',
  maxOpenPositionNotional: 500,
});

export function validatePolicy(policy) {
  const errors = [];
  const num = (k) => {
    if (typeof policy[k] !== 'number' || !Number.isFinite(policy[k]) || policy[k] < 0) {
      errors.push(`${k} must be a finite non-negative number`);
    }
  };
  ['maxOrderNotional', 'dailyRealizedLossLimit', 'cooldownMs', 'confirmAboveNotional', 'maxOpenPositionNotional']
    .forEach(num);
  if (!Array.isArray(policy.allowlist) || policy.allowlist.length === 0) {
    errors.push('allowlist must be a non-empty array. An empty allowlist is not "allow everything".');
  }
  if (!Array.isArray(policy.denylist)) errors.push('denylist must be an array');
  if (policy.confirmAboveNotional > policy.maxOrderNotional) {
    errors.push('confirmAboveNotional exceeds maxOrderNotional, so it can never trigger');
  }
  if (errors.length) throw new Error(`invalid policy:\n  ${errors.join('\n  ')}`);
  return policy;
}

// --- rules: pure, synchronous, no IO ---

const violation = (rule, message, detail) => ({ rule, message, detail });

export const RULES = [
  function killSwitch(intent, ctx) {
    if (ctx.env?.AGENT_KILL === '1') return violation('kill_switch', 'AGENT_KILL=1 is set');
    if (existsSync(ctx.policy.killSwitchFile)) {
      return violation('kill_switch', `kill switch file present: ${ctx.policy.killSwitchFile}`);
    }
    return null;
  },

  function denylisted(intent, ctx) {
    return ctx.policy.denylist.includes(intent.symbol)
      ? violation('denylist', `${intent.symbol} is denylisted`)
      : null;
  },

  function notAllowlisted(intent, ctx) {
    return ctx.policy.allowlist.includes(intent.symbol)
      ? null
      : violation('allowlist', `${intent.symbol} is not in the allowlist`, { allowlist: ctx.policy.allowlist });
  },

  function maxNotional(intent, ctx) {
    const notional = requireNotional(intent);
    return notional > ctx.policy.maxOrderNotional
      ? violation('max_order_notional', `notional ${notional.toFixed(2)} exceeds ${ctx.policy.maxOrderNotional}`, { notional })
      : null;
  },

  function dailyLossStop(intent, ctx) {
    const loss = -Math.min(0, ctx.dailyRealizedPnl ?? 0);
    if (ctx.dailyRealizedPnl === undefined || ctx.dailyRealizedPnl === null) {
      return violation('daily_loss_stop', 'daily realized PnL unavailable, denying'); // fail closed
    }
    return loss >= ctx.policy.dailyRealizedLossLimit
      ? violation('daily_loss_stop', `realized loss ${loss.toFixed(2)} for ${ctx.utcDay} hit limit ${ctx.policy.dailyRealizedLossLimit}`, { loss, utcDay: ctx.utcDay })
      : null;
  },

  function cooldown(intent, ctx) {
    const last = ctx.lastFillAt?.[intent.symbol];
    if (last === undefined) return null;
    const since = ctx.now - last;
    return since < ctx.policy.cooldownMs
      ? violation('cooldown', `${Math.round((ctx.policy.cooldownMs - since) / 1000)}s remaining on ${intent.symbol}`, { since })
      : null;
  },

  function openPositionCap(intent, ctx) {
    if (intent.isExit) return null; // exits reduce exposure and are never capped by it
    const current = Math.abs(ctx.openNotional?.[intent.symbol] ?? 0);
    const after = current + requireNotional(intent);
    return after > ctx.policy.maxOpenPositionNotional
      ? violation('max_open_position', `position would reach ${after.toFixed(2)}, cap ${ctx.policy.maxOpenPositionNotional}`, { current, after })
      : null;
  },
];

function requireNotional(intent) {
  const n = Number(intent.notional);
  if (!Number.isFinite(n) || n <= 0) {
    throw new Error(`intent has no usable notional: ${JSON.stringify(intent.notional)}`);
  }
  return n;
}

export function createPolicyEngine({ policy = DEFAULT_POLICY, rules = RULES, journal } = {}) {
  validatePolicy(policy);

  return {
    policy,

    async evaluate(intent, context = {}) {
      const evaluatedAt = new Date().toISOString();
      let verdict;

      try {
        const ctx = {
          policy,
          now: context.now ?? Date.now(),
          env: context.env ?? process.env,
          utcDay: new Date(context.now ?? Date.now()).toISOString().slice(0, 10),
          ...context,
        };

        const violations = rules.map((rule) => {
          try {
            return rule(intent, ctx);
          } catch (err) {
            // A rule that throws counts as a violation, never as a pass.
            return violation('rule_error', `rule ${rule.name} threw: ${err.message}`);
          }
        }).filter(Boolean);

        const notional = Number(intent.notional) || 0;
        const requiresConfirmation =
          violations.length === 0 && notional > policy.confirmAboveNotional;

        verdict = {
          allow: violations.length === 0 && !requiresConfirmation,
          requiresConfirmation,
          violations,
          evaluatedAt,
          policyVersion: policy.version ?? 'unversioned',
        };
      } catch (err) {
        // FAIL CLOSED. Any unexpected error is a denial, not a pass.
        verdict = {
          allow: false,
          requiresConfirmation: false,
          violations: [violation('engine_error', `policy engine failed: ${err.message}`)],
          evaluatedAt,
          failedClosed: true,
        };
      }

      await journal?.write({ type: 'policy_evaluation', intent, verdict }).catch(() => {});
      return verdict;
    },
  };
}
```

## Deliverable

- `src/policy/engine.mjs` with `createPolicyEngine`, `RULES`, `validatePolicy`.
- `policy.json` committed with conservative production values, plus
  `policy.dev.json`.
- `src/policy/confirm.mjs` implementing the out-of-band approval flow: pending
  record, alert, approval token with an expiry.
- `test/policy.test.js` with one test per rule, plus the fail-closed tests
  described below.

## How to verify

```sh
cd packages/agent
node --test test/policy.test.js
```

The suite must include these four, and they are the ones that matter:

```js
// 1. a throwing rule denies rather than passes
const engine = createPolicyEngine({ rules: [() => { throw new Error('boom'); }] });
assert.equal((await engine.evaluate({ symbol: 'BTC-USD', notional: 1 })).allow, false);

// 2. a malformed intent denies
assert.equal((await engine.evaluate({})).allow, false);

// 3. missing daily PnL context denies
assert.equal((await engine.evaluate(validIntent, { dailyRealizedPnl: undefined })).allow, false);

// 4. the kill switch file denies everything, including exits
writeFileSync('./KILL', '');
assert.equal((await engine.evaluate({ ...validIntent, isExit: true })).allow, false);
unlinkSync('./KILL');
```

Then run the full loop in paper mode with a deliberately oversized strategy
quantity and confirm every order is blocked with
`rule: "max_order_notional"` in the journal.

## Gotchas

- **Fail closed is the entire design.** The natural way to write this
  (`if (violations.length) return false; return true`) fails open the moment any
  code path throws before the check. The try/catch that returns deny is not
  defensive style, it is the feature.
- An empty allowlist means "nothing is allowed", and `validatePolicy` rejects it
  because an empty array read as "allow all" is a catastrophic default. Be
  explicit either way.
- Never add a bypass flag. The moment `skipPolicy: true` exists, it will be set
  during an incident by someone who is certain it is fine, and it will not be.
  Exits go through the engine too; the `isExit` field exempts them from the
  exposure cap only, not from the kill switch.
- The daily loss counter must be keyed to a UTC day and persisted. In memory, a
  crash-restart clears it and a crash loop becomes unlimited losses.
- `confirmAboveNotional` above `maxOrderNotional` means confirmation can never
  trigger, because the notional cap denies first. The validator catches this
  because it is easy to configure by accident and looks correct.
- Evaluate exactly once per intent and pass the verdict forward. Re-evaluating
  before send introduces a window where the two evaluations disagree, and the
  code will use whichever answer it read last.
- Policy changes are production changes. Version the policy file, log the
  version in every verdict, and review changes the way you would review the
  execution engine.
