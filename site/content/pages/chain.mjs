/**
 * robinhood-toolkit · Robinhood Chain guide page content
 * Author: nirholas · https://github.com/nirholas/robinhood-toolkit
 * License: All Rights Reserved (c) 2026 nirholas
 */

import { CONTRACTS, LINKS, NETWORKS, SELECTORS } from '../constants.mjs'
import { callout, code, esc, href, list, p, pager, rpcConsole, section, stats, table } from '../ui.mjs'

export const route = {
  path: '/chain/',
  file: 'chain/index.html',
  nav: 'Chain',
  modules: 'rpc',
  title: 'Robinhood Chain guide',
  description:
    'Network parameters, deploying contracts with Foundry and Hardhat, the Stock Token registry, bridging, and the trust assumptions of an Arbitrum Orbit L2 operated by a single sequencer.'
}

export function render({ base }) {
  const m = NETWORKS.mainnet
  const t = NETWORKS.testnet

  return `
<div class="page-head">
  <p class="eyebrow">Chain</p>
  <h1>Robinhood Chain</h1>
  <p class="lede">
    An Arbitrum Orbit (Nitro) L2 that settles to Ethereum and uses Ethereum blobs for data
    availability. Public mainnet since 2026-07-01. Solidity and Vyper deploy unmodified, and
    deployment is permissionless: no allowlist, no application, no gatekeeper.
  </p>
</div>

${section(
  'shape',
  'The shape of the network',
  stats([
    { label: 'Chain ID', value: String(m.chainId), note: m.chainIdHex },
    { label: 'Stack', value: 'Orbit Nitro' },
    { label: 'Settles to', value: 'Ethereum' },
    { label: 'Data availability', value: 'Blobs' },
    { label: 'Block time', value: '~101 ms', note: 'observed' },
    { label: 'Gas price', value: '~0.055 gwei', note: 'observed' },
    { label: 'Gas token', value: m.gasToken },
    { label: 'Deploys', value: 'Permissionless' }
  ]),
  p(
    'Practically, a Nitro chain means your existing EVM toolchain works without modification. The',
    'differences you will actually notice are the ones inherited from Arbitrum rather than from',
    'Robinhood: gas is charged in two components (L2 execution plus an L1 data posting cost), block',
    'timestamps advance on a sub-second cadence, and <code>block.number</code> semantics follow',
    'Arbitrum rules rather than Ethereum ones. Anything that assumes 12-second blocks will behave',
    'strangely here, so treat block-count-based timing as unreliable and use timestamps.'
  ),
  table({
    head: ['', 'Mainnet', 'Testnet'],
    rows: [
      ['Chain ID', `<code>${m.chainId}</code>`, `<code>${t.chainId}</code>`],
      ['RPC', `<code>${m.rpc}</code>`, `<code>${t.rpc}</code>`],
      ['Explorer', `<a href="${esc(m.explorer)}" rel="noopener noreferrer">Blockscout</a>`, `<a href="${esc(t.explorer)}" rel="noopener noreferrer">Testnet explorer</a>`],
      ['Sequencer feed', `<code>${m.feed}</code>`, `<code>${t.feed}</code>`],
      ['Faucet', 'n/a', `<a href="${esc(t.faucet)}" rel="noopener noreferrer">faucet</a>`]
    ]
  })
)}

${section(
  'contracts',
  'Core contracts',
  p('Two addresses worth having on hand. Both verified on mainnet.'),
  table({
    head: ['Contract', 'Address', 'Notes'],
    rows: [
      [
        'WETH',
        `<code>${CONTRACTS.weth}</code>`,
        '<code>symbol()</code> WETH, 18 decimals. Canonical wrapped ETH, and the quote asset on most Uniswap v3 pools on this chain.'
      ],
      [
        'USDG',
        `<code>${CONTRACTS.usdg}</code>`,
        '<code>name()</code> Global Dollar, <strong>6 decimals</strong>, read on-chain 2026-07-20. Three other tokens on this chain claim the same ticker.'
      ]
    ]
  }),
  callout({
    icon: '!',
    strong: true,
    label: 'Ticker collisions are not hypothetical here. There are four USDG tokens.',
    body: `<p>Verified on 2026-07-20: four separate contracts on Robinhood Chain report
      <code>symbol() == "USDG"</code>, and three of them report <code>name() == "Global Dollar"</code>.
      Only <code>${esc(CONTRACTS.usdg)}</code> is the canonical one. Symbol and name are both chosen by
      whoever deployed the contract, cost nothing to claim, and are verified by no one.</p>
      <p>They do not even agree on decimals: the canonical USDG is a 6-decimal token, while the
      impostor holding the most-traded USDG pair on the chain is an 18-decimal meme token named
      "Useless Stupid Degen Gamblers". Code that resolves by ticker will not throw. It will return a
      confident number about the wrong asset, scaled wrong by a factor of a million. The
      <a href="${esc(href(base, '/charts/'))}#ticker-collision">live market view</a> loads that exact pair
      and shows the full comparison.</p>`
  }),
  rpcConsole({
    title: 'Resolve a token by address',
    description: 'Reads <code>symbol()</code> from any address via <code>eth_call</code>. This is the check to run before trusting a ticker.',
    method: 'eth_call',
    decode: 'abi-string',
    to: CONTRACTS.usdg,
    data: SELECTORS.symbol,
    buttonLabel: `Read symbol() at ${CONTRACTS.usdg.slice(0, 10)}...`
  })
)}

${section(
  'deploying',
  'Deploying contracts',
  p(
    'There is nothing chain-specific about the compile step. Point your existing setup at the RPC,',
    'fund the deployer with ETH for gas, and deploy. Start on testnet.'
  ),
  code({
    label: 'foundry · deploy to testnet',
    body: `# 1. Store the key in the encrypted keystore. Never in an env var, never in the repo.
cast wallet import deployer --interactive

# 2. Deploy.
forge create src/Counter.sol:Counter \\
  --rpc-url ${t.rpc} \\
  --account deployer \\
  --broadcast

# 3. Verify on Blockscout.
forge verify-contract <ADDRESS> src/Counter.sol:Counter \\
  --verifier blockscout \\
  --verifier-url ${t.explorer}/api`,
    note:
      'Copy-only, for your own terminal. Swap the testnet RPC for the mainnet one once the contract behaves on testnet.'
  }),
  code({
    label: 'hardhat · deploy script',
    body: `import hre from 'hardhat'

const counter = await hre.ethers.deployContract('Counter')
await counter.waitForDeployment()
console.log('deployed to', await counter.getAddress())

// npx hardhat run scripts/deploy.js --network robinhoodTestnet`
  }),
  list([
    '<strong>Gas estimation is two-part.</strong> An Orbit chain charges L2 execution plus the L1 data cost of posting your calldata. A large constructor argument is expensive for reasons that have nothing to do with computation.',
    '<strong>Verify on Blockscout, not Etherscan.</strong> The explorer for this chain is Blockscout, and its verification API lives at <code>/api</code> under the explorer URL.',
    '<strong>Deterministic deploys work.</strong> CREATE2 and the standard singleton factory behave exactly as they do on any other EVM chain, so cross-chain address parity is achievable if you need it.'
  ])
)}

${section(
  'stock-tokens',
  'Stock Tokens: query the registry, never hardcode',
  p(
    'Stock Tokens are tokenized debt securities issued by Robinhood Assets (Jersey) Limited. They',
    'grant no legal or beneficial rights in the underlying equity. That is the actual instrument,',
    'and it matters for anything you build on top of one.'
  ),
  callout({
    icon: '$',
    strong: true,
    label: 'Robinhood warns explicitly that a token matching a ticker at a different address is not canonical.',
    body: `<p>Addresses come from a live registry and change as instruments are added. Resolve at
      runtime, cache with a short TTL, and fail closed when the registry is unreachable. Hardcoding
      a Stock Token address into a strategy is how you end up trading a lookalike. This site does not
      print any Stock Token address for exactly that reason: any address printed in documentation is
      stale the moment the registry updates.</p>`
  }),
  list([
    'Resolve ticker to address through the registry on every cold start, not once at build time.',
    'Treat a registry miss as a hard stop. An unknown ticker is never an excuse to fall back to a cached address.',
    'Re-check the issuer and the token contract when a ticker reappears after an absence.',
    `Read the full task in the build prompt <a href="${esc(href(base, '/prompts/'))}#track-10-chain">10-chain / 05 query stock token registry</a>.`
  ])
)}

${section(
  'bridging',
  'Bridging in and out',
  p(
    'The canonical bridge is an optimistic rollup bridge, which means withdrawals to Ethereum sit',
    'through a challenge period of about seven days. That is the design working correctly, not a',
    'delay you can support your way out of.'
  ),
  table({
    head: ['Route', 'Exit time', 'Trade-off'],
    rows: [
      ['Canonical bridge', '~7 days', 'Inherits the chain\'s own security. No extra trust, maximum latency.'],
      ['Partner routes', 'minutes', 'LayerZero, Chainlink CCIP, Relay, Across and LiFi exit faster for a fee, and add that provider\'s trust assumptions to yours.']
    ]
  }),
  callout({
    icon: '!',
    label: 'Design for the seven days, then optimise.',
    body: '<p>Any product that assumes funds can leave quickly has a liquidity problem hiding in it. Decide what happens to a user who wants out during a fast-route outage before you ship, not during the outage.</p>'
  })
)}

${section(
  'trust',
  'Trust assumptions',
  p(
    'This is the part worth reading twice, because it is the part that does not show up in a',
    'successful test transaction.'
  ),
  list([
    `<strong>Robinhood operates both the sequencer and the proposer.</strong> <a href="${esc(LINKS.l2beat)}" rel="noopener noreferrer">L2BEAT</a> rates the risk profile accordingly, because fewer than five external actors can submit fraud challenges. A young L2 sitting here is normal. It is also a real assumption you are accepting.`,
    '<strong>A single sequencer can censor or reorder.</strong> Not that it will, but your design should not assume it cannot. Force-inclusion via the L1 inbox is the escape hatch, and it is slow by construction.',
    '<strong>On-chain balances are not brokerage balances.</strong> Self-custody wallet services run through Robinhood Non-Custodial, Ltd., a separate legal entity from Robinhood Financial LLC and Robinhood Crypto, LLC. Same company, deliberately integrated product, distinct custody. Do not reconcile the two as if they were one ledger.',
    '<strong>Stock Tokens are debt instruments.</strong> They grant no legal or beneficial rights in the underlying. Anything you build that implies otherwise is misrepresenting the product.',
    '<strong>Nobody is supervising your agent.</strong> Robinhood states it does not control, supervise, monitor, recommend, or audit connected agents.'
  ]),
  callout({
    icon: '>',
    label: 'Before anything of yours holds value',
    body: `<p>Work the <a href="${esc(href(base, '/prompts/'))}#track-80-safety">80-safety track</a>: key
      management, policy guardrails, transaction simulation, audit logging, and incident response. Five
      prompts, and they are the difference between a bug and an incident.</p>`
  })
)}

${pager(base, { href: '/start/', title: 'Quick start' }, { href: '/charts/', title: 'Live market view' })}
`
}
