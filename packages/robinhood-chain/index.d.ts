/**
 * robinhood-chain · TypeScript declarations
 * Author: nirholas · https://github.com/nirholas/robinhood-toolkit
 * License: MIT (c) 2026 nirholas
 *
 * robinhood-toolkit · package: robinhood-chain
 *
 * Hand-written to keep this package build-step free: the published files are the
 * source files. Keep these in sync with index.js when the public API changes.
 */

import type { AbiEvent, Address, Chain, Log, PublicClient } from 'viem'

// ---------------------------------------------------------------------------
// Chains
// ---------------------------------------------------------------------------

export declare const MULTICALL3_ADDRESS: '0xcA11bde05977b3631167028862bE2a173976CA11'
export declare const ROBINHOOD_MAINNET_ID: 4663
export declare const ROBINHOOD_TESTNET_ID: 46630

/** Robinhood Chain mainnet (4663), with contracts.multicall3 declared. */
export declare const robinhoodChain: Chain

/** Robinhood Chain testnet (46630), with contracts.multicall3 declared. */
export declare const robinhoodTestnet: Chain

export declare const CHAINS: readonly Chain[]
export declare const chainsById: Record<number, Chain>

/** Resolve a chain by numeric ID. Throws UnsupportedChainError if unknown. */
export declare function getChain(chainId: number | bigint | string): Chain

export declare function isRobinhoodChain(chainId: number | bigint | string): boolean

/** Confirms Multicall3 bytecode is present at the canonical address. */
export declare function hasMulticall3(client: PublicClient): Promise<boolean>

export interface AddEthereumChainParameter {
  chainId: string
  chainName: string
  nativeCurrency: { name: string; symbol: string; decimals: number }
  rpcUrls: string[]
  blockExplorerUrls: string[]
}

/** EIP-3085 payloads. Chain IDs are hex strings ('0x1237' / '0xb626'). */
export declare const addChainParams: {
  mainnet: AddEthereumChainParameter
  testnet: AddEthereumChainParameter
}

// ---------------------------------------------------------------------------
// Tokens
// ---------------------------------------------------------------------------

export interface KnownToken {
  readonly address: Address
  readonly name: string
  readonly symbol: string
  readonly decimals: number
  readonly chainId: number
}

export interface ImpostorToken extends KnownToken {
  /** Address of the real token whose ticker this one squats. */
  readonly impersonates: Address
  readonly note: string
}

/** WETH on mainnet. 18 decimals. */
export declare const WETH: KnownToken

/** Global Dollar on mainnet. SIX decimals, not 18. */
export declare const USDG: KnownToken

export declare const KNOWN_TOKENS: { readonly WETH: KnownToken; readonly USDG: KnownToken }

/** Live ticker squatters observed on mainnet. Advisory, never exhaustive. */
export declare const KNOWN_IMPOSTORS: readonly ImpostorToken[]

export declare function knownTokenAt(address: Address | string): KnownToken | ImpostorToken | null
export declare function isKnownImpostor(address: Address | string): boolean

// ---------------------------------------------------------------------------
// Formatting (never defaults decimals)
// ---------------------------------------------------------------------------

/** Validates decimals. Throws MissingDecimalsError when absent. */
export declare function assertDecimals(decimals: number | undefined | null, context?: string): number

/** Format a raw amount. `decimals` is required; there is no default. */
export declare function formatToken(amount: bigint | number | string, decimals: number): string

/** Parse a decimal string to a raw bigint. `decimals` is required. */
export declare function parseToken(value: string | number, decimals: number): bigint

export declare function readDecimals(
  client: PublicClient,
  address: Address | string,
  options?: { cache?: Map<string, number> },
): Promise<number>

export interface TokenBalance {
  token: Address
  account: Address
  raw: bigint
  decimals: number
  formatted: string
}

export declare function readBalance(
  client: PublicClient,
  options: { token: Address | string; account: Address | string; cache?: Map<string, number> },
): Promise<TokenBalance>

// ---------------------------------------------------------------------------
// Verification
// ---------------------------------------------------------------------------

export interface TokenMetadata {
  address: Address
  chainId: number | null
  /** Attacker-controlled string. Display only, never a logic key. */
  name: string | null
  /** Attacker-controlled string. Display only, never a logic key. */
  symbol: string | null
  decimals: number
  readAt: string
}

export interface ExpectedToken {
  address?: Address | string
  name?: string
  symbol?: string
  decimals?: number
}

export declare function readTokenMetadata(
  client: PublicClient,
  address: Address | string,
): Promise<TokenMetadata>

/**
 * Prove the token at `address` is what it claims to be.
 * Throws NotCanonicalTokenError on mismatch.
 */
export declare function assertCanonicalToken(
  client: PublicClient,
  address: Address | string,
  expected: ExpectedToken,
  options?: { caseInsensitive?: boolean },
): Promise<TokenMetadata>

export interface VerifyResult {
  ok: boolean
  metadata: TokenMetadata | null
  error: Error | null
}

/** Non-throwing variant of assertCanonicalToken. */
export declare function verifyToken(
  client: PublicClient,
  address: Address | string,
  expected: ExpectedToken,
  options?: { caseInsensitive?: boolean },
): Promise<VerifyResult>

// ---------------------------------------------------------------------------
// Log scanning
// ---------------------------------------------------------------------------

export declare const DEFAULT_CHUNK: bigint
export declare const MIN_CHUNK: bigint
export declare const BLOCK_TIME_MS: number

export declare function blocksToMs(blocks: bigint | number): number

export type ScanErrorKind = 'matched-log-cap' | 'response-size-cap' | 'unknown'

/**
 * Advisory classifier for the known mainnet caps. REPORTING ONLY: never use the
 * result as a retry condition. The endpoint has already reported the
 * matched-log cap under two different messages on the same day, so any control
 * flow keyed on error text is one server-side reword away from breaking.
 */
export declare function classifyScanError(error: unknown): ScanErrorKind

export interface ScanCursor {
  nextBlock: bigint
  chunkSize: bigint
  chunksScanned: number
  halvings: number
  logsFound: number
}

export interface SerializedCursor {
  nextBlock: string
  chunkSize: string
  chunksScanned: number
  halvings: number
  logsFound: number
}

export declare function createCursor(options: {
  fromBlock: bigint | number | string
  chunkSize?: bigint | number | string
}): ScanCursor

export declare function serializeCursor(cursor: ScanCursor): SerializedCursor
export declare function deserializeCursor(plain: SerializedCursor): ScanCursor

export interface LogBatch {
  logs: Log[]
  fromBlock: bigint
  toBlock: bigint
  cursor: ScanCursor
}

export interface ScanLogsOptions {
  client: PublicClient
  address?: Address | Address[]
  event?: AbiEvent
  events?: readonly AbiEvent[]
  args?: unknown
  fromBlock?: bigint | number | string
  /** Defaults to the current head. */
  toBlock?: bigint | number | string
  /** Blocks per request. Defaults to 1000, the measured mainnet ceiling. */
  chunkSize?: bigint | number | string
  minChunkSize?: bigint | number | string
  /** Resume a previous scan. */
  cursor?: ScanCursor
  onChunk?: (batch: LogBatch) => void
}

/** Async generator yielding one batch per successful chunk. */
export declare function streamLogs(options: ScanLogsOptions): AsyncGenerator<LogBatch, void, void>

export interface ScanStats {
  chunksScanned: number
  halvings: number
  finalChunkSize: bigint | null
  logsFound: number
  elapsedMs: number
}

export interface ScanResult {
  logs: Log[]
  cursor: ScanCursor | null
  /** False when the scan stopped on the `maxChunks` budget with range left. */
  done: boolean
  stats: ScanStats
}

export declare function scanLogs(
  options: ScanLogsOptions & { maxChunks?: number },
): Promise<ScanResult>

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export declare class RobinhoodChainError extends Error {}

export declare class UnsupportedChainError extends RobinhoodChainError {
  chainId: number | bigint | string
  supported: number[]
}

export declare class MissingDecimalsError extends RobinhoodChainError {
  context?: string
}

export interface FieldMismatch {
  field: 'address' | 'name' | 'symbol' | 'decimals'
  expected: unknown
  actual: unknown
}

export declare class NotCanonicalTokenError extends RobinhoodChainError {
  address: Address
  mismatches: FieldMismatch[]
  actual: Partial<TokenMetadata> | null
}

export declare class LogScanError extends RobinhoodChainError {
  /** Serialize this to resume where the scan stopped. */
  cursor?: ScanCursor
  chunkSize?: bigint
}
