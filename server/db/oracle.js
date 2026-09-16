const oracledb = require('oracledb');
const { createBreaker, DbUnavailableError, isFatal, isStaleAddress } = require('./circuitBreaker');

// Guards every physical connection attempt. Credential errors block outright;
// anything else backs off. While it is open or blocked nothing touches the
// network, so a broken login can no longer flood the listener log.
const breaker = createBreaker({
  onStateChange: ({ from, to, reason }) =>
    console.warn(`[oracle] circuit ${from} -> ${to}: ${reason}`),
});

// Thin mode is the default (no Oracle Instant Client needed).
// Commit explicitly per request instead of per statement — one autocommit per
// row generated a transaction (and a redo record) for every ticket we saved.
oracledb.autoCommit = false;
// CLOB columns (SAD_SETTINGS.SETTING_VALUE, SAD_ROLES.BULLETS) come back as
// plain strings so the JSON.parse() calls in routes.js work on them directly.
oracledb.fetchAsString = [oracledb.CLOB];

// Read when a pool is built, not once at import, so a rebuilt pool picks up the
// current settings.
function buildConfig() {
  return {
    user:     process.env.ORACLE_USER     || 'SprintAnalyticsDashboard',
    password: process.env.ORACLE_PASSWORD || '',
    // ORACLE_CONNECT_STRING overrides the parts — set it to a tnsnames alias
    // (e.g. AIS_SERVER) if you also set TNS_ADMIN. Defaults to the EZConnect
    // equivalent of the AIS_SERVER descriptor: DBSRV:1521/ORCL.
    connectString: process.env.ORACLE_CONNECT_STRING
      || `${process.env.ORACLE_HOST || 'DBSRV'}:${process.env.ORACLE_PORT || 1521}/${process.env.ORACLE_SERVICE || 'ORCL'}`,
  };
}

// Cache the *promise*, not the resolved pool. `if (!pool) pool = await create()`
// let every concurrent first caller past the guard before the first create
// resolved, so each built its own pool. Only the last was kept in the variable;
// the rest were orphaned, holding poolMin connections open and re-establishing
// them forever. Each re-establish is a fresh logon in the listener log.
let poolPromise = null;

// Pool settings, exported so the regression test runs the exact same config.
const POOL_OPTIONS = {
  // Must stay 0. In thin mode the pool's background task keeps poolMin
  // connections open, and when a connect fails it retries immediately with no
  // delay — measured at ~700 attempts/second against a dropped listener, with
  // no requests at all. A DB restart, network blip or password change would
  // restart the listener-log flood. With 0 the driver only connects when a
  // request asks, so every attempt passes through the breaker below.
  poolMin:       0,
  poolMax:       10,
  poolIncrement: 1,
  // Never retire idle connections. The default (60s) meant a quiet period
  // dropped connections that the next request had to re-open through the
  // listener — steady churn with no work behind it. Once opened, a connection
  // stays open even with poolMin 0.
  poolTimeout:      0,
  poolPingInterval: 60,
  queueTimeout:     30000,
};

function getPool() {
  if (!poolPromise) {
    // createPool does no network I/O in thin mode and proves nothing about the
    // credentials, so it is not recorded as a success — only a real connection is.
    poolPromise = oracledb
      .createPool({ ...buildConfig(), ...POOL_OPTIONS })
      .then(p => {
        console.log('✅ Oracle connection pool created');
        return p;
      })
      .catch(err => {
        // Clear the cache so a transient outage doesn't poison the pool
        // permanently — the next request retries instead of failing forever.
        // The breaker decides whether that next attempt is actually allowed.
        poolPromise = null;
        throw err;
      });
  }
  return poolPromise;
}

// Run `fn` against a single pooled connection. Every route should wrap its
// whole unit of work in one of these — borrowing per statement is what turned a
// single save into thousands of logons.
async function withConnection(fn) {
  // Throws without any network I/O when the breaker is open or blocked. Checked
  // on every borrow, not just pool creation — an existing pool whose connection
  // was dropped would otherwise reconnect straight past an open breaker.
  breaker.assertAllowed();

  let conn;
  try {
    const pool = await getPool();
    conn = await pool.getConnection();
  } catch (err) {
    // Credential errors always surface here, never at createPool. Tear the pool
    // down on a fatal one so nothing cached can keep trying the bad login.
    breaker.recordFailure(err);
    // A pool resolves the host once, when it is built. One built while the network
    // was down (laptop off the LAN, DNS unreachable) keeps that dead address list
    // and fails forever, even after the network returns — it took a restart to
    // recover. Drop it so the next attempt resolves the host again; the breaker
    // still decides when that attempt may happen.
    if (isFatal(err) || isStaleAddress(err)) await destroyPool();
    throw err;
  }
  breaker.recordSuccess();

  try {
    return await fn(conn);
  } finally {
    try { await conn.close(); } catch (_) { /* returning to pool, not closing */ }
  }
}

// Same contract, but commits on success and rolls back on failure.
async function withTransaction(fn) {
  return withConnection(async conn => {
    try {
      const out = await fn(conn);
      await conn.commit();
      return out;
    } catch (err) {
      try { await conn.rollback(); } catch (_) {}
      throw err;
    }
  });
}

async function execute(conn, sql, binds = {}, opts = {}) {
  const result = await conn.execute(sql, binds, {
    outFormat: oracledb.OUT_FORMAT_OBJECT,
    ...opts,
  });
  // Return only plain data — avoid circular refs in oracledb result metadata.
  return { rows: result.rows || [], rowsAffected: result.rowsAffected || 0 };
}

// Convenience wrapper for one-off reads.
async function query(sql, binds = {}, opts = {}) {
  return withConnection(conn => execute(conn, sql, binds, opts));
}

async function closePool() {
  if (!poolPromise) return;
  const p = poolPromise.catch(() => null);
  poolPromise = null;
  const pool = await p;
  if (pool) await pool.close(10);
}

// Drop the pool immediately, without draining. Used when credentials have gone
// bad: every second a poolMin connection keeps retrying is more listener log.
async function destroyPool() {
  if (!poolPromise) return;
  const p = poolPromise.catch(() => null);
  poolPromise = null;
  const pool = await p;
  if (pool) { try { await pool.close(0); } catch (_) {} }
}

// Clear a blocked/open breaker after the credentials have actually been fixed.
function resetCircuit() {
  breaker.reset();
  return breaker.status();
}

function circuitStatus() {
  return breaker.status();
}

module.exports = {
  oracledb,
  POOL_OPTIONS,
  query,
  execute,
  withConnection,
  withTransaction,
  getPool,
  closePool,
  destroyPool,
  resetCircuit,
  circuitStatus,
  DbUnavailableError,
};
