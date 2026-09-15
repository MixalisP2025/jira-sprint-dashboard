// Pure metrics engine for the Team Contribution panel.
// Lives outside the component file so the panel can stay a components-only module
// (React fast refresh) and so the arithmetic can be unit-tested directly.
import { workingDaysBetween, workingDaysInclusive, workingDaysList, cycleWorkingDays } from './workingDays';
import { ALLOC_BASIS } from './teamAllocation';

// ─── Capacity-planning constant ───────────────────────────────────────────────
// One definition shared by Time Tracking (where it is edited) and the Executive Summary
// (which judges planning against it) — they previously fell back to 2 and 1.
export const DEFAULT_SP_PER_DAY = 2;
export const SP_PER_DAY_KEY = 'tt_spPerDay';
export function loadPlanningSPPerDay() {
  try { const v = parseFloat(localStorage.getItem(SP_PER_DAY_KEY)); return Number.isFinite(v) && v > 0 ? v : DEFAULT_SP_PER_DAY; }
  catch { return DEFAULT_SP_PER_DAY; }
}

// ─── Accessors ────────────────────────────────────────────────────────────────
export const getStatus   = t => t['Status'] || '';
export const getSP       = t => parseFloat(t['Story Points']) || parseFloat(t['Story points']) || parseFloat(t['Custom field (Story Points)']) || 0;
export const getSprint   = t => t['Sprint'] || t['G'] || '';
export const getAssignee = t => t['Assignee'] || t['D'] || 'Unassigned';
export const getProject  = t => t['Project'] || t['B'] || 'Unknown';
export const getKey      = t => t['Key'] || t['Issue key'] || '';
export const getType     = t => t['Issue Type'] || '';
export const getLoggedSec = t => parseFloat(t['Time Spent']) || 0;
export const getResolved = t => t['Resolved'] || t['Resolution Date'] || t._rawFields?.resolutiondate || null;
export const getCreated  = t => t['Created'] || null;
export const getStart    = t => t['Start date'] || t._rawFields?.customfield_10052 || null;

export const ALLOWED_TYPES = ['story', 'task', 'bug'];
const SEC_PER_HOUR = 3600;
const ROUND_WORKLOG_SECS = new Set([3600, 14400, 28800]); // 1h / 4h / 8h
const normStatus = (s = '') => s.toLowerCase().trim();
export const isDone = s => ['done', 'completed', 'closed', 'resolved'].includes(normStatus(s));
const TODO_NAMES = new Set(['to do', 'to-do', 'todo', 'open', 'backlog', 'new', 'selected for development', 'reopened']);
export const isTodoName = s => TODO_NAMES.has(normStatus(s));
const isBlockedName = s => /block|impediment|on[\s-]?hold|waiting/i.test(s || '');

// Derive exact per-ticket signals from a compact changelog {status:[{t,from,to}], assignee:[{t,from,to}]}
export function deriveChangelog(cl, currentAssignee, createdISO) {
  const statuses = (cl?.status || []).map(x => ({ t: new Date(x.t), from: x.from, to: x.to })).filter(x => !isNaN(x.t)).sort((a, b) => a.t - b.t);
  const assignees = (cl?.assignee || []).map(x => ({ t: new Date(x.t), from: x.from, to: x.to })).filter(x => !isNaN(x.t)).sort((a, b) => a.t - b.t);
  let doneTime = null, firstActive = null, reopened = false, blocked = false, blockedSince = null;
  for (const s of statuses) {
    if (isDone(s.to)) doneTime = s.t;                                   // last transition INTO done
    if (!firstActive && !isTodoName(s.to) && !isDone(s.to)) firstActive = s.t; // first move off the backlog
    if (isDone(s.from) && !isDone(s.to)) reopened = true;              // came back from done
    if (isBlockedName(s.to)) { blocked = true; blockedSince = s.t; }   // latest entry into a blocked status
    if (isBlockedName(s.from) && !isBlockedName(s.to)) blockedSince = null;  // came back out of it
  }
  // every status change, for "has anything happened to this ticket lately"
  const transitions = statuses.map(s => s.t);
  const lastAuthor = assignees.length ? assignees[assignees.length - 1].to : currentAssignee;
  let assigneeAtDone = currentAssignee;
  if (assignees.length) {
    if (doneTime) { let eff = assignees[0].from ?? currentAssignee; for (const a of assignees) { if (a.t <= doneTime) eff = a.to; else break; } assigneeAtDone = eff; }
    else assigneeAtDone = assignees[assignees.length - 1].to;
  }
  assigneeAtDone = assigneeAtDone || 'Unassigned';
  const created = createdISO ? new Date(createdISO) : null;
  const startForCycle = firstActive || (created && !isNaN(created) ? created : null);
  const cycleDays = (startForCycle && doneTime) ? workingDaysBetween(startForCycle, doneTime) : null;
  // startForCycle→doneTime is also the interval the ticket was "in flight", which is what WIP counts.
  return { assigneeAtDone, cycleDays, reopened, blocked, blockedSince, transitions, lastAuthor, activeFrom: startForCycle, activeTo: doneTime };
}

export const f1 = n => (Number.isFinite(n) ? Math.round(n * 10) / 10 : null);
export const f2 = n => (Number.isFinite(n) ? Math.round(n * 100) / 100 : null);
export const pctI = n => (Number.isFinite(n) ? Math.round(n) : null);

// ─── Stats ────────────────────────────────────────────────────────────────────
export function median(arr) { if (!arr.length) return NaN; const s = [...arr].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; }
export function quantile(arr, q) { if (!arr.length) return NaN; const s = [...arr].sort((a, b) => a - b); const pos = (s.length - 1) * q, base = Math.floor(pos), r = pos - base; return s[base + 1] !== undefined ? s[base] + r * (s[base + 1] - s[base]) : s[base]; }
function bootstrapCI(items, statFn, resamples = 2000) {
  const n = items.length; if (n < 2) return [NaN, NaN];
  const stats = [];
  for (let r = 0; r < resamples; r++) { const s = new Array(n); for (let i = 0; i < n; i++) s[i] = items[Math.floor(Math.random() * n)]; const v = statFn(s); if (Number.isFinite(v)) stats.push(v); }
  if (!stats.length) return [NaN, NaN];
  return [quantile(stats, 0.025), quantile(stats, 0.975)];
}

// The end date names the sprint's last working day, so it runs to the end of that day.
// Midnight at its start made the last day read as "sprint has ended" and dropped that
// day's worklogs and completions from every in-sprint check.
export function parseSprintDates(name) {
  const m = name?.match(/(\d{2}-\d{2}-\d{2})\s+to\s+(\d{2}-\d{2}-\d{2})/);
  if (m) {
    const iso = s => { const [d, mo, y] = s.split('-'); return `20${y}-${mo}-${d}`; };
    return { start: new Date(`${iso(m[1])}T00:00:00Z`), end: new Date(`${iso(m[2])}T23:59:59.999Z`) };
  }
  return null;
}
export const shortSprint = name => (name || 'No Sprint').replace(/Sprint\s*/i, 'S').replace(/\s+\d{2}-\d{2}-\d{2}\s+to\s+\d{2}-\d{2}-\d{2}/, '');

// Population rule: every ratio below draws its numerator and denominator from the same
// set of people. "Assessable" = passed the n>=10 gate with an establishable allocation.
// Where an all-contributor figure is also useful it is computed separately and named,
// never blended into the assessable one.
const STALE_WORKING_DAYS = 20;   // an in-progress ticket older than this is a stale queue item
const ACTIVE_WINDOW_DAYS = 5;    // touched within this many working days counts as active

export function computeTeam({ completedTickets, scoped = [], worklog, changelog, availability, excludedSet = new Set(), windowSprints, workingDaysInWindow, windowStart, windowEnd, hoursPerDay, attrSprintOf, windowFor, splitByHours, today, coverage }) {
  const now = today || new Date();
  const worklogsOf = key => (worklog && worklog.get(key)) || [];
  const authorsOf = key => { const s = new Set(); for (const w of worklogsOf(key)) s.add(w.author); return s; };
  const availOf = name => availability?.byName?.get(name) || null;

  const people = {};
  const ensure = name => (people[name] ||= { name, tickets: 0, sp: 0, ticketSPs: [], sizeMix: { Small: 0, Medium: 0, Large: 0 }, sprints: new Set(), sharedSP: 0, carryTickets: 0, cyclePerSP: [], cycleDaysList: [], contributorsPerTicket: [], sec: 0, pointedSec: 0, worklogCount: 0, roundCount: 0, logTickets: new Set(), clTickets: 0, reopenTickets: 0, blockedTickets: 0, ownKeys: new Set(), intervals: [] });

  const allSP = completedTickets.map(getSP);
  const sizeCut = [quantile(allSP, 1 / 3), quantile(allSP, 2 / 3)];
  const sizeBucket = sp => (sp <= sizeCut[0] ? 'Small' : sp <= sizeCut[1] ? 'Medium' : 'Large');

  const spHoursPairs = [];   // [sp, loggedHours] for the estimation-soundness check
  const ledger = [];         // one entry per (ticket, credited person) — drives the by-sprint view

  for (const t of completedTickets) {
    const sp = getSP(t); const key = getKey(t);
    const authors = authorsOf(key);
    const sprint = attrSprintOf(t);
    const cld = changelog && changelog.get(key) ? deriveChangelog(changelog.get(key), getAssignee(t), getCreated(t)) : null;
    const hasCl = !!cld;
    let carry = false;
    if (worklog) { const wins = new Set(); for (const w of worklogsOf(key)) { const win = w.started ? windowFor(w.started) : null; if (win) wins.add(win); } carry = wins.size > 1; }
    else { const raw = t._rawFields || {}; const sf = raw.customfield_10010 || raw.sprint; carry = Array.isArray(sf) && sf.length > 1; }
    const cyc = cld?.cycleDays ?? cycleWorkingDays(getStart(t) || getCreated(t), getResolved(t));
    const wholeAssignee = cld?.assigneeAtDone || getAssignee(t);

    if (worklog && sp > 0) {
      const secs = worklogsOf(key).reduce((a, w) => a + (w.seconds || 0), 0);
      if (secs > 0) spHoursPairs.push([sp, secs / SEC_PER_HOUR]);
    }

    let credit;
    if (splitByHours && worklog && worklogsOf(key).length) {
      const bySec = {}; let tot = 0;
      for (const w of worklogsOf(key)) { bySec[w.author] = (bySec[w.author] || 0) + (w.seconds || 0); tot += w.seconds || 0; }
      credit = tot > 0 ? Object.fromEntries(Object.entries(bySec).map(([nm, s]) => [nm, sp * (s / tot)])) : { [wholeAssignee]: sp };
    } else {
      credit = { [wholeAssignee]: sp };
    }

    for (const [name, creditSP] of Object.entries(credit)) {
      if (excludedSet.has(name)) continue;
      const p = ensure(name);
      p.tickets += 1; p.sp += creditSP; p.ticketSPs.push(creditSP); p.sizeMix[sizeBucket(sp)] += 1;
      p.ownKeys.add(key);
      if (sprint) p.sprints.add(sprint);
      if (authors.size > 1) p.sharedSP += creditSP;
      p.contributorsPerTicket.push(authors.size || 1);
      if (carry) p.carryTickets += 1;
      if (cyc != null) { p.cycleDaysList.push(cyc); if (sp > 0) p.cyclePerSP.push(cyc / sp); }
      if (hasCl) { p.clTickets += 1; if (cld.reopened) p.reopenTickets += 1; if (cld.blocked) p.blockedTickets += 1; }
      if (cld?.activeFrom && cld?.activeTo) p.intervals.push([new Date(cld.activeFrom), new Date(cld.activeTo), key]);
      ledger.push({ key, name, sprint, sp: creditSP, cyc, size: sizeBucket(sp) });
    }
  }

  // ── The in-progress queue as it stands right now ──
  // Counted point-in-time from ticket status, not from the completed-ticket history, so it
  // includes work that has never finished and therefore never enters any cycle-time figure.
  const lastTouch = key => {
    let latest = null;
    for (const w of worklogsOf(key)) { const d = w.started ? new Date(w.started) : null; if (d && !isNaN(d) && (!latest || d > latest)) latest = d; }
    return latest;
  };
  const inProgressItems = [];
  const unassignedItems = [];
  for (const t of scoped) {
    const st = getStatus(t);
    if (isDone(st) || isTodoName(st)) continue;
    const name = getAssignee(t) || 'Unassigned';
    const from = getStart(t) || getCreated(t);
    const a = from ? new Date(from) : null;
    const age = (a && !isNaN(a)) ? workingDaysBetween(a, now) : null;
    const updated = t['Updated'] ? new Date(t['Updated']) : null;
    const touched = lastTouch(getKey(t)) || (updated && !isNaN(updated) ? updated : null);
    const daysSinceTouch = touched ? workingDaysBetween(touched, now) : null;
    const item = {
      key: getKey(t), name, sp: getSP(t), status: st, age,
      daysSinceTouch,
      active: daysSinceTouch != null && daysSinceTouch <= ACTIVE_WINDOW_DAYS,
      stale: age != null && age > STALE_WORKING_DAYS,
      startedAt: a,
    };
    if (name === 'Unassigned') { unassignedItems.push(item); continue; }
    if (excludedSet.has(name)) continue;
    inProgressItems.push(item);
    // an unfinished ticket still occupies its owner's queue for every day it has been open
    const p = ensure(name);
    if (a && !isNaN(a)) p.intervals.push([a, now, getKey(t)]);
  }

  const unassignedAges = unassignedItems.map(i => i.age).filter(Number.isFinite);
  const unassignedBacklog = {
    open: unassignedItems.length,
    sp: unassignedItems.reduce((a, i) => a + (i.sp || 0), 0),
    stale: unassignedItems.filter(i => i.stale).length,
    medianAge: unassignedAges.length ? median(unassignedAges) : null,
    oldest: unassignedItems.filter(i => Number.isFinite(i.age)).sort((a, b) => b.age - a.age)[0] || null,
  };

  // ── hours by worklog author, split pointed vs other ──
  if (worklog) {
    for (const [key, wls] of worklog.entries()) {
      for (const w of wls) {
        if (excludedSet.has(w.author)) continue;
        const d = w.started ? new Date(w.started) : null;
        if (windowStart && windowEnd && (!d || isNaN(d) || d < windowStart || d > windowEnd)) continue;
        const p = ensure(w.author);
        const secs = w.seconds || 0;
        p.sec += secs; p.worklogCount += 1;
        if (p.ownKeys.has(key)) p.pointedSec += secs;
        if (ROUND_WORKLOG_SECS.has(w.seconds)) p.roundCount += 1;
        p.logTickets.add(key);
      }
    }
  }

  // ── Per-person open-queue occupancy, sampled day by day ──
  // This is an average count of tickets sitting in an in-progress status — NOT a measure
  // of how many things someone actively worked on at once.
  const dayCountsOf = name => {
    const p = people[name];
    const byDay = new Map();
    if (!p) return byDay;
    for (const [a0, b0] of p.intervals) {
      if (!a0 || !b0 || isNaN(a0) || isNaN(b0) || b0 < a0) continue;
      const a = windowStart && a0 < windowStart ? windowStart : a0;
      const b = windowEnd && b0 > windowEnd ? windowEnd : b0;
      if (b < a) continue;
      for (const iso of workingDaysList(a, b)) byDay.set(iso, (byDay.get(iso) || 0) + 1);
    }
    return byDay;
  };
  const dayCountCache = new Map();
  const dayCountsFor = name => { if (!dayCountCache.has(name)) dayCountCache.set(name, dayCountsOf(name)); return dayCountCache.get(name); };

  const openWipOf = name => {
    const byDay = dayCountsFor(name);
    if (!byDay.size || !windowSprints.length) return null;
    const avail = availOf(name);
    const means = [];
    for (const w of windowSprints) {
      if (avail && avail.presenceInferred && !avail.presentSprintNames.includes(w.name)) continue;
      const days = workingDaysList(w.start, w.end);
      if (!days.length) continue;
      means.push(days.reduce((a, iso) => a + (byDay.get(iso) || 0), 0) / days.length);
    }
    return means.length ? means.reduce((a, b) => a + b, 0) / means.length : null;
  };

  const names = Object.keys(people).filter(n => !excludedSet.has(n));

  const rows = names.map(nm => {
    const p = people[nm];
    const avail = availOf(nm);
    const allocDays = avail ? avail.availableDays : null;
    const alloc = avail ? avail.allocPct : null;
    const allocUnknown = !avail || !avail.trusted;
    const hours = worklog ? p.sec / SEC_PER_HOUR : null;
    const pointedHours = worklog ? p.pointedSec / SEC_PER_HOUR : null;
    const otherHours = (hours != null && pointedHours != null) ? Math.max(0, hours - pointedHours) : null;
    const unpointedShare = (hours != null && hours > 0 && otherHours != null) ? otherHours / hours : null;
    const capacityHours = allocDays != null ? allocDays * hoursPerDay : null;
    const enoughN = p.tickets >= 10;
    const suppressed = !enoughN || allocUnknown;
    const spPerDay = (!suppressed && allocDays > 0) ? p.sp / allocDays : null;
    const spPerDayCI = (!suppressed && allocDays > 0 && p.ticketSPs.length >= 2)
      ? bootstrapCI(p.ticketSPs, s => s.reduce((a, b) => a + b, 0) / allocDays) : [NaN, NaN];
    const sharedShare = p.sp > 0 ? p.sharedSP / p.sp : null;
    const openNow = inProgressItems.filter(i => i.name === nm);
    // Present the whole window, logging steadily, but almost nothing lands as a pointed
    // ticket — usually means the work is not being captured as tickets at all.
    const presentButQuiet = !!avail && avail.absentCount === 0 && windowSprints.length >= 3
      && p.sprints.size > 0 && p.sprints.size <= Math.ceil(windowSprints.length / 2)
      && (hours == null || hours > 0);
    return {
      name: nm,
      tickets: p.tickets, sp: p.sp, hours, pointedHours, otherHours, unpointedShare,
      hoursPerSP: (hours != null && p.sp > 0) ? hours / p.sp : null,
      worklogCount: worklog ? p.worklogCount : null, sprintsActive: p.sprints.size,
      spPerDay, spPerDayCI, medianSize: p.ticketSPs.length ? median(p.ticketSPs) : null, sizeMix: p.sizeMix,
      shareSP: 0, shareCap: null,
      completeness: (worklog && capacityHours > 0) ? (p.sec / SEC_PER_HOUR) / capacityHours : null,
      roundShare: (worklog && p.worklogCount > 0) ? p.roundCount / p.worklogCount : null,
      worklogsPerTicket: (worklog && p.logTickets.size > 0) ? p.worklogCount / p.logTickets.size : null,
      sharedShare, sharedHigh: sharedShare != null && sharedShare >= 0.40,
      carryoverRate: p.tickets > 0 ? p.carryTickets / p.tickets : null,
      cyclePerSP: p.cyclePerSP.length ? median(p.cyclePerSP) : null,
      cycleDays: p.cycleDaysList.length ? median(p.cycleDaysList) : null,
      openWip: openWipOf(nm),
      openNow: openNow.length, activeNow: openNow.filter(i => i.active).length, staleNow: openNow.filter(i => i.stale).length,
      medianContributors: p.contributorsPerTicket.length ? median(p.contributorsPerTicket) : null,
      reopenRate: p.clTickets > 0 ? p.reopenTickets / p.clTickets : null,
      blockedShare: p.clTickets > 0 ? p.blockedTickets / p.clTickets : null,
      suppressed, allocUnknown, presentButQuiet,
      suppressReason: allocUnknown
        ? (avail && !avail.presenceInferred ? 'no presence signal' : 'allocation unverified')
        : `n=${p.tickets} of 10`,
      allocPct: alloc,
      allocBasis: avail ? avail.allocBasis : 'assumed',
      allocBasisShort: ALLOC_BASIS[avail ? avail.allocBasis : 'assumed']?.short ?? 'assumed full-time',
      basisLabel: avail ? avail.basisLabel : 'assumed full-time — not verified',
      presenceBasis: avail ? avail.presenceBasis : 'assumed',
      presentCount: avail ? avail.presentCount : null,
      absentCount: avail ? avail.absentCount : null,
      sprintCount: windowSprints.length,
      completionOnlySprints: avail ? avail.completionOnlySprints : 0,
      _allocDays: allocDays,
    };
  });

  const assessable = rows.filter(r => !r.suppressed);
  const assessableNames = new Set(assessable.map(r => r.name));
  const teamAllocDays = assessable.reduce((a, r) => a + (r._allocDays || 0), 0);
  const assessableSP = assessable.reduce((a, r) => a + r.sp, 0);
  const assessableTickets = assessable.reduce((a, r) => a + r.tickets, 0);
  const spPerDay = teamAllocDays > 0 ? assessableSP / teamAllocDays : null;

  const totalSP = rows.reduce((a, r) => a + r.sp, 0);
  const totalTickets = rows.reduce((a, r) => a + r.tickets, 0);
  const excludedSP = totalSP - assessableSP;
  const allContribDays = rows.reduce((a, r) => a + (r._allocDays || 0), 0);

  rows.forEach(r => {
    r.shareSP = assessableSP > 0 && !r.suppressed ? r.sp / assessableSP : 0;
    r.shareCap = (!r.suppressed && r._allocDays != null && teamAllocDays > 0) ? r._allocDays / teamAllocDays : null;
  });

  // ── The in-progress queue, over the assessable population only ──
  // Computed here rather than above because it must match the population every other
  // headline figure uses; the same items for everyone shown are reported alongside.
  const queueOver = items => {
    const ages = items.map(i => i.age).filter(Number.isFinite);
    const oldest = items.filter(i => Number.isFinite(i.age)).sort((a, b) => b.age - a.age)[0] || null;
    return {
      open: items.length,
      active: items.filter(i => i.active).length,
      stale: items.filter(i => i.stale).length,
      unknownAge: items.length - ages.length,
      medianAge: ages.length ? median(ages) : null,
      p90Age: ages.length ? quantile(ages, 0.9) : null,
      oldest: oldest ? { key: oldest.key, age: oldest.age, status: oldest.status } : null,
    };
  };
  const queue = {
    ...queueOver(inProgressItems.filter(i => assessableNames.has(i.name))),
    allShown: queueOver(inProgressItems),
    staleThreshold: STALE_WORKING_DAYS,
    activeWindow: ACTIVE_WINDOW_DAYS,
    ageBasis: 'start date, or creation date where no start date is set',
  };

  // ── Team aggregates, each over a single named population ──
  const assessableCycleDays = assessable.flatMap(r => people[r.name].cycleDaysList);
  const assessableCyclePerSP = assessable.flatMap(r => people[r.name].cyclePerSP);
  const assessableTicketSPs = assessable.flatMap(r => people[r.name].ticketSPs);
  const spPerDayMedian = assessable.length ? median(assessable.map(r => r.spPerDay).filter(Number.isFinite)) : null;
  const cyclePerSPMedian = assessableCyclePerSP.length ? median(assessableCyclePerSP) : null;
  const cycleDaysMedian = assessableCycleDays.length ? median(assessableCycleDays) : null;
  const medianTicketSize = assessableTicketSPs.length ? median(assessableTicketSPs) : null;
  const openWips = assessable.map(r => r.openWip).filter(Number.isFinite);
  const openWipMedian = openWips.length ? median(openWips) : null;

  // logged hours — assessable set only, matching the person-day denominator
  const assessableLoggedHours = assessable.reduce((a, r) => a + (r.hours || 0), 0);
  const assessableCapacityHours = teamAllocDays * hoursPerDay;
  const loggingCompleteness = assessableCapacityHours > 0 ? assessableLoggedHours / assessableCapacityHours : null;
  // the same ratio over everyone shown, reported separately and never blended in
  const allLoggedHours = rows.reduce((a, r) => a + (r.hours || 0), 0);
  const allCapacityHours = allContribDays * hoursPerDay;
  const loggingCompletenessAll = allCapacityHours > 0 ? allLoggedHours / allCapacityHours : null;

  const suppressedNames = rows.filter(r => r.suppressed).map(r => r.name);
  const assumedNames = rows.filter(r => r.allocUnknown).map(r => r.name);
  const quietNames = rows.filter(r => r.presentButQuiet).map(r => r.name);
  const basisCounts = rows.reduce((acc, r) => { acc[r.allocBasis] = (acc[r.allocBasis] || 0) + 1; return acc; }, {});
  const presenceAdjusted = rows.filter(r => r.absentCount > 0).map(r => ({ name: r.name, present: r.presentCount, of: windowSprints.length }));
  const weakPresence = rows.filter(r => r.presenceBasis === 'completion' && r.absentCount > 0).map(r => r.name);

  // ── Little's Law reconciliation ──
  // throughput x cycle time should approximate the number of items in the system. When the
  // observed queue is far larger, the difference is work that is open but not moving — and
  // cycle time, which only ever sees completed tickets, is therefore a best case.
  const littlesLaw = (() => {
    if (spPerDay == null || cycleDaysMedian == null || teamAllocDays <= 0 || openWipMedian == null) return null;
    const throughputPerPersonDay = assessableTickets / teamAllocDays;
    const impliedWip = throughputPerPersonDay * cycleDaysMedian;
    if (!(impliedWip > 0)) return null;
    const ratio = openWipMedian / impliedWip;
    return {
      throughputPerPersonDay, impliedWip, observedWip: openWipMedian, ratio,
      breached: ratio > 2,
      stalledEstimate: Math.max(0, Math.round((openWipMedian - impliedWip) * assessable.length)),
    };
  })();

  const flow = (() => {
    if (cyclePerSPMedian == null || openWipMedian == null || medianTicketSize == null) return null;
    const slow = cycleDaysMedian != null && cycleDaysMedian >= 5;
    if (!slow) return { verdict: 'ok', openWipMedian, cycleDaysMedian, cyclePerSPMedian };
    return { verdict: openWipMedian >= 3 ? 'flow' : 'blocking', openWipMedian, cycleDaysMedian, cyclePerSPMedian };
  })();

  const spearman = (() => {
    const n = spHoursPairs.length;
    if (n < 8) return null;
    const rank = arr => {
      const idx = arr.map((v, i) => [v, i]).sort((a, b) => a[0] - b[0]);
      const r = new Array(n);
      let i = 0;
      while (i < n) {
        let j = i; while (j + 1 < n && idx[j + 1][0] === idx[i][0]) j++;
        const avg = (i + j) / 2 + 1;
        for (let k = i; k <= j; k++) r[idx[k][1]] = avg;
        i = j + 1;
      }
      return r;
    };
    const rx = rank(spHoursPairs.map(p => p[0])), ry = rank(spHoursPairs.map(p => p[1]));
    const mx = rx.reduce((a, b) => a + b, 0) / n, my = ry.reduce((a, b) => a + b, 0) / n;
    let num = 0, dx = 0, dy = 0;
    for (let i = 0; i < n; i++) { const a = rx[i] - mx, b = ry[i] - my; num += a * b; dx += a * a; dy += b * b; }
    const rho = (dx > 0 && dy > 0) ? num / Math.sqrt(dx * dy) : null;
    return rho == null ? null : { rho, n };
  })();

  // ── Chart data ──
  const barData = assessable.slice().sort((a, b) => a.name.localeCompare(b.name)).map(r => ({
    name: r.name, spPerDay: f2(r.spPerDay),
    err: [Number.isFinite(r.spPerDayCI[0]) ? f2(r.spPerDay) - f2(r.spPerDayCI[0]) : 0, Number.isFinite(r.spPerDayCI[1]) ? f2(r.spPerDayCI[1]) - f2(r.spPerDay) : 0],
  }));
  // a person with no completed tickets has no size mix to draw — omit rather than draw a blank bar
  const sizeMixData = rows.filter(r => r.tickets > 0).slice().sort((a, b) => a.name.localeCompare(b.name)).map(r => ({ name: r.name, ...r.sizeMix }));
  const scatter = assessable.filter(r => r.cyclePerSP != null && r.tickets > 0).map(r => ({ name: r.name, x: f2(r.spPerDay), y: f1(r.cyclePerSP), n: r.tickets }));

  // ── Per-sprint aggregates ──
  const spBySprintPerson = {};
  const ticketsBySprintPerson = {};
  const cycleBySprint = {};
  for (const e of ledger) {
    if (!e.sprint) continue;
    (spBySprintPerson[e.sprint] ||= {})[e.name] = (spBySprintPerson[e.sprint][e.name] || 0) + e.sp;
    (ticketsBySprintPerson[e.sprint] ||= {})[e.name] = (ticketsBySprintPerson[e.sprint][e.name] || 0) + 1;
    if (e.cyc != null && assessableNames.has(e.name)) (cycleBySprint[e.sprint] ||= []).push(e.cyc);
  }
  // hours per sprint per person, split pointed vs other
  const hoursBySprintPerson = {};
  if (worklog) {
    for (const [key, wls] of worklog.entries()) {
      for (const w of wls) {
        if (excludedSet.has(w.author)) continue;
        const d = w.started ? new Date(w.started) : null;
        if (!d || isNaN(d)) continue;
        const sprint = windowSprints.find(s => d >= s.start && d <= s.end);
        if (!sprint) continue;
        const bucket = ((hoursBySprintPerson[sprint.name] ||= {})[w.author] ||= { sec: 0, pointedSec: 0 });
        bucket.sec += w.seconds || 0;
        if (people[w.author]?.ownKeys.has(key)) bucket.pointedSec += w.seconds || 0;
      }
    }
  }

  const bySprint = windowSprints.map((w, idx) => {
    const cov = coverage?.bySprint?.[w.name] || null;
    const rated = coverage ? coverage.ratedNames.has(w.name) : true;
    const presentRows = assessable.filter(r => {
      const a = availOf(r.name);
      const slot = a?.perSprint.find(s => s.sprint === w.name);
      return slot ? slot.present : true;
    });
    // an excluded sprint still shows the days people were actually there, so the row reads
    // honestly — it just does not contribute them to any rate
    const availDays = presentRows.reduce((acc, r) => {
      const slot = availOf(r.name)?.perSprint.find(s => s.sprint === w.name);
      return acc + (slot ? (rated ? slot.availableDays : slot.presentDays) : 0);
    }, 0);
    const sp = presentRows.reduce((acc, r) => acc + (spBySprintPerson[w.name]?.[r.name] || 0), 0);
    const tickets = presentRows.reduce((acc, r) => acc + (ticketsBySprintPerson[w.name]?.[r.name] || 0), 0);
    const cycles = cycleBySprint[w.name] || [];
    const sprintDays = workingDaysList(w.start, w.end);

    // queue occupancy and stale count during this sprint, across assessable people
    let openSum = 0, staleAtEnd = 0;
    const seenStale = new Set();
    for (const r of presentRows) {
      const byDay = dayCountsFor(r.name);
      if (byDay.size && sprintDays.length) openSum += sprintDays.reduce((a, iso) => a + (byDay.get(iso) || 0), 0) / sprintDays.length;
      for (const [a0, b0, key] of (people[r.name]?.intervals || [])) {
        if (!a0 || !b0 || isNaN(a0) || isNaN(b0)) continue;
        if (b0 < w.start || a0 > w.end) continue;              // interval must overlap the sprint
        if (seenStale.has(key)) continue;
        if (workingDaysBetween(a0, b0 < w.end ? b0 : w.end) > STALE_WORKING_DAYS) { seenStale.add(key); staleAtEnd += 1; }
      }
    }

    let sec = 0, pointedSec = 0;
    for (const r of presentRows) {
      const b = hoursBySprintPerson[w.name]?.[r.name];
      if (b) { sec += b.sec; pointedSec += b.pointedSec; }
    }
    const loggedH = worklog ? sec / SEC_PER_HOUR : null;
    const capH = availDays * hoursPerDay;

    return {
      name: w.name, label: shortSprint(w.name), index: idx,
      start: w.start, end: w.end,
      rated,
      pointingCoverage: cov ? cov.coverage : null,
      pointedTickets: cov ? cov.pointed : null,
      completedTickets: cov ? cov.all : null,
      workingDays: workingDaysInclusive(w.start, w.end),
      present: presentRows.length, of: assessable.length,
      availDays, tickets, sp,
      // an excluded sprint gets no rate at all — showing one would be the artifact
      spPerDay: (rated && availDays > 0) ? sp / availDays : null,
      medianCycle: rated && cycles.length ? median(cycles) : null,
      openWip: presentRows.length ? openSum / presentRows.length : null,
      stale: staleAtEnd,
      loggedH,
      logPct: (loggedH != null && capH > 0) ? loggedH / capH : null,
      unpointedPct: (worklog && sec > 0) ? (sec - pointedSec) / sec : null,
      // per-person volume only — the sample at person-sprint level cannot carry a rate
      people: presentRows.map(r => {
        const b = hoursBySprintPerson[w.name]?.[r.name];
        const s = b ? b.sec : 0;
        return {
          name: r.name,
          tickets: ticketsBySprintPerson[w.name]?.[r.name] || 0,
          sp: spBySprintPerson[w.name]?.[r.name] || 0,
          hours: worklog ? s / SEC_PER_HOUR : null,
          unpointedShare: (worklog && s > 0) ? (s - b.pointedSec) / s : null,
        };
      }).sort((a, b2) => a.name.localeCompare(b2.name)),
    };
  });

  const windowTotals = {
    label: 'Window total',
    present: assessable.length, of: assessable.length,
    availDays: teamAllocDays, tickets: assessableTickets, sp: assessableSP,
    spPerDay, medianCycle: cycleDaysMedian, openWip: openWipMedian,
    stale: queue.stale,
    loggedH: assessableLoggedHours,
    logPct: loggingCompleteness,
    unpointedPct: (() => {
      const tot = assessable.reduce((a, r) => a + (r.hours || 0), 0);
      const other = assessable.reduce((a, r) => a + (r.otherHours || 0), 0);
      return tot > 0 ? other / tot : null;
    })(),
  };

  // throughput over time, per person — absence is a gap, a present-but-empty sprint is a zero
  const trendSprints = windowSprints.slice(-8);
  const trendNames = assessable.map(r => r.name);
  const trendData = trendSprints.map(w => {
    const row = { label: shortSprint(w.name), _absent: {} };
    for (const nm of trendNames) {
      const slot = availOf(nm)?.perSprint.find(s => s.sprint === w.name);
      const present = slot ? slot.present : true;
      if (!present) { row[nm] = null; row._absent[nm] = true; continue; }
      const days = slot ? slot.availableDays : 0;
      const sp = spBySprintPerson[w.name]?.[nm] || 0;
      row[nm] = days > 0 ? f2(sp / days) : null;
      if (!(days > 0)) row._absent[nm] = true;
    }
    return row;
  });

  const teamTrend = bySprint.map(s => ({
    label: s.label, sp: f1(s.sp), days: f1(s.availDays),
    spPerDay: s.spPerDay != null ? f2(s.spPerDay) : null,
    rated: s.rated, pointingCoverage: s.pointingCoverage,
    lowCoverage: s.rated && s.pointingCoverage != null && s.pointingCoverage < 0.9,
  }));

  // Is the rate actually trending, or just noisy? Mann–Kendall on the rated sprints only.
  // A six-point series that swings by an order of magnitude will not clear this, and should
  // not be described as improvement.
  const paceTrend = (() => {
    const series = bySprint.filter(s => s.rated && s.spPerDay != null).map(s => s.spPerDay);
    const n = series.length;
    if (n < 4) return { n, testable: false, trending: false, direction: 0, verdict: 'too few sprints to test for a trend' };
    let S = 0;
    for (let i = 0; i < n - 1; i++) for (let j = i + 1; j < n; j++) S += Math.sign(series[j] - series[i]);
    const varS = n * (n - 1) * (2 * n + 5) / 18;
    const z = S > 0 ? (S - 1) / Math.sqrt(varS) : S < 0 ? (S + 1) / Math.sqrt(varS) : 0;
    // two-sided normal tail, no external dependency
    const erf = x => { const s = Math.sign(x); x = Math.abs(x); const a = [0.254829592, -0.284496736, 1.421413741, -1.453152027, 1.061405429], p = 0.3275911; const t = 1 / (1 + p * x); const y = 1 - ((((a[4] * t + a[3]) * t + a[2]) * t + a[1]) * t + a[0]) * t * Math.exp(-x * x); return s * y; };
    const pValue = 2 * (1 - 0.5 * (1 + erf(Math.abs(z) / Math.SQRT2)));
    const trending = pValue < 0.10;
    const spread = series.length ? Math.max(...series) / Math.max(Math.min(...series), 1e-9) : null;
    return {
      n, testable: true, S, z, pValue, trending,
      direction: trending ? Math.sign(S) : 0,
      spread,
      verdict: trending
        ? (S > 0 ? 'improving' : 'declining')
        : 'varies sprint to sprint without a reliable direction',
    };
  })();

  const divergence = assessable.filter(r => r.cyclePerSP != null && cyclePerSPMedian != null && r.cyclePerSP > cyclePerSPMedian * 1.3 && spPerDayMedian != null && r.spPerDay < spPerDayMedian)
    .sort((a, b) => b.cyclePerSP - a.cyclePerSP).slice(0, 3)
    .map(r => ({ name: r.name, cyclePerSP: r.cyclePerSP }));

  const comps = assessable.filter(r => r.completeness != null).map(r => r.completeness);
  const completenessSpread = comps.length >= 2 ? [Math.min(...comps), Math.max(...comps)] : null;
  const hoursPerSPValues = assessable.map(r => r.hoursPerSP).filter(v => Number.isFinite(v) && v > 0);
  const hoursPerSPSpread = hoursPerSPValues.length >= 2 ? [Math.min(...hoursPerSPValues), Math.max(...hoursPerSPValues)] : null;
  const unpointedShares = assessable.map(r => r.unpointedShare).filter(Number.isFinite);
  const unpointedMedian = unpointedShares.length ? median(unpointedShares) : null;
  // Team-level share of logged hours that went to work carrying no story points — the only
  // measurement here of output the organisation does not record as deliverable.
  const unpointedHoursShare = (() => {
    const tot = assessable.reduce((a, r) => a + (r.hours || 0), 0);
    const other = assessable.reduce((a, r) => a + (r.otherHours || 0), 0);
    return tot > 0 ? other / tot : null;
  })();
  // Above this, a low throughput figure means "this panel cannot see their work".
  const mostlyInvisible = rows.filter(r => r.unpointedShare != null && r.unpointedShare >= 0.6).map(r => r.name);

  return {
    rows, suppressedNames, assumedNames, quietNames, changelogLoaded: !!changelog, worklogLoaded: !!worklog,
    assessableCount: assessable.length, suppressedCount: suppressedNames.length,
    basisCounts, presenceAdjusted, weakPresence,
    team: {
      totalSP, totalTickets, assessableSP, assessableTickets, excludedSP,
      totalAllocDays: teamAllocDays, allContribDays, spPerDay, spPerDayMedian,
      cyclePerSPMedian, cycleDaysMedian, medianTicketSize, openWipMedian, sizeCut,
      loggedHours: assessableLoggedHours, capacityHours: assessableCapacityHours, loggingCompleteness,
      allLoggedHours, allCapacityHours, loggingCompletenessAll,
      workingDaysInWindow, hoursPerDay, unpointedHoursShare,
    },
    queue, unassignedBacklog, littlesLaw, paceTrend,
    coverage: coverage ? {
      threshold: coverage.threshold,
      excluded: coverage.excluded,
      lowButIncluded: coverage.lowButIncluded,
      ratedCount: coverage.ratedNames.size,
      sprintCount: windowSprints.length,
    } : null,
    // per-sprint working-day derivation, printed in the appendix so it can be checked
    dayDerivation: bySprint.map(s => ({
      label: s.label,
      start: s.start, end: s.end,
      workingDays: s.workingDays,
      rated: s.rated,
    })),
    flow, spearman, hoursPerSPSpread, unpointedMedian, mostlyInvisible,
    barData, sizeMixData, scatter, divergence, completenessSpread, teamTrend,
    bySprint, windowTotals,
    trend: { data: trendData, names: trendNames },
  };
}
