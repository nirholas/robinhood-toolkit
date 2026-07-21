/**
 * robinhood-toolkit · agent entrypoint
 * Author: nirholas · https://github.com/nirholas/robinhood-toolkit
 * License: All Rights Reserved (c) 2026 nirholas
 */
import { loadConfig, createLoop, MODES } from './loop.mjs';

const config = loadConfig();
console.log(`[agent] starting in ${config.mode.toUpperCase()} mode`);
if (config.mode === MODES.PAPER) console.log('[agent] no real orders will be sent');

const loop = await createLoop({
  config,
  marketData: await import('./market/quotes.mjs').then((m) => m.default(config)),
  strategy: await import('./strategy/index.mjs').then((m) => m.default(config)),
  policy: await import('./policy/index.mjs').then((m) => m.default(config)),
  broker: await import(config.mode === MODES.LIVE ? './broker/live.mjs' : './broker/paper.mjs')
    .then((m) => m.default(config)),
  journal: await import('./journal.mjs').then((m) => m.default(config)),
}).start();

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, async () => {
    console.log(`[agent] ${sig} received, draining`);
    await loop.stop();
    process.exit(0);
  });
}
