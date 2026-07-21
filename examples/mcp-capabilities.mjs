/**
 * robinhood-toolkit · report which capabilities the live MCP surface satisfies
 * Author: nirholas · https://github.com/nirholas/robinhood-toolkit
 * License: All Rights Reserved (c) 2026 nirholas
 */
import { CAPABILITIES, RobinhoodMCPAdapter } from '../packages/rh-mcp/adapter.mjs';

const adapter = await RobinhoodMCPAdapter.open();
console.log(`${adapter.toolNames.length} tools advertised\n`);

for (const capability of Object.keys(CAPABILITIES)) {
  if (adapter.has(capability)) {
    console.log(`  yes  ${capability.padEnd(16)} -> ${adapter.resolve(capability).name}`);
  } else {
    console.log(`  no   ${capability}`);
  }
}

console.log(`\nclassified as writes: ${[...adapter.writeTools].join(', ') || 'none'}`);
await adapter.close();
