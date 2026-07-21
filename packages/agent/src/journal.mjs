/**
 * robinhood-toolkit · journal sink (placeholder)
 * Author: nirholas · https://github.com/nirholas/robinhood-toolkit
 * License: All Rights Reserved (c) 2026 nirholas
 *
 * Every tick writes one record here, even no-op ticks, so a post-mortem has no
 * gaps. Prompt 80-safety/04-audit-logging.md defines the durable record format
 * and sink; the skeleton logs one compact line per tick to stdout so you can
 * watch the state machine advance. Implements the Journal seam from ./ports.mjs.
 */
export default function createJournal(_config) {
  return {
    async write(record) {
      const { tick, mode, state } = record;
      console.log(`[journal] tick=${tick} mode=${mode} state=${state}`);
    },
    async flush() {},
  };
}
