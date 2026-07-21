/**
 * robinhood-toolkit · agentic trading over MCP page content
 * Author: nirholas · https://github.com/nirholas/robinhood-toolkit
 * License: All Rights Reserved (c) 2026 nirholas
 *
 * The endpoint, transport, auth scheme and OAuth metadata below were verified by
 * direct request on 2026-07-20. The tool list is deliberately not printed: it is
 * account-scoped and changes, so the correct move is always to enumerate it.
 */

import { LINKS } from '../constants.mjs'
import { callout, code, esc, href, list, p, pager, section, stats, table } from '../ui.mjs'

export const route = {
  path: '/agents/',
  file: 'agents/index.html',
  nav: 'Agents',
  title: 'Agentic trading over MCP',
  description:
    'Connecting an agent to the Robinhood Trading MCP server: endpoint, transport, OAuth 2.1 with PKCE, account scoping, capability limits, and the supervision gap you own.'
}

export function render({ base }) {
  return `
<div class="page-head">
  <p class="eyebrow">Agents</p>
  <h1>Agentic trading over MCP</h1>
  <p class="lede">
    Robinhood exposes a Model Context Protocol server at
    <code>${esc(LINKS.mcpEndpoint)}</code>. An MCP client such as Claude Code connects, completes an
    OAuth handshake, and gets a set of trading tools scoped to a dedicated Agentic account. The
    protocol details below were verified by direct request on 2026-07-20.
  </p>
</div>

${section(
  'facts',
  'The connection',
  stats([
    { label: 'Transport', value: 'Streamable HTTP' },
    { label: 'Auth', value: 'OAuth 2.1', note: 'auth code + PKCE (S256)' },
    { label: 'Client type', value: 'Public', note: 'no client secret' },
    { label: 'Device', value: 'Desktop only', note: 'to open an Agentic account' }
  ]),
  p(
    'An unauthenticated <code>initialize</code> call returns HTTP 401 with an RFC 9728',
    'protected-resource challenge. The exposed <code>Mcp-Session-Id</code> header plus the',
    'GET/POST/DELETE method set confirms streamable HTTP rather than the older SSE transport.',
    'You never implement any of this by hand; your MCP client does. It matters because it tells',
    'you exactly what to check when a connection fails.'
  ),
  code({
    label: 'terminal · confirm the endpoint is alive and speaking the protocol you expect',
    body: `curl -s -D - -o /dev/null -X POST ${LINKS.mcpEndpoint} \\
  -H 'content-type: application/json' \\
  -H 'accept: application/json, text/event-stream' \\
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}'

# Expect: HTTP/2 401 with a www-authenticate: Bearer resource_metadata=... header.
# A 404 or a timeout means the endpoint changed. A 401 is success here.`
  }),
  code({
    label: 'discovered OAuth metadata (verified live 2026-07-20)',
    body: `{
  "issuer": "${LINKS.mcpEndpoint}",
  "authorization_endpoint": "https://robinhood.com/oauth",
  "token_endpoint": "https://api.robinhood.com/oauth2/token/",
  "registration_endpoint": "https://agent.robinhood.com/oauth/trading/register",
  "grant_types_supported": ["authorization_code", "refresh_token"],
  "code_challenge_methods_supported": ["S256"],
  "token_endpoint_auth_methods_supported": ["none"],
  "scopes_supported": ["internal"]
}`,
    note:
      '<code>token_endpoint_auth_methods_supported: ["none"]</code> means MCP clients are treated as public clients: there is no client secret to obtain or store, dynamic client registration is open, and PKCE is what protects the exchange.'
  })
)}

${section(
  'connect',
  'Connecting Claude Code',
  code({
    label: 'terminal',
    body: `claude mcp add robinhood-trading --transport http ${LINKS.mcpEndpoint}

# Then, inside a session, trigger the OAuth flow:
claude
/mcp`
  }),
  list([
    'Select <code>robinhood-trading</code> and authenticate. A browser opens to <code>https://robinhood.com/oauth</code>. Approve access there.',
    'Robinhood prompts you to open a dedicated <strong>Agentic account</strong> during or immediately after authentication. This must be done from a desktop device; it cannot be completed on mobile.',
    'Fund the Agentic account with the amount you are willing to put under agent control, and no more. That balance is your real risk limit, and it is more reliable than any guardrail you write.',
    'Confirm with <code>claude mcp list</code>, then ask the agent to list the tools the server advertises.'
  ]),
  callout({
    icon: '!',
    strong: true,
    label: 'Do not assume a tool list from any documentation, including this page.',
    body: `<p>The advertised tool set is account-scoped and changes over time. Enumerate it at
      runtime, record what the server actually returned on the date you connected, and make your
      adapter fail loudly when a tool it depends on is missing. A hardcoded tool name is a silent
      breakage waiting for a server update.</p>`
  })
)}

${section(
  'scope',
  'Account scoping and capability limits',
  table({
    head: ['Capability', 'Scope'],
    rows: [
      ['Reads: positions, balances, portfolio, orders, transactions', 'All of your Robinhood accounts'],
      ['Order placement', 'The funded Agentic account only'],
      ['Asset classes today', 'Long equities and options orders'],
      ['Crypto', 'Announced as rolling out, not live at verification time']
    ],
    caption: 'Connecting does not expose your main account to order placement. Reads are broader than writes.'
  }),
  p(
    'Robinhood\'s wording on capability: "You currently can use your agent to place long equities',
    'and options orders. Note that we\'ll be adding support for more assets soon." On crypto:',
    '"Agentic Accounts for crypto will begin rolling out soon to eligible US traders at no',
    'additional cost." When crypto ships it runs through this same endpoint, so the connection work',
    'you do now carries over. Build for it and detect it at runtime rather than waiting.'
  )
)}

${section(
  'supervision',
  'The supervision gap',
  callout({
    icon: '$',
    strong: true,
    label: 'Robinhood states it does not control, supervise, monitor, recommend, or audit connected agents.',
    body: `<p>That sentence is the entire safety model. There is no counterparty checking that your
      agent is behaving, no circuit breaker on their side calibrated to your intent, and no one to
      call at 4am on a Sunday when a 24/7 venue and a loop with a bad assumption meet each other.
      Whatever supervision exists is supervision you built.</p>`
  }),
  list([
    '<strong>Fund the account to your loss tolerance.</strong> The balance is the only guardrail that cannot be bypassed by a bug in your own guardrail code.',
    '<strong>Write the policy layer before the strategy layer.</strong> Position caps, per-order caps, daily loss limits, and a kill switch belong in code that runs before an order is constructed, not inside the code that decides to trade.',
    '<strong>Simulate before you send.</strong> Every order path should have a dry-run mode that produces the exact request it would have made, and your tests should assert on that request.',
    '<strong>Log every decision, not every action.</strong> An audit log that records what the agent chose and why is the difference between a five-minute post-mortem and a week of guessing.',
    '<strong>Write the incident runbook while nothing is wrong.</strong> How you revoke the OAuth grant, how you flatten positions, and who does it, decided in advance.'
  ]),
  p(
    `The <a href="${esc(href(base, '/prompts/'))}#track-80-safety">80-safety track</a> is five prompts covering`,
    'exactly these: key management, policy guardrails, transaction simulation, audit logging, and',
    'incident response. Work them before anything of yours places an order unattended.'
  )
)}

${section(
  'build',
  'Building on it',
  p(
    `The <a href="${esc(href(base, '/prompts/'))}#track-30-agentic-mcp">30-agentic-mcp track</a> covers the`,
    'full arc: connecting Claude Code, connecting other MCP platforms, enumerating tools properly',
    'including programmatically, setting up the Agentic account, building an adapter that maps the',
    'server\'s tools onto your own domain, preparing for the crypto rollout so you can detect it at',
    'runtime, and writing an MCP server from scratch when you need Robinhood data inside a surface',
    'Robinhood does not serve.'
  ),
  callout({
    icon: '>',
    label: 'Two agentic surfaces, one product',
    body: `<p>The MCP server is not the only way to automate. The
      <a href="${esc(href(base, '/api/'))}">Crypto REST API</a> is the programmatic path for crypto today,
      and it is available now. Most real systems end up using both: MCP where a human is in the loop
      conversationally, REST where a strategy loop runs unattended.</p>`
  })
)}

${pager(base, { href: '/api/', title: 'Robinhood Crypto REST API' }, { href: '/prompts/', title: 'Build prompts' })}
`
}
