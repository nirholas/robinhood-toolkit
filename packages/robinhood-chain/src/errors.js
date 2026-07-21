/* built by nirholas x.com/nichxbt */
/**
 * robinhood-chain · error types
 * Author: nirholas · https://github.com/nirholas/robinhood-toolkit
 * License: All Rights Reserved (c) 2026 nirholas
 *
 * robinhood-toolkit · package: robinhood-chain
 */

/** Base class for every error this package throws. Catch this to catch them all. */
export class RobinhoodChainError extends Error {
  constructor(message, options) {
    super(message, options)
    this.name = 'RobinhoodChainError'
  }
}

/**
 * Thrown when a chain ID is not one of the two Robinhood Chain networks.
 * Carries the supported list so the caller does not have to look it up.
 */
export class UnsupportedChainError extends RobinhoodChainError {
  constructor(chainId, supported) {
    super(
      `Chain ${String(chainId)} is not a Robinhood Chain network. ` +
        `Supported: ${supported.join(', ')}.`,
    )
    this.name = 'UnsupportedChainError'
    this.chainId = chainId
    this.supported = supported
  }
}

/**
 * Thrown instead of silently defaulting to 18 decimals.
 *
 * This exists because USDG on Robinhood Chain has 6 decimals, not 18. A default
 * of 18 misformats a USDG balance by a factor of a trillion and still renders as
 * a plausible-looking number, which is strictly worse than a thrown error.
 */
export class MissingDecimalsError extends RobinhoodChainError {
  constructor(context) {
    super(
      `Token decimals are required and were not supplied${context ? ` (${context})` : ''}. ` +
        'This package never defaults to 18. Pass an explicit decimals value, or use ' +
        'readDecimals(client, address) to read it from the contract at call time. ' +
        'USDG on Robinhood Chain has 6 decimals.',
    )
    this.name = 'MissingDecimalsError'
    this.context = context
  }
}

/**
 * Thrown when an address does not match the token it claims to be.
 *
 * The live case this guards: a token named "Useless Stupid Degen Gamblers"
 * deploys with symbol "USDG" at 0x8218d73C00567A01481495Ad6c5143e00D5BB5b4 and
 * is not the Global Dollar stablecoin at 0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168.
 */
export class NotCanonicalTokenError extends RobinhoodChainError {
  constructor(address, mismatches, actual) {
    const detail = mismatches
      .map((m) => `${m.field}: expected ${JSON.stringify(m.expected)}, got ${JSON.stringify(m.actual)}`)
      .join('; ')
    super(
      `Token at ${address} is not the token it was expected to be. ${detail}. ` +
        'Resolve tokens by contract address, never by symbol: symbols are ' +
        'attacker-controlled strings with no uniqueness guarantee on this chain.',
    )
    this.name = 'NotCanonicalTokenError'
    this.address = address
    this.mismatches = mismatches
    this.actual = actual
  }
}

/**
 * Thrown when a log scan cannot make progress even at the minimum chunk size.
 * Carries the cursor so a caller can persist it and resume later.
 */
export class LogScanError extends RobinhoodChainError {
  constructor(message, { cursor, chunkSize, cause } = {}) {
    super(message, { cause })
    this.name = 'LogScanError'
    this.cursor = cursor
    this.chunkSize = chunkSize
  }
}
/* built by nirholas x.com/nichxbt */
