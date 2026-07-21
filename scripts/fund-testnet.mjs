/* built by nirholas x.com/nichxbt */
/**
 * robinhood-toolkit · testnet funding helper
 * Author: nirholas · https://github.com/nirholas/robinhood-toolkit
 * License: All Rights Reserved (c) 2026 nirholas
 *
 * Reads the address, checks the balance, and — if it is under the floor —
 * prints the faucet URL plus the address to paste. It does NOT script the
 * faucet. The faucet's drip amount, cooldown, and API surface are UNVERIFIED
 * and it is rate-limited; an automated claim loop gets your IP or address
 * throttled and breaks the first time the faucet page changes. Read the terms
 * on the page at run time.
 *
 * Refuses to run against mainnet — there is no faucet there.
 *
 * Usage:
 *   node --env-file=.env scripts/fund-testnet.mjs
 */
import { formatEther } from 'viem';
import { publicClientFor, robinhoodTestnet } from '@robinhood-toolkit/network';
import { account, chain } from '@robinhood-toolkit/wallet/signer';

const FAUCET = 'https://faucet.testnet.chain.robinhood.com';

if (!chain.testnet) {
  console.error(
    `Refusing to run: resolved chain is ${chain.name} (${chain.id}), not a testnet.\n` +
      'The faucet only funds testnet. Unset NETWORK (or set it to anything but "mainnet") to target testnet.',
  );
  process.exit(1);
}

const client = publicClientFor(robinhoodTestnet);

// Floor: enough for a handful of simple transfers at the observed testnet gas
// price. Below this, a fresh address cannot even pay for its first send.
const gasPrice = await client.getGasPrice();
const floor = gasPrice * 21_000n * 20n;

const balance = await client.getBalance({ address: account.address });

console.log(`address:  ${account.address}`);
console.log(`network:  ${chain.name} (${chain.id})`);
console.log(`balance:  ${formatEther(balance)} ETH`);
console.log(`floor:    ${formatEther(floor)} ETH  (20 x 21,000-gas transfer)`);

if (balance >= floor) {
  console.log('\nAlready funded above the floor. Nothing to do.');
  console.log(`explorer: ${chain.blockExplorers.default.url}/address/${account.address}`);
} else {
  console.log('\nBelow the floor. Fund the address manually:');
  console.log(`\n  1. Open ${FAUCET}`);
  console.log('  2. Read the terms on the page (drip amount and cooldown are not guaranteed).');
  console.log(`  3. Paste this address:\n\n     ${account.address}\n`);
  console.log(`Then re-run this script, or scripts/wallet-status.mjs, to confirm the balance changed.`);
  console.log(`explorer: ${chain.blockExplorers.default.url}/address/${account.address}`);
  process.exitCode = 1;
}
/* built by nirholas x.com/nichxbt */
