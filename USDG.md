<!--
  robinhood-toolkit · USDG on Robinhood Chain — verified facts
  Author: nirholas · https://github.com/nirholas/robinhood-toolkit
  License: All Rights Reserved (c) 2026 nirholas
-->

# USDG (Global Dollar) on Robinhood Chain

All values below were read from Robinhood Chain **mainnet** (chain id `4663`,
RPC `https://rpc.mainnet.chain.robinhood.com`) on **2026-07-21**, and
cross-checked against the Blockscout explorer
(`https://robinhoodchain.blockscout.com`). Anything not read here is marked
UNVERIFIED — do not fill it from assumption.

## Token identity (read on-chain)

| Field | Value |
| --- | --- |
| Proxy address (interact here) | `0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168` |
| `symbol()` | `USDG` |
| `name()` | `Global Dollar` |
| **`decimals()`** | **`6`** |
| `totalSupply()` (raw) | `287463570344453` |
| `totalSupply()` (formatted) | `287,463,570.344453` USDG |

`decimals` is **6**, not 18. The module reads it at runtime on every call; this
table is a note, never a value the code depends on.

## Proxy (EIP-1967)

| Slot | Value read 2026-07-21 |
| --- | --- |
| Implementation (`keccak256("eip1967.proxy.implementation") - 1`) | `0x68184c449e1A8F34fa18d289737129Fd27b66F8f` |
| Admin (`keccak256("eip1967.proxy.admin") - 1`) | `0x0` (zero) |

- The implementation slot is **non-zero**, confirming a standard EIP-1967
  transparent/UUPS proxy. Interact only through the proxy `0x5fc5…d168`; never
  send to or cache the implementation — it can be upgraded (`upgradeTo`,
  `upgradeToAndCall`, `proxiableUUID` are all present on the implementation).
- The admin slot reads zero. Ownership/upgrade control is handled through
  AccessControl roles on the implementation (`DEFAULT_ADMIN_ROLE`,
  `beginDefaultAdminTransfer` / `acceptDefaultAdminTransfer`, `owner`) rather
  than the EIP-1967 admin slot.

Implementation contract on Blockscout is **verified** and named `USDG`
(compiler `v0.8.28`).

## Transfer restrictions — does the implementation restrict transfers?

**Yes, indirectly. USDG is a regulated Paxos "Global Dollar" token built as a
faceted (diamond-style) proxy, and the supply controller can burn from any
address.** From the verified implementation ABI:

- **Forced burn / seize — PRESENT.** `decreaseSupplyFromAddress(...)` and
  `decreaseSupply(...)` let a supply controller destroy tokens held by an
  arbitrary address. This is the seize/forced-transfer capability regulated
  dollar tokens carry, exposed as a burn rather than a `transferFrom`.
  Counterparts: `increaseSupplyToAddress`, `increaseSupply`, `mint`, `burn`.
- **Configurable transfer policy — PRESENT.** `globalTransferSettings(...)`
  governs transfer behavior globally. A transfer can therefore fail for policy
  reasons unrelated to your balance.
- **Faceted proxy — logic can live off the main ABI.** `facets()`, `getFacet`,
  `setFacet`, `batchSetFacet` mean parts of the transfer path (potentially
  including blocklist/freeze/pause-style checks) are implemented in facets that
  are **not** all represented in the top-level ABI. Treat "no `pause()` in the
  ABI" as "not visible here", not "cannot happen".
- **No plain `pause()` / `blocklist()` / `freeze()`** appears in the top-level
  implementation ABI as of this read. Legacy Paxos controls exist but are
  retired: `assetProtectionRoleDeprecated`, `betaDelegateWhitelisterDeprecated`,
  `supplyControllerDeprecated`, `proposedOwnerDeprecated`.
- **Access control:** OpenZeppelin AccessControl (`grantRole`, `revokeRole`,
  `hasRole`, `getRoleAdmin`, `renounceRole`) plus a timelocked default-admin
  transfer (`defaultAdminDelay`, `changeDefaultAdminDelay`).

**Operational consequence:** a USDG transfer can revert for reasons that have
nothing to do with your balance or gas — global transfer settings or facet-level
policy. When a transfer reverts with no obvious cause and your balance and ETH
are sufficient, read the verified implementation source on Blockscout before
debugging blind. Do not assume plain ERC-20 semantics.

## Testnet — UNVERIFIED

Whether USDG is deployed on testnet (`46630`) and at what address is **not
verified**. Do **not** reuse the mainnet address on testnet. Resolve it from
<https://docs.robinhood.com/chain/contracts/> or the testnet explorer and set
`RH_USDG_TESTNET`; until then, [clients/usdg.mjs](clients/usdg.mjs) throws for
chain `46630` by design. The anvil fork rehearsal (chain id 4663) is the
reliable dry run — see [fork-rehearsal.txt](fork-rehearsal.txt).

## Other facts

- Chain id `4663`; gas paid in **ETH**, not USDG (~0.055 gwei); ~101 ms blocks.
  A wallet with plenty of USDG and zero ETH cannot move anything.
- ~101 ms blocks mean `waitForTransactionReceipt` returns almost immediately —
  that is sequencer confirmation on an Orbit L2 with a centralized sequencer,
  not Ethereum settlement. For large transfers, decide what finality you need
  and wait for it deliberately.
- USDG is the settlement asset for Stock Tokens (prompt 05).
- Docs: <https://docs.robinhood.com/chain/contracts/>

## Sources

- On-chain reads via viem against `https://rpc.mainnet.chain.robinhood.com`
  (`symbol`, `name`, `decimals`, `totalSupply`, EIP-1967 storage slots), 2026-07-21.
- Implementation ABI: Blockscout verified source for
  `0x68184c449e1A8F34fa18d289737129Fd27b66F8f`.
