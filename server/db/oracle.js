const oracledb = require('oracledb');

// Thin mode is the default (no Oracle Instant Client needed).
// Commit explicitly per request instead of per statement — one autocommit per
// row generated a transaction (and a redo record) for every ticket we saved.
oracledb.autoCommit = false;
// CLOB columns (SAD_SETTINGS.SETTING_VALUE, SAD_ROLES.BULLETS) come back as
// plain strings so the JSON.parse() calls in routes.js work on them directly.
oracledb.fetchAsString = [oracledb.CLOB];

const config = {
  user:     process.env.ORACLE_USER     || 'SprintAnalyticsDashboard',
  password: process.env.ORACLE_PASSWORD || '',
  // ORACLE_CONNECT_STRING overrides the parts — set it to a tnsnames alias
  // (e.g. AIS_SERVER) if you also set TNS_ADMIN. Defaults to the EZConnect
  // equivalent of the AIS_SERVER descriptor: DBSRV:1521/ORCL.
  connectString: process.env.ORACLE_CONNECT_STRING
    || `${process.env.ORACLE_HOST || 'DBSRV'}:${process.env.ORACLE_PORT || 1521}/${process.env.ORACLE_SERVICE || 'ORCL'}`,
};

// Cache the *promise*, not the resolved pool. `if (!pool) pool = await create()`
// let every concurrent first caller past the guard before the first create
// resolved, so each built its own pool. Only the last was kept in the variable;
// the rest were orphaned, holding poolMin connections open and re-establishing
// them forever. Each re-establish is a fresh logon in the listener log.
let poolPromise = null;

function getPool() {
  if (!poolPromise) {
    poolPromise = oracledb
      .createPool({
        ...config,
        poolMin:       1,
        poolMax:       10,
        poolIncrement: 1,
        // Never retire idle connections. The default (60s) meant a quiet period
        // dropped connections that the next request had to re-open through the
        // listener — steady churn with no work behind it.
        poolTimeout:      0,
        poolPingInterval: 60,
        queueTimeout:     30000,
      })
      .then(p => {
        console.log('✅ Oracle connection pool created');
        return p;
      })
      .catch(err => {
        // Clear the cache so a transient outage doesn't poison the pool
        // permanently — the next request retries instead of failing forever.
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
  const pool = await getPool();
  const conn = await pool.getConnection();
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
  return { rows: result.rows || [] };
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

module.exports = {
  oracledb,
  query,
  execute,
  withConnection,
  withTransaction,
  getPool,
  closePool,
};
