/* built by nirholas x.com/nichxbt */
/**
 * robinhood-toolkit · request signer for the Robinhood Crypto Trading API
 * Author: nirholas · https://github.com/nirholas/robinhood-toolkit
 * License: All Rights Reserved (c) 2026 nirholas
 */
import { createPrivateKey, createPublicKey, sign } from 'node:crypto';

const PKCS8_ED25519_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex');

/** Load a base64 32-byte Ed25519 seed into a Node KeyObject. */
export function loadPrivateKey(base64Seed) {
  const seed = Buffer.from(base64Seed, 'base64');
  if (seed.length !== 32) {
    throw new Error(`private key must decode to 32 bytes, got ${seed.length}`);
  }
  return createPrivateKey({
    key: Buffer.concat([PKCS8_ED25519_PREFIX, seed]),
    format: 'der',
    type: 'pkcs8',
  });
}

/** Derive the base64 public key from a private KeyObject. */
export function publicKeyBase64(privateKey) {
  return createPublicKey(privateKey)
    .export({ format: 'der', type: 'spki' })
    .subarray(12)
    .toString('base64');
}

/**
 * Build the three auth headers.
 * @param path full request path including query string, e.g. "/api/v1/crypto/trading/orders/"
 * @param body the exact serialized body string you will transmit, or "" for no body
 */
export function authHeaders({ apiKey, privateKey, method, path, body = '', timestamp }) {
  const ts = timestamp ?? Math.floor(Date.now() / 1000);
  const message = `${apiKey}${ts}${path}${method.toUpperCase()}${body}`;
  return {
    'x-api-key': apiKey,
    'x-signature': sign(null, Buffer.from(message, 'utf8'), privateKey).toString('base64'),
    'x-timestamp': String(ts),
  };
}
/* built by nirholas x.com/nichxbt */
