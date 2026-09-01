// Sync dashboard data to/from Oracle via the backend API

const BASE = '/api/db';

async function post(path, data) {
  const res = await fetch(BASE + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

async function get(path) {
  const res = await fetch(BASE + path);
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

// ── Issues ────────────────────────────────────────────────────
export async function saveIssuesToDB(issues) {
  return post('/issues', issues);
}

export async function loadIssuesFromDB(sprint = 'all') {
  const url = sprint && sprint !== 'all' ? `/issues?sprint=${encodeURIComponent(sprint)}` : '/issues';
  return get(url);
}

// ── Capacity ──────────────────────────────────────────────────
export async function saveCapacityToDB(caps) {
  return post('/capacity', caps);
}

export async function loadCapacityFromDB() {
  return get('/capacity');
}

// ── Eligibility ───────────────────────────────────────────────
export async function saveEligibilityToDB(elig) {
  // elig is { assignee: Set([...]) } — convert Sets to arrays
  const plain = Object.fromEntries(
    Object.entries(elig).map(([k, v]) => [k, v instanceof Set ? [...v] : v])
  );
  return post('/eligibility', plain);
}

export async function loadEligibilityFromDB() {
  return get('/eligibility');
}

// ── Roles ─────────────────────────────────────────────────────
export async function saveRolesToDB(roles) {
  return post('/roles', roles);
}

export async function loadRolesFromDB() {
  return get('/roles');
}

// ── Allocations ───────────────────────────────────────────────
export async function saveAllocationsToDB(sprint, changes) {
  return post('/allocations', { sprint, changes });
}

// ── Settings (capacity config, program end date, etc.) ────────
export async function saveSettingsToDB(settings) {
  return post('/settings', settings);
}

export async function loadSettingsFromDB() {
  return get('/settings');
}

// ── Ping ──────────────────────────────────────────────────────
// Result is cached for PING_TTL_MS and concurrent callers share one in-flight
// request. Every component used to ping on mount and before every save, so a
// single page load fired dozens of round trips that told us the same thing.
const PING_TTL_MS = 60_000;
let _pingValue = null;
let _pingAt = 0;
let _pingInFlight = null;

export async function pingDB({ force = false } = {}) {
  const fresh = Date.now() - _pingAt < PING_TTL_MS;
  if (!force && _pingValue !== null && fresh) return _pingValue;
  if (_pingInFlight) return _pingInFlight;

  _pingInFlight = (async () => {
    try {
      const r = await get('/ping');
      _pingValue = r.ok === true;
    } catch {
      _pingValue = false;
    }
    _pingAt = Date.now();
    _pingInFlight = null;
    return _pingValue;
  })();

  return _pingInFlight;
}
