const express = require('express');
const router  = express.Router();
const db      = require('./oracle');
const oracledb = db.oracledb;

// Safe JSON response — avoids circular ref crashes from oracledb internals
function safeJson(res, data, status = 200) {
  try {
    res.status(status).setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(data));
  } catch (_) {
    res.status(500).setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: 'Serialisation error' }));
  }
}

function errJson(res, err) {
  safeJson(res, { error: String(err && err.message ? err.message : err) }, 500);
}

// Clamp to the column width so a long value fails as truncation here rather
// than blowing up the whole batch with ORA-12899.
function clamp(v, n) {
  const s = v == null ? '' : String(v);
  return s.length > n ? s.substring(0, n) : s;
}

function num(v) {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : null;
}

function round2(n) {
  return n == null ? null : Math.round(n * 100) / 100;
}

// Rows are sent to Oracle in chunks so a large sprint pull doesn't build one
// enormous bind array. Each chunk is still a single round trip.
const CHUNK = 1000;

async function executeManyChunked(conn, sql, rows, bindDefs) {
  let affected = 0;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const r = await conn.executeMany(sql, rows.slice(i, i + CHUNK), {
      autoCommit: false,
      bindDefs,
    });
    affected += r.rowsAffected || 0;
  }
  return affected;
}

// ── Issues ────────────────────────────────────────────────────
// Every refresh re-sends the whole dataset, and nearly all of it is unchanged.
// The WHERE on the matched branch skips rows whose values are identical, so an
// unchanged ticket costs a read instead of an UPDATE — no undo/redo, nothing
// for archive logs on DBSRV. DECODE compares NULLs as equal (a plain <> would
// treat NULL vs NULL as "changed" and rewrite the row). FETCHED_AT therefore
// means "last changed", not "last seen".
//
// The ON clause is NULL-safe for the same reason: Oracle stores '' as NULL, so
// a ticket with no sprint never matched its own row, fell through to INSERT,
// and hit UQ_ISSUE_KEY_SPRINT — failing the entire save on every refresh after
// the first.
const ISSUE_MERGE = `
  MERGE INTO SAD_ISSUES tgt
  USING (SELECT :key AS ISSUE_KEY, :sprint AS SPRINT_NAME FROM DUAL) src
  ON (tgt.ISSUE_KEY = src.ISSUE_KEY AND DECODE(tgt.SPRINT_NAME, src.SPRINT_NAME, 1, 0) = 1)
  WHEN MATCHED THEN UPDATE SET
    SUMMARY       = :summary,
    ISSUE_TYPE    = :type,
    STATUS        = :status,
    ASSIGNEE      = :assignee,
    PROJECT_KEY   = :projectKey,
    PROJECT_NAME  = :projectName,
    STORY_POINTS  = :sp,
    ORIGINAL_EST  = :est,
    PRIORITY      = :priority,
    FETCHED_AT    = SYSTIMESTAMP
  WHERE DECODE(tgt.SUMMARY,      :summary,     0, 1) = 1
     OR DECODE(tgt.ISSUE_TYPE,   :type,        0, 1) = 1
     OR DECODE(tgt.STATUS,       :status,      0, 1) = 1
     OR DECODE(tgt.ASSIGNEE,     :assignee,    0, 1) = 1
     OR DECODE(tgt.PROJECT_KEY,  :projectKey,  0, 1) = 1
     OR DECODE(tgt.PROJECT_NAME, :projectName, 0, 1) = 1
     OR DECODE(tgt.STORY_POINTS, :sp,          0, 1) = 1
     OR DECODE(tgt.ORIGINAL_EST, :est,         0, 1) = 1
     OR DECODE(tgt.PRIORITY,     :priority,    0, 1) = 1
  WHEN NOT MATCHED THEN INSERT
    (ISSUE_KEY, SUMMARY, ISSUE_TYPE, STATUS, ASSIGNEE,
     PROJECT_KEY, PROJECT_NAME, SPRINT_NAME, STORY_POINTS,
     ORIGINAL_EST, PRIORITY, FETCHED_AT)
  VALUES
    (:key, :summary, :type, :status, :assignee,
     :projectKey, :projectName, :sprint, :sp,
     :est, :priority, SYSTIMESTAMP)`;

const ISSUE_BIND_DEFS = {
  key:         { type: oracledb.STRING, maxSize: 50 },
  summary:     { type: oracledb.STRING, maxSize: 1000 },
  type:        { type: oracledb.STRING, maxSize: 100 },
  status:      { type: oracledb.STRING, maxSize: 100 },
  assignee:    { type: oracledb.STRING, maxSize: 255 },
  projectKey:  { type: oracledb.STRING, maxSize: 50 },
  projectName: { type: oracledb.STRING, maxSize: 255 },
  sprint:      { type: oracledb.STRING, maxSize: 500 },
  sp:          { type: oracledb.NUMBER },
  est:         { type: oracledb.NUMBER },
  priority:    { type: oracledb.STRING, maxSize: 50 },
};

function toIssueBinds(issues) {
  // Collapse duplicate (key, sprint) pairs — the MERGE key — keeping the last
  // occurrence. Saves re-merging the same row several times per save.
  const seen = new Map();
  for (const t of issues) {
    const key    = clamp(t['Issue key'] || t['Key'] || '', 50);
    const sprint = clamp(t['Sprint'] || t['G'] || '', 500);
    if (!key) continue;
    // JSON-encoded pair as the dedupe key — no separator character can
    // collide with a sprint name containing punctuation.
    seen.set(JSON.stringify([key, sprint]), {
      key,
      sprint,
      summary:     clamp(t['Summary'], 1000),
      type:        clamp(t['Issue Type'], 100),
      status:      clamp(t['Status'], 100),
      assignee:    clamp(t['Assignee'] || t['D'], 255),
      projectKey:  clamp(t['Project'] || t['B'], 50),
      projectName: clamp(t['Project'] || t['B'], 255),
      // STORY_POINTS is NUMBER(10,2). Round first, or a derived value like
      // 0.1333 never equals the stored 0.13 and the row is rewritten on every
      // refresh by the change check in ISSUE_MERGE.
      sp:          round2(num(t['Story Points'])),
      est:         num(t['Original Estimate']),
      priority:    clamp(t['Priority'], 50),
    });
  }
  return [...seen.values()];
}

// ── POST /api/db/issues — save Jira data ─────────────────────
router.post('/issues', async (req, res) => {
  try {
    const issues = req.body;
    if (!Array.isArray(issues)) return safeJson(res, { error: "Expected array" }, 400);

    const rows = toIssueBinds(issues);
    if (!rows.length) return safeJson(res, { ok: true, count: 0, merged: 0 });

    const written = await db.withTransaction(conn =>
      executeManyChunked(conn, ISSUE_MERGE, rows, ISSUE_BIND_DEFS)
    );
    // written counts only inserted + changed rows; unchanged rows are skipped.
    safeJson(res, { ok: true, count: issues.length, merged: rows.length, written });
  } catch (err) {
    console.error('DB /issues error:', err);
    errJson(res, err);
  }
});

// ── GET /api/db/issues — load all issues ─────────────────────
router.get('/issues', async (req, res) => {
  try {
    const { sprint } = req.query;
    let sql = `SELECT * FROM SAD_ISSUES`;
    const binds = {};
    if (sprint && sprint !== 'all') {
      sql += ` WHERE SPRINT_NAME = :sprint`;
      binds.sprint = sprint;
    }
    sql += ` ORDER BY SPRINT_NAME, ASSIGNEE, ISSUE_KEY`;
    const result = await db.query(sql, binds);
    // Map back to dashboard format
    const rows = result.rows.map(r => ({
      'Issue key':    r.ISSUE_KEY,
      'Key':          r.ISSUE_KEY,
      'Summary':      r.SUMMARY,
      'Issue Type':   r.ISSUE_TYPE,
      'Status':       r.STATUS,
      'Assignee':     r.ASSIGNEE,
      'D':            r.ASSIGNEE,
      'Project':      r.PROJECT_KEY,
      'B':            r.PROJECT_KEY,
      'Sprint':       r.SPRINT_NAME,
      'G':            r.SPRINT_NAME,
      'Story Points': r.STORY_POINTS,
      'Original Estimate': r.ORIGINAL_EST,
      'Priority':     r.PRIORITY,
    }));
    safeJson(res, rows);
  } catch (err) {
    console.error('DB GET /issues error:', err);
    errJson(res, err);
  }
});

// ── GET /api/db/sprints — distinct sprint names ───────────────
router.get('/sprints', async (req, res) => {
  try {
    const result = await db.query(
      `SELECT DISTINCT SPRINT_NAME FROM SAD_ISSUES WHERE SPRINT_NAME IS NOT NULL ORDER BY SPRINT_NAME DESC`
    );
    safeJson(res, result.rows.map(r => r.SPRINT_NAME));
  } catch (err) {
    errJson(res, err);
  }
});

// ── Settings-style merges ─────────────────────────────────────
// The dashboard re-saves capacity and settings every time it is opened, almost always
// with identical values. Each WHEN MATCHED branch only updates a row whose values
// actually differ, so an unchanged save writes nothing (no undo/redo, no archive log).
//
// CLOB columns cannot use DECODE, so they compare with DBMS_LOB.COMPARE, which returns
// NULL when either side is NULL — hence the explicit NULL cases around it. Oracle stores
// '' as NULL, so an empty string against a NULL column counts as unchanged.
const CAPACITY_MERGE = `
  MERGE INTO SAD_ASSIGNEE_CAPACITY tgt
  USING (SELECT :assignee AS ASSIGNEE FROM DUAL) src
  ON (tgt.ASSIGNEE = src.ASSIGNEE)
  WHEN MATCHED THEN UPDATE SET SPRINT_CAPACITY = :sp, UPDATED_AT = SYSTIMESTAMP
    WHERE tgt.SPRINT_CAPACITY <> :sp
  WHEN NOT MATCHED THEN INSERT (ASSIGNEE, SPRINT_CAPACITY) VALUES (:assignee, :sp)`;

const clobChanged = (col, bind) =>
  `((${col} IS NULL AND ${bind} IS NOT NULL) OR (${col} IS NOT NULL AND ${bind} IS NULL) OR DBMS_LOB.COMPARE(${col}, ${bind}) <> 0)`;

const SETTINGS_MERGE = `
  MERGE INTO SAD_SETTINGS tgt
  USING (SELECT :key AS SETTING_KEY FROM DUAL) src
  ON (tgt.SETTING_KEY = src.SETTING_KEY)
  WHEN MATCHED THEN UPDATE SET SETTING_VALUE = :val, UPDATED_AT = SYSTIMESTAMP
    WHERE ${clobChanged('tgt.SETTING_VALUE', ':val')}
  WHEN NOT MATCHED THEN INSERT (SETTING_KEY, SETTING_VALUE) VALUES (:key, :val)`;

const ROLES_MERGE = `
  MERGE INTO SAD_ROLES tgt
  USING (SELECT :roleId AS ROLE_ID FROM DUAL) src
  ON (tgt.ROLE_ID = src.ROLE_ID)
  WHEN MATCHED THEN UPDATE SET
    TITLE = :title, BULLETS = :bullets, RESPONSIBLE = :responsible,
    SORT_ORDER = :sort, UPDATED_AT = SYSTIMESTAMP
    WHERE DECODE(tgt.TITLE,       :title,       0, 1) = 1
       OR DECODE(tgt.RESPONSIBLE, :responsible, 0, 1) = 1
       OR DECODE(tgt.SORT_ORDER,  :sort,        0, 1) = 1
       OR ${clobChanged('tgt.BULLETS', ':bullets')}
  WHEN NOT MATCHED THEN INSERT
    (ROLE_ID, TITLE, BULLETS, RESPONSIBLE, SORT_ORDER)
  VALUES (:roleId, :title, :bullets, :responsible, :sort)`;

// Bound as CLOB so a value over 4000 characters compares and stores the same way as a
// short one, instead of being sent as a LONG that DBMS_LOB.COMPARE rejects.
const clobBind = v => ({ val: v, type: oracledb.CLOB });

// ── GET/POST /api/db/capacity ─────────────────────────────────
router.get('/capacity', async (req, res) => {
  try {
    const result = await db.query(`SELECT ASSIGNEE, SPRINT_CAPACITY FROM SAD_ASSIGNEE_CAPACITY ORDER BY ASSIGNEE`);
    const caps = {};
    result.rows.forEach(r => { caps[r.ASSIGNEE] = r.SPRINT_CAPACITY; });
    safeJson(res, caps);
  } catch (err) {
    errJson(res, err);
  }
});

router.post('/capacity', async (req, res) => {
  try {
    const caps = req.body; // { assignee: sp, ... }
    const rows = Object.entries(caps || {}).map(([assignee, sp]) => ({
      assignee: clamp(assignee, 255),
      // SPRINT_CAPACITY is NUMBER(10,2); round first or 12.345 never equals the stored 12.35
      sp:       round2(Number(sp) || 16),
    }));
    if (!rows.length) return safeJson(res, { ok: true });

    const written = await db.withTransaction(conn => executeManyChunked(
      conn, CAPACITY_MERGE, rows,
      { assignee: { type: oracledb.STRING, maxSize: 255 }, sp: { type: oracledb.NUMBER } }
    ));
    safeJson(res, { ok: true, count: rows.length, written });
  } catch (err) {
    errJson(res, err);
  }
});

// ── GET/POST /api/db/eligibility ──────────────────────────────
router.get('/eligibility', async (req, res) => {
  try {
    const result = await db.query(`SELECT ASSIGNEE, PROJECT_KEY FROM SAD_ELIGIBILITY ORDER BY ASSIGNEE`);
    const elig = {};
    result.rows.forEach(r => {
      if (!elig[r.ASSIGNEE]) elig[r.ASSIGNEE] = [];
      elig[r.ASSIGNEE].push(r.PROJECT_KEY);
    });
    safeJson(res, elig);
  } catch (err) {
    errJson(res, err);
  }
});

router.post('/eligibility', async (req, res) => {
  try {
    const elig = req.body || {}; // { assignee: [projectKey, ...] }
    const assignees = Object.keys(elig).map(a => ({ assignee: clamp(a, 255) }));
    if (!assignees.length) return safeJson(res, { ok: true });

    const pairs = [];
    for (const [assignee, projects] of Object.entries(elig)) {
      for (const pk of projects || []) {
        pairs.push({ assignee: clamp(assignee, 255), pk: clamp(pk, 50) });
      }
    }

    // Delete-then-insert as before, but as two batched statements inside one
    // transaction instead of 1 + N statements each on its own connection.
    await db.withTransaction(async conn => {
      await executeManyChunked(
        conn,
        `DELETE FROM SAD_ELIGIBILITY WHERE ASSIGNEE = :assignee`,
        assignees,
        { assignee: { type: oracledb.STRING, maxSize: 255 } }
      );
      if (pairs.length) {
        await executeManyChunked(
          conn,
          `INSERT INTO SAD_ELIGIBILITY (ASSIGNEE, PROJECT_KEY) VALUES (:assignee, :pk)`,
          pairs,
          {
            assignee: { type: oracledb.STRING, maxSize: 255 },
            pk:       { type: oracledb.STRING, maxSize: 50 },
          }
        );
      }
    });
    safeJson(res, { ok: true });
  } catch (err) {
    errJson(res, err);
  }
});

// ── GET/POST /api/db/roles ────────────────────────────────────
router.get('/roles', async (req, res) => {
  try {
    const result = await db.query(
      `SELECT ROLE_ID, TITLE, BULLETS, RESPONSIBLE FROM SAD_ROLES ORDER BY SORT_ORDER, ROLE_ID`
    );
    const roles = result.rows.map(r => {
      let bullets = [];
      try { bullets = JSON.parse(r.BULLETS || '[]'); } catch (_) {}
      return {
        id:          r.ROLE_ID,
        title:       r.TITLE,
        bullets,
        responsible: r.RESPONSIBLE || '',
      };
    });
    safeJson(res, roles);
  } catch (err) {
    errJson(res, err);
  }
});

router.post('/roles', async (req, res) => {
  try {
    const roles = Array.isArray(req.body) ? req.body : [];
    if (!roles.length) return safeJson(res, { ok: true });

    // BULLETS is a CLOB, so these stay as individual statements — but they now
    // share one connection and one commit instead of one of each per role.
    let written = 0;
    await db.withTransaction(async conn => {
      for (let i = 0; i < roles.length; i++) {
        const r = roles[i];
        const out = await db.execute(conn, ROLES_MERGE, {
          roleId:      clamp(r.id, 50),
          title:       clamp(r.title, 255),
          bullets:     clobBind(JSON.stringify(r.bullets || [])),
          responsible: clamp(r.responsible, 500),
          sort:        i,
        });
        written += out.rowsAffected;
      }
    });
    safeJson(res, { ok: true, count: roles.length, written });
  } catch (err) {
    errJson(res, err);
  }
});

// ── POST /api/db/allocations — save allocation changes ────────
router.post('/allocations', async (req, res) => {
  try {
    const { sprint, changes } = req.body || {};
    const rows = (changes || []).map(c => ({
      sprint: clamp(sprint, 500),
      key:    clamp(c.id, 50),
      from:   clamp(c.from, 255),
      to:     clamp(c.to, 255),
      sp:     num(c.sp),
    }));
    if (!rows.length) return safeJson(res, { ok: true });

    await db.withTransaction(conn => executeManyChunked(
      conn,
      `INSERT INTO SAD_ALLOCATIONS (SPRINT_NAME, ISSUE_KEY, FROM_ASSIGNEE, TO_ASSIGNEE, STORY_POINTS)
       VALUES (:sprint, :key, :from, :to, :sp)`,
      rows,
      {
        sprint: { type: oracledb.STRING, maxSize: 500 },
        key:    { type: oracledb.STRING, maxSize: 50 },
        from:   { type: oracledb.STRING, maxSize: 255 },
        to:     { type: oracledb.STRING, maxSize: 255 },
        sp:     { type: oracledb.NUMBER },
      }
    ));
    safeJson(res, { ok: true });
  } catch (err) {
    errJson(res, err);
  }
});

// ── GET/POST /api/db/settings ─────────────────────────────────
router.get('/settings', async (req, res) => {
  try {
    const result = await db.query(`SELECT SETTING_KEY, SETTING_VALUE FROM SAD_SETTINGS`);
    const settings = {};
    (result.rows || []).forEach(r => {
      try {
        const parsed = JSON.parse(r.SETTING_VALUE);
        // Only store plain serialisable values
        settings[r.SETTING_KEY] = JSON.parse(JSON.stringify(parsed));
      } catch (_) {
        if (typeof r.SETTING_VALUE === 'string') {
          settings[r.SETTING_KEY] = r.SETTING_VALUE;
        }
      }
    });
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(settings));
  } catch (err) {
    const msg = err && err.message ? String(err.message) : 'Unknown error';
    console.error('Settings GET error:', msg);
    res.status(500).setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: msg }));
  }
});

router.post('/settings', async (req, res) => {
  try {
    const settings = req.body || {};
    const entries = [];
    for (const [key, value] of Object.entries(settings)) {
      try {
        entries.push({
          key: clamp(key, 100),
          val: typeof value === 'string' ? value : JSON.stringify(value),
        });
      } catch (_) { /* skip unserialisable values */ }
    }
    if (!entries.length) return safeJson(res, { ok: true });

    // SETTING_VALUE is a CLOB — kept as individual statements, but on one
    // connection with a single commit.
    let written = 0;
    await db.withTransaction(async conn => {
      for (const { key, val } of entries) {
        const out = await db.execute(conn, SETTINGS_MERGE, { key, val: clobBind(val) });
        written += out.rowsAffected;
      }
    });
    safeJson(res, { ok: true, count: entries.length, written });
  } catch (err) {
    errJson(res, err);
  }
});

// ── GET /api/db/ping — test connection ───────────────────────
router.get('/ping', async (req, res) => {
  try {
    const result = await db.query(`SELECT 'OK' AS STATUS FROM DUAL`);
    safeJson(res, { ok: true, status: result.rows[0].STATUS });
  } catch (err) {
    // 503 rather than 500 when the breaker is holding the line — this is a
    // known-unavailable state, not an unexpected failure.
    const open = err && (err.code === 'DB_CIRCUIT_OPEN' || err.code === 'DB_CIRCUIT_BLOCKED');
    safeJson(res, {
      ok: false,
      circuit: db.circuitStatus(),
      error: String((err && err.message) || err),
    }, open ? 503 : 500);
  }
});

// ── GET /api/db/status — breaker state, for diagnosis ────────
// The original outage was invisible for weeks because every DB error was
// swallowed client-side. This endpoint always answers, so "is the database
// actually working?" has one place to look.
router.get('/status', (req, res) => {
  safeJson(res, db.circuitStatus());
});

// ── POST /api/db/reset-circuit — after fixing credentials ────
// A blocked breaker is deliberately sticky: it will not retry a locked account
// on its own. Call this once the account is unlocked and the password is right,
// or just restart the backend.
router.post('/reset-circuit', (req, res) => {
  safeJson(res, { ok: true, circuit: db.resetCircuit() });
});

// ── GET /api/db/tables — check which SAD_ tables exist ───────
router.get('/tables', async (req, res) => {
  try {
    const result = await db.query(
      `SELECT TABLE_NAME FROM USER_TABLES WHERE TABLE_NAME LIKE 'SAD_%' ORDER BY TABLE_NAME`
    );
    safeJson(res, result.rows.map(r => r.TABLE_NAME));
  } catch (err) {
    errJson(res, err);
  }
});

module.exports = router;
// Exposed so the statements can be checked against the real schema.
module.exports.SQL = { ISSUE_MERGE, CAPACITY_MERGE, SETTINGS_MERGE, ROLES_MERGE };
