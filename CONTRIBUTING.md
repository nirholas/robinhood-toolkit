<!--
  robinhood-toolkit · contributing guide
  Author: nirholas · https://github.com/nirholas/robinhood-toolkit
  License: MIT (c) 2026 nirholas
-->

# Contributing

Issues and pull requests are welcome. This project has two rules that matter
more than style, and a PR that breaks either will be sent back.

## 1. Every code sample must run as written

Not "compile." Run. If you add a snippet, execute it first. Readers copy these
verbatim and a sample that fails on line one costs them more time than no sample
at all.

Chain code is verifiable against a live public RPC, so there is no excuse for
shipping it untested:

```sh
cast chain-id --rpc-url https://rpc.mainnet.chain.robinhood.com   # 4663
```

## 2. No invented addresses, endpoints, or API shapes

If you cannot verify a fact against a live source, label it `UNVERIFIED` inline
and tell the reader how to check it themselves. That is genuinely more useful
than a confident guess, because a confident guess is indistinguishable from a
verified fact until it costs someone money.

This applies hardest to addresses. Resolve them from official registries at
runtime and prove them on-chain. There is a live ticker collision on this chain
right now: a token with symbol `USDG` at `0x8218d73C…` that is not the real USDG
at `0x5fc5360D…`. That is the failure mode this rule exists to prevent.

## Verified constants

These are confirmed against the live chain. Reuse them rather than re-deriving:

| Fact | Value |
|---|---|
| Mainnet chain ID | `4663` |
| Testnet chain ID | `46630` |
| WETH | `0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73`, 18 decimals |
| USDG | `0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168`, **6 decimals**, "Global Dollar" |
| Multicall3 | canonical address, deployed on both networks |
| DexScreener chain slug | `robinhood` (string, not `4663`) |

USDG having 6 decimals rather than 18 is the trap most likely to appear in a
PR. A wrong default misformats balances by a factor of a trillion while still
rendering a plausible number.

## Before you open a PR

```sh
npm test          # runs the attribution header linter
```

Every source and doc file carries an authorship header. See
[ATTRIBUTION.md](ATTRIBUTION.md) for the format per file type. The linter fails
the build if one is missing.

Also check:

- No em-dashes or en-dashes. Plain hyphens only.
- No TODOs, stub functions, or commented-out code.
- No mock data or sample-array fallbacks in anything that ships.
- Prompt files keep the seven-section structure: Goal, Prerequisites, Reference
  facts, Steps, Deliverable, How to verify, Gotchas.

## Anything that spends money

Testnet first. Where a protocol has no known testnet deployment, rehearse
against a mainnet fork (`anvil --fork-url`) rather than skipping the dry run.

Autonomous trading code additionally must default to paper mode, fail closed on
any policy evaluation error, and never automate flattening positions. See
[prompts/80-safety](prompts/80-safety/).

## Reporting a security issue

Do not open a public issue for a vulnerability in code that handles keys or
signs transactions. Open a GitHub security advisory on the repository instead.
