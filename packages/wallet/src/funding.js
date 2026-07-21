/* built by nirholas x.com/nichxbt */
/**
 * robinhood-toolkit · funding gate (assertFunded)
 * Author: nirholas · https://github.com/nirholas/robinhood-toolkit
 * License: All Rights Reserved (c) 2026 nirholas
 *
 * The spend preflight. Call it at the top of any script that sends a
 * transaction. It throws with the explorer URL and (on testnet) the faucet URL
 * when the balance is below the floor, so the failure tells the reader exactly
 * how to fix it. This file takes an address, never a key — it does not import
 * the signer and never touches key material.
 */

/**
 * Throw unless `address` holds at least `minWei` on `chain`.
 *
 * @param {import('viem').PublicClient} publicClient
 * @param {import('viem').Chain} chain
 * @param {`0x${string}`} address
 * @param {bigint} minWei  floor in wei (bigint — gas maths is bigint end to end)
 * @returns {Promise<bigint>} the balance, when it clears the floor
 */
export async function assertFunded(publicClient, chain, address, minWei) {
  const balance = await publicClient.getBalance({ address });
  if (balance >= minWei) return balance;

  const lines = [
    `Insufficient balance on ${chain.name} (chain ${chain.id}).`,
    `  address: ${address}`,
    `  have:    ${balance} wei`,
    `  need:    ${minWei} wei`,
    `  explorer: ${chain.blockExplorers.default.url}/address/${address}`,
  ];
  if (chain.testnet) {
    lines.push('  faucet:   https://faucet.testnet.chain.robinhood.com');
  } else {
    lines.push('  bridge:   see prompts/00-foundations/04-bridging-to-robinhood-chain.md');
  }
  throw new Error(lines.join('\n'));
}
/* built by nirholas x.com/nichxbt */
