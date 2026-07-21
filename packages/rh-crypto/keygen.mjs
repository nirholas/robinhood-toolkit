/* built by nirholas x.com/nichxbt */
/**
 * robinhood-toolkit · Ed25519 keypair generator for Robinhood Crypto API
 * Author: nirholas · https://github.com/nirholas/robinhood-toolkit
 * License: All Rights Reserved (c) 2026 nirholas
 */
import { generateKeyPairSync } from 'node:crypto';

const { privateKey, publicKey } = generateKeyPairSync('ed25519');

// Strip DER wrappers to the raw 32-byte seed and 32-byte public key.
const seed = privateKey.export({ format: 'der', type: 'pkcs8' }).subarray(16);
const pub = publicKey.export({ format: 'der', type: 'spki' }).subarray(12);

console.log('private (keep secret):', seed.toString('base64'));
console.log('public  (give to RH) :', pub.toString('base64'));
/* built by nirholas x.com/nichxbt */
