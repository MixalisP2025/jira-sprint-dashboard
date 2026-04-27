const API_BASE = import.meta.env.DEV ? 'http://localhost:4001/api' : '/api';

export const DOMAIN_MAP = {
  'piraeusbank.gr':  'Piraeus Bank',
  'piraeusbank.ro':  'Piraeus Bank',
  'eurobank.gr':     'Eurobank',
  'eurobank.ro':     'Eurobank',
  'alpha.gr':        'Alpha Bank',
  'nbg.gr':          'National Bank of Greece',
  'atticabank.gr':   'Attica Bank',
  'optima.gr':       'Optima Bank',
  'pancretabank.gr': 'Pancreta Bank',
  'timerbank.ai':    'Timer Bank',
  'bankofgreece.gr': 'Bank of Greece',
};

// ─── SLA Engine ───────────────────────────────────────────────────────────────
// Jira SLA API returns empty values for this instance — using manual thresholds.
// Configurable per bank+priority. Update SLA_CONFIG to plug in real agreements.

export const SLA_CONFIG = {
  // Default thresholds by priority (days)
  defaults: { Critical: 7, High: 7, Medium: 14, Low: 30, default: 14 },
  // Per-bank overrides: { bankName: { priority: days } }
  perBank: {
    'Piraeus Bank': { High: 7, Medium: 14 },
    'Eurobank':     { High: 5, Medium: 10 },
  },
};

export function getSLATarget(ticket) {
  const priority = ticket.priority || 'default';
  const bank = ticket.bank || 'Unknown';
  const bankOverrides = SLA_CONFIG.perBank[bank];
  if (bankOverrides && bankOverrides[priority] !== undefined) return bankOverrides[priority];
  return SLA_CONFIG.defaults[priority] ?? SLA_CONFIG.defaults.default;
}

// Returns 'on-track' | 'at-risk' | 'breaching'
export function getSLARisk(ticket) {
  const isClosed = ticket.status === 'Completed' || ticket.status === 'Closed' || ticket.statusCat === 'Done';
  if (isClosed) return 'on-track'; // resolved tickets are always on-track regardless of age
  const target = getSLATarget(ticket);
  const age = ticket.age || 0;
  const pct = age / target;
  if (pct > 1.0) return 'breaching';  // > 100% of SLA elapsed
  if (pct >= 0.7) return 'at-risk';   // 70–100% of SLA elapsed
  return 'on-track';
}

export const SLA_RISK_STYLES = {
  'on-track':  { border: 'border-l-4 border-l-green-500',  badge: 'bg-green-100 text-green-800 border-green-300',  label: 'On Track',  dot: '🟢' },
  'at-risk':   { border: 'border-l-4 border-l-amber-500',  badge: 'bg-amber-100 text-amber-800 border-amber-300',  label: 'At Risk',   dot: '🟡' },
  'breaching': { border: 'border-l-4 border-l-red-500',    badge: 'bg-red-100 text-red-800 border-red-300',        label: 'Breaching', dot: '🔴' },
};

export function deriveBank(reporterEmail) {
  if (!reporterEmail || !reporterEmail.includes('@')) return 'Unknown';
  const domain = reporterEmail.split('@')[1];
  if (!domain) return 'Unknown';
  return DOMAIN_MAP[domain] ?? domain;
}

export function ticketAge(createdDate, now = new Date()) {
  if (!createdDate) return 0;
  return Math.floor((now - new Date(createdDate)) / 86400000);
}

export function isSLABreach(ticket) {
  return (
    ticket.age > 30 &&
    ticket.status !== 'Completed' &&
    ticket.status !== 'Closed' &&
    ticket.statusCat !== 'Done'
  );
}

export function isStale(ticket) {
  if (ticket.status === 'Completed' || ticket.status === 'Closed') return false;
  if (!ticket.updated) return false;
  const daysSinceUpdated = Math.floor((new Date() - new Date(ticket.updated)) / 86400000);
  return daysSinceUpdated > 7;
}

// CSR projects visible in the external Jira
export const CSR_PROJECTS = [
  { key: 'STLU',  name: 'STP to Local UAT' },
  { key: 'SRDII', name: 'SRDII UAT' },
  { key: 'CSR',   name: 'ais-Custody Support' },
  { key: 'SSLM',  name: 'Sett Suite Local Market' },
  { key: 'CPM',   name: 'Custody On-going Project' },
];

const FIELDS = [
  'summary', 'status', 'assignee', 'reporter', 'created', 'updated',
  'priority', 'issuetype', 'project', 'customfield_10010', 'comment',
  'description', 'resolutiondate', 'duedate', 'issuelinks',
  'timetracking', 'aggregatetimespent', 'customfield_10016', 'parent',
].join(',');

async function fetchPage(jql, nextPageToken = null) {
  const params = new URLSearchParams({ jql, fields: FIELDS, maxResults: '100' });
  if (nextPageToken) params.set('nextPageToken', nextPageToken);
  else params.set('startAt', '0');

  const res = await fetch(`${API_BASE}/jira-csr/issues?${params}`);
  if (!res.ok) throw new Error(`CSR API error: ${res.status}`);
  return res.json();
}

async function fetchAllForJql(jql) {
  const all = [];
  let token = null;
  let iter  = 0;
  while (iter < 200) {
    iter++;
    const data = await fetchPage(jql, token);
    all.push(...(data.issues || []));
    if (data.isLast || !data.nextPageToken) break;
    token = data.nextPageToken;
  }
  return all;
}

export async function fetchCSRIssues() {
  const all = [];
  for (const p of CSR_PROJECTS) {
    try {
      const issues = await fetchAllForJql(
        `project = "${p.key}" ORDER BY created DESC`
      );
      all.push(...issues);
    } catch (e) {
      console.warn(`CSR fetch failed for ${p.key}:`, e.message);
    }
  }
  // dedupe by key
  const map = new Map();
  all.forEach(i => { if (!map.has(i.key)) map.set(i.key, i); });
  return Array.from(map.values());
}

// Fetch live SLA breach status for open tickets from Jira Service Desk API
export async function fetchSLABreaches(tickets) {
  const openKeys = tickets
    .filter(t => !['Completed','Closed'].includes(t.status) && t.statusCat !== 'Done')
    .map(t => t.key);
  if (openKeys.length === 0) return {};
  try {
    const res = await fetch(`${API_BASE}/jira-csr/sla-bulk`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ keys: openKeys }),
    });
    if (!res.ok) throw new Error(`SLA bulk fetch failed: ${res.status}`);
    return await res.json();
  } catch (e) {
    console.warn('SLA bulk fetch failed:', e.message);
    return {};
  }
}

export function transformCSRIssue(issue) {
  const f = issue.fields || {};
  const status    = f.status?.name || '';
  const statusCat = f.status?.statusCategory?.name || '';
  const created   = f.created || '';
  const updated   = f.updated || '';
  const reporterEmail = f.reporter?.emailAddress || '';
  const age = ticketAge(created);

  const isClosed = status === 'Completed' || status === 'Closed';
  // isSLABreach will be set after ticket object is built (needs bank+priority for SLA target)
  const daysSinceUpdated = updated
    ? Math.floor((new Date() - new Date(updated)) / 86400000)
    : 0;
  const isStaleVal = !isClosed && daysSinceUpdated > 7;

  // Extract linked internal tickets from issuelinks
  const internalLinks = (f.issuelinks || [])
    .map(link => {
      const linked = link.outwardIssue || link.inwardIssue;
      if (!linked) return null;
      return {
        key:      linked.key,
        summary:  linked.fields?.summary || '',
        status:   linked.fields?.status?.name || '',
        assignee: linked.fields?.assignee?.displayName || 'Unassigned',
        priority: linked.fields?.priority?.name || '',
        linkType: link.type?.name || 'Relates',
      };
    })
    .filter(Boolean);

  const ticket = {
    key:           issue.key,
    summary:       f.summary || '',
    status,
    statusCat,
    assignee:      f.assignee?.displayName || 'Unassigned',
    reporter:      f.reporter?.displayName || reporterEmail || 'Unknown',
    reporterEmail,
    bank:          deriveBank(reporterEmail),
    project:       f.project?.name || f.project?.key || '',
    projectKey:    f.project?.key || '',
    issueType:     f.issuetype?.name || '',
    priority:      f.priority?.name || '',
    created,
    updated,
    resolved:      f.resolutiondate || null,
    due:           f.duedate || null,
    age,
    isSLABreach:   false, // set below after SLA target is known
    isStale:       isStaleVal,
    internalLinks,
    // Time tracking fields
    timeSpent:           f.timetracking?.timeSpent || null,
    timeSpentSeconds:    f.timetracking?.timeSpentSeconds || 0,
    originalEstimate:    f.timetracking?.originalEstimate || null,
    originalEstimateSec: f.timetracking?.originalEstimateSeconds || 0,
    remainingEstimate:   f.timetracking?.remainingEstimate || null,
    aggregateTimeSpent:  f.aggregatetimespent || 0,
    // Story points
    storyPoints:         f.customfield_10016 || null,
    // Parent (epic / support bucket)
    parentKey:           f.parent?.key || null,
    parentSummary:       f.parent?.fields?.summary || null,
  };
  ticket.slaTarget  = getSLATarget(ticket);
  ticket.slaRisk    = getSLARisk(ticket);
  ticket.isSLABreach = ticket.slaRisk === 'breaching';
  return ticket;
}
