/**
 * robinhood-toolkit · wallet status preflight
 * Author: nirholas · https://github.com/nirholas/robinhood-toolkit
 * License: MIT (c) 2026 nirholas
 *
 * The preflight you run before every spend. Prints the address, the resolved
 * chain, the native balance, the nonce, the current gas price, and the cost of
 * a plain 21,000-gas transfer. Read-only apart from resolving the account.
 *
 * Usage:
 *   node --env-file=.env scripts/wallet-status.mjs        # testnet (46630)
 *   NETWORK=mainnet node --env-file=.env scripts/wallet-status.mjs
 *
 * Prints the address only, never the key.
 */
import { formatEther, formatGwei } from 'viem';
import { publicClientFor } from '@robinhood-toolkit/network';
import { account, chain } from '@robinhood-toolkit/wallet/signer';

const publicClient = publicClientFor(chain);

const [balance, nonce, gasPrice] = await Promise.all([
  publicClient.getBalance({ address: account.address }),
  publicClient.getTransactionCount({ address: account.address }),
  publicClient.getGasPrice(),
]);

// A 21,000-gas transfer is the cheapest possible spend, so its cost is the
// clearest single "can I afford to move" number. The funded flag keeps a 10x
// headroom so a status of `true` survives a gas-price bump before you send.
const transferCost = gasPrice * 21_000n;

console.log({
  address: account.address,
  network: chain.name,
  chainId: chain.id,
  balanceEth: formatEther(balance),
  nonce,
  gasPriceGwei: formatGwei(gasPrice),
  simpleTransferCostEth: formatEther(transferCost),
  fundedForTransfer: balance > transferCost * 10n,
  explorer: `${chain.blockExplorers.default.url}/address/${account.address}`,
  faucet: chain.testnet ? 'https://faucet.testnet.chain.robinhood.com' : null,
});
