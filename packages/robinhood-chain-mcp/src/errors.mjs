/**
 * robinhood-toolkit · MCP boundary error handling
 * Author: nirholas · https://github.com/nirholas/robinhood-toolkit
 * License: MIT (c) 2026 nirholas
 *
 * Every tool handler runs inside `guard()`. A tool must never throw out of the
 * handler: a thrown error surfaces to the host as a protocol-level failure with
 * no text the model can reason about, so an agent typically reports "the tool
 * broke" instead of "that address is not an ERC-20". `guard()` converts every
 * failure into an isError result carrying an actionable sentence.
 */
import { BaseError, isAddress, getAddress } from 'viem';

/** A failure we produced deliberately, with a message written for an agent. */
export class ToolError extends Error {
  constructor(message, { hint } = {}) {
    super(message);
    this.name = 'ToolError';
    this.hint = hint;
  }
}

/**
 * JSON.stringify throws outright on a BigInt, and chain reads are full of them.
 * Serialising as a decimal string keeps full precision: a uint256 does not fit
 * in a JS number, so coercing to Number would silently corrupt large balances.
 */
function bigintSafe(_key, value) {
  return typeof value === 'bigint' ? value.toString() : value;
}

/** Successful tool result. JSON so the model gets structured, quotable data. */
export function ok(data) {
  return { content: [{ type: 'text', text: JSON.stringify(data, bigintSafe, 2) }] };
}

/** Logical failure. isError tells the host this is a tool-level problem. */
export function fail(message, { hint } = {}) {
  const text = hint ? `${message}\n\nHint: ${hint}` : message;
  return { isError: true, content: [{ type: 'text', text }] };
}

/**
 * Validate and checksum an address at the boundary. viem's getAddress throws an
 * opaque InvalidAddressError on bad input; this produces a sentence that tells
 * the agent which argument was wrong and what shape was expected.
 */
export function requireAddress(value, label = 'address') {
  if (typeof value !== 'string' || !isAddress(value, { strict: false })) {
    throw new ToolError(
      `"${label}" is not a valid EVM address: ${JSON.stringify(value)}`,
      { hint: 'Expected a 0x-prefixed 20-byte hex string, for example 0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168.' },
    );
  }
  return getAddress(value);
}

/** Validate a 32-byte transaction hash. */
export function requireTxHash(value) {
  if (typeof value !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(value)) {
    throw new ToolError(
      `"hash" is not a valid transaction hash: ${JSON.stringify(value)}`,
      { hint: 'Expected a 0x-prefixed 32-byte hex string (66 characters total).' },
    );
  }
  return value.toLowerCase();
}

/**
 * Turn any thrown value into an agent-readable sentence. viem errors carry a
 * useful shortMessage; raw fetch failures do not, so we classify the common
 * transport problems by hand rather than leaking a stack trace to the model.
 */
export function describeError(error) {
  if (error instanceof ToolError) return { message: error.message, hint: error.hint };

  if (error instanceof BaseError) {
    const message = error.shortMessage || error.message;
    if (/rate ?limit|429|too many requests/i.test(message)) {
      return {
        message: `The Robinhood Chain RPC endpoint rate limited this request: ${message}`,
        hint: 'Wait a few seconds and retry. For sustained use set ROBINHOOD_MAINNET_RPC_URL to a keyed provider.',
      };
    }
    return { message };
  }

  const message = error?.message ?? String(error);

  if (error?.name === 'AbortError' || /timeout|timed out/i.test(message)) {
    return {
      message: `The request to the Robinhood Chain RPC endpoint timed out: ${message}`,
      hint: 'The public RPC may be under load. Retry once before concluding the chain is unreachable.',
    };
  }
  if (/fetch failed|ENOTFOUND|ECONNREFUSED|ECONNRESET|EAI_AGAIN|network/i.test(message)) {
    return {
      message: `Could not reach the Robinhood Chain RPC endpoint: ${message}`,
      hint: 'Check network egress from the machine running this MCP server.',
    };
  }

  return { message };
}

/**
 * Wrap a handler so no failure escapes as a protocol error. This is the single
 * boundary the whole server relies on to stay alive across a bad tool call.
 */
export function guard(handler) {
  return async (args) => {
    try {
      return await handler(args);
    } catch (error) {
      const { message, hint } = describeError(error);
      return fail(message, { hint });
    }
  };
}
