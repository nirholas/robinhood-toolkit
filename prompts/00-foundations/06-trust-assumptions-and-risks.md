<!--
  robinhood-toolkit · build prompt: trust assumptions, risk disclosure, and liveness monitoring
  Author: nirholas · https://github.com/nirholas/robinhood-toolkit
  License: All Rights Reserved (c) 2026 nirholas
-->

# 06 · Trust assumptions and risks

## Goal

Build the risk layer: a machine-readable trust-assumption model, a UI disclosure
component that renders it, and a liveness monitor that detects sequencer stalls.
The point is not a disclaimer. The point is that anything you ship on this chain
should degrade correctly when the assumptions below stop holding, and your users
should know what they are trusting before they sign.

## Prerequisites

- Prompts 02 and 05 completed. You import the chain definitions and the read
  layer.
- `npm i viem ws`.
- Read-only. Nothing here spends.

## Reference facts (verified)

**Operator centralization.** Robinhood operates both the sequencer and the
proposer. One party orders transactions and one party posts state roots, and it
is the same party.

**Fraud-proof permissioning.** L2BEAT classifies this chain's risk profile as
"Other" because fewer than five external actors can submit fraud challenges. An
optimistic rollup's security argument depends on someone independent being able
and willing to challenge an invalid state root. With a challenger set this
small, that argument is materially weaker than the "inherits Ethereum security"
framing suggests. This is a real decentralization caveat and it belongs in your
product copy, not only in a footnote.

**What the stack does still give you.** Arbitrum Orbit on Nitro, settling to
Ethereum with blob data availability. Transaction data is published to Ethereum,
so the chain's history is reconstructible by anyone even if the operator stops
cooperating. Data availability and execution correctness are separate
guarantees, and this chain is stronger on the first than on the second.

**Exit latency.** Canonical withdrawals take approximately 7 days, the
optimistic challenge period. Deposits take approximately 10 minutes. During a
sequencer outage, users cannot exit quickly through the canonical path.

**Third-party bridge risk.** Partner routes (LayerZero and Stargate, Chainlink
CCIP, Relay, Across, LiFi) skip the challenge period by fronting liquidity. Each
adds its own security model on top of the chain's. Faster is not safer.

**Upgradeability.** WETH `0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73` and USDG
`0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168` are both proxies. Proxy
implementations can change. Who controls those upgrades, and under what timelock
or multisig, is UNVERIFIED here: read it from
<https://docs.robinhood.com/chain/contracts/> and from the explorer before you
state anything about it.

**Legal structure.** Self-custody wallet services run through Robinhood
Non-Custodial Ltd, a Cayman Islands entity, which is separate from Robinhood
Financial LLC and from Robinhood Crypto LLC. An on-chain balance is not a
brokerage balance. It is not held by the broker-dealer and it does not carry
brokerage account protections. It is also not an unrelated third party: these
are related entities offering related products. Describe the relationship
accurately in both directions. Overstating the separation is as misleading as
collapsing it.

**Chain age.** Mainnet went live 2026-07-01. Testnet has run since 2026-02-10.
This is a young network. Treat operational history accordingly.

**Not verified.** Escape hatch mechanics (whether and how a user can force-include
a transaction or exit without the sequencer), the challenge window's exact
duration in blocks, validator set composition, and upgrade timelock parameters
are all UNVERIFIED in this document. These are the highest-value facts to
confirm from primary sources, because they determine what happens in the worst
case. Check <https://docs.robinhood.com/chain/> and the L2BEAT page for this
chain before publishing any claim about them.

## Steps

1. Create `packages/risk/src/assumptions.ts` exporting a structured
   `TRUST_MODEL`: each assumption gets an id, a plain-language statement, a
   severity, the affected user action, and a `verified` boolean. Unverified
   items stay in the array with `verified: false` rather than being dropped. An
   omitted risk reads as an absent risk.
2. Give each entry a `mitigation` field describing what a user or an integrator
   can actually do about it. A risk list with no mitigations is a disclaimer,
   which is not the deliverable.
3. Create `packages/risk/src/disclosure.tsx` (or the plain-DOM equivalent), a
   component rendering the model. Requirements: readable at 320px, keyboard
   navigable, semantic markup, no color-only severity encoding, and no collapsed
   -by-default section hiding a high-severity item.
4. Gate value-moving actions on it. Before a first bridge or a first mainnet
   send, the user sees the exit-latency and operator-centralization items and
   acknowledges them. Once per user, persisted, not a modal on every action.
5. Create `packages/risk/src/liveness.ts`, a sequencer liveness monitor. Track
   head advancement over a rolling window and classify: healthy, degraded,
   stalled. At approximately 101 ms blocks, ten seconds with no new block is
   already anomalous, which makes detection fast and cheap here.
6. Cross-check the RPC head against the sequencer WebSocket feed. Divergence
   between them, or a feed that stops while RPC advances, is a distinct signal
   from a full stall. Report them as separate states.
7. Wire liveness into the UI: when the monitor reports stalled, disable
   transaction submission and display the reason plus the canonical exit path
   and its seven day period. Do not let a user broadcast into a stalled
   sequencer and interpret the silence as their own error.
8. Write `packages/risk/README.md` explaining the model, the severity scale, and
   how to add an assumption when a fact moves from unverified to verified.

```js
/**
 * robinhood-toolkit · trust assumption model
 * Author: nirholas · https://github.com/nirholas/robinhood-toolkit
 * License: All Rights Reserved (c) 2026 nirholas
 */
export const TRUST_MODEL = [
  {
    id: 'centralized-sequencer',
    severity: 'high',
    verified: true,
    statement:
      'Robinhood operates both the sequencer and the proposer. One party orders ' +
      'transactions and posts state roots.',
    affects: ['transaction inclusion', 'censorship resistance', 'liveness'],
    mitigation:
      'Monitor sequencer liveness and disable submission when stalled. Do not ' +
      'design flows that assume guaranteed inclusion within a deadline.',
  },
  {
    id: 'permissioned-fraud-proofs',
    severity: 'high',
    verified: true,
    statement:
      'Fewer than five external actors can submit fraud challenges. L2BEAT ' +
      'classifies the risk profile as "Other" for this reason.',
    affects: ['state validity', 'withdrawal correctness'],
    mitigation:
      'Do not describe this chain as inheriting Ethereum security without ' +
      'qualification. Size positions to the operator trust you are extending.',
  },
  {
    id: 'withdrawal-latency',
    severity: 'medium',
    verified: true,
    statement:
      'Canonical withdrawals take approximately 7 days, the optimistic ' +
      'challenge period. Deposits take approximately 10 minutes.',
    affects: ['exit', 'liquidity planning'],
    mitigation:
      'Surface the 7 day period before the user signs. Offer partner routes as ' +
      'a labeled alternative with their own trust model, not as a default.',
  },
  {
    id: 'blob-data-availability',
    severity: 'low',
    verified: true,
    statement:
      'Transaction data is posted to Ethereum via blobs, so chain history is ' +
      'reconstructible independently of the operator.',
    affects: ['data availability', 'history reconstruction'],
    mitigation:
      'This is a strength, not a risk. Do not let it be read as covering ' +
      'execution validity, which it does not.',
  },
  {
    id: 'upgradeable-token-proxies',
    severity: 'medium',
    verified: true,
    statement:
      'Core bridged tokens (WETH, USDG) are proxy contracts whose ' +
      'implementations can change.',
    affects: ['token behavior', 'integration stability'],
    mitigation:
      'Interact through the proxy, never a cached implementation address. ' +
      'Monitor upgrade events on addresses you depend on.',
  },
  {
    id: 'proxy-upgrade-control',
    severity: 'high',
    verified: false,
    statement:
      'UNVERIFIED: who controls proxy upgrades, and under what multisig or ' +
      'timelock. Confirm at https://docs.robinhood.com/chain/contracts/ before ' +
      'making any claim.',
    affects: ['token behavior', 'user funds'],
    mitigation: 'Verify from primary sources before publishing. Do not guess.',
  },
  {
    id: 'escape-hatch',
    severity: 'high',
    verified: false,
    statement:
      'UNVERIFIED: whether users can force-include a transaction or exit ' +
      'without sequencer cooperation, and on what delay.',
    affects: ['censorship resistance', 'worst-case exit'],
    mitigation:
      'Confirm from the chain docs and the L2BEAT page. This determines the ' +
      'worst case, so it is the highest-value fact to resolve.',
  },
  {
    id: 'entity-separation',
    severity: 'medium',
    verified: true,
    statement:
      'Self-custody wallet services run through Robinhood Non-Custodial Ltd ' +
      '(Cayman), a separate entity from Robinhood Financial LLC and Robinhood ' +
      'Crypto LLC. An on-chain balance is not a brokerage balance and carries ' +
      'no brokerage account protections. The entities are related, not ' +
      'unaffiliated.',
    affects: ['custody', 'user expectations', 'account protections'],
    mitigation:
      'State both halves in UI copy. Never imply app funds and chain funds are ' +
      'one pool, and never imply the products are unrelated.',
  },
  {
    id: 'network-age',
    severity: 'low',
    verified: true,
    statement: 'Mainnet launched 2026-07-01. Operational history is short.',
    affects: ['operational confidence'],
    mitigation: 'Rehearse on testnet. Size early mainnet exposure accordingly.',
  },
];

export const unverified = () => TRUST_MODEL.filter((a) => !a.verified);
export const highSeverity = () => TRUST_MODEL.filter((a) => a.severity === 'high');
```

Liveness monitor:

```js
/**
 * robinhood-toolkit · sequencer liveness monitor
 * Author: nirholas · https://github.com/nirholas/robinhood-toolkit
 * License: All Rights Reserved (c) 2026 nirholas
 */
import { publicClientFor, robinhoodMainnet } from '../../network/src/chains.js';

// ~101ms blocks. These thresholds are generous by two orders of magnitude.
const DEGRADED_MS = 5_000;
const STALLED_MS = 30_000;

export function monitorLiveness(onStatus, { chain = robinhoodMainnet, intervalMs = 2_000 } = {}) {
  const client = publicClientFor(chain);
  let lastBlock = null;
  let lastAdvanceAt = Date.now();

  const timer = setInterval(async () => {
    try {
      const head = await client.getBlockNumber({ cacheTime: 0 });
      const now = Date.now();

      if (lastBlock === null || head > lastBlock) {
        lastBlock = head;
        lastAdvanceAt = now;
      }

      const silentFor = now - lastAdvanceAt;
      const status =
        silentFor >= STALLED_MS ? 'stalled' : silentFor >= DEGRADED_MS ? 'degraded' : 'healthy';

      onStatus({
        status,
        head: head.toString(),
        silentForMs: silentFor,
        chainId: chain.id,
        canSubmit: status !== 'stalled',
        checkedAt: new Date(now).toISOString(),
      });
    } catch (err) {
      onStatus({
        status: 'unreachable',
        error: err.shortMessage ?? err.message,
        canSubmit: false,
        chainId: chain.id,
        checkedAt: new Date().toISOString(),
      });
    }
  }, intervalMs);

  return () => clearInterval(timer);
}
```

## Deliverable

- `packages/risk/` with `assumptions.ts`, `disclosure` component, `liveness.ts`,
  and `README.md`, all with attribution headers.
- A pre-transaction disclosure gate wired into any value-moving flow in the
  repo.
- `scripts/liveness.mjs` runnable as a standalone monitor.
- A public-facing risk section in the site track (prompt 60) rendered from
  `TRUST_MODEL`, so the copy cannot drift from the model.

## How to verify

Liveness against the live chain:

```sh
node -e "import('./packages/risk/src/liveness.js').then(m =>
  m.monitorLiveness(s => console.log(s)))"
```

Expected: `status: 'healthy'`, `canSubmit: true`, and `head` advancing on every
tick. Leave it running for several minutes.

Prove the failure path, because the healthy path proves nothing. Point the
client at an unreachable host and confirm the monitor reports `unreachable` with
`canSubmit: false` instead of throwing or silently hanging. Then confirm your UI
actually disables the submit button on that state.

Model completeness:

```sh
node -e "import('./packages/risk/src/assumptions.js').then(m => {
  console.log('unverified:', m.unverified().map(a => a.id));
  console.log('high severity:', m.highSeverity().map(a => a.id));
})"
```

Every unverified item must have a mitigation naming a primary source to check.
Every high-severity item must be visible in the rendered disclosure without a
click.

Copy review: read your product's chain-related copy against the entity-separation
statement. If any sentence implies the app balance and the chain balance are the
same pool, or implies the entities are unaffiliated, rewrite it.

## Gotchas

- Do not write "secured by Ethereum" without qualification. Data availability is
  on Ethereum. Execution validity depends on a challenger set with fewer than
  five external actors. Those are different claims and conflating them is the
  most common inaccuracy in writeups of this chain.
- Do not bury the operator-centralization item in a collapsed section. If your
  disclosure needs a click to reveal a high-severity assumption, it is not a
  disclosure.
- Do not present partner bridges as strictly better because they are faster.
  They trade the challenge period for a different counterparty. Label the trade.
- Do not delete an unverified assumption because you could not confirm it. Ship
  it marked unverified with the source to check. Silence reads as safety.
- Do not soften the entity separation into "Robinhood's blockchain wallet is
  part of your Robinhood account." It is not. Equally, do not overcorrect into
  "unrelated third party." Both are wrong.
- Liveness thresholds tuned for a 12-second L1 are useless here. Five seconds of
  silence on a 101 ms chain is roughly fifty missed blocks.
- A monitor that only reports healthy is untested. Exercise the stalled and
  unreachable branches in CI with a stubbed transport.
- Recheck this file's unverified items on a schedule. A young chain's parameters
  change, and a risk doc that was accurate at launch quietly becomes wrong.
