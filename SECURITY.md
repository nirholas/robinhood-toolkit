<!--
  robinhood-toolkit · security policy
  Author: nirholas · https://github.com/nirholas/robinhood-toolkit
  License: MIT (c) 2026 nirholas
-->

# Security policy

## Reporting a vulnerability

Open a [security advisory](https://github.com/nirholas/robinhood-toolkit/security/advisories/new)
rather than a public issue. This matters more than usual here: code in this
repository handles private keys, signs transactions, and places orders, so a
public issue is a working exploit disclosure against anyone already running it.

Expect a first response within 72 hours.

## Scope

In scope:

- Anything in `packages/` that touches keys, signing, or order placement
- Guardrail or policy logic that could be made to fail open
- Documented code samples that would leak a key or send funds somewhere
  unintended if copied as written
- Address-resolution logic that could be induced to accept a non-canonical token

Out of scope:

- Vulnerabilities in Robinhood's own products, APIs, or chain. Report those to
  Robinhood.
- Third-party protocols the tutorials interact with (Uniswap, Morpho, Chainlink).
  Report to those projects.
- The centralized sequencer and permissioned fraud proofs on Robinhood Chain.
  That is a documented and deliberate trust assumption of the chain itself, not
  a defect in this toolkit. See the README.

## Design boundaries this project holds

These are architectural commitments, not aspirations. A change that breaks one
is a security regression regardless of what it enables.

**MCP servers in this repo are read-only.** No signing code path exists in them.
An agent connected to one cannot move funds, because there is nothing to call.

**The site playground never accepts a private key.** Interactive snippets are
restricted to read-only RPC methods, enforced by a build-time guard that fails
the build if a runnable block contains write-shaped tokens. Anything that would
send a transaction is copy-to-clipboard for the reader's own terminal.

**Policy engines fail closed.** Any error during evaluation denies the action.
There is no bypass flag.

**Local signers refuse mainnet.** The example signer structurally cannot sign
for chain 4663 with a plaintext key. Real value requires a KMS or hardware
signer.

## If you are running this code with real funds

Nothing here has been audited. It is teaching material that happens to work.
Read [prompts/80-safety](prompts/80-safety/) before anything of yours places an
order unattended, cap what a hot wallet can hold, and assume your strategy has a
bug you have not found yet.
