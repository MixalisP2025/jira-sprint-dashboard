// Changelog retrieval, in two implementations behind one shape.
//
// Bulk path: POST /rest/api/3/changelog/bulkfetch (Jira Cloud). Collapses hundreds of
// per-issue reads into a handful of calls.
// Fallback: GET /rest/api/3/issue/{key}/changelog per issue — Cloud-only endpoints return
// 404 on Server/Data Center, so the old path stays as a safety net.
//
// Dependencies are injected so this can be exercised against a stub Jira in tests.

const CHANGELOG_FIELDS = ['status', 'assignee'];
const BULK_ISSUES_PER_CALL = 1000;   // Jira's documented cap on issueIdsOrKeys
const KEY_LOOKUP_CHUNK = 100;        // keeps `key in (...)` inside JQL's practical limit
const MAX_PAGES = 200;               // pagination guard

/** Collapse change histories into the compact {status, assignee} shape callers consume. */
function collectHistories(histories, into) {
  for (const h of histories || []) {
    const t = h.created;
    for (const it of (h.items || [])) {
      if (it.field === 'status' || it.fieldId === 'status') into.status.push({ t, from: it.fromString, to: it.toString });
      else if (it.field === 'assignee' || it.fieldId === 'assignee') into.assignee.push({ t, from: it.fromString, to: it.toString });
    }
  }
  return into;
}

/**
 * bulkfetch identifies issues by numeric issueId, but every caller here speaks in keys.
 * Resolve both directions up front — one search per 100 keys.
 */
async function resolveKeyIds({ axios, baseUrl, headers, keys, counter }) {
  const idToKey = new Map();
  const keyToId = new Map();
  for (let i = 0; i < keys.length; i += KEY_LOOKUP_CHUNK) {
    const chunk = keys.slice(i, i + KEY_LOOKUP_CHUNK);
    counter.calls += 1;
    const r = await axios.get(`${baseUrl}/rest/api/3/search/jql`, {
      headers,
      params: { jql: `key in (${chunk.join(',')})`, fields: 'id', maxResults: chunk.length },
      timeout: 30000,
    });
    for (const issue of (r.data.issues || [])) {
      if (issue.id && issue.key) { idToKey.set(String(issue.id), issue.key); keyToId.set(issue.key, String(issue.id)); }
    }
  }
  return { idToKey, keyToId };
}

async function fetchChangelogsBulk({ axios, baseUrl, headers, keys, counter, log = () => {} }) {
  const { idToKey, keyToId } = await resolveKeyIds({ axios, baseUrl, headers, keys, counter });
  const ids = keys.map(k => keyToId.get(k)).filter(Boolean);
  if (!ids.length) throw new Error('could not resolve any issue ids for bulkfetch');

  const byKey = new Map();
  const ensure = key => {
    if (!byKey.has(key)) byKey.set(key, { key, status: [], assignee: [] });
    return byKey.get(key);
  };

  for (let i = 0; i < ids.length; i += BULK_ISSUES_PER_CALL) {
    const batch = ids.slice(i, i + BULK_ISSUES_PER_CALL);
    let nextPageToken = null;
    let pages = 0;
    do {
      counter.calls += 1;
      const body = { issueIdsOrKeys: batch, fieldIds: CHANGELOG_FIELDS, maxResults: 1000 };
      if (nextPageToken) body.nextPageToken = nextPageToken;
      const r = await axios.post(`${baseUrl}/rest/api/3/changelog/bulkfetch`, body, {
        headers: { ...headers, 'Content-Type': 'application/json' },
        timeout: 60000,
      });
      for (const entry of (r.data.issueChangeLogs || [])) {
        // prefer a key when the payload carries one; otherwise map back from issueId
        const key = entry.key || entry.issueKey || idToKey.get(String(entry.issueId));
        if (!key) continue;
        collectHistories(entry.changeHistories, ensure(key));
      }
      nextPageToken = r.data.nextPageToken || null;
    } while (nextPageToken && ++pages < MAX_PAGES);
    if (nextPageToken) log(`[jira] changelog bulkfetch stopped after ${MAX_PAGES} pages with more remaining — history for this batch may be incomplete`);
  }

  // an issue with no status/assignee history still needs an entry, or callers read it as missing
  for (const k of keys) if (keyToId.has(k)) ensure(k);
  return { changelogs: [...byKey.values()], unresolved: keys.filter(k => !keyToId.has(k)) };
}

async function fetchChangelogsPerIssue({ axios, baseUrl, headers, keys, counter, mapLimit }) {
  const changelogs = [];
  const errors = [];
  await mapLimit(keys, 6, async (key) => {
    try {
      let startAt = 0; let total = Infinity;
      const acc = { status: [], assignee: [] };
      while (startAt < total) {
        counter.calls += 1;
        const r = await axios.get(`${baseUrl}/rest/api/3/issue/${encodeURIComponent(key)}/changelog`, { headers, params: { startAt, maxResults: 100 }, timeout: 30000 });
        const vals = r.data.values || [];
        total = Number.isFinite(r.data.total) ? r.data.total : vals.length;
        collectHistories(vals, acc);
        startAt += vals.length;
        if (!vals.length) break;
      }
      changelogs.push({ key, status: acc.status, assignee: acc.assignee });
    } catch (e) {
      errors.push({ key, message: e.response?.status ? `HTTP ${e.response.status}` : e.message });
    }
  });
  return { changelogs, errors };
}

/** Bulk when available, per-issue when not. Never throws for an unavailable bulk endpoint. */
async function fetchChangelogs({ axios, baseUrl, headers, keys, mapLimit, bulkEnabled = true, log = () => {} }) {
  const counter = { calls: 0 };
  if (bulkEnabled) {
    let out;
    try {
      out = await fetchChangelogsBulk({ axios, baseUrl, headers, keys, counter, log });
    } catch (e) {
      const fallbackReason = e.response?.status ? `HTTP ${e.response.status}` : e.message;
      log(`[jira] changelog bulkfetch unavailable (${fallbackReason}) — falling back to per-issue`);
      counter.calls = 0;
      const perIssue = await fetchChangelogsPerIssue({ axios, baseUrl, headers, keys, counter, mapLimit });
      return { ...perIssue, jiraCalls: counter.calls, method: 'per-issue', fallbackReason };
    }
    // A key search does not return an issue under a key it has since moved away from
    // (`key in (OLD-1)` comes back as NEW-1), so those keys never resolve to an id. The
    // per-issue endpoint follows the old key, so fetch just those one by one.
    let errors = [];
    let changelogs = out.changelogs;
    if (out.unresolved.length) {
      const rest = await fetchChangelogsPerIssue({ axios, baseUrl, headers, keys: out.unresolved, counter, mapLimit });
      changelogs = changelogs.concat(rest.changelogs);
      errors = rest.errors;
    }
    return { changelogs, errors, jiraCalls: counter.calls, method: 'bulkfetch', fallbackReason: null };
  }
  const out = await fetchChangelogsPerIssue({ axios, baseUrl, headers, keys, counter, mapLimit });
  return { ...out, jiraCalls: counter.calls, method: 'per-issue', fallbackReason: null };
}

module.exports = {
  collectHistories, resolveKeyIds, fetchChangelogsBulk, fetchChangelogsPerIssue, fetchChangelogs,
  CHANGELOG_FIELDS, BULK_ISSUES_PER_CALL, KEY_LOOKUP_CHUNK,
};
