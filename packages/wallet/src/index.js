/**
 * robinhood-toolkit · wallet package entry
 * Author: nirholas · https://github.com/nirholas/robinhood-toolkit
 * License: All Rights Reserved (c) 2026 nirholas
 *
 * The funding gate is import-safe with no PRIVATE_KEY (it takes an address).
 * The signer is NOT: importing it validates PRIVATE_KEY and fails closed. Pull
 * signer members from '@robinhood-toolkit/wallet/signer' only where a key is
 * actually required, so key-free scripts (e.g. fund-testnet) stay runnable.
 */
export { assertFunded } from './funding.js';
