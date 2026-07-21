/* built by nirholas x.com/nichxbt */
/**
 * robinhood-toolkit · typed errors for the Robinhood Crypto Trading API
 * Author: nirholas · https://github.com/nirholas/robinhood-toolkit
 * License: All Rights Reserved (c) 2026 nirholas
 */

export class RobinhoodError extends Error {
  constructor(message, { status, type, errors = [], method, path, headers } = {}) {
    super(message);
    this.name = 'RobinhoodError';
    this.status = status;
    this.type = type;
    this.errors = errors;
    this.method = method;
    this.path = path;
    this.headers = headers;
  }

  /** Field-level details keyed by attr. Only populated on validation errors. */
  get byField() {
    const map = new Map();
    for (const e of this.errors) {
      const key = e.attr ?? 'non_field_errors';
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(e.detail);
    }
    return map;
  }

  get isValidation() {
    return this.type === 'validation_error' || this.status === 400;
  }

  get isAuth() {
    return this.status === 401;
  }

  get isPermission() {
    return this.status === 403;
  }

  get isRateLimit() {
    return this.status === 429;
  }

  get isServer() {
    return this.status >= 500;
  }

  /** One line a human can act on. */
  get summary() {
    const parts = [...this.byField].map(([field, details]) =>
      field === 'non_field_errors' ? details.join('; ') : `${field}: ${details.join('; ')}`,
    );
    return parts.length ? parts.join(' | ') : this.message;
  }
}

/** Build a RobinhoodError from a non-2xx response. */
export function toRobinhoodError({ status, payload, method, path, headers }) {
  const type = payload?.type;
  const errors = Array.isArray(payload?.errors) ? payload.errors : [];
  const error = new RobinhoodError(`Robinhood ${status} on ${method} ${path}`, {
    status,
    type,
    errors,
    method,
    path,
    headers,
  });
  return error;
}

/**
 * What the caller should do. Deliberately exhaustive over the documented codes
 * so a new code shows up as 'investigate' rather than being silently retried.
 */
export function triage(error) {
  switch (error.status) {
    case 400:
      return { action: 'fix-request', retryable: false, hint: error.summary };
    case 401:
      return {
        action: 'fix-auth',
        retryable: false,
        hint: 'Signature, timestamp, or key is wrong. Check clock drift and that the signed path includes the query string.',
      };
    case 403:
      return {
        action: 'fix-permissions',
        retryable: false,
        hint: 'Key is valid but lacks this scope. Re-create the credential with the required permission.',
      };
    case 404:
      return { action: 'fix-request', retryable: false, hint: 'Unknown path or resource id.' };
    case 405:
      return { action: 'fix-request', retryable: false, hint: 'Wrong HTTP method for this path.' };
    case 406:
      return { action: 'fix-request', retryable: false, hint: 'Adjust the Accept header.' };
    case 415:
      return { action: 'fix-request', retryable: false, hint: 'Set Content-Type: application/json.' };
    case 429:
      return { action: 'back-off', retryable: true, hint: 'Rate limited. Honor Retry-After if present.' };
    case 500:
    case 503:
      return { action: 'retry-if-idempotent', retryable: true, hint: 'Transient. Only retry GETs and orders carrying a reused client_order_id.' };
    default:
      return { action: 'investigate', retryable: false, hint: `Undocumented status ${error.status}.` };
  }
}

/**
 * Log an error in a greppable JSON form. Never emits the signature or private
 * key: headers are omitted entirely.
 */
export function logError(error) {
  const record = {
    at: new Date().toISOString(),
    status: error.status,
    type: error.type,
    method: error.method,
    path: error.path,
    fields: Object.fromEntries(error.byField ?? []),
    action: triage(error).action,
  };
  console.error(JSON.stringify(record));
}
/* built by nirholas x.com/nichxbt */
