const oracledb = require('oracledb');

// Use thin mode — no Oracle Instant Client required
oracledb.initOracleClient = undefined; // ensure thin mode
oracledb.autoCommit = true;

const config = {
  user:        process.env.ORACLE_USER     || 'SprintAnalyticsDashboard',
  password:    process.env.ORACLE_PASSWORD || '',
  connectString: `${process.env.ORACLE_HOST || 'DBSRV'}:${process.env.ORACLE_PORT || 1521}/${process.env.ORACLE_SERVICE || 'ORCL'}`,
};

let pool = null;

async function getPool() {
  if (!pool) {
    pool = await oracledb.createPool({
      ...config,
      poolMin:       2,
      poolMax:       10,
      poolIncrement: 1,
    });
    console.log('✅ Oracle connection pool created');
  }
  return pool;
}

async function query(sql, binds = [], opts = {}) {
  const p = await getPool();
  const conn = await p.getConnection();
  try {
    const result = await conn.execute(sql, binds, {
      outFormat: oracledb.OUT_FORMAT_OBJECT,
      ...opts,
    });
    // Return only plain data — avoid circular refs in oracledb result metadata
    return { rows: result.rows || [] };
  } finally {
    await conn.close();
  }
}

async function closePool() {
  if (pool) {
    await pool.close(0);
    pool = null;
  }
}

module.exports = { query, getPool, closePool };
