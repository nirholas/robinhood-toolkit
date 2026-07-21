<!--
  robinhood-toolkit · package readme: wallet
  Author: nirholas · https://github.com/nirholas/robinhood-toolkit
  License: All Rights Reserved (c) 2026 nirholas
-->

# @robinhood-toolkit/wallet

A development signer you can safely automate against, plus the funding gate you
run before every spend. **Testnet by default.** Mainnet must be a deliberate,
typed act.

## Exports

| From | Export | What it is |
|---|---|---|
| `src/signer.js` | `account` | the signing account, validated at import time |
| `src/signer.js` | `chain` | resolved chain — testnet unless `NETWORK=mainnet` |
| `src/signer.js` | `wallet` | default wallet client on the failover transport |
| `src/signer.js` | `walletClientFor(chain)` | wallet client for a specific chain |
| `src/signer.js` | `resolveChain(network)`, `loadAccount(pk)` | the guards, unit-testable |
| `src/funding.js` | `assertFunded(client, chain, address, minWei)` | the spend preflight |

## Key handling — the rules

- The private key is read from `process.env.PRIVATE_KEY` **only**. Never a
  literal, never a default, never a fallback to a well-known test key.
- The signer **fails closed**: a missing or malformed key throws an actionable
  message at import, before viem ever sees the value.
- Validation is shape-first — `0x` + 64 hex digits (66 chars) — so the error
  reads `PRIVATE_KEY must be a 0x-prefixed 32-byte hex string`, not a viem
  internal.
- **Never log the key.** Print `account.address`. If a script emits an account,
  it emits the address.

## The network guard

`resolveChain` returns testnet unless `process.env.NETWORK` is *exactly* the
string `'mainnet'`. Anything else — unset, empty, `'main'`, `'MAINNET'` — resolves
to testnet. A network selector that defaults to mainnet eventually sends real
value during a test run.

```js
import { account, chain, wallet } from '@robinhood-toolkit/wallet/signer';
// account.address, chain.id (46630 unless NETWORK=mainnet), wallet.sendTransaction(...)
```

## The funding gate

`assertFunded` is import-safe without a key — it takes an address, not the
signer. Call it at the top of any script that sends a transaction. Below the
floor it throws with the explorer URL and, on testnet, the faucet URL.

```js
import { publicClientFor } from '@robinhood-toolkit/network';
import { assertFunded } from '@robinhood-toolkit/wallet';

const client = publicClientFor(chain);
await assertFunded(client, chain, account.address, 10n * 21_000n * gasPrice);
```

## Note on custody

A Robinhood **app** balance is not a Robinhood **Chain** balance. Self-custody
wallet services run through Robinhood Non-Custodial Ltd (Cayman Islands), a
separate legal entity from Robinhood Financial LLC and Robinhood Crypto LLC.
Moving value between the app and this chain is a real transfer, not an internal
ledger entry, and there is no automatic sweep between them. Say this in your UI,
not just in a doc.

## Nonce management

At ~101 ms blocks, back-to-back sends race. For any batch, track the nonce
locally and increment it yourself rather than refetching per transaction.
