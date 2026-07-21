<!--
  robinhood-toolkit · package: robinhood-risk
  Author: nirholas · https://github.com/nirholas/robinhood-toolkit
  License: All Rights Reserved (c) 2026 nirholas
-->

# robinhood-risk

The risk layer for Robinhood Chain (Arbitrum Orbit L2, chain `4663` / testnet
`46630`). It is not a disclaimer. It is a set of primitives that make a
value-moving flow **degrade correctly** when the operator's assumptions stop
holding, and that tell a user what they are trusting before they sign.

Four parts, one model:

| Module | Export | What it does |
| --- | --- | --- |
| `src/assumptions.js` | `TRUST_MODEL` | Machine-readable trust model. The single source of truth. |
| `src/disclosure.js` | `disclosureHTML`, `mountDisclosure` | Accessible component that renders the model. |
| `src/gate.js` | `requireDisclosure`, `gated` | One-time, persisted pre-transaction acknowledgment. |
| `src/liveness.js` | `monitorLiveness` | Sequencer liveness monitor (RPC head + feed cross-check). |
| `src/liveness-ui.js` | `bindLivenessToSubmit` | Disables submission on a stall and shows the exit path. |

Everything renders **from** `TRUST_MODEL`, so product copy — in the app, in the
gate, in the site risk section — cannot drift from the model.

## Install

```sh
npm i robinhood-risk viem
# ws is a dependency; it enables the sequencer feed cross-check. In a browser or
# on Node >= 22 the global WebSocket is used and ws is not required.
```

Read-only. Nothing in this package signs or submits a transaction.

## The trust model

Each assumption is:

```js
{
  id: 'centralized-sequencer',        // stable kebab-case key
  severity: 'high',                   // low | medium | high
  verified: true,                     // false until confirmed from a primary source
  statement: '…',                     // plain language, no jargon-only claims
  affects: ['transaction inclusion'], // user actions it bears on
  mitigation: '…',                    // what a user or integrator can actually do
}
```

Two rules keep the file honest, and both are enforced by tests:

1. **Unverified items stay in the array** with `verified: false`. They are never
   dropped because they could not be confirmed. An omitted risk reads as an
   absent risk; silence reads as safety.
2. **Every entry carries a `mitigation`.** A risk list with no mitigations is a
   disclaimer, and a disclaimer is not the deliverable. Every *unverified*
   mitigation additionally names the primary source to check.

```js
import { TRUST_MODEL, unverified, highSeverity, bySeverity } from 'robinhood-risk'

unverified().map((a) => a.id)   // ['proxy-upgrade-control', 'escape-hatch']
highSeverity().map((a) => a.id) // the items that must render without a click
```

### Severity scale

| Severity | Meaning | Rendering rule |
| --- | --- | --- |
| `high` | Failure would be high-impact (funds, censorship, worst-case exit). | Must be visible in the disclosure **without a click**. |
| `medium` | Failure would be material (latency, integration stability, custody expectations). | Visible; may sit below the high items. |
| `low` | Failure would be limited, or the item is a strength framed as context. | Visible; lowest priority. |

Severity is about the *impact if the assumption fails*, not the *likelihood*. A
centralized sequencer that behaves well every day is still `high`, because the
question is what you are exposed to if it does not.

### Adding an assumption, or promoting one to verified

1. Add or edit the entry in `src/assumptions.js`. Keep `id` stable — the gate and
   any deep links reference it.
2. Write the `mitigation` first. If you cannot state what a user does about the
   risk, you do not yet understand the risk well enough to ship the entry.
3. To move an item from `verified: false` to `verified: true`, confirm it from a
   **primary source** — <https://docs.robinhood.com/chain/>, the contract docs at
   <https://docs.robinhood.com/chain/contracts/>, the block explorer, or the
   L2BEAT page for this chain — then flip the flag and remove the `UNVERIFIED:`
   prefix from the statement. Cite what you read in the PR.
4. If the change alters **what** the gate asks a user to acknowledge (not just
   wording), bump `ACK_VERSION` in `src/gate.js` so returning users are asked
   once more.
5. `npm test` guards the invariants: shape, unique ids, a mitigation on every
   item, and a primary-source pointer on every unverified item.

> A young chain's parameters change. Re-check the unverified items on a schedule;
> a risk doc that was accurate at launch quietly becomes wrong.

## Disclosure component

Framework-free. `disclosureHTML()` returns a string (server rendering, tests);
`mountDisclosure()` returns a live element.

```js
import { mountDisclosure } from 'robinhood-risk'
document.querySelector('#risk').append(mountDisclosure())
```

It is readable at 320px, keyboard navigable, semantically marked up, encodes
severity in **text and a glyph** (never color alone), and hides nothing behind a
`<details>` — every high-severity assumption is on screen without interaction.

## Pre-transaction gate

Before a user's first bridge or first mainnet send, show the exit-latency and
operator-centralization items and require acknowledgment. Once per user,
persisted, not a modal on every action.

```js
import { requireDisclosure, gated } from 'robinhood-risk'

// Option A: gate imperatively.
async function onBridge() {
  if (!(await requireDisclosure())) return // dismissed → do NOT proceed
  await bridge()
}

// Option B: wrap the action.
sendButton.addEventListener('click', () =>
  gated(() => send(), { /* storage, document, mount, now */ }),
)
```

A dismissed gate resolves `false` and the action must not run. In a context with
no DOM and no prior acknowledgment, `requireDisclosure` resolves `false` — it
will not wave a value-moving action through without showing the required copy.

## Liveness monitor

At ~101 ms blocks, ten seconds of silence is roughly a hundred missed blocks —
anomalous, not noise. Thresholds tuned for a 12-second L1 are useless here.

```js
import { monitorLiveness } from 'robinhood-risk'

const stop = monitorLiveness((s) => {
  // s.status:    'healthy' | 'degraded' | 'stalled' | 'unreachable'
  // s.feedStatus:'live' | 'silent' | 'connecting' | 'disconnected' | 'disabled'
  // s.divergence:null | 'rpc-stalled-feed-live' | 'feed-silent-rpc-advancing'
  // s.canSubmit: boolean   s.exit: canonical exit (on stall/unreachable)
  console.log(s)
})
// stop() when done
```

Defaults: `DEGRADED_MS = 5_000`, `STALLED_MS = 30_000`, `FEED_SILENT_MS = 10_000`.

**Two independent signals, reported separately.** The RPC head advancing is one
signal; the sequencer WebSocket feed carrying messages is another. A frozen head
is a different failure from a feed that goes quiet while RPC keeps advancing.
Collapsing them loses the information that tells a user what is happening, so they
stay distinct and combine into `divergence`.

### Wiring it into the UI

```js
import { bindLivenessToSubmit } from 'robinhood-risk'

const stop = bindLivenessToSubmit({
  button: document.querySelector('#send'),
  statusEl: document.querySelector('#liveness'),
})
```

On `stalled` or `unreachable` the button is disabled and the status element shows
the reason plus the canonical exit path and its **~7 day** period. The point is
that a user never broadcasts into a stalled sequencer and reads the silence as
their own error.

### Standalone

```sh
node scripts/liveness.mjs                 # mainnet, RPC + feed
node scripts/liveness.mjs --testnet
node scripts/liveness.mjs --rpc https://unreachable.invalid   # prove the failure path
```

## Verify

```sh
# Model completeness
node -e "import('./src/assumptions.js').then(m => {
  console.log('unverified:', m.unverified().map(a => a.id));
  console.log('high severity:', m.highSeverity().map(a => a.id));
})"

# Liveness against the live chain — expect status: healthy, canSubmit: true, head advancing
node -e "import('./src/liveness.js').then(m => m.monitorLiveness(s => console.log(s)))"

# The failure path — expect status: unreachable, canSubmit: false, no throw/hang
node -e "import('./src/liveness.js').then(m =>
  m.monitorLiveness(s => console.log(s), { feed: false, rpcUrl: 'https://unreachable.invalid' }))"

# Full suite (stalled + unreachable branches run against a stubbed client)
npm test
```

## What this chain does and does not give you

- **Data availability is on Ethereum.** Transaction data is posted via blobs, so
  history is reconstructible independently of the operator. This is real and it
  is a strength.
- **Execution validity depends on a small challenger set** — fewer than five
  external actors, which is why L2BEAT rates the profile "Other". Do not write
  "secured by Ethereum" without qualification; data availability and execution
  validity are different claims and conflating them is the most common inaccuracy
  in writeups of this chain.
- **On-chain balances are not brokerage balances.** Self-custody wallet services
  run through Robinhood Non-Custodial Ltd (Cayman), a separate entity from
  Robinhood Financial LLC and Robinhood Crypto LLC. The entities are *related*,
  not unaffiliated. State both halves; overstating the separation is as
  misleading as collapsing it.

## License

All Rights Reserved © nirholas. Part of [robinhood-toolkit](https://github.com/nirholas/robinhood-toolkit).
