<!--
  robinhood-toolkit · app readme: connect
  Author: nirholas · https://github.com/nirholas/robinhood-toolkit
  License: MIT (c) 2026 nirholas
-->

# apps/connect

A dependency-free browser page that connects an EIP-1193 wallet to Robinhood
Chain: it calls `wallet_addEthereumChain` with the EIP-3085 payload from
[`packages/network`](../../packages/network/src/wallet-config.js), then
`wallet_switchEthereumChain`, and renders the connected address, chain ID, and
native balance. **Testnet is selected by default.**

No build step, no bundler, no npm dependencies. `main.js` imports the chain
payloads directly from the network package, so there is exactly one definition
of the chain IDs.

## Run it

Because `main.js` imports `../../packages/network/src/wallet-config.js`, the page
must be served from the **repository root** so that relative path resolves:

```sh
# from the repo root
python3 -m http.server 8080
# then open http://localhost:8080/apps/connect/
```

Any static server rooted at the repo works (`npx serve .`, etc.). Opening the
file over `file://` will not work — ES module imports need an HTTP origin.

## Generating a fresh key for this path

Use a throwaway wallet here, not a personal one. Create a new account in your
browser wallet (or import a freshly generated key) before connecting. Nothing in
this app reads `PRIVATE_KEY` — signing stays inside the wallet.

## Custody note

The page shows it, and so should any app you ship: a Robinhood **app** balance
is not a Robinhood **Chain** balance. Different entity (Robinhood Non-Custodial
Ltd), different custody model, and no automatic sweep between them.
