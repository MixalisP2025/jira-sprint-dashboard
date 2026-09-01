// Circuit breaker for Oracle connection attempts.
//
// Background: a wrong password put SprintAnalyticsDashboard into
// FAILED_LOGIN_ATTEMPTS lockout (ORA-28000). The backend retried the connection
// with no backoff, ~46 times a second. The listener records every attempt
// *before* authentication runs, so each rejected connect still wrote ~400 bytes
// to log.xml — about 1.5 GB/day, ~15 GB before anyone noticed.
//
// Two rules follow from that:
//   1. Credential errors must never be retried automatically. Retrying is what
//      trips the lockout in the first place, and it can never succeed on its
//      own. These go to 'blocked' and stay there until a human intervenes.
//   2. Everything else backs off exponentially, and while the breaker is open
//      callers are rejected with no network I/O at all — nothing reaches the
//      listener.

// Oracle errors where another attempt is useless or actively harmful.
const FATAL_ORA_ERRORS = {
  1005:  'no password given',
  1017:  'invalid username/password',
  12154: 'TNS could not resolve the connect identifier',
  28000: 'the account is locked',
  28001: 'the password has expired',
  28003: 'password verification for the specified password failed',
};

// oracledb sets err.errorNum; fall back to parsing "ORA-01017: ..." from text.
function oraErrorNumber(err) {
  if (!err) return null;
  if (Number.isInteger(err.errorNum) && err.errorNum > 0) return err.errorNum;
  const m = /ORA-(\d{4,5})/.exec(String(err.message || err));
  return m ? Number(m[1]) : null;
}

function isFatal(err) {
  const num = oraErrorNumber(err);
  return num != null && Object.prototype.hasOwnProperty.call(FATAL_ORA_ERRORS, num);
}

class DbUnavailableError extends Error {
  constructor(message, { code, retryInMs = null, oraErrorNum = null, cause = null } = {}) {
    super(message);
    this.name = 'DbUnavailableError';
    this.code = code;
    this.retryInMs = retryInMs;
    this.oraErrorNum = oraErrorNum;
    this.cause = cause;
  }
}

function createBreaker(opts = {}) {
  const now              = opts.now              || (() => Date.now());
  const baseDelayMs      = opts.baseDelayMs      != null ? opts.baseDelayMs      : 1000;
  const maxDelayMs       = opts.maxDelayMs       != null ? opts.maxDelayMs       : 5 * 60 * 1000;
  const failureThreshold = opts.failureThreshold != null ? opts.failureThreshold : 3;
  const onStateChange    = opts.onStateChange    || (() => {});

  let state = 'closed';          // 'closed' | 'open' | 'blocked'
  let consecutiveFailures = 0;
  let openedAt = 0;
  let cooldownMs = 0;
  let lastError = null;          // { oraErrorNum, message, at }
  let probeInFlight = false;

  function setState(next, reason) {
    if (state === next) return;
    const prev = state;
    state = next;
    try { onStateChange({ from: prev, to: next, reason }); } catch (_) {}
  }

  function blockedError() {
    const num = lastError && lastError.oraErrorNum;
    const what = num && FATAL_ORA_ERRORS[num] ? `ORA-${String(num).padStart(5, '0')} (${FATAL_ORA_ERRORS[num]})` : 'a credential/config error';
    return new DbUnavailableError(
      `Oracle connections are blocked after ${what}. Not retrying — repeated attempts are what lock the account and flood the listener log. ` +
      `Fix the credentials (unlock the account, verify ORACLE_PASSWORD), then reset the breaker or restart the backend.`,
      { code: 'DB_CIRCUIT_BLOCKED', oraErrorNum: num, cause: lastError }
    );
  }

  function openError(retryInMs) {
    return new DbUnavailableError(
      `Oracle is unreachable; connection attempts are paused for another ${Math.ceil(retryInMs / 1000)}s.`,
      { code: 'DB_CIRCUIT_OPEN', retryInMs, cause: lastError }
    );
  }

  // Throws (without any network I/O) when an attempt must not be made.
  // Returns true when the caller may attempt a connection.
  function assertAllowed() {
    if (state === 'blocked') throw blockedError();

    if (state === 'open') {
      const elapsed = now() - openedAt;
      const remaining = cooldownMs - elapsed;
      if (remaining > 0) throw openError(remaining);
      // Cooldown elapsed — let exactly one caller through as a probe.
      if (probeInFlight) throw openError(cooldownMs);
      probeInFlight = true;
    }
    return true;
  }

  function recordSuccess() {
    probeInFlight = false;
    consecutiveFailures = 0;
    cooldownMs = 0;
    openedAt = 0;
    lastError = null;
    setState('closed', 'connection succeeded');
  }

  function recordFailure(err) {
    probeInFlight = false;
    lastError = {
      oraErrorNum: oraErrorNumber(err),
      message: String((err && err.message) || err),
      at: now(),
    };

    if (isFatal(err)) {
      consecutiveFailures += 1;
      setState('blocked', `fatal Oracle error ORA-${lastError.oraErrorNum}`);
      return { state, fatal: true };
    }

    consecutiveFailures += 1;
    if (consecutiveFailures >= failureThreshold) {
      const overshoot = consecutiveFailures - failureThreshold;
      cooldownMs = Math.min(maxDelayMs, baseDelayMs * Math.pow(2, overshoot));
      openedAt = now();
      setState('open', `${consecutiveFailures} consecutive failures`);
    }
    return { state, fatal: false };
  }

  function reset() {
    probeInFlight = false;
    consecutiveFailures = 0;
    cooldownMs = 0;
    openedAt = 0;
    lastError = null;
    setState('closed', 'manual reset');
  }

  function status() {
    const remaining = state === 'open' ? Math.max(0, cooldownMs - (now() - openedAt)) : 0;
    return {
      state,
      consecutiveFailures,
      retryInMs: remaining,
      // Surfaced so a failure is visible in hours rather than weeks — the
      // original outage was invisible because every error was swallowed.
      lastError: lastError ? { oraErrorNum: lastError.oraErrorNum, message: lastError.message, at: lastError.at } : null,
    };
  }

  return { assertAllowed, recordSuccess, recordFailure, reset, status };
}

module.exports = {
  createBreaker,
  DbUnavailableError,
  isFatal,
  oraErrorNumber,
  FATAL_ORA_ERRORS,
};
