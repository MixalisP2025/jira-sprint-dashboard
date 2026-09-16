import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createRequire } from 'module';
import net from 'net';

const require = createRequire(import.meta.url);
const { isStaleAddress } = require('../../server/db/circuitBreaker.js');

// Regression test for the listener-log flood, run against the real oracledb
// driver. The "listener" is a local socket that accepts and drops every
// connection and counts them — each count is one line Oracle's real listener
// would have written to log.xml. Nothing leaves this machine.
let server;
let hits = 0;
let port;

const sleep = ms => new Promise(r => setTimeout(r, ms));

beforeAll(async () => {
  server = net.createServer(s => { hits++; s.destroy(); });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  port = server.address().port;
  process.env.ORACLE_CONNECT_STRING = `127.0.0.1:${port}/STORMTEST`;
  process.env.ORACLE_PASSWORD = 'not-a-real-password';
});

afterAll(async () => {
  try { await require('../../server/db/oracle.js').destroyPool(); } catch (_) {}
  await new Promise(r => server.close(r));
});

describe('a pool built while the host was unresolvable is rebuilt, not reused', () => {
  it('recovers on the next attempt once the host resolves again', async () => {
    const db = require('../../server/db/oracle.js');
    const warn = console.warn;
    console.warn = () => {};
    try {
      // 1. network down: the host cannot be resolved, so the pool holds no usable address
      process.env.ORACLE_CONNECT_STRING = 'dbsrv.invalid-for-test:1521/ORCL';
      const first = await db.query('SELECT 1 FROM DUAL').then(() => null, e => e);
      expect(String(first.message)).toMatch(/NJS-530/);
      expect(isStaleAddress(first)).toBe(true);

      // 2. network back: the next attempt must resolve again rather than reuse the
      //    dead address list. Reaching the local listener proves the pool was rebuilt.
      db.resetCircuit();
      process.env.ORACLE_CONNECT_STRING = `127.0.0.1:${port}/STORMTEST`;
      const second = await db.query('SELECT 1 FROM DUAL').then(() => null, e => e);
      expect(second).toBeTruthy();
      expect(String(second.message)).not.toMatch(/NJS-530/);   // no longer a name problem
      expect(hits).toBeGreaterThan(0);                          // it actually dialled the listener
    } finally {
      console.warn = warn;
      await require('../../server/db/oracle.js').destroyPool();
      require('../../server/db/oracle.js').resetCircuit();
    }
  }, 30000);
});

describe('Oracle pool does not retry on its own', () => {
  it('keeps poolMin at 0', () => {
    const { POOL_OPTIONS } = require('../../server/db/oracle.js');
    // poolMin > 0 makes the thin driver reconnect in a tight loop whenever a
    // connect fails (~700/s measured), with no request driving it.
    expect(POOL_OPTIONS.poolMin).toBe(0);
  });

  it('an idle pool built with the production options makes no connections', async () => {
    const { oracledb, POOL_OPTIONS } = require('../../server/db/oracle.js');
    const before = hits;
    const pool = await oracledb.createPool({
      user: 'x', password: 'y', connectString: `127.0.0.1:${port}/STORMTEST`, ...POOL_OPTIONS,
    });
    await sleep(1500);
    await pool.close(0);
    expect(hits - before).toBe(0);
  }, 10000);

  it('a burst of requests against a dead database is capped by the breaker, then goes quiet', async () => {
    const db = require('../../server/db/oracle.js');
    const warn = console.warn;
    console.warn = () => {};
    try {
      const before = hits;
      const results = [];
      for (let i = 0; i < 25; i++) {
        results.push(await db.query('SELECT 1 FROM DUAL').then(() => 'ok', e => e.code || 'error'));
      }
      const afterBurst = hits - before;

      // Three real attempts trip the breaker; the rest are refused locally.
      expect(results.filter(r => r === 'ok')).toHaveLength(0);
      expect(afterBurst).toBeLessThanOrEqual(3);
      expect(results.filter(r => r === 'DB_CIRCUIT_OPEN').length).toBeGreaterThanOrEqual(20);
      expect(db.circuitStatus().state).toBe('open');

      // Idle: nothing may reconnect in the background.
      await sleep(2500);
      expect(hits - before).toBe(afterBurst);
    } finally {
      console.warn = warn;
    }
  }, 30000);
});
