/**
 * robinhood-toolkit · landing page content
 * Author: nirholas · https://github.com/nirholas/robinhood-toolkit
 * License: All Rights Reserved (c) 2026 nirholas
 */

import { NETWORKS, CONTRACTS, LINKS } from '../constants.mjs'
import { callout, cards, code, esc, href, list, p, section, stats, table } from '../ui.mjs'

export const route = {
  path: '/',
  file: 'index.html',
  nav: 'Overview',
  title: 'Build on Robinhood Chain and Robinhood Crypto',
  description:
    'Verified network parameters, runnable code, a live DexScreener market view, and 64 build prompts for Robinhood Chain, the Robinhood Crypto REST API, and agentic trading over MCP.'
}

export function render({ base, prompts }) {
  const m = NETWORKS.mainnet
  const t = NETWORKS.testnet

  return `
<div class="hero">
  <p class="eyebrow">Arbitrum Orbit L2 · chain ID ${m.chainId} · mainnet since 2026-07-01</p>
  <h1>Robinhood opened up. This is the practical layer on top.</h1>
  <p class="lede">
    Robinhood shipped three developer surfaces: a permissionless L2, a REST trading API, and an
    agentic MCP endpoint. The official docs tell you what the endpoints are. They do not tell you
    how to wire a datafeed into a chart, how to structure a strategy loop that will not liquidate
    you at 4am on a 24/7 venue, or how to get one codebase onto five different hosts. That gap is
    what this fills.
  </p>
  <div class="btn-row">
    <a class="btn btn--primary" href="${esc(href(base, '/start/'))}">Start here</a>
    <a class="btn" href="${esc(href(base, '/charts/'))}">See the live market view</a>
    <a class="btn" href="${esc(LINKS.chainDocs)}" rel="noopener noreferrer">Official chain docs</a>
  </div>
</div>

${section(
  'surfaces',
  'Three surfaces, one toolkit',
  cards(
    [
      {
        title: 'Robinhood Chain',
        body: 'An Arbitrum Orbit (Nitro) L2 that settles to Ethereum with blob data availability. Public mainnet since 2026-07-01. Solidity and Vyper deploy unmodified, and deployment is permissionless.',
        href: '/chain/',
        meta: 'chain id 4663 · gas in ETH'
      },
      {
        title: 'Robinhood Crypto REST API',
        body: 'Programmatic access to the brokerage side: market data, order placement, order lifecycle, portfolio and balances, with its own auth scheme and rate limits.',
        href: '/api/',
        meta: 'authenticated · rate limited'
      },
      {
        title: 'Agentic trading over MCP',
        body: 'An MCP endpoint that lets an agent trade. It covers equities and options today, with crypto support announced as rolling out. Nobody supervises your agent but you.',
        href: '/agents/',
        meta: 'model context protocol'
      }
    ],
    { columns: 3, base }
  )
)}

${section(
  'networks',
  'Verified network parameters',
  p(
    'These were confirmed by direct RPC calls, not copied from a docs page. You can re-run the',
    `verification yourself in about ten seconds on the <a href="${esc(href(base, '/start/'))}">quick start</a> page.`
  ),
  table({
    caption:
      'Verified 2026-07-20 by direct eth_chainId call. Mainnet returns <code>0x1237</code>, which is decimal 4663.',
    head: ['', 'Mainnet', 'Testnet'],
    rows: [
      ['Chain ID', `<code>${m.chainId}</code> (<code>${m.chainIdHex}</code>)`, `<code>${t.chainId}</code> (<code>${t.chainIdHex}</code>)`],
      ['RPC', `<code>${m.rpc}</code>`, `<code>${t.rpc}</code>`],
      [
        'Explorer',
        `<a href="${esc(m.explorer)}" rel="noopener noreferrer">robinhoodchain.blockscout.com</a>`,
        `<a href="${esc(t.explorer)}" rel="noopener noreferrer">explorer.testnet.chain.robinhood.com</a>`
      ],
      ['Sequencer feed', `<code>${m.feed}</code>`, `<code>${t.feed}</code>`],
      ['Gas token', m.gasToken, t.gasToken],
      ['Faucet', 'n/a', `<a href="${esc(t.faucet)}" rel="noopener noreferrer">faucet.testnet.chain.robinhood.com</a>`]
    ]
  }),
  stats([
    { label: 'Stack', value: 'Orbit Nitro', note: 'settles to Ethereum' },
    { label: 'Data availability', value: 'Blobs', note: 'EIP-4844' },
    { label: 'Observed block time', value: '~101 ms' },
    { label: 'Observed gas price', value: '~0.055 gwei' }
  ]),
  p('Core contracts on mainnet:'),
  list([
    `WETH <code>${CONTRACTS.weth}</code> · 18 decimals`,
    `USDG <code>${CONTRACTS.usdg}</code> · name "Global Dollar" · <strong>6 decimals</strong>`
  ]),
  callout({
    icon: '!',
    strong: true,
    label: 'Resolve tokens by address. Never by ticker.',
    body: `<p>Bridged token addresses differ from their Ethereum counterparts, so an address that is
      USDC on Ethereum is something else, or nothing, here. Worse, tickers collide: four separate
      contracts on this chain report <code>symbol() == "USDG"</code> and three of them also claim the
      name "Global Dollar". The <a href="${esc(href(base, '/charts/'))}#ticker-collision">live market
      view</a> walks through the full comparison using a real, actively traded pair.</p>`
  })
)}

${section(
  'toolkit',
  'What this toolkit gives you',
  cards(
    [
      {
        title: 'Quick start',
        body: 'Reach the chain, make your first RPC call, and verify chain ID 4663 from your browser or your terminal.',
        href: '/start/',
        meta: 'read-only · no wallet needed'
      },
      {
        title: 'Chain guide',
        body: 'Network params, deploying contracts with Foundry or Hardhat, the Stock Token registry, and the trust assumptions you are accepting.',
        href: '/chain/',
        meta: 'deploys · registries · risk'
      },
      {
        title: 'Live market view',
        body: 'Real DexScreener data for Robinhood Chain pairs rendered with Lightweight Charts. Honest about what is sourced and what is derived.',
        href: '/charts/',
        meta: 'live api · no sample data'
      },
      {
        title: 'REST API overview',
        body: 'What the Robinhood Crypto API covers, how auth works, and where the rate limits and retry rules bite.',
        href: '/api/',
        meta: 'market data · orders'
      },
      {
        title: 'Agentic trading',
        body: 'Connecting an agent over MCP, enumerating the tool surface, and the supervision gap you are responsible for closing.',
        href: '/agents/',
        meta: 'mcp · guardrails'
      },
      {
        title: `${prompts.total} build prompts`,
        body: 'Self-contained build tasks across nine tracks. Each states its goal, prerequisites, verified facts, steps, deliverable, and verification.',
        href: '/prompts/',
        meta: `${prompts.tracks.length} tracks · browsable`
      }
    ],
    { columns: 3, base }
  )
)}

${section(
  'ground-rules',
  'The rules everything here follows',
  list([
    '<strong>Every code sample runs as written.</strong> If it did not run, it is not on the page.',
    '<strong>No invented addresses, endpoints, or API shapes.</strong> Anything that could not be verified against a live source is labelled <code>UNVERIFIED</code> inline, with instructions for checking it yourself.',
    '<strong>Registries are queried at runtime.</strong> Stock Token addresses in particular come from a live registry and are never hardcoded.',
    '<strong>Read-only in the browser.</strong> The interactive widgets on this site call read-only JSON-RPC and nothing else. Any snippet that would send a transaction is copy-to-clipboard for your own terminal.'
  ]),
  callout({
    icon: '$',
    strong: true,
    label: 'The chain is centralized today.',
    body: `<p>Robinhood operates both the sequencer and the proposer, and
      <a href="${esc(LINKS.l2beat)}" rel="noopener noreferrer">L2BEAT</a> rates its risk profile accordingly
      because fewer than five external actors can submit fraud challenges. That is a normal place for a young
      L2 to be, and it is also a real trust assumption. Size positions with it in mind, and read
      <a href="${esc(href(base, '/chain/'))}#trust">the trust assumptions</a> before you deploy anything that
      holds value.</p>`
  })
)}

${section(
  'verify',
  'Verify the chain right now',
  p('No wallet, no key, no account. This is the same call the site runs from your browser on the quick start page.'),
  code({
    label: 'terminal',
    body: `curl -s ${m.rpc} \\
  -H 'content-type: application/json' \\
  -d '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}'
# {"jsonrpc":"2.0","id":1,"result":"${m.chainIdHex}"}   # ${m.chainIdHex} == ${m.chainId}`
  })
)}
`
}
