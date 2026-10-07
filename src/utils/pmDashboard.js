// Pure metrics for the PM Dashboard: the counts a project manager checks daily (priority,
// on hold, overdue, due soon, unassigned, stuck), the project × status matrix, created vs
// resolved per week, and workload per person. Mirrors the Jira "Management" dashboard so
// the two can be read side by side.
import { getStatus, getSP, getAssignee, getProject, getKey, getCreated, getResolved, isDone, isTodoName } from './teamEngine';
import { daysInStatus, isAwaiting } from './sprintReview';
import { zonedDayKey } from './workingDays';

export const STUCK_WORKING_DAYS = 10;
export const DUE_SOON_DAYS = 7;
export const CREATED_RESOLVED_WEEKS = 8;   // well inside the refresh window, so both lines are complete

const PRIORITY_RANK = { highest: 0, high: 1, medium: 2, low: 3, lowest: 4 };
export const getPriority = t => (t['Priority'] || '').trim();
export const priorityRank = t => PRIORITY_RANK[getPriority(t).toLowerCase()] ?? 9;
export const isHighPriority = t => priorityRank(t) <= 1;
export const isOnHold = s => /on[\s-]?hold/i.test(s || '');
export const isUnassigned = t => { const a = getAssignee(t); return !a || a === 'Unassigned'; };
export const isOpen = t => !isDone(getStatus(t));
export const getDue = t => {
  const v = t['Due Date'] || t['Due date'] || t._rawFields?.duedate || '';
  return /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : null;
};

const addDays = (key, n) => { const d = new Date(`${key}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

/**
 * The headline lists. `today` is a YYYY-MM-DD day key (Athens). Overdue = due before
 * today; due soon = due today or within the next 7 days. Stuck counts only work that has
 * started (not To Do, not On Hold — that has its own count) and only where change history
 * gives the real time in status; a created-date guess would flag every old backlog ticket.
 */
export function headlineLists(openRows, { today, changelogs = null, now = new Date() }) {
  const soonEnd = addDays(today, DUE_SOON_DAYS);
  const out = { highest: [], high: [], onHold: [], overdue: [], dueSoon: [], unassigned: [], stuck: [] };
  for (const t of openRows) {
    const p = priorityRank(t);
    if (p === 0) out.highest.push(t);
    if (p === 1) out.high.push(t);
    const status = getStatus(t);
    if (isOnHold(status)) out.onHold.push(t);
    const due = getDue(t);
    if (due && due < today) out.overdue.push(t);
    else if (due && due <= soonEnd) out.dueSoon.push(t);
    if (isUnassigned(t)) out.unassigned.push(t);
    if (changelogs && !isTodoName(status) && !isOnHold(status)) {
      const d = daysInStatus(t, changelogs.get(getKey(t)), now);
      if (d.exact && d.days >= STUCK_WORKING_DAYS) out.stuck.push({ ...t, _daysInStatus: d.days });
    }
  }
  const byPriorityThenDue = (a, b) => priorityRank(a) - priorityRank(b) || (getDue(a) || '9999').localeCompare(getDue(b) || '9999');
  out.highest.sort(byPriorityThenDue); out.high.sort(byPriorityThenDue);
  out.overdue.sort((a, b) => getDue(a).localeCompare(getDue(b)));
  out.dueSoon.sort((a, b) => getDue(a).localeCompare(getDue(b)));
  out.stuck.sort((a, b) => b._daysInStatus - a._daysInStatus);
  return out;
}

// Status columns in workflow order; anything unknown goes after, busiest first.
const STATUS_ORDER = ['to do', 'open', 'in progress', 'in review', 'awaiting testing', 'awaiting versioning', 'on hold', 'parking lot'];

/** Project × status counts for open work, projects busiest first, as in Jira's two-dimensional gadget. */
export function statusMatrix(openRows) {
  const byProject = new Map();
  const colTotals = new Map();
  for (const t of openRows) {
    const project = getProject(t); const status = getStatus(t) || '(none)';
    if (!byProject.has(project)) byProject.set(project, new Map());
    const m = byProject.get(project);
    m.set(status, (m.get(status) || 0) + 1);
    colTotals.set(status, (colTotals.get(status) || 0) + 1);
  }
  const rank = s => { const i = STATUS_ORDER.indexOf(s.toLowerCase()); return i < 0 ? STATUS_ORDER.length : i; };
  const columns = [...colTotals.keys()].sort((a, b) => rank(a) - rank(b) || colTotals.get(b) - colTotals.get(a));
  const rows = [...byProject].map(([project, m]) => ({
    project, counts: Object.fromEntries(columns.map(c => [c, m.get(c) || 0])),
    total: [...m.values()].reduce((a, b) => a + b, 0),
  })).sort((a, b) => b.total - a.total);
  return { columns, rows, totals: Object.fromEntries(columns.map(c => [c, colTotals.get(c)])), total: openRows.length };
}

/** Week (Monday) of a timestamp, as a YYYY-MM-DD key in Athens time. */
function weekOf(iso) {
  const key = zonedDayKey(new Date(iso));
  const d = new Date(`${key}T00:00:00Z`);
  const dow = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - dow);
  return d.toISOString().slice(0, 10);
}

/** Created vs resolved per week over the last `weeks` weeks, oldest first. */
export function createdVsResolved(rows, { now = new Date(), weeks = CREATED_RESOLVED_WEEKS } = {}) {
  const thisWeek = weekOf(now.toISOString());
  const keys = Array.from({ length: weeks }, (_, i) => addDays(thisWeek, -7 * (weeks - 1 - i)));
  const buckets = new Map(keys.map(k => [k, { week: k, created: 0, resolved: 0 }]));
  for (const t of rows) {
    const c = getCreated(t); const r = getResolved(t);
    if (c) { const b = buckets.get(weekOf(c)); if (b) b.created++; }
    if (r && isDone(getStatus(t))) { const b = buckets.get(weekOf(r)); if (b) b.resolved++; }
  }
  const list = [...buckets.values()];
  const created = list.reduce((a, b) => a + b.created, 0);
  const resolved = list.reduce((a, b) => a + b.resolved, 0);
  return { weeks: list, created, resolved, net: created - resolved };
}

/**
 * Sprint workload per person from the dashboard's own capacity stats (the figures the
 * Overview and Capacity tabs show), alphabetical — a load list, not a ranking.
 */
export function workloadFromStats(stats, excluded = []) {
  return Object.entries(stats || {})
    // "Unassigned" is not a person with capacity; unassigned work has its own count.
    .filter(([name]) => !excluded.includes(name) && name !== 'Unassigned' && name)
    .map(([name, s]) => ({
      name,
      capacity: s.baseCapacity || 0,
      active: s.activeWorkload || 0,
      awaiting: s.awaitingWorkload || 0,
      done: s.completedWorkload || 0,
      remaining: s.remainingCapacity || 0,
      activeItems: s.activeItems || 0,
      awaitingItems: s.awaitingItems || 0,
      doneItems: s.completedItems || 0,
      status: s.capacityStatus || '',
      utilization: s.baseCapacity > 0 ? (s.activeWorkload / s.baseCapacity) * 100 : null,
    }))
    .filter(p => p.active || p.awaiting || p.done || p.activeItems || p.awaitingItems || p.doneItems)
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** All open work per person (no capacity: it spans sprints and backlog), alphabetical. */
export function openLoadByPerson(openRows, { today }) {
  const m = new Map();
  for (const t of openRows) {
    const name = isUnassigned(t) ? 'Unassigned' : getAssignee(t);
    if (!m.has(name)) m.set(name, { name, items: 0, sp: 0, inProgress: 0, awaiting: 0, overdue: 0, high: 0 });
    const e = m.get(name);
    const status = getStatus(t);
    e.items++; e.sp += getSP(t);
    if (isAwaiting(status)) e.awaiting++;
    else if (!isTodoName(status) && !isOnHold(status)) e.inProgress++;
    const due = getDue(t);
    if (due && due < today) e.overdue++;
    if (isHighPriority(t)) e.high++;
  }
  return [...m.values()].map(e => ({ ...e, sp: Math.round(e.sp * 10) / 10 }))
    .sort((a, b) => (a.name === 'Unassigned') - (b.name === 'Unassigned') || a.name.localeCompare(b.name));
}
