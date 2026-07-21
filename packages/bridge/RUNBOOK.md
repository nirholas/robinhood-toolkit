<!--
  robinhood-toolkit · package: bridge · deposit & withdrawal runbook
  Author: nirholas · https://github.com/nirholas/robinhood-toolkit
  License: All Rights Reserved (c) 2026 nirholas
-->

# Deposit & Withdrawal Runbook

The seven-day withdrawal wait is why you rehearse. A mistake found on day six is
expensive. Complete a full testnet round-trip before touching mainnet value.

## 0. Before anything

- **Bridge ETH before you bridge tokens.** ETH is the gas token. Arriving with an
  ERC-20 balance and zero ETH leaves you unable to move it.
- Canonical bridge UI:
  <https://portal.arbitrum.io/bridge?destinationChain=robinhood-chain&sourceChain=ethereum>
- Read the Orbit bridge contract targets from
  <https://docs.robinhood.com/chain/contracts/> — **do not** reuse Arbitrum One
  addresses.

## 1. Rehearse on testnet

1. Fund from the faucet (prompt 03).
2. Deposit a small amount through the bridge UI. Record the L1 hash, the L2 hash,
   and the wall-clock delta.
3. Withdraw the same amount. Confirm the exit flow completes end to end. This is
   the step you do not want to discover is broken while holding mainnet value.

## 2. First mainnet deposit (small amount, through the UI — not code)

Use the canonical bridge UI. Record:

| Field | Value |
| --- | --- |
| Amount | _(fill in)_ |
| L1 tx hash | _(fill in)_ |
| L2 tx hash | _(fill in)_ |
| L1 confirmed at | _(fill in, UTC)_ |
| L2 confirmed at | _(fill in, UTC)_ |
| **Measured deposit latency** | _(fill in — this replaces the ~10 min figure in your docs)_ |

> Confirm the L2 balance change on <https://robinhoodchain.blockscout.com>.
> The measured delta is your real deposit latency. Put it in your docs; delete
> the approximate figure.

## 3. First mainnet withdrawal

`estimateWithdrawal()` returns `challengePeriodDays: 7`. Surface that to the user
**before** they sign, not on the confirmation screen.

| Field | Value |
| --- | --- |
| Amount | _(fill in)_ |
| L2 initiate tx hash | _(fill in)_ |
| Initiated at | _(fill in, UTC)_ |
| Claimable at (initiated + ~7d) | _(fill in, UTC)_ |
| L1 claim tx hash | _(fill in, after the challenge period)_ |
| **Measured challenge period** | _(fill in — should be ≈ 7 days)_ |

### Need to exit faster?

Partner routes (LayerZero/Stargate, Chainlink CCIP, Relay, Across, LiFi) front
liquidity to skip the challenge period. That is a **different trust model**, not a
faster canonical withdrawal, and the fee is market-driven — quote it live at
request time. See prompt 06.

## 4. Token accounting sanity check

- `resolveToken('WETH')` / `resolveToken('USDG')` → verified chain-specific
  addresses. A symbol with no verified address throws; it never falls back to an
  Ethereum address.
- WETH is 18 decimals, USDG is 6. Read `decimals()` per token; never assume 18.
- Regenerate `reports/bridge-tokens.json` with
  `npm run report --workspace bridge` and open each `explorer` URL to confirm the
  contract page matches. Both tokens are proxies — read through to the
  implementation before assuming behavior.
