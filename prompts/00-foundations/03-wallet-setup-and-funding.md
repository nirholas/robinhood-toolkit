<!--
  robinhood-toolkit · build prompt: wallet setup, key handling, and testnet funding
  Author: nirholas · https://github.com/nirholas/robinhood-toolkit
  License: MIT (c) 2026 nirholas
-->

# 03 · Wallet setup and funding

## Goal

Stand up a development wallet you can safely automate against: a keystore-backed
signer, a browser-wallet connect path, a testnet funding loop through the
faucet, and a balance preflight that refuses to run a spending operation without
enough gas. Testnet first, always.

## Prerequisites

- Prompt 02 completed. You import chains and clients from `packages/network`.
- `npm i viem` plus `dotenv` if you are not on Node's native `--env-file`.
- A browser wallet for the interactive path (any EIP-1193 provider).
- For mainnet: ETH already on Robinhood Chain, or a bridge run from prompt 04.

## Reference facts (verified)

- Gas token is ETH on both networks. There is no separate gas asset to acquire.
- Testnet: chain ID 46630 (`0xb626`), RPC
  `https://rpc.testnet.chain.robinhood.com`, explorer
  `https://explorer.testnet.chain.robinhood.com`.
- Mainnet: chain ID 4663 (`0x1237`), RPC
  `https://rpc.mainnet.chain.robinhood.com`, explorer
  `https://robinhoodchain.blockscout.com`.
- Faucet: <https://faucet.testnet.chain.robinhood.com>. Live and rate-limited.
  The exact drip amount, cooldown window, and any eligibility requirement are
  UNVERIFIED. Read the terms on the faucet page at run time. Do not hardcode an
  expected amount into a test assertion.
- Observed mainnet gas price approximately 0.055 gwei, blocks approximately
  101 ms. A simple transfer therefore costs a very small fraction of a cent, but
  a zero balance still fails.
- Self-custody wallet services offered by Robinhood run through Robinhood
  Non-Custodial Ltd (Cayman Islands), a separate legal entity from Robinhood
  Financial LLC and Robinhood Crypto LLC. Funds in a self-custody wallet are not
  a brokerage balance, are not held by the broker-dealer, and moving value
  between the app and this chain is a real transfer, not an internal ledger
  entry. They are related products from related entities, not the same account.

## Steps

1. Create `packages/wallet/src/signer.ts`. Load the private key from
   `process.env.PRIVATE_KEY` only. Never a literal, never a default, never a
   fallback to a well-known test key.
2. Fail closed on a missing or malformed key. Validate it is a 0x-prefixed
   32-byte hex string before handing it to `privateKeyToAccount`, so the failure
   message is actionable rather than a viem internal error.
3. Add a hard network guard: if `process.env.NETWORK` is not exactly `mainnet`,
   resolve the testnet chain. Default to testnet. A mainnet run must be an
   explicit, typed act.
4. Export `walletClientFor(chain)` built on the same transport factory from
   `packages/network` so the signer inherits the failover behavior.
5. Create `scripts/wallet-status.mjs`: prints the address, the resolved chain,
   the native balance, the nonce, the current gas price, and an estimated cost
   for a plain 21000-gas transfer. This is the preflight you run before every
   spend.
6. Implement `assertFunded(client, address, minWei)`. It throws with the
   explorer URL and the faucet URL when the balance is below the floor. Call it
   at the top of any script that sends a transaction.
7. Create `scripts/fund-testnet.mjs`. It reads the address, checks the balance,
   and if the balance is under the floor prints the faucet URL plus the address
   to paste. Do not script an automated faucet claim: the faucet is
   rate-limited and its API surface is UNVERIFIED. Scripting against an
   unverified endpoint produces a broken tool and burns the rate limit.
8. Generate a fresh key for the browser path instead of importing a personal
   wallet. Write `apps/connect/` with an EIP-1193 connect button that calls
   `wallet_addEthereumChain` with the payload from prompt 02, then
   `wallet_switchEthereumChain`, and renders the connected address and balance.

```js
/**
 * robinhood-toolkit · wallet status preflight
 * Author: nirholas · https://github.com/nirholas/robinhood-toolkit
 * License: MIT (c) 2026 nirholas
 */
import { createWalletClient, formatEther, formatGwei, http, isHex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { publicClientFor, robinhoodMainnet, robinhoodTestnet } from '../packages/network/src/chains.js';

const chain = process.env.NETWORK === 'mainnet' ? robinhoodMainnet : robinhoodTestnet;

const pk = process.env.PRIVATE_KEY;
if (!pk) throw new Error('PRIVATE_KEY is not set. Put it in .env, never in source.');
if (!isHex(pk) || pk.length !== 66) {
  throw new Error('PRIVATE_KEY must be 0x-prefixed 32-byte hex (66 chars).');
}

const account = privateKeyToAccount(pk);
const publicClient = publicClientFor(chain);

export const wallet = createWalletClient({
  account,
  chain,
  transport: http(chain.rpcUrls.default.http[0]),
});

const [balance, nonce, gasPrice] = await Promise.all([
  publicClient.getBalance({ address: account.address }),
  publicClient.getTransactionCount({ address: account.address }),
  publicClient.getGasPrice(),
]);

const transferCost = gasPrice * 21_000n;

console.log({
  address: account.address,
  network: chain.name,
  chainId: chain.id,
  balanceEth: formatEther(balance),
  nonce,
  gasPriceGwei: formatGwei(gasPrice),
  simpleTransferCostEth: formatEther(transferCost),
  fundedForTransfer: balance > transferCost * 10n,
  explorer: `${chain.blockExplorers.default.url}/address/${account.address}`,
  faucet: chain.testnet ? 'https://faucet.testnet.chain.robinhood.com' : null,
});
```

The funding gate, called before any spend:

```js
export async function assertFunded(publicClient, chain, address, minWei) {
  const balance = await publicClient.getBalance({ address });
  if (balance >= minWei) return balance;

  const lines = [
    `Insufficient balance on ${chain.name} (chain ${chain.id}).`,
    `  address: ${address}`,
    `  have:    ${balance} wei`,
    `  need:    ${minWei} wei`,
    `  explorer: ${chain.blockExplorers.default.url}/address/${address}`,
  ];
  if (chain.testnet) {
    lines.push('  faucet:   https://faucet.testnet.chain.robinhood.com');
  } else {
    lines.push('  bridge:   see prompt 04-bridging-to-robinhood-chain.md');
  }
  throw new Error(lines.join('\n'));
}
```

## Deliverable

- `packages/wallet/` with `signer.ts`, the network guard, `assertFunded`, and a
  `README.md`.
- `scripts/wallet-status.mjs` and `scripts/fund-testnet.mjs`.
- `apps/connect/` browser connect flow wired to the prompt 02 chain payloads.
- `.env.example` listing `PRIVATE_KEY`, `NETWORK`, and `ALCHEMY_API_KEY` with
  empty values. `.env` in `.gitignore`, verified.

## How to verify

```sh
node --env-file=.env scripts/wallet-status.mjs
```

Expected: your address, `chainId` 46630 with no `NETWORK` set, a balance, and a
`fundedForTransfer` boolean. Open the printed explorer URL and confirm the
address page matches the balance reported.

Then prove the guards:

- Unset `PRIVATE_KEY`. The script must exit with the actionable message, not a
  viem stack trace.
- Set `PRIVATE_KEY` to `0xdeadbeef`. It must fail the length check.
- Set `NETWORK=mainnet` and confirm `chainId` reads 4663. Unset it and confirm
  it falls back to 46630, never the other way around.
- Call `assertFunded` with an absurd floor and confirm the error includes both
  the explorer and faucet URLs.

Fund the testnet address at <https://faucet.testnet.chain.robinhood.com>, then
rerun and confirm the balance changed on both the script and the explorer.

## Gotchas

- Default to testnet, and require an explicit opt-in string for mainnet. A
  network selector that defaults to mainnet will eventually send real value
  during a test run.
- Do not script the faucet. Its distribution terms and API are UNVERIFIED and it
  is rate-limited. An automated claim loop gets your IP or address throttled and
  leaves you with a tool that breaks the first time the faucet page changes.
- Gas is cheap here, not free. Sub-cent transfer costs still require a nonzero
  balance, and a fresh address has none.
- The gas token is ETH, but it is ETH on Robinhood Chain. ETH sitting on
  Ethereum mainnet does nothing for you here until it is bridged. That is
  prompt 04.
- A Robinhood app balance is not a Robinhood Chain balance. Different entity,
  different custody model, and no automatic sweep between them. Say this to your
  users in the UI, not just in a doc.
- Never log a private key, and never write one into a report file. If a script
  prints an account, print the address.
- Nonce management: with approximately 101 ms blocks, back-to-back sends race.
  For any batch, track the nonce locally and increment it yourself rather than
  refetching per transaction.
