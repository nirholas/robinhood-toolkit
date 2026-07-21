/* built by nirholas x.com/nichxbt */
/**
 * robinhood-toolkit · keystore-backed signer with a hard network guard
 * Author: nirholas · https://github.com/nirholas/robinhood-toolkit
 * License: All Rights Reserved (c) 2026 nirholas
 *
 * Loads the private key from process.env.PRIVATE_KEY ONLY — never a literal,
 * never a default, never a fallback to a well-known test key. Fails closed on a
 * missing or malformed key with an actionable message, before viem ever sees
 * the value. Defaults to testnet; mainnet must be an explicit, typed opt-in.
 *
 * Never log the key. Print `account.address`, never the key material.
 */
import { createWalletClient } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { robinhoodMainnet, robinhoodTestnet, transportFor } from '@robinhood-toolkit/network';

/**
 * Hard network guard. Testnet unless NETWORK is EXACTLY the string 'mainnet'.
 * A mainnet run must be a deliberate, typed act — a selector that defaults to
 * mainnet eventually sends real value during a test run.
 *
 * @param {string} [network=process.env.NETWORK]
 * @returns {import('viem').Chain}
 */
export function resolveChain(network = process.env.NETWORK) {
  return network === 'mainnet' ? robinhoodMainnet : robinhoodTestnet;
}

/**
 * Validate and load the account from PRIVATE_KEY. Throws with an actionable
 * message rather than a viem internal error when the key is absent or malformed.
 *
 * @param {string} [pk=process.env.PRIVATE_KEY]
 * @returns {import('viem/accounts').PrivateKeyAccount}
 */
export function loadAccount(pk = process.env.PRIVATE_KEY) {
  if (!pk) {
    throw new Error('PRIVATE_KEY is not set. Put it in .env, never in source. See .env.example.');
  }
  // A 32-byte hex key is exactly 66 chars: '0x' + 64 hex digits. Validate the
  // shape here so the failure is legible, not a viem "invalid private key".
  if (!/^0x[0-9a-fA-F]{64}$/.test(pk)) {
    throw new Error(
      'PRIVATE_KEY must be a 0x-prefixed 32-byte hex string (66 chars, 64 hex digits). ' +
        `Got ${pk.length} chars.`,
    );
  }
  return privateKeyToAccount(pk);
}

/** The resolved chain for this process (testnet unless NETWORK=mainnet). */
export const chain = resolveChain();

/** The signing account, validated at import time. Fails closed. */
export const account = loadAccount();

/**
 * Wallet client for a chain, built on the SAME failover transport as the public
 * client factory in @robinhood-toolkit/network, so the signer inherits its
 * failover behavior. Defaults to the process-resolved chain.
 *
 * @param {import('viem').Chain} [forChain=chain]
 */
export function walletClientFor(forChain = chain) {
  return createWalletClient({ account, chain: forChain, transport: transportFor(forChain) });
}

/** Default wallet client for the resolved chain. */
export const wallet = walletClientFor(chain);
/* built by nirholas x.com/nichxbt */
