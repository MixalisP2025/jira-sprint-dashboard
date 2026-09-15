// Daily delivery note — the operational read, deliberately separate from the analyst panels.
//
// Current sprint only. Volume and status, never rates. Nothing here is normalised, windowed,
// or compared between people: a line earns its place only if somebody can act on it today.

import { workingDaysBetween, workingDaysInclusive, previousWorkingDayKey, dayKeyToDate, zonedDayKey, REPORT_TZ } from './workingDays';
import { getKey, getSP, getStatus, getAssignee, getResolved, getStart, getCreated, isDone, isTodoName } from './teamEngine';

// Default only. At the logging completeness this team runs at, "no worklog" is weak
// evidence of inactivity — if the list comes back full of work that is plainly moving,
// raise this rather than trusting it.
export const STALL_DAYS_DEFAULT = 3;
export const STALL_DAYS_KEY = 'tt_stallDays';
export const AGING_DAYS = 20;             // matches the analyst panel's stale threshold
export const DAILY_SNAPSHOT_KEY = 'tt_dailySnapshot';

export function loadStallDays() {
  try { const v = parseInt(localStorage.getItem(STALL_DAYS_KEY), 10); return Number.isFinite(v) && v >= 1 && v <= 15 ? v : STALL_DAYS_DEFAULT; }
  catch { return STALL_DAYS_DEFAULT; }
}
export function saveStallDays(v) {
  try { localStorage.setItem(STALL_DAYS_KEY, String(v)); } catch { /* private mode */ }
}

const getSummary = t => t['Summary'] || t['Issue summary'] || '';
const isBlockedStatus = s => /block|impediment|on[\s-]?hold|waiting/i.test(s || '');

/** The sprint in flight: the one today falls inside, else the one Jira marks active. */
export function findCurrentSprint(windows = [], today = new Date()) {
  const live = windows.find(w => w.start <= today && today <= w.end);
  if (live) return live;
  const active = windows.find(w => String(w.state || '').toLowerCase() === 'active');
  if (active) return active;
  // nothing running — fall back to the most recently finished, and say so
  const past = windows.filter(w => w.end < today).sort((a, b) => b.end - a.end);
  return past[0] || null;
}

/**
 * Everything the daily note prints, in one pass.
 * `prev` is yesterday's snapshot: { date, aging, unassigned } or null.
 */
export function computeDailyNote({
  sprintTickets = [], allScoped = [], sprint, worklog = null, changelog = null,
  today = new Date(), prev = null, deriveChangelog, stallDays = STALL_DAYS_DEFAULT, tz = REPORT_TZ,
}) {
  const todayKey = zonedDayKey(today, tz);
  const yesterdayKey = previousWorkingDayKey(today, tz);
  const yesterday = dayKeyToDate(yesterdayKey);
  const worklogsOf = key => (worklog && worklog.get(key)) || [];

  // ── 2. Where the sprint stands ──
  let committedSP = 0, committedTickets = 0, doneSP = 0, doneTickets = 0;
  for (const t of sprintTickets) {
    const sp = getSP(t);
    committedSP += sp; committedTickets += 1;
    if (isDone(getStatus(t))) { doneSP += sp; doneTickets += 1; }
  }
  const totalDays = sprint ? workingDaysInclusive(sprint.start, sprint.end) : 0;
  // day 1 is the first working day of the sprint, and the sprint cannot be on day 11 of 10
  const dayOfSprint = sprint ? Math.min(Math.max(workingDaysInclusive(sprint.start, today < sprint.end ? today : sprint.end), 1), totalDays) : 0;
  const pctElapsed = totalDays > 0 ? dayOfSprint / totalDays : null;
  const pctDone = committedSP > 0 ? doneSP / committedSP : null;
  // project on THIS sprint's own rate, not the trailing window
  const ratePerDay = dayOfSprint > 0 ? doneSP / dayOfSprint : null;
  const projectedSP = ratePerDay != null ? ratePerDay * totalDays : null;

  // ── 3. Moved in the last working day ──
  // Compared on the Athens civil date of the event, not its UTC date — an event at 01:00
  // Athens belongs to that day, even though UTC still calls it the day before.
  const movedOn = d => (d ? zonedDayKey(d, tz) === yesterdayKey : false);
  const movedDone = [], movedStarted = [];
  for (const t of sprintTickets) {
    const cld = (changelog && deriveChangelog && changelog.get(getKey(t)))
      ? deriveChangelog(changelog.get(getKey(t)), getAssignee(t), getCreated(t)) : null;
    const doneAt = cld?.activeTo || getResolved(t);
    const startedAt = cld?.activeFrom || getStart(t);
    const row = { key: getKey(t), summary: getSummary(t), assignee: getAssignee(t), sp: getSP(t) };
    if (isDone(getStatus(t)) && movedOn(doneAt)) movedDone.push(row);
    else if (movedOn(startedAt) && !isTodoName(getStatus(t)) && !isDone(getStatus(t))) movedStarted.push(row);
  }

  // ── 4. Not moving ──
  const lastTouch = t => {
    let latest = null;
    for (const w of worklogsOf(getKey(t))) {
      const d = w.started ? new Date(w.started) : null;
      if (d && !isNaN(d) && (!latest || d > latest)) latest = d;
    }
    const cld = (changelog && deriveChangelog && changelog.get(getKey(t)))
      ? deriveChangelog(changelog.get(getKey(t)), getAssignee(t), getCreated(t)) : null;
    for (const d of (cld?.transitions || [])) { if (d && (!latest || d > latest)) latest = d; }
    if (!latest) { const u = t['Updated'] ? new Date(t['Updated']) : null; if (u && !isNaN(u)) latest = u; }
    return latest;
  };
  const inProgress = sprintTickets.filter(t => { const s = getStatus(t); return !isDone(s) && !isTodoName(s); });
  const stalled = inProgress.map(t => {
    const touched = lastTouch(t);
    return {
      key: getKey(t), summary: getSummary(t), assignee: getAssignee(t), status: getStatus(t),
      daysSince: touched ? workingDaysBetween(touched, today) : null,
      lastTouched: touched,
    };
  }).filter(x => x.daysSince != null && x.daysSince >= stallDays)
    .sort((a, b) => b.daysSince - a.daysSince);

  // ── 5. Blocked ──
  const blocked = inProgress.filter(t => isBlockedStatus(getStatus(t))).map(t => {
    const cld = (changelog && deriveChangelog && changelog.get(getKey(t)))
      ? deriveChangelog(changelog.get(getKey(t)), getAssignee(t), getCreated(t)) : null;
    const since = cld?.blockedSince || null;
    const touched = lastTouch(t);
    return {
      key: getKey(t), summary: getSummary(t), assignee: getAssignee(t), status: getStatus(t),
      daysBlocked: since ? workingDaysBetween(since, today) : null,
      lastTouchedBy: cld?.lastAuthor || getAssignee(t),
      lastTouched: touched,
    };
  }).sort((a, b) => (b.daysBlocked ?? -1) - (a.daysBlocked ?? -1));

  // ── 6 & 7. Aging and unassigned queue, across the whole project scope ──
  let aging = 0, unassigned = 0;
  for (const t of allScoped) {
    const s = getStatus(t);
    if (isDone(s) || isTodoName(s)) continue;
    const from = getStart(t) || getCreated(t);
    const d = from ? new Date(from) : null;
    if (d && !isNaN(d) && workingDaysBetween(d, today) > AGING_DAYS) aging += 1;
    if ((getAssignee(t) || 'Unassigned') === 'Unassigned') unassigned += 1;
  }

  // No stored baseline means there is nothing to compare against — say that rather than
  // implying the figure held steady.
  const agingPrev = prev && Number.isFinite(prev.aging) ? prev.aging : null;
  const unassignedPrev = prev && Number.isFinite(prev.unassigned) ? prev.unassigned : null;

  return {
    generatedAt: today,
    tz, todayKey, stallDays,
    sprint: sprint ? {
      name: sprint.name, start: sprint.start, end: sprint.end,
      dayOfSprint, totalDays, pctElapsed,
      finished: today > sprint.end,
    } : null,
    standing: {
      committedSP, committedTickets, doneSP, doneTickets, pctDone, pctElapsed,
      ratePerDay, projectedSP,
    },
    moved: { done: movedDone, started: movedStarted, on: yesterday, onKey: yesterdayKey },
    stalled,
    blocked,
    aging: { count: aging, prev: agingPrev, delta: agingPrev == null ? null : aging - agingPrev, hasBaseline: agingPrev != null },
    unassigned: { count: unassigned, prev: unassignedPrev, changed: unassignedPrev != null && unassignedPrev !== unassigned, hasBaseline: unassignedPrev != null },
    snapshot: { date: todayKey, aging, unassigned },
  };
}

export function loadSnapshot() {
  try { const raw = localStorage.getItem(DAILY_SNAPSHOT_KEY); return raw ? JSON.parse(raw) : null; }
  catch { return null; }
}
// Only overwrite once the day rolls over, so today's note keeps comparing against yesterday.
export function saveSnapshot(snapshot) {
  try {
    const prev = loadSnapshot();
    if (prev && prev.date === snapshot.date) return;
    localStorage.setItem(DAILY_SNAPSHOT_KEY, JSON.stringify(snapshot));
  } catch { /* private mode */ }
}
