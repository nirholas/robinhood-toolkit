/**
 * robinhood-toolkit · verify Crypto API credentials end to end
 * Author: nirholas · https://github.com/nirholas/robinhood-toolkit
 * License: MIT (c) 2026 nirholas
 */
import { RobinhoodCrypto } from '../packages/rh-crypto/client.mjs';

const rh = new RobinhoodCrypto();
const account = await rh.get('/api/v1/crypto/trading/accounts/');
console.log(account);
