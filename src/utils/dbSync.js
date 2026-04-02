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
export async function pingDB() {
  try {
    const r = await get('/ping');
    return r.ok === true;
  } catch (_) {
    return false;
  }
}
