/* built by nirholas x.com/nichxbt */
/**
 * robinhood-toolkit · detect agentic crypto availability at runtime
 * Author: nirholas · https://github.com/nirholas/robinhood-toolkit
 * License: All Rights Reserved (c) 2026 nirholas
 */
import { readFile, writeFile } from 'node:fs/promises';

const STATE = 'docs/mcp/crypto-readiness.json';

/**
 * @returns {{available: boolean, capabilities: object, tools: string[], checked_at: string}}
 */
export function assessCryptoReadiness(adapter) {
  const capabilities = {
    cryptoPlaceOrder: adapter.has('cryptoPlaceOrder'),
    cryptoReviewOrder: adapter.has('cryptoReviewOrder'),
    cryptoCancelOrder: adapter.has('cryptoCancelOrder'),
    cryptoPositions: adapter.has('cryptoPositions'),
  };
  return {
    checked_at: new Date().toISOString(),
    available: capabilities.cryptoPlaceOrder,
    capabilities,
    tools: Object.entries(capabilities)
      .filter(([, present]) => present)
      .map(([capability]) => `${capability} -> ${adapter.resolve(capability).name}`),
  };
}

/** Persist and report whether readiness changed since the last check. */
export async function recordReadiness(assessment) {
  let previous = null;
  try {
    previous = JSON.parse(await readFile(STATE, 'utf8'));
  } catch {
    previous = null;
  }
  await writeFile(STATE, `${JSON.stringify(assessment, null, 2)}\n`);
  const became = assessment.available && previous?.available === false;
  const lost = previous?.available === true && !assessment.available;
  return { became, lost, previous };
}
/* built by nirholas x.com/nichxbt */
