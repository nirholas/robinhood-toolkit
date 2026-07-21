<!--
  robinhood-toolkit · build prompt: key management for agents that spend
  Author: nirholas · https://github.com/nirholas/robinhood-toolkit
  License: All Rights Reserved (c) 2026 nirholas
-->

# 01 · Key management

## Goal

Build a signing layer where the private key material never exists in your
process, never exists in a file in your repository, and never authorizes more
value than you are willing to lose to a single compromise. You will implement a
`Signer` interface with a local development implementation and a KMS-backed
production implementation, and a hot/cold wallet split with an enforced cap.

## Prerequisites

- `npm i viem` inside `packages/agent`.
- For the KMS path, one of: Google Cloud KMS, AWS KMS, or a hardware signer. The
  sample uses GCP KMS because the signing shape (asymmetric sign, secp256k1) is
  the same across providers and the differences are in the client call.
- A funded testnet account on chain 46630 for verification. Do not test key
  handling with mainnet value.

## Reference facts (verified)

| | Mainnet | Testnet |
|---|---|---|
| Chain ID | 4663 | 46630 |
| RPC | `https://rpc.mainnet.chain.robinhood.com` | `https://rpc.testnet.chain.robinhood.com` |
| Explorer | `https://robinhoodchain.blockscout.com` | `https://explorer.testnet.chain.robinhood.com` |
| Gas token | ETH | ETH |

- Robinhood Chain is Arbitrum Orbit on Nitro, so it uses standard Ethereum
  secp256k1 accounts and EIP-1559 style transactions. Any signer that works for
  Ethereum works here. Chain ID 4663 is part of the signed payload, which is
  what prevents a signed mainnet transaction from replaying on testnet.
- Self-custody wallet services on this chain run through Robinhood Non-Custodial
  Ltd. On-chain balances are not brokerage balances and are not covered by
  brokerage protections. If you lose the key, the funds are gone. There is no
  support path that restores them.
- Crypto REST API docs: <https://docs.robinhood.com/crypto/trading>. The REST
  API uses its own API credential, separate from any chain key. Treat it as an
  independent secret with its own rotation schedule and its own blast radius.

## Rules, in order of importance

1. **A plaintext private key never enters git.** Not in `.env`, not in a config
   file, not in a comment, not in a test fixture, not in a commit you plan to
   amend away. Git history is permanent and public repositories are scraped
   within seconds. If a key has ever been committed, it is burned. Rotate it,
   do not clean the history and reuse it.
2. **Anything holding real value is signed by a KMS or a hardware device.** The
   goal is that a full compromise of your application host does not yield the
   key. It yields, at worst, the ability to request signatures while the
   compromise lasts, which is bounded by your policy engine and your hot wallet
   cap.
3. **Hot and cold are separate accounts with separate custody.** The hot wallet
   holds a capped operating balance, has the KMS signing permission, and is the
   only account the agent knows about. Cold storage holds the rest, uses
   hardware custody, and its address is never in the agent's configuration.
   Sweeping from hot to cold is automated. Refilling cold to hot is manual, on
   purpose, because it is the one moment a human reviews the operation.
4. **The cap is enforced, not aspirational.** The agent checks its own hot
   balance at startup and on a schedule, and refuses to run above the cap. A
   forgotten large deposit into the hot wallet should stop trading, not enable
   it.
5. **Every credential has a rotation date and a documented revocation
   procedure.** If you cannot revoke a credential in under five minutes at
   03:00, you do not have a security control, you have a hope.

## Steps

1. Create `src/signing/signer.mjs` defining the `Signer` port:
   `{ address, signTransaction(tx), signMessage(msg), signTypedData(td) }`. Viem
   accounts already satisfy this shape, which keeps both implementations
   interchangeable.
2. Implement `src/signing/local.mjs` for development only. It reads a key from
   the environment, and it **refuses to load when the chain is mainnet 4663**.
   Make that refusal structural, not a warning, so nobody can point a local key
   at mainnet by editing one env var during an incident.
3. Implement `src/signing/kms.mjs` using `toAccount` from `viem/accounts` with a
   custom `sign` that calls the KMS. Derive the address from the public key
   once at startup and cache it. Never accept an address from configuration that
   you did not derive from the key you are actually signing with.
4. Implement `src/signing/cap.mjs`: a balance guard that reads the hot wallet
   balance and returns a halt verdict above `HOT_WALLET_CAP_WEI`.
5. Implement `scripts/sweep-to-cold.mjs`: when the hot balance exceeds the cap
   plus a buffer, transfer the excess to the cold address. The cold address is
   read from a separate config the agent process cannot write, and the sweep
   only ever sends in the hot-to-cold direction. A sweep script that can be
   inverted by flipping an argument is a withdrawal tool for an attacker.
6. Add a `.gitignore` and a pre-commit secret scan. Grep for `0x` followed by 64
   hex characters, for `PRIVATE_KEY`, and for the mnemonic word list. Wire it as
   a git hook so it runs without anyone remembering to.
7. Document rotation in `docs/key-rotation.md`: how to rotate the KMS key
   version, how to rotate the REST API credential, who has the cold hardware
   device, and how to revoke everything. Write this before the incident, not
   during.

```js
/**
 * robinhood-toolkit · signer implementations
 * Author: nirholas · https://github.com/nirholas/robinhood-toolkit
 * License: All Rights Reserved (c) 2026 nirholas
 */
import { privateKeyToAccount, toAccount } from 'viem/accounts';
import { createPublicClient, http, formatEther, serializeTransaction, keccak256 } from 'viem';
import { publicKeyToAddress } from 'viem/utils'; // not re-exported from the 'viem' root

const MAINNET_ID = 4663;

/** Development only. Structurally cannot be used against mainnet. */
export function createLocalSigner({ chainId, env = process.env }) {
  if (chainId === MAINNET_ID) {
    throw new Error('local plaintext signer is forbidden on chain 4663. Use the KMS signer.');
  }
  const key = env.DEV_PRIVATE_KEY;
  if (!key) throw new Error('DEV_PRIVATE_KEY not set');
  if (!/^0x[0-9a-fA-F]{64}$/.test(key)) throw new Error('DEV_PRIVATE_KEY is not a 32-byte hex key');
  return privateKeyToAccount(key);
}

/**
 * Production signer. The key never leaves the KMS.
 * kmsClient must implement:
 *   getPublicKey() -> uncompressed secp256k1 public key as 0x-prefixed hex
 *   signDigest(digestHex) -> { r, s, v } with s already normalized to low-s
 */
export async function createKmsSigner({ kmsClient }) {
  const publicKey = await kmsClient.getPublicKey();
  const address = publicKeyToAddress(publicKey);

  return toAccount({
    address,
    async signMessage({ message }) {
      const digest = keccak256(
        new TextEncoder().encode(`\x19Ethereum Signed Message:\n${message.length}${message}`),
      );
      return serializeSignature(await kmsClient.signDigest(digest));
    },
    async signTransaction(transaction, { serializer = serializeTransaction } = {}) {
      const digest = keccak256(serializer(transaction));
      const signature = await kmsClient.signDigest(digest);
      return serializer(transaction, signature);
    },
    async signTypedData(typedData) {
      const { hashTypedData } = await import('viem');
      return serializeSignature(await kmsClient.signDigest(hashTypedData(typedData)));
    },
  });
}

function serializeSignature({ r, s, v }) {
  return `${r}${s.slice(2)}${(v === 27n || v === 27 ? '1b' : '1c')}`;
}

/** Refuses to trade when the hot wallet holds more than it should. */
export async function assertHotWalletCap({ address, chain, capWei }) {
  const client = createPublicClient({ chain, transport: http() });
  const balance = await client.getBalance({ address });
  if (balance > capWei) {
    throw new Error(
      `hot wallet holds ${formatEther(balance)} ETH, above cap ${formatEther(capWei)} ETH. ` +
        'Sweep to cold storage before trading.',
    );
  }
  return { address, balanceWei: balance.toString(), capWei: capWei.toString(), ok: true };
}
```

```sh
# robinhood-toolkit · pre-commit secret scan
# Author: nirholas · https://github.com/nirholas/robinhood-toolkit
# License: All Rights Reserved (c) 2026 nirholas
# .git/hooks/pre-commit  (chmod +x)
set -eu

staged=$(git diff --cached --name-only --diff-filter=ACM)
[ -z "$staged" ] && exit 0

if git diff --cached -U0 -- $staged | grep -nE '^\+.*(0x[0-9a-fA-F]{64}|PRIVATE_KEY\s*=\s*0x|BEGIN (EC|RSA|OPENSSH) PRIVATE KEY)'; then
  echo "refusing commit: possible private key material above" >&2
  exit 1
fi

if git diff --cached --name-only | grep -qE '(^|/)\.env($|\.)' ; then
  echo "refusing commit: .env file staged" >&2
  exit 1
fi
```

## Deliverable

- `src/signing/signer.mjs`, `local.mjs`, `kms.mjs`, `cap.mjs`.
- `scripts/sweep-to-cold.mjs`, one direction only.
- `.git/hooks/pre-commit` secret scan plus a committed copy at
  `scripts/hooks/pre-commit` with install instructions.
- `docs/key-rotation.md` covering the chain key, the REST credential, cold
  custody, and revocation.
- `.gitignore` entries for `.env*`, `*.key`, `.paper-state.json`.

## How to verify

```sh
# the local signer must refuse mainnet
node -e "import('./src/signing/local.mjs').then(m=>m.createLocalSigner({chainId:4663}))"
# expect: Error: local plaintext signer is forbidden on chain 4663

# KMS signer produces the same address every start, derived not configured
node scripts/print-signer-address.mjs

# cap enforcement
HOT_WALLET_CAP_WEI=1 node scripts/preflight.mjs   # must refuse to start

# secret scan
echo "PRIVATE_KEY=0x$(printf '1%.0s' {1..64})" > /tmp/leak.txt && cp /tmp/leak.txt ./leak.txt
git add leak.txt && git commit -m test   # must be refused
git reset leak.txt && rm leak.txt
```

Then sign one testnet transaction through the KMS path end to end and confirm it
on `https://explorer.testnet.chain.robinhood.com`. A signer that has never
signed a real transaction is not verified.

## Gotchas

- **A key in `.env` is a key in git eventually.** Someone will run `git add -A`
  during an incident. The pre-commit hook and the `.gitignore` are both required
  because either one alone fails to the same outcome.
- KMS signatures need low-s normalization. A signature with high s is valid
  secp256k1 and invalid Ethereum. If your KMS returns high s, normalize it
  before serializing or transactions will be rejected with confusing errors.
- Derive the address from the public key. If you read the address from config
  and the KMS key version silently changed, you will sign valid transactions
  from an account you are not monitoring.
- Chain ID is part of the signed transaction, which prevents cross-chain replay
  between 4663 and 46630. Do not build any "sign once, broadcast anywhere"
  helper that strips it.
- A hot wallet cap only helps if something enforces it continuously. Checking it
  once at startup misses the deposit that arrives an hour later. Re-check on a
  schedule.
- Rotating the REST API credential and rotating the chain key are separate
  operations with separate blast radii. Compromise of one does not imply
  compromise of the other, but your incident response should assume both until
  proven otherwise.
- Never log a signed transaction's raw bytes at debug level alongside anything
  else you ship to a log aggregator. It is not the key, but combined with a
  nonce-reuse bug it can be enough.
