// Pure metrics for the Sprint Review tab: one sprint's position, what is falling behind,
// what is stuck, and how it compares with the sprints before it.
//
// Sprint membership is read from the Jira sprint field's full history, not the single
// "Sprint" column. That column keeps only the most recent sprint, so a ticket that slipped
// from S33 into S34 looked like it had always been S34 work — carry-over was invisible and
// S33's commitment was understated by exactly the work it failed to finish.
import {
  getStatus, getSP, getSprint, getKey, getAssignee, getProject, getCreated, getResolved,
  isDone, isTodoName, parseSprintDates, median, f1,
} from './teamEngine';
import { workingDaysBetween, workingDaysInclusive } from './workingDays';

const normStatus = (s = '') => s.toLowerCase().trim();

// Built and waiting on someone else — testing, versioning, review. Same match the
// Capacity tab uses, minus anything already done.
export const isAwaiting = s => {
  if (isDone(s)) return false;
  const l = normStatus(s);
  return l.includes('awaiting') || l.includes('testing') || l.includes('review');
};

export const STALE_WORKING_DAYS = 5;       // in one status this long within a sprint is worth asking about
export const COMPARE_SPRINTS = 4;          // selected sprint + the three before it
const ON_PACE_TOLERANCE = 10;              // percentage points behind the clock before "behind pace"

// Sprint names are typed by hand and sometimes carry a wrong year ("31-08-26 to 11-09-27").
// A sprint longer than six weeks or ending before it starts is a typo: assume two weeks.
const MAX_SPRINT_MS = 42 * 86400000;
const TWO_WEEKS_END_MS = 14 * 86400000 - 1;
function saneDates(start, end) {
  if (start && end && (end < start || end - start > MAX_SPRINT_MS)) return { start, end: new Date(start.getTime() + TWO_WEEKS_END_MS) };
  return { start, end };
}

// Sprints get renamed (a mistyped end date corrected mid-sprint), and change history keeps
// the name as it was at the time. Match on everything before the end date.
export const canonSprint = name => (name || '').trim().replace(/\s+to\s+\d{2}-\d{2}-\d{2}\s*$/i, '').toLowerCase();

const MIN_DWELL_MS = 60 * 60 * 1000;           // shuffled through a sprint for seconds is not commitment
const PLANNING_GRACE_MS = 24 * 60 * 60 * 1000; // added on the sprint's first day counts as planned
const OVERLAP_MS = 24 * 60 * 60 * 1000;        // back-to-back sprints may overlap by hours

const splitSprints = v => (v || '').split(',').map(x => x.trim()).filter(Boolean);

/**
 * True when sprint history is available: Jira's sprint field (a live refresh) or Sprint
 * change history. The database snapshot alone keeps only each ticket's latest sprint.
 */
export const hasSprintHistory = (rows, changelogs = null) =>
  rows.some(t => Array.isArray((t._rawFields || {}).customfield_10010))
  || (!!changelogs && [...changelogs.values()].some(c => Array.isArray(c?.sprint)));

/**
 * Every sprint a ticket has been in, oldest first: [{ name, state, start, end }].
 * Falls back to the flat Sprint column (CSV uploads carry no history).
 */
export function sprintHistory(t) {
  const raw = t._rawFields || {};
  const field = raw.customfield_10010 || raw.sprint;
  if (Array.isArray(field) && field.length) {
    const out = field.map(s => {
      if (typeof s === 'string') return { name: s, state: null, start: null, end: null };
      const named = parseSprintDates(s?.name);
      return {
        name: s?.name || '',
        state: s?.state || null,
        ...saneDates(s?.startDate ? new Date(s.startDate) : named?.start || null, s?.endDate ? new Date(s.endDate) : named?.end || null),
      };
    }).filter(s => s.name);
    // Jira returns them in sprint-id order, which is creation order — sort by start so
    // a sprint created early but started late still sits where it ran.
    return out.sort((a, b) => (a.start?.getTime() ?? 0) - (b.start?.getTime() ?? 0));
  }
  const flat = getSprint(t);
  if (!flat) return [];
  return flat.split(',').map(s => s.trim()).filter(Boolean).map(name => {
    const d = parseSprintDates(name);
    return { name, state: null, ...saneDates(d?.start || null, d?.end || null) };
  });
}

/**
 * One row per issue. The database snapshot is keyed on (issue, sprint), so a ticket that
 * moved from S33 to S34 comes back twice, the S33 row frozen at its old status. Keep the
 * row in the latest-starting sprint; live Jira data has one row per issue already.
 */
export function latestRowPerIssue(rows) {
  const best = new Map();
  const startOf = t => parseSprintDates(getSprint(t))?.start?.getTime() ?? -Infinity;
  const loose = [];
  for (const t of rows) {
    const k = getKey(t);
    if (!k) { loose.push(t); continue; }
    const cur = best.get(k);
    if (!cur || startOf(t) >= startOf(cur)) best.set(k, t);
  }
  return [...best.values(), ...loose];
}

/** Sprints seen in the data with their dates, oldest first. */
export function sprintCalendar(rows) {
  const map = new Map();
  for (const t of rows) {
    for (const s of sprintHistory(t)) {
      const k = canonSprint(s.name);
      const cur = map.get(k);
      if (!cur) map.set(k, { ...s });
      else {
        cur.start ||= s.start; cur.end ||= s.end; cur.state ||= s.state;
      }
    }
  }
  const list = [...map.values()].filter(s => s.start);
  return list.sort((a, b) => a.start - b.start);
}

/** The sprint running today, or the most recently started one. */
export function currentSprint(calendar, now = new Date()) {
  const running = calendar.filter(s => s.start <= now && (!s.end || s.end >= now));
  if (running.length) return running[running.length - 1].name;
  const started = calendar.filter(s => s.start <= now);
  return started.length ? started[started.length - 1].name : (calendar[calendar.length - 1]?.name || null);
}

/**
 * Shared inputs for membership: change history by key, the sprint calendar by canonical
 * name, and a per-ticket cache so several ledgers over the same rows replay history once.
 */
export function reviewContext(rows, changelogs = null, now = new Date()) {
  const calendar = new Map(sprintCalendar(rows).map(s => [canonSprint(s.name), s]));
  return { changelogs, calendar, now, cache: new WeakMap() };
}

/**
 * Every sprint a ticket was really in, oldest first: [{ name, start, end, enteredAt }].
 * The sprint field gives where it is now (and, sometimes, closed sprints it was in).
 * Sprint change history adds the sprints it was moved out of, which is how carry-over
 * shows when unfinished work is moved on before a sprint closes. A sprint counts if the
 * ticket sat in it for at least an hour while it ran, or if it is in it now.
 */
export function sprintMembership(t, ctx) {
  if (!ctx) return sprintHistory(t).map(s => ({ ...s, enteredAt: null }));
  if (ctx.cache.has(t)) return ctx.cache.get(t);
  const infoFor = (k, fallbackName) => {
    const known = ctx.calendar.get(k);
    if (known) return known;
    const d = parseSprintDates(fallbackName);
    return d ? { name: fallbackName, state: null, ...saneDates(d.start, d.end) } : null;
  };

  const byCanon = new Map();
  for (const s of sprintHistory(t)) {
    const k = canonSprint(s.name);
    byCanon.set(k, { ...s, ...(ctx.calendar.get(k) || {}), enteredAt: null });
  }

  const events = (ctx.changelogs?.get(getKey(t))?.sprint || [])
    .map(e => ({ ...e, t: new Date(e.t) })).filter(e => !isNaN(e.t)).sort((a, b) => a.t - b.t);
  if (events.length) {
    const created = getCreated(t) ? new Date(getCreated(t)) : null;
    const open = new Map();   // canon -> entered at
    const spans = new Map();  // canon -> [[in, out]]
    const names = new Map();
    const close = (k, at) => {
      if (!open.has(k)) return;
      if (!spans.has(k)) spans.set(k, []);
      spans.get(k).push([open.get(k), at]);
      open.delete(k);
    };
    // Sprints listed as "from" on the first event were set before history began.
    for (const n of splitSprints(events[0].from)) {
      const k = canonSprint(n);
      names.set(k, n);
      open.set(k, created && !isNaN(created) ? created : events[0].t);
    }
    for (const e of events) {
      const from = new Map(splitSprints(e.from).map(n => [canonSprint(n), n]));
      const to = new Map(splitSprints(e.to).map(n => [canonSprint(n), n]));
      for (const k of from.keys()) if (!to.has(k)) close(k, e.t);
      for (const [k, n] of to) { names.set(k, n); if (!open.has(k)) open.set(k, e.t); }
    }
    for (const k of [...open.keys()]) close(k, ctx.now);

    for (const [k, list] of spans) {
      const info = infoFor(k, names.get(k));
      if (!info?.start) continue;
      const winEnd = info.end || ctx.now;
      const dwell = list.reduce((a, [i, o]) => a + Math.max(0, Math.min(o, winEnd) - Math.max(i, info.start)), 0);
      if (!byCanon.has(k) && dwell < MIN_DWELL_MS) continue;
      byCanon.set(k, { ...(byCanon.get(k) || {}), ...info, enteredAt: list[0][0] });
    }
  }
  const out = [...byCanon.values()].filter(s => s.name)
    .sort((a, b) => (a.start?.getTime() ?? 0) - (b.start?.getTime() ?? 0));
  ctx.cache.set(t, out);
  return out;
}

/**
 * One sprint's ledger. Committed = every ticket that was in the sprint while it ran.
 * Delivered = done with this as its last sprint. Carried out = in this sprint, moved on
 * to a later one. Carried in = in this sprint having already been in an earlier one.
 */
export function sprintLedger(rows, sprintName, sprintInfo, ctx = null) {
  const target = canonSprint(sprintName);
  const idxOf = hist => hist.findIndex(s => canonSprint(s.name) === target);
  const members = rows.filter(t => idxOf(sprintMembership(t, ctx)) >= 0);
  const L = {
    sprint: sprintName, start: sprintInfo?.start || null, end: sprintInfo?.end || null,
    items: 0, sp: 0, doneItems: 0, doneSP: 0, awaitingItems: 0, awaitingSP: 0,
    inProgressItems: 0, inProgressSP: 0, todoItems: 0, todoSP: 0,
    carriedOutItems: 0, carriedOutSP: 0, carriedIn: [], addedAfterStart: 0,
    unpointed: 0, unassigned: 0, cycleDays: [], tickets: members,
  };
  for (const t of members) {
    const sp = getSP(t);
    const status = getStatus(t);
    const hist = sprintMembership(t, ctx);
    const idx = idxOf(hist);
    const isLast = idx === hist.length - 1;
    L.items++; L.sp += sp;
    if (sp <= 0) L.unpointed++;
    if (!getAssignee(t) || getAssignee(t) === 'Unassigned') L.unassigned++;

    if (!isLast) { L.carriedOutItems++; L.carriedOutSP += sp; }
    else if (isDone(status)) { L.doneItems++; L.doneSP += sp; }
    else if (isAwaiting(status)) { L.awaitingItems++; L.awaitingSP += sp; }
    else if (isTodoName(status)) { L.todoItems++; L.todoSP += sp; }
    else { L.inProgressItems++; L.inProgressSP += sp; }

    if (idx > 0) L.carriedIn.push({ ticket: t, sprintsBefore: idx, firstSprint: hist[0].name });

    // Scope change: moved into the sprint (change history) or created (no history) after
    // its first day. Day-one additions are sprint planning, not scope creep.
    const created = getCreated(t) ? new Date(getCreated(t)) : null;
    const entered = hist[idx].enteredAt || created;
    if (L.start && entered && entered - L.start > PLANNING_GRACE_MS) L.addedAfterStart++;
  }
  L.sp = f1(L.sp); L.doneSP = f1(L.doneSP); L.awaitingSP = f1(L.awaitingSP);
  L.inProgressSP = f1(L.inProgressSP); L.todoSP = f1(L.todoSP); L.carriedOutSP = f1(L.carriedOutSP);
  L.deliveredPct = L.sp > 0 ? (L.doneSP / L.sp) * 100 : (L.items ? (L.doneItems / L.items) * 100 : null);
  L.carryInPct = L.items ? (L.carriedIn.length / L.items) * 100 : 0;
  return L;
}

/** Working days the ticket has sat in its current status, from change history when present. */
export function daysInStatus(t, changelog, now = new Date()) {
  const hist = changelog?.status || [];
  const last = hist.length ? new Date(hist[hist.length - 1].t) : null;
  if (last && !isNaN(last)) return { days: workingDaysBetween(last, now), since: last, exact: true };
  const created = getCreated(t) ? new Date(getCreated(t)) : null;
  if (created && !isNaN(created)) return { days: workingDaysBetween(created, now), since: created, exact: false };
  return { days: null, since: null, exact: false };
}

/** Working days from first leaving the backlog to the last move into done. */
export function cycleDays(t, changelog) {
  const hist = (changelog?.status || []).map(s => ({ ...s, t: new Date(s.t) })).filter(s => !isNaN(s.t));
  let start = null; let done = null;
  for (const s of hist) {
    if (!start && !isTodoName(s.to) && !isDone(s.to)) start = s.t;
    if (isDone(s.to)) done = s.t;
  }
  start ||= getCreated(t) ? new Date(getCreated(t)) : null;
  done ||= getResolved(t) ? new Date(getResolved(t)) : null;
  if (!start || !done || isNaN(start) || isNaN(done) || done < start) return null;
  return workingDaysBetween(start, done);
}

/** Open tickets in the sprint, longest in their current status first. */
export function staleTickets(ledger, changelogs, now = new Date(), ctx = null) {
  const target = canonSprint(ledger.sprint);
  return ledger.tickets
    .filter(t => !isDone(getStatus(t)) && canonSprint(sprintMembership(t, ctx).at(-1)?.name) === target)
    .map(t => {
      const d = daysInStatus(t, changelogs?.get(getKey(t)), now);
      return {
        key: getKey(t), summary: t['Summary'] || '', status: getStatus(t), assignee: getAssignee(t),
        project: getProject(t), sp: getSP(t), ...d,
      };
    })
    .filter(x => x.days != null)
    .sort((a, b) => b.days - a.days);
}

/** Share of the sprint's working days already gone, 0–100; null without dates. */
export function sprintElapsedPct(ledger, now = new Date()) {
  if (!ledger.start || !ledger.end) return null;
  if (now <= ledger.start) return 0;
  if (now >= ledger.end) return 100;
  // days fully gone before today, over the sprint's capacity days (both ends counted)
  const total = workingDaysInclusive(ledger.start, ledger.end) || 1;
  const gone = Math.max(0, workingDaysInclusive(ledger.start, now) - 1);
  return Math.min(100, (gone / total) * 100);
}

export function paceVerdict(ledger, now = new Date()) {
  const elapsed = sprintElapsedPct(ledger, now);
  if (elapsed == null || ledger.deliveredPct == null) return { elapsed, verdict: 'unknown' };
  const gap = ledger.deliveredPct - elapsed;
  return { elapsed, gap, verdict: gap >= -ON_PACE_TOLERANCE ? 'on-pace' : 'behind' };
}

/**
 * The selected sprint and up to three before it, oldest first, each with median cycle time.
 * Trend arrows compare the selected sprint with the average of the earlier ones.
 */
export function compareSprints(rows, calendar, sprintName, changelogs, n = COMPARE_SPRINTS, ctx = null) {
  const selected = calendar.find(s => canonSprint(s.name) === canonSprint(sprintName));
  if (!selected) return { sprints: [], trend: {} };
  // Walk back through sprints that ended before the previous one started. Several boards
  // run sprints side by side; a neighbour's overlapping sprint is not "the one before".
  const window = [selected];
  for (let i = calendar.length - 1; i >= 0 && window.length < n; i--) {
    const s = calendar[i];
    const earliest = window[window.length - 1];
    if (s.end && s.start < earliest.start && s.end - earliest.start <= OVERLAP_MS) window.push(s);
  }
  window.reverse();
  const sprints = window.map(info => {
    const L = sprintLedger(rows, info.name, info, ctx);
    const cyc = L.tickets
      .filter(t => isDone(getStatus(t)) && canonSprint(sprintMembership(t, ctx).at(-1)?.name) === canonSprint(info.name))
      .map(t => cycleDays(t, changelogs?.get(getKey(t))))
      .filter(Number.isFinite);
    return {
      sprint: info.name, start: info.start, end: info.end, committedSP: L.sp, doneSP: L.doneSP,
      items: L.items, doneItems: L.doneItems, deliveredPct: L.deliveredPct,
      carriedOutItems: L.carriedOutItems, carryInPct: L.carryInPct, addedAfterStart: L.addedAfterStart,
      medianCycle: cyc.length ? median(cyc) : null, cycleSample: cyc.length,
    };
  });
  const cur = sprints[sprints.length - 1];
  const prev = sprints.slice(0, -1);
  const avg = k => { const v = prev.map(s => s[k]).filter(Number.isFinite); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
  // higherIsBetter decides the colour; the arrow always shows the raw direction
  const trendOf = (k, higherIsBetter) => {
    const a = avg(k); const c = cur?.[k];
    if (a == null || !Number.isFinite(c)) return null;
    const delta = c - a;
    const flat = Math.abs(delta) < Math.max(Math.abs(a) * 0.05, 0.5);
    return { avg: a, delta, direction: flat ? 'flat' : delta > 0 ? 'up' : 'down', good: flat ? null : (delta > 0) === higherIsBetter };
  };
  return {
    sprints,
    trend: {
      doneSP: trendOf('doneSP', true),
      deliveredPct: trendOf('deliveredPct', true),
      carryInPct: trendOf('carryInPct', false),
      addedAfterStart: trendOf('addedAfterStart', false),
      medianCycle: trendOf('medianCycle', false),
    },
  };
}

/**
 * Plain-language suggestions from rules, each tied to the number that triggered it.
 * Team-level on purpose: no person is named, in line with the Executive Summary.
 */
export function suggestions({ ledger, stale, comparison, pace, history = true }) {
  const out = [];
  const open = ledger.awaitingSP + ledger.inProgressSP + ledger.todoSP;
  if (open > 0 && ledger.awaitingSP / open >= 0.3) {
    out.push({ severity: 'adverse', title: 'Work is queuing for testing / versioning / review',
      detail: `${Math.round((ledger.awaitingSP / open) * 100)}% of the open SP (${ledger.awaitingSP} SP, ${ledger.awaitingItems} items) is built and waiting. Adding testing capacity or limiting new starts would finish more than starting new work.` });
  }
  if (history && ledger.items >= 5 && ledger.carryInPct >= 25) {
    out.push({ severity: 'adverse', title: 'A large share of the sprint is carried over',
      detail: `${ledger.carriedIn.length} of ${ledger.items} items (${Math.round(ledger.carryInPct)}%) were already in an earlier sprint. Committing closer to recent delivery (see the comparison table) would make the plan more reliable.` });
  }
  // A running sprint is still delivering; comparing it with finished ones would always alarm.
  const d = comparison?.trend?.deliveredPct;
  const ended = pace?.elapsed != null && pace.elapsed >= 100;
  if (ended && d && d.good === false && Math.abs(d.delta) >= 10) {
    out.push({ severity: 'neutral', title: 'Less of the commitment is being delivered',
      detail: `This sprint ${Math.round(comparison.sprints.at(-1).deliveredPct)}% vs ${Math.round(d.avg)}% average over the previous sprints. Check whether scope grew or capacity dropped.` });
  }
  if (history && ledger.items >= 5 && ledger.addedAfterStart / ledger.items >= 0.2) {
    out.push({ severity: 'neutral', title: 'Scope is being added mid-sprint',
      detail: `${ledger.addedAfterStart} of ${ledger.items} items were added after the sprint's first day. Keep a buffer for unplanned work, or move new work to the next sprint.` });
  }
  if (ledger.items >= 5 && ledger.unpointed / ledger.items >= 0.2) {
    out.push({ severity: 'neutral', title: 'Many items have no story points',
      detail: `${ledger.unpointed} of ${ledger.items} items are unestimated, so SP-based progress and forecasts understate the real load.` });
  }
  if (ledger.unassigned > 0) {
    out.push({ severity: 'neutral', title: 'Unassigned work in the sprint',
      detail: `${ledger.unassigned} item(s) have no assignee. Committed work without an owner is the first to slip.` });
  }
  const stuck = stale.filter(s => s.days >= STALE_WORKING_DAYS * 2);
  if (stuck.length) {
    out.push({ severity: 'adverse', title: 'Tickets stuck for two weeks or more',
      detail: `${stuck.length} open item(s) have been in the same status for ${STALE_WORKING_DAYS * 2}+ working days. Raise them at stand-up: blocked, waiting on someone, or no longer needed?` });
  }
  if (pace?.verdict === 'behind') {
    out.push({ severity: 'adverse', title: 'Behind the sprint clock',
      detail: `${Math.round(pace.elapsed)}% of the sprint's working days are gone but ${Math.round(ledger.deliveredPct)}% of the commitment is done. Decide now what to drop rather than carrying it.` });
  }
  if (!out.length) {
    out.push({ severity: 'reassuring', title: 'Nothing stands out',
      detail: 'No queueing, carry-over, scope-change or staleness rule fired for this sprint.' });
  }
  return out;
}
