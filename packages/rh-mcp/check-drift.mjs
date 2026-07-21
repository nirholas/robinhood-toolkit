/**
 * robinhood-toolkit · fail if the MCP tool surface changed since the snapshot
 * Author: nirholas · https://github.com/nirholas/robinhood-toolkit
 * License: MIT (c) 2026 nirholas
 */
import { readFile } from 'node:fs/promises';
import { connect, enumerateTools } from './enumerate.mjs';

const snapshot = JSON.parse(await readFile('docs/mcp/tools-snapshot.json', 'utf8'));
const client = await connect();
const live = await enumerateTools(client);
await client.close();

const before = new Map(snapshot.tools.map((t) => [t.name, t]));
const after = new Map(live.map((t) => [t.name, t]));

const added = [...after.keys()].filter((n) => !before.has(n));
const removed = [...before.keys()].filter((n) => !after.has(n));
const changed = [...after.keys()].filter((n) => {
  const a = before.get(n);
  if (!a) return false;
  return JSON.stringify(a.inputSchema) !== JSON.stringify(after.get(n).inputSchema);
});

for (const n of added) console.log(`ADDED   ${n}`);
for (const n of removed) console.log(`REMOVED ${n}`);
for (const n of changed) console.log(`CHANGED ${n}`);

if (added.length || removed.length || changed.length) {
  console.log(`\nTool surface drifted since ${snapshot.captured_at}. Re-run enumerate.mjs and review.`);
  process.exitCode = 1;
} else {
  console.log(`No drift since ${snapshot.captured_at}. ${live.length} tools.`);
}
