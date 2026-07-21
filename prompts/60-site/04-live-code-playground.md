<!-- built by nirholas x.com/nichxbt -->
<!--
  robinhood-toolkit · build prompt: read-only live code playground against Robinhood Chain
  Author: nirholas · https://github.com/nirholas/robinhood-toolkit
  License: All Rights Reserved (c) 2026 nirholas
-->

# 04 · Live code playground

## Goal

Let a reader run a snippet against the live chain from inside a tutorial and see
real output. Read-only by construction: the playground can query state and it is
structurally incapable of signing or sending anything, because nothing in the
page accepts a private key.

## Prerequisites

- Prompts 01 to 03 complete. The template already emits `data-playground` from
  frontmatter.
- No new runtime dependency. The runner uses `fetch`, a Web Worker, and the
  tokens from prompt 02.

## Reference facts

- Read-only JSON-RPC against `https://rpc.mainnet.chain.robinhood.com` (chain ID
  4663) and `https://rpc.testnet.chain.robinhood.com` (chain ID 46630) is safe
  from a browser. It reads public state, needs no key, and costs nothing.
- Both endpoints are public HTTPS and serve CORS for browser requests. Verify
  this yourself before shipping (see How to verify step 1). If a CORS header is
  ever missing, the correct response is to disable the runner on that network,
  not to introduce a proxy the site cannot deploy to GitHub Pages.
- **Security boundary, stated as a boundary and not as a limitation.** The
  playground never accepts a private key, a seed phrase, or a keystore. It
  contains no signing code and no wallet connection. That is not a missing
  feature to add later. A tutorial site is a high-value phishing target precisely
  because readers arrive expecting to paste things in, and the only durable
  defense is that there is nothing in the page a key could be typed into. Four
  rules enforce it:
  1. Method allowlist. The runner proxies a fixed set of read-only JSON-RPC
     methods. Everything else is refused client-side before a request is made.
  2. No key surface. No input, no `localStorage` key slot, no `window.ethereum`
     use, no signing library in the bundle, on any page.
  3. Write operations are copy-only. Any snippet that would send a transaction
     renders as a copy-to-clipboard block for the reader's own terminal and has
     no run button. Deploys, approvals, swaps, and transfers all fall here.
  4. Worker isolation. Snippet code executes in a Web Worker with no DOM, no
     cookies, and no access to site storage.
- Allowlisted methods: `eth_chainId`, `eth_blockNumber`, `eth_getBalance`,
  `eth_call`, `eth_estimateGas`, `eth_gasPrice`, `eth_feeHistory`,
  `eth_getCode`, `eth_getStorageAt`, `eth_getLogs`, `eth_getBlockByNumber`,
  `eth_getBlockByHash`, `eth_getTransactionByHash`,
  `eth_getTransactionReceipt`, `eth_getTransactionCount`, `net_version`,
  `web3_clientVersion`.
- Explicitly refused: `eth_sendTransaction`, `eth_sendRawTransaction`,
  `eth_sign`, `eth_signTransaction`, `eth_signTypedData*`, `eth_accounts`,
  `personal_*`.
- Public RPC rate limits are UNVERIFIED (see [prompts/README.md](../README.md)).
  A tutorial page open in many tabs is a real load pattern, so the runner
  throttles and backs off on 429 rather than assuming headroom.
- Known-good addresses for samples: WETH `0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73`,
  USDG `0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168`, both mainnet. Multicall3 at
  `0xcA11bde05977b3631167028862bE2a173976CA11` on both networks.

## Steps

1. Extend the markdown fence contract. The info string after the language decides
   how a block renders:
   - `js run` renders an editor plus a Run button and an output pane.
   - `js` renders read-only with a copy button.
   - `bash copy` or `js copy` renders copy-only and is the required form for
     anything that sends a transaction.
   Parse the info string in the content build and emit `data-exec` on the block.
2. Enforce rule 3 at build time, not by review. Scan every `run` block for
   write-shaped tokens (`sendRawTransaction`, `sendTransaction`, `privateKey`,
   `PRIVATE_KEY`, `mnemonic`, `writeContract`, `signMessage`, `Wallet(`). A match
   fails the build with the file and line. This is the check that survives a
   contributor who does not read this prompt.
3. Write `site/src/js/rpc.js`: the allowlisted client. It validates the method
   name, applies a timeout via `AbortSignal.timeout`, throttles concurrent calls,
   and backs off on 429.
4. Write `site/src/js/playground-worker.js`: a Web Worker that receives snippet
   source, runs it inside an `AsyncFunction` with exactly one injected binding
   (`rpc`), and posts back console output plus the resolved value. The worker has
   no DOM, no cookies, and no access to the site's `localStorage`.
5. Write `site/src/js/playground.js`: progressive enhancement over the
   pre-rendered `<pre>`. It upgrades the block into an editable `<textarea>`,
   adds Run and Reset, renders output, and handles errors. With JS off, the block
   stays a readable, copyable code sample.
6. Render output states with the semantic-state exception from prompt 02: success
   and error each pair the color with an icon and a text label. Never color
   alone.
7. Add a network selector per playground block, defaulting to the page's
   `network` frontmatter, so a reader can run the same snippet on testnet.
8. Keyboard support: Ctrl+Enter and Cmd+Enter run. Tab inserts a tab character
   only after an explicit Escape-then-Tab sequence, so keyboard users can still
   leave the editor. See prompt 06.
9. Put a short, permanent note in the playground UI: read-only, no keys, and a
   link to the copy-only convention. Readers should learn the boundary from the
   product, not from the docs.

```js
/**
 * robinhood-toolkit · allowlisted read-only JSON-RPC client for the browser
 * Author: nirholas · https://github.com/nirholas/robinhood-toolkit
 * License: All Rights Reserved (c) 2026 nirholas
 *
 * Read-only by construction. Every method below reads public chain state.
 * Nothing here can sign or broadcast, and no key ever enters this module.
 */

export const ENDPOINTS = {
  mainnet: 'https://rpc.mainnet.chain.robinhood.com',
  testnet: 'https://rpc.testnet.chain.robinhood.com',
};

export const READ_ONLY_METHODS = new Set([
  'eth_chainId',
  'eth_blockNumber',
  'eth_getBalance',
  'eth_call',
  'eth_estimateGas',
  'eth_gasPrice',
  'eth_feeHistory',
  'eth_getCode',
  'eth_getStorageAt',
  'eth_getLogs',
  'eth_getBlockByNumber',
  'eth_getBlockByHash',
  'eth_getTransactionByHash',
  'eth_getTransactionReceipt',
  'eth_getTransactionCount',
  'net_version',
  'web3_clientVersion',
]);

let inFlight = 0;
const MAX_CONCURRENT = 4;

export async function rpc(method, params = [], { network = 'mainnet' } = {}) {
  if (!READ_ONLY_METHODS.has(method)) {
    throw new Error(
      `"${method}" is not available in the playground. This runner is read-only. ` +
        `Copy the snippet and run it in your own terminal.`,
    );
  }
  const url = ENDPOINTS[network];
  if (!url) throw new Error(`unknown network "${network}"`);

  while (inFlight >= MAX_CONCURRENT) await new Promise((r) => setTimeout(r, 50));
  inFlight++;
  try {
    return await request(url, method, params);
  } finally {
    inFlight--;
  }
}

async function request(url, method, params, attempt = 0) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: Date.now(), method, params }),
    signal: AbortSignal.timeout(10_000),
  });

  // Public RPC rate limits are UNVERIFIED. Back off rather than assume headroom.
  if (res.status === 429 && attempt < 3) {
    const wait = 2 ** attempt * 400 + Math.random() * 200;
    await new Promise((r) => setTimeout(r, wait));
    return request(url, method, params, attempt + 1);
  }
  if (!res.ok) throw new Error(`RPC ${res.status} ${res.statusText}`);

  const body = await res.json();
  if (body.error) throw new Error(`RPC error ${body.error.code}: ${body.error.message}`);
  return body.result;
}
```

The worker. Snippet code never touches the page:

```js
/**
 * robinhood-toolkit · playground worker
 * Author: nirholas · https://github.com/nirholas/robinhood-toolkit
 * License: All Rights Reserved (c) 2026 nirholas
 *
 * Workers have no DOM, no cookies, and no access to the site's localStorage.
 * The only capability injected into snippet scope is the read-only rpc().
 *
 * Instantiate it the Vite way so the import below is bundled and hashed:
 *   new Worker(new URL('./playground-worker.js', import.meta.url), { type: 'module' })
 * A worker parked in public/ is served unprocessed, and its bare or absolute
 * imports resolve in dev then 404 in the production build.
 */
import { rpc } from './rpc.js';

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

self.onmessage = async (event) => {
  const { id, source, network } = event.data;
  const logs = [];
  const console = {
    log: (...args) => logs.push(args.map(format).join(' ')),
    error: (...args) => logs.push(args.map(format).join(' ')),
    warn: (...args) => logs.push(args.map(format).join(' ')),
  };

  try {
    const fn = new AsyncFunction('rpc', 'console', source);
    const value = await fn((m, p) => rpc(m, p, { network }), console);
    self.postMessage({ id, ok: true, logs, value: value === undefined ? null : format(value) });
  } catch (error) {
    self.postMessage({ id, ok: false, logs, error: String(error?.message ?? error) });
  }
};

function format(value) {
  if (typeof value === 'string') return value;
  if (typeof value === 'bigint') return `${value}n`;
  try {
    return JSON.stringify(value, (_k, v) => (typeof v === 'bigint' ? `${v}n` : v), 2);
  } catch {
    return String(value);
  }
}
```

A runnable snippet as it appears in a tutorial. This one executes as written:

````markdown
```js run
// Chain identity and head, straight from the public RPC.
const chainId = await rpc('eth_chainId');
const head = await rpc('eth_blockNumber');
console.log('chainId', parseInt(chainId, 16));  // 4663 on mainnet
console.log('head', parseInt(head, 16));

// USDG total supply via eth_call. Selector 0x18160ddd = totalSupply().
const raw = await rpc('eth_call', [
  { to: '0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168', data: '0x18160ddd' },
  'latest',
]);
console.log('USDG totalSupply (wei)', BigInt(raw).toString());
```
````

A write operation, in its required copy-only form:

````markdown
```bash copy
# Runs in YOUR terminal, never in the browser. This spends gas and needs a key.
cast send 0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168 \
  "transfer(address,uint256)" "$RECIPIENT" 1000000 \
  --rpc-url https://rpc.testnet.chain.robinhood.com \
  --private-key "$PRIVATE_KEY"
```
````

The build-time guard that keeps rule 3 true:

```js
/**
 * robinhood-toolkit · playground write-operation guard
 * Author: nirholas · https://github.com/nirholas/robinhood-toolkit
 * License: All Rights Reserved (c) 2026 nirholas
 */
const WRITE_SHAPED = [
  /sendRawTransaction/,
  /sendTransaction/,
  /\bprivate[_-]?key\b/i,
  /\bmnemonic\b/i,
  /\bseed\s*phrase\b/i,
  /writeContract/,
  /signMessage/,
  /signTypedData/,
  /\bnew\s+Wallet\s*\(/,
  /privateKeyToAccount/,
];

/** Throws if a block marked `run` contains anything that could spend or sign. */
export function assertReadOnly(source, file, line) {
  for (const pattern of WRITE_SHAPED) {
    if (pattern.test(source)) {
      throw new Error(
        `${file}:${line} runnable block matches ${pattern}. ` +
          `Write operations must be marked \`copy\`, never \`run\`.`,
      );
    }
  }
}
```

## Deliverable

- `site/src/js/rpc.js`, `site/src/js/playground-worker.js`,
  `site/src/js/playground.js`, and the playground component CSS built from
  prompt 02 tokens.
- Fence-metadata parsing plus `assertReadOnly` wired into the content build.
- One tutorial with at least two working `run` blocks and one `copy` block.
- A `Playground security boundary` section in `site/README.md` stating the four
  rules and why they are structural rather than advisory.

## How to verify

1. CORS is real, not assumed. From a browser console on any origin:

```js
await fetch('https://rpc.mainnet.chain.robinhood.com', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_chainId', params: [] }),
}).then((r) => r.json());
// { jsonrpc: '2.0', id: 1, result: '0x1237' }  -> 4663
```

2. The sample snippet above runs in the page and prints chain ID 4663, a head
   block number that increases between runs, and a non-zero USDG supply.
3. The allowlist refuses writes. In a run block, call
   `await rpc('eth_sendRawTransaction', ['0x00'])` and confirm it throws the
   read-only message with no network request in the Network tab. The refusal must
   happen before `fetch`, not after.
4. The build guard fires. Add `const wallet = new Wallet(PRIVATE_KEY);` to a
   `run` block and confirm the build fails with the file and line. Change `run`
   to `copy` and confirm the build passes and the block renders with no Run
   button.
5. Worker isolation. From a snippet, `typeof document` is `undefined` and
   `typeof localStorage` is `undefined`.
6. Grep the whole site for a key surface. `grep -rniE 'private.?key|mnemonic|window\.ethereum' site/src`
   returns only the refusal message, the guard patterns, and comments.
7. Error path renders. Call `await rpc('eth_getBalance', ['not-an-address', 'latest'])`
   and confirm the output pane shows an error state with an icon and the word
   Error, legible with color removed.
8. Testnet selector works: the same block on testnet returns `0xb626`, 46630.

## Gotchas

- An `AsyncFunction` runs on the worker thread, so an infinite loop in a snippet
  hangs that worker and nothing else. Terminate and recreate the worker on a
  timeout, otherwise the Run button stops responding with no visible cause.
- `new Worker(url, { type: 'module' })` is required for the worker to `import`
  `rpc.js`. Classic workers cannot, and the failure is a silent no-op in some
  browsers.
- Keep the worker in `src/`, instantiated through
  `new URL('./playground-worker.js', import.meta.url)`. Vite copies `public/`
  verbatim without resolving imports or applying `base`, so a worker placed there
  works in dev and 404s in the production build, and again under a GitHub Pages
  subpath.
- `AbortSignal.timeout` needs a reasonably current browser. Feature-detect and
  fall back to an `AbortController` plus `setTimeout`, otherwise the runner
  throws on load in older browsers instead of degrading.
- Do not accept a custom RPC URL from a query parameter. It turns the page into
  an open proxy and lets a shared link point a reader's snippet at an
  attacker-controlled endpoint.
- Never soften rule 3 for a "harmless" write. A testnet transaction still needs a
  key, and normalizing key entry on a testnet page is exactly the habit that gets
  a reader phished on a mainnet one.
- `parseInt(hex, 16)` loses precision above 2^53. Use `BigInt(hex)` for balances,
  supplies, and wei amounts. Block numbers are fine either way today.
- The output pane renders untrusted strings from RPC responses. Insert with
  `textContent`, never `innerHTML`.
<!-- built by nirholas x.com/nichxbt -->
