/**
 * robinhood-toolkit · quick start page content
 * Author: nirholas · https://github.com/nirholas/robinhood-toolkit
 * License: MIT (c) 2026 nirholas
 */

import { NETWORKS, CONTRACTS, SELECTORS } from '../constants.mjs'
import { callout, code, esc, href, list, p, pager, rpcConsole, section, table } from '../ui.mjs'

export const route = {
  path: '/start/',
  file: 'start/index.html',
  nav: 'Quick start',
  modules: 'rpc',
  title: 'Quick start',
  description:
    'Connect to Robinhood Chain, make your first RPC call, and verify chain ID 4663 from the browser or your own terminal. Read-only, no wallet required.'
}

export function render({ base }) {
  const m = NETWORKS.mainnet
  const t = NETWORKS.testnet

  return `
<div class="page-head">
  <p class="eyebrow">Quick start</p>
  <h1>Reach the chain in under a minute</h1>
  <p class="lede">
    Everything on this page is read-only. No wallet connection, no key, no account. The buttons
    below make real JSON-RPC calls to <code>${esc(m.rpc)}</code> from your browser, and each one
    shows you the equivalent terminal command so you can reproduce it yourself.
  </p>
</div>

${section(
  'step-1',
  '1. Confirm you can reach the RPC',
  p(
    'The first thing to establish is that the endpoint answers and that it answers as the network you',
    'think it is. Chain ID confusion is the single most common way to lose funds on a new L2: a wallet',
    'pointed at the wrong network will happily sign for a chain you did not intend.'
  ),
  rpcConsole({
    title: 'Verify chain ID',
    description: `Calls <code>eth_chainId</code> against mainnet and checks the answer equals ${m.chainId}. Expect <code>${m.chainIdHex}</code>.`,
    method: 'eth_chainId',
    decode: 'chain-id',
    buttonLabel: 'Run eth_chainId'
  }),
  code({
    label: 'the same call, in your terminal',
    body: `curl -s ${m.rpc} \\
  -H 'content-type: application/json' \\
  -d '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}'
# {"jsonrpc":"2.0","id":1,"result":"${m.chainIdHex}"}`
  }),
  code({
    label: 'with foundry',
    body: `cast chain-id --rpc-url ${m.rpc}
# ${m.chainId}`
  })
)}

${section(
  'step-2',
  '2. Read live chain state',
  p(
    'Block height and gas price tell you whether the sequencer is producing and what a transaction',
    'is likely to cost. Robinhood Chain has been observed at roughly 101ms block times and around',
    '0.055 gwei, so both numbers should look very different from Ethereum mainnet.'
  ),
  rpcConsole({
    title: 'Current block height',
    description: 'Calls <code>eth_blockNumber</code>. Run it twice a few seconds apart and watch the gap: at ~101ms block times, the number moves fast.',
    method: 'eth_blockNumber',
    decode: 'number',
    buttonLabel: 'Run eth_blockNumber'
  }),
  rpcConsole({
    title: 'Current gas price',
    description: 'Calls <code>eth_gasPrice</code> and converts the wei result to gwei.',
    method: 'eth_gasPrice',
    decode: 'gwei',
    buttonLabel: 'Run eth_gasPrice'
  })
)}

${section(
  'step-3',
  '3. Look up any account',
  p(
    'Balances are denominated in ETH, which is also the gas token. Paste any address, including one',
    'you control, to read its balance. Nothing is signed and nothing is stored.'
  ),
  callout({
    icon: '!',
    strong: true,
    label: 'This console will not accept a private key.',
    body: `<p>It rejects any input shaped like a 32-byte hex key or a seed phrase before the request
      leaves your browser, and the JSON-RPC method allowlist has no write methods on it at all. That
      is a deliberate boundary, not a courtesy: no documentation site should ever be a place where
      pasting key material seems reasonable.</p>`
  }),
  rpcConsole({
    title: 'Account balance',
    description: 'Calls <code>eth_getBalance</code> at the latest block and formats the result as ETH.',
    method: 'eth_getBalance',
    decode: 'ether',
    symbol: 'ETH',
    buttonLabel: 'Read balance',
    arg: {
      label: 'Address',
      placeholder: '0x0000000000000000000000000000000000000000',
      hint: 'Any 20-byte address. Try the WETH contract to see a contract balance.'
    }
  }),
  rpcConsole({
    title: 'Is it a contract?',
    description: 'Calls <code>eth_getCode</code>. An empty result means an externally owned account; bytecode means a deployed contract.',
    method: 'eth_getCode',
    decode: 'code',
    buttonLabel: 'Read code',
    arg: {
      label: 'Address',
      placeholder: CONTRACTS.weth,
      hint: `Try the canonical WETH deployment: <code>${esc(CONTRACTS.weth)}</code>`
    }
  })
)}

${section(
  'step-4',
  '4. Call a contract',
  p(
    'A view function costs nothing and changes nothing, which makes <code>eth_call</code> the right',
    'first contract interaction. This reads the symbol straight off the canonical WETH deployment',
    `at <code>${esc(CONTRACTS.weth)}</code>.`
  ),
  rpcConsole({
    title: 'WETH symbol()',
    description: `Calls <code>eth_call</code> with selector <code>${SELECTORS.symbol}</code> and decodes the ABI-encoded string.`,
    method: 'eth_call',
    decode: 'abi-string',
    to: CONTRACTS.weth,
    data: SELECTORS.symbol,
    buttonLabel: 'Call symbol()'
  }),
  rpcConsole({
    title: 'WETH totalSupply()',
    description: `Calls <code>eth_call</code> with selector <code>${SELECTORS.totalSupply}</code> and formats the uint256 at 18 decimals.`,
    method: 'eth_call',
    decode: 'abi-uint',
    to: CONTRACTS.weth,
    data: SELECTORS.totalSupply,
    decimals: '18',
    buttonLabel: 'Call totalSupply()'
  })
)}

${section(
  'step-5',
  '5. Point your tools at the chain',
  p('Same parameters, four common toolchains. Mainnet on the left of every pair, testnet on the right.'),
  table({
    head: ['Setting', 'Mainnet', 'Testnet'],
    rows: [
      ['Network name', m.name, t.name],
      ['RPC URL', `<code>${m.rpc}</code>`, `<code>${t.rpc}</code>`],
      ['Chain ID', `<code>${m.chainId}</code>`, `<code>${t.chainId}</code>`],
      ['Currency symbol', m.gasToken, t.gasToken],
      [
        'Block explorer',
        `<a href="${esc(m.explorer)}" rel="noopener noreferrer">${esc(m.explorer)}</a>`,
        `<a href="${esc(t.explorer)}" rel="noopener noreferrer">${esc(t.explorer)}</a>`
      ]
    ]
  }),
  code({
    label: 'viem',
    body: `import { createPublicClient, defineChain, http } from 'viem'

export const robinhoodChain = defineChain({
  id: ${m.chainId},
  name: '${m.name}',
  nativeCurrency: { name: 'Ether', symbol: '${m.gasToken}', decimals: 18 },
  rpcUrls: { default: { http: ['${m.rpc}'] } },
  blockExplorers: { default: { name: 'Blockscout', url: '${m.explorer}' } }
})

const client = createPublicClient({ chain: robinhoodChain, transport: http() })
console.log(await client.getChainId())  // ${m.chainId}`
  }),
  code({
    label: 'foundry.toml',
    body: `[rpc_endpoints]
robinhood = "${m.rpc}"
robinhood_testnet = "${t.rpc}"

[etherscan]
robinhood = { key = "unused", url = "${m.explorer}/api" }`
  }),
  code({
    label: 'hardhat.config.js',
    body: `export default {
  networks: {
    robinhood: { url: '${m.rpc}', chainId: ${m.chainId} },
    robinhoodTestnet: { url: '${t.rpc}', chainId: ${t.chainId} }
  }
}`
  }),
  code({
    label: 'wallet_addEthereumChain (run in your own app, not here)',
    body: `await window.ethereum.request({
  method: 'wallet_addEthereumChain',
  params: [{
    chainId: '${m.chainIdHex}',
    chainName: '${m.name}',
    nativeCurrency: { name: 'Ether', symbol: '${m.gasToken}', decimals: 18 },
    rpcUrls: ['${m.rpc}'],
    blockExplorerUrls: ['${m.explorer}']
  }]
})`,
    note:
      'Copy-only. This site never asks a wallet for anything, so there is no button here to run it. Paste it into your own application.'
  })
)}

${section(
  'step-6',
  '6. Get testnet funds',
  p('Start on testnet. It is the same stack with the same tooling and none of the consequences.'),
  list([
    `Point your wallet or RPC client at <code>${esc(t.rpc)}</code> with chain ID <code>${t.chainId}</code>.`,
    `Request funds from the faucet at <a href="${esc(t.faucet)}" rel="noopener noreferrer">${esc(t.faucet)}</a>.`,
    `Confirm the balance landed with the balance widget above, after switching the endpoint in your own client to testnet.`,
    `Watch the transaction on <a href="${esc(t.explorer)}" rel="noopener noreferrer">the testnet explorer</a>.`
  ]),
  callout({
    icon: '>',
    label: 'Next',
    body: `<p>Deploying a contract, reading the Stock Token registry, and the trust assumptions you accept
      by using the chain are all covered in the <a href="${esc(href(base, '/chain/'))}">chain guide</a>.</p>`
  })
)}

${pager(base, { href: '/', title: 'Overview' }, { href: '/chain/', title: 'Robinhood Chain guide' })}
`
}
