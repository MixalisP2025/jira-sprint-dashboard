import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { collectHistories, fetchChangelogs, fetchChangelogsBulk, KEY_LOOKUP_CHUNK } = require('../../server/jiraChangelogs.js');

// A stub Jira. Records every call so the whole point of this change — call count —
// is asserted rather than assumed.
function makeJira({ histories = {}, bulkStatus = null, pageSize = Infinity, echoKey = false }) {
  const calls = { search: 0, bulk: 0, perIssue: 0, bodies: [] };
  const keyToId = Object.fromEntries(Object.keys(histories).map((k, i) => [k, String(10000 + i)]));
  const idToKey = Object.fromEntries(Object.entries(keyToId).map(([k, v]) => [v, k]));

  const axios = {
    async get(url, cfg) {
      if (url.includes('/search/jql')) {
        calls.search += 1;
        const jql = cfg.params.jql;
        const wanted = jql.slice(jql.indexOf('(') + 1, jql.lastIndexOf(')')).split(',').map(s => s.trim());
        return { data: { issues: wanted.filter(k => keyToId[k]).map(k => ({ id: keyToId[k], key: k })) } };
      }
      if (url.includes('/changelog')) {
        calls.perIssue += 1;
        const key = decodeURIComponent(url.split('/issue/')[1].split('/')[0]);
        const vals = histories[key] || [];
        return { data: { values: vals, total: vals.length } };
      }
      throw new Error(`unexpected GET ${url}`);
    },
    async post(url, body) {
      if (!url.includes('/changelog/bulkfetch')) throw new Error(`unexpected POST ${url}`);
      calls.bulk += 1;
      calls.bodies.push(body);
      if (bulkStatus) { const e = new Error(`HTTP ${bulkStatus}`); e.response = { status: bulkStatus }; throw e; }
      const ids = body.issueIdsOrKeys;
      const start = body.nextPageToken ? parseInt(body.nextPageToken, 10) : 0;
      const slice = ids.slice(start, start === Infinity ? undefined : start + pageSize);
      const issueChangeLogs = slice.map(id => {
        const key = idToKey[id];
        const entry = { issueId: id, changeHistories: histories[key] || [] };
        if (echoKey) entry.key = key;
        return entry;
      });
      const nextStart = start + slice.length;
      return { data: { issueChangeLogs, nextPageToken: nextStart < ids.length ? String(nextStart) : null } };
    },
  };
  return { axios, calls };
}

const mapLimit = async (items, limit, fn) => {
  const out = [];
  for (let i = 0; i < items.length; i += limit) out.push(...await Promise.all(items.slice(i, i + limit).map(fn)));
  return out;
};

const H = (created, field, from, to) => ({ created, items: [{ field, fromString: from, toString: to }] });
const HISTORIES = {
  'A-1': [H('2026-07-01T10:00:00.000+03:00', 'status', 'To Do', 'In Progress'), H('2026-07-05T10:00:00.000+03:00', 'status', 'In Progress', 'Done')],
  'A-2': [H('2026-07-02T10:00:00.000+03:00', 'assignee', 'Sotirios', 'Giorgos')],
  'A-3': [],
};
const KEYS = ['A-1', 'A-2', 'A-3'];
const run = (jira, over = {}) => fetchChangelogs({
  axios: jira.axios, baseUrl: 'https://x.atlassian.net', headers: {}, keys: KEYS, mapLimit, ...over,
});

describe('collectHistories', () => {
  it('splits status and assignee changes and keeps the timestamp', () => {
    const out = collectHistories(HISTORIES['A-1'], { status: [], assignee: [] });
    expect(out.status).toEqual([
      { t: '2026-07-01T10:00:00.000+03:00', from: 'To Do', to: 'In Progress' },
      { t: '2026-07-05T10:00:00.000+03:00', from: 'In Progress', to: 'Done' },
    ]);
    expect(out.assignee).toEqual([]);
  });

  it('accepts fieldId as well as field', () => {
    const out = collectHistories([{ created: 't', items: [{ fieldId: 'assignee', fromString: 'a', toString: 'b' }] }], { status: [], assignee: [] });
    expect(out.assignee).toHaveLength(1);
  });

  it('ignores fields we do not track', () => {
    const out = collectHistories([{ created: 't', items: [{ field: 'description', fromString: 'a', toString: 'b' }] }], { status: [], assignee: [] });
    expect(out.status).toEqual([]); expect(out.assignee).toEqual([]);
  });
});

describe('bulkfetch path', () => {
  it('returns the same shape as the per-issue path', async () => {
    const bulk = await run(makeJira({ histories: HISTORIES }));
    const perIssue = await run(makeJira({ histories: HISTORIES }), { bulkEnabled: false });
    const norm = r => [...r.changelogs].sort((a, b) => a.key.localeCompare(b.key));
    expect(norm(bulk)).toEqual(norm(perIssue));
  });

  it('collapses the call count — the reason for the change', async () => {
    const jira = makeJira({ histories: HISTORIES });
    const out = await run(jira);
    expect(out.method).toBe('bulkfetch');
    expect(jira.calls.perIssue).toBe(0);
    expect(jira.calls.search).toBe(1);        // one key→id lookup
    expect(jira.calls.bulk).toBe(1);          // one changelog call for all issues
    expect(out.jiraCalls).toBe(2);
  });

  it('beats the per-issue path decisively at scale', async () => {
    const many = Object.fromEntries(Array.from({ length: 250 }, (_, i) => [`B-${i}`, [H('2026-07-01T10:00:00Z', 'status', 'To Do', 'Done')]]));
    const keys = Object.keys(many);
    const bulkJira = makeJira({ histories: many });
    const perJira = makeJira({ histories: many });
    const bulk = await fetchChangelogs({ axios: bulkJira.axios, baseUrl: 'x', headers: {}, keys, mapLimit });
    const per = await fetchChangelogs({ axios: perJira.axios, baseUrl: 'x', headers: {}, keys, mapLimit, bulkEnabled: false });
    expect(bulk.jiraCalls).toBeLessThan(per.jiraCalls / 20);
    expect(bulk.changelogs).toHaveLength(250);
    expect(per.changelogs).toHaveLength(250);
    // key lookups chunk at 100, so 250 keys cost 3 searches + 1 bulk page
    expect(bulkJira.calls.search).toBe(Math.ceil(250 / KEY_LOOKUP_CHUNK));
  });

  it('maps issueId back to the issue key', async () => {
    const out = await run(makeJira({ histories: HISTORIES }));
    expect(out.changelogs.map(c => c.key).sort()).toEqual(['A-1', 'A-2', 'A-3']);
    expect(out.changelogs.find(c => c.key === 'A-1').status).toHaveLength(2);
    expect(out.changelogs.find(c => c.key === 'A-2').assignee).toHaveLength(1);
  });

  it('uses an echoed key when the payload provides one', async () => {
    const out = await run(makeJira({ histories: HISTORIES, echoKey: true }));
    expect(out.changelogs.map(c => c.key).sort()).toEqual(['A-1', 'A-2', 'A-3']);
  });

  it('emits an entry for an issue with no tracked history', async () => {
    const out = await run(makeJira({ histories: HISTORIES }));
    const a3 = out.changelogs.find(c => c.key === 'A-3');
    expect(a3).toEqual({ key: 'A-3', status: [], assignee: [] });
  });

  it('follows nextPageToken to the end', async () => {
    const jira = makeJira({ histories: HISTORIES, pageSize: 1 });
    const out = await run(jira);
    expect(jira.calls.bulk).toBe(3);
    expect(out.changelogs).toHaveLength(3);
  });

  it('requests only the fields it needs', async () => {
    const jira = makeJira({ histories: HISTORIES });
    await run(jira);
    expect(jira.calls.bodies[0].fieldIds).toEqual(['status', 'assignee']);
  });

  it('reports keys it could not resolve rather than dropping them silently', async () => {
    const jira = makeJira({ histories: { 'A-1': [] } });
    const out = await fetchChangelogs({ axios: jira.axios, baseUrl: 'x', headers: {}, keys: ['A-1', 'GONE-9'], mapLimit });
    expect(out.errors).toEqual([{ key: 'GONE-9', message: 'issue id could not be resolved' }]);
    expect(out.changelogs.map(c => c.key)).toEqual(['A-1']);
  });
});

describe('fallback when bulkfetch is unavailable', () => {
  it('falls back to per-issue on 404 (Server / Data Center)', async () => {
    const jira = makeJira({ histories: HISTORIES, bulkStatus: 404 });
    const out = await run(jira);
    expect(out.method).toBe('per-issue');
    expect(out.fallbackReason).toBe('HTTP 404');
    expect(jira.calls.perIssue).toBe(3);
    expect(out.changelogs).toHaveLength(3);
  });

  it('falls back on any other bulk failure too', async () => {
    const out = await run(makeJira({ histories: HISTORIES, bulkStatus: 500 }));
    expect(out.method).toBe('per-issue');
    expect(out.changelogs).toHaveLength(3);
  });

  it('does not count the abandoned bulk attempt in the reported call total', async () => {
    const out = await run(makeJira({ histories: HISTORIES, bulkStatus: 404 }));
    expect(out.jiraCalls).toBe(3);      // three per-issue reads, not the failed bulk attempt
  });

  it('honours bulkEnabled=false without trying bulk at all', async () => {
    const jira = makeJira({ histories: HISTORIES });
    const out = await run(jira, { bulkEnabled: false });
    expect(jira.calls.bulk).toBe(0);
    expect(out.method).toBe('per-issue');
    expect(out.fallbackReason).toBeNull();
  });

  it('still reports per-issue errors individually', async () => {
    const jira = makeJira({ histories: HISTORIES, bulkStatus: 404 });
    const broken = { ...jira.axios, get: async (url, cfg) => {
      if (url.includes('/issue/A-2/')) { const e = new Error('boom'); e.response = { status: 403 }; throw e; }
      return jira.axios.get(url, cfg);
    } };
    const out = await fetchChangelogs({ axios: broken, baseUrl: 'x', headers: {}, keys: KEYS, mapLimit });
    expect(out.errors).toEqual([{ key: 'A-2', message: 'HTTP 403' }]);
    expect(out.changelogs).toHaveLength(2);
  });
});

describe('bulkfetch guards', () => {
  it('throws rather than looping when no id resolves, so the caller can fall back', async () => {
    const jira = makeJira({ histories: {} });
    await expect(fetchChangelogsBulk({ axios: jira.axios, baseUrl: 'x', headers: {}, keys: ['Z-1'], counter: { calls: 0 } }))
      .rejects.toThrow(/could not resolve any issue ids/);
  });
});
