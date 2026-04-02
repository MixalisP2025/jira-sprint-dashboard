const express = require('express');
const router  = express.Router();
const db      = require('./oracle');

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

// ── Helper: upsert issues in batches ─────────────────────────
async function upsertIssues(issues) {
  for (const t of issues) {
    await db.query(
      `MERGE INTO SAD_ISSUES tgt
       USING (SELECT :key AS ISSUE_KEY, :sprint AS SPRINT_NAME FROM DUAL) src
       ON (tgt.ISSUE_KEY = src.ISSUE_KEY AND tgt.SPRINT_NAME = src.SPRINT_NAME)
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
       WHEN NOT MATCHED THEN INSERT
         (ISSUE_KEY, SUMMARY, ISSUE_TYPE, STATUS, ASSIGNEE,
          PROJECT_KEY, PROJECT_NAME, SPRINT_NAME, STORY_POINTS,
          ORIGINAL_EST, PRIORITY, FETCHED_AT)
       VALUES
         (:key, :summary, :type, :status, :assignee,
          :projectKey, :projectName, :sprint, :sp,
          :est, :priority, SYSTIMESTAMP)`,
      {
        key:         t['Issue key'] || t['Key'] || '',
        summary:     (t['Summary'] || '').substring(0, 1000),
        type:        t['Issue Type'] || '',
        status:      t['Status'] || '',
        assignee:    t['Assignee'] || t['D'] || '',
        projectKey:  t['Project'] || t['B'] || '',
        projectName: t['Project'] || t['B'] || '',
        sprint:      (t['Sprint'] || t['G'] || '').substring(0, 500),
        sp:          parseFloat(t['Story Points']) || null,
        est:         parseFloat(t['Original Estimate']) || null,
        priority:    t['Priority'] || '',
      }
    );
  }
}

// ── POST /api/db/issues — save Jira data ─────────────────────
router.post('/issues', async (req, res) => {
  try {
    const issues = req.body;
    if (!Array.isArray(issues)) return safeJson(res, { error: "Expected array" }, 400);
    await upsertIssues(issues);
    safeJson(res, { ok: true, count: issues.length });
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
    for (const [assignee, sp] of Object.entries(caps)) {
      await db.query(
        `MERGE INTO SAD_ASSIGNEE_CAPACITY tgt
         USING (SELECT :assignee AS ASSIGNEE FROM DUAL) src
         ON (tgt.ASSIGNEE = src.ASSIGNEE)
         WHEN MATCHED THEN UPDATE SET SPRINT_CAPACITY = :sp, UPDATED_AT = SYSTIMESTAMP
         WHEN NOT MATCHED THEN INSERT (ASSIGNEE, SPRINT_CAPACITY) VALUES (:assignee, :sp)`,
        { assignee, sp: Number(sp) || 16 }
      );
    }
    safeJson(res, { ok: true });
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
    const elig = req.body; // { assignee: [projectKey, ...] }
    // Delete all for these assignees then re-insert
    for (const [assignee, projects] of Object.entries(elig)) {
      await db.query(`DELETE FROM SAD_ELIGIBILITY WHERE ASSIGNEE = :assignee`, { assignee });
      for (const pk of projects) {
        await db.query(
          `INSERT INTO SAD_ELIGIBILITY (ASSIGNEE, PROJECT_KEY) VALUES (:assignee, :pk)`,
          { assignee, pk }
        );
      }
    }
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
    const roles = result.rows.map(r => ({
      id:          r.ROLE_ID,
      title:       r.TITLE,
      bullets:     JSON.parse(r.BULLETS || '[]'),
      responsible: r.RESPONSIBLE || '',
    }));
    safeJson(res, roles);
  } catch (err) {
    errJson(res, err);
  }
});

router.post('/roles', async (req, res) => {
  try {
    const roles = req.body;
    for (let i = 0; i < roles.length; i++) {
      const r = roles[i];
      await db.query(
        `MERGE INTO SAD_ROLES tgt
         USING (SELECT :roleId AS ROLE_ID FROM DUAL) src
         ON (tgt.ROLE_ID = src.ROLE_ID)
         WHEN MATCHED THEN UPDATE SET
           TITLE = :title, BULLETS = :bullets, RESPONSIBLE = :responsible,
           SORT_ORDER = :sort, UPDATED_AT = SYSTIMESTAMP
         WHEN NOT MATCHED THEN INSERT
           (ROLE_ID, TITLE, BULLETS, RESPONSIBLE, SORT_ORDER)
         VALUES (:roleId, :title, :bullets, :responsible, :sort)`,
        {
          roleId:      r.id,
          title:       r.title,
          bullets:     JSON.stringify(r.bullets || []),
          responsible: r.responsible || '',
          sort:        i,
        }
      );
    }
    safeJson(res, { ok: true });
  } catch (err) {
    errJson(res, err);
  }
});

// ── POST /api/db/allocations — save allocation changes ────────
router.post('/allocations', async (req, res) => {
  try {
    const { sprint, changes } = req.body;
    for (const c of changes) {
      await db.query(
        `INSERT INTO SAD_ALLOCATIONS (SPRINT_NAME, ISSUE_KEY, FROM_ASSIGNEE, TO_ASSIGNEE, STORY_POINTS)
         VALUES (:sprint, :key, :from, :to, :sp)`,
        { sprint: sprint || '', key: c.id, from: c.from || '', to: c.to || '', sp: c.sp || null }
      );
    }
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
    const settings = req.body;
    for (const [key, value] of Object.entries(settings)) {
      let val;
      try {
        val = typeof value === 'string' ? value : JSON.stringify(value);
      } catch (_) {
        continue; // skip unserializable values
      }
      await db.query(
        `MERGE INTO SAD_SETTINGS tgt
         USING (SELECT :key AS SETTING_KEY FROM DUAL) src
         ON (tgt.SETTING_KEY = src.SETTING_KEY)
         WHEN MATCHED THEN UPDATE SET SETTING_VALUE = :val, UPDATED_AT = SYSTIMESTAMP
         WHEN NOT MATCHED THEN INSERT (SETTING_KEY, SETTING_VALUE) VALUES (:key, :val)`,
        { key, val }
      );
    }
    safeJson(res, { ok: true });
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
    errJson(res, err);
  }
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


