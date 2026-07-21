/* built by nirholas x.com/nichxbt */
/**
 * robinhood-toolkit · notice when agentic crypto lights up on this account
 * Author: nirholas · https://github.com/nirholas/robinhood-toolkit
 * License: All Rights Reserved (c) 2026 nirholas
 */
import { RobinhoodMCPAdapter } from '../packages/rh-mcp/adapter.mjs';
import { assessCryptoReadiness, recordReadiness } from '../packages/rh-mcp/crypto-readiness.mjs';

const adapter = await RobinhoodMCPAdapter.open();
const assessment = assessCryptoReadiness(adapter);
const { became, lost } = await recordReadiness(assessment);
await adapter.close();

if (became) {
  console.log('AGENTIC CRYPTO IS NOW AVAILABLE on this account.');
  console.log(assessment.tools.join('\n'));
  console.log('\nRe-run enumerate.mjs to refresh the snapshot, then review the new schemas before enabling writes.');
  process.exitCode = 10; // distinct code so a scheduler can alert on it
} else if (lost) {
  console.log('Crypto capability disappeared. Investigate before trading.');
  process.exitCode = 11;
} else {
  console.log(`crypto available: ${assessment.available}`);
}
/* built by nirholas x.com/nichxbt */
