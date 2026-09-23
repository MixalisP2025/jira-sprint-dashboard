// Project portfolio: turns the issue rows into a per-project delivery forecast.
//
// The question this answers is "will this project hit its target date, and if not, by
// how much". Everything here is built so the answer can be argued with: a project's
// status is never a bare colour, it is a forecast date plus the rate that produced it
// plus the rate that would be needed instead.
//
// ─── The constraint that shapes this file ─────────────────────────────────────
// Rows loaded from Oracle carry only 14 fields (see ISSUE_DB_FIELDS in dbSync.js) and
// NONE of them is a date: no Resolved, no Created, no Due date. So "when was this
// finished" cannot be read off a ticket. The only time signal that survives the round
// trip is the sprint NAME, which encodes its own dates ("Sprint 23 27-04-26 to
// 08-05-26"). Velocity is therefore measured per sprint and placed on the calendar by
// that sprint's end date. Every time-based number below rests on that, which is why a
// project whose sprints carry no parsable dates gets an honest "can't forecast"
// rather than a guess.

import { getSP, getSprint, getProject, getStatus, isDone, parseSprintDates, f1 } from './teamEngine';

// ─── Health ───────────────────────────────────────────────────────────────────
// Exported so the UI can state the rule on screen rather than applying it invisibly.
export const HEALTH = {
  // Continuous work — support queues, BAU streams — that is not trying to finish.
  // It must never be judged against a completion date, because there isn't one.
  ONGOING:    'ongoing',
  DONE:       'done',
  ON_TRACK:   'on-track',
  AT_RISK:    'at-risk',
  OFF_TRACK:  'off-track',
  NO_TARGET:  'no-target',
  NO_DATA:    'no-data',
};

export const HEALTH_LABEL = {
  [HEALTH.ONGOING]:   'Ongoing',
  [HEALTH.DONE]:      'Complete',
  [HEALTH.ON_TRACK]:  'On track',
  [HEALTH.AT_RISK]:   'At risk',
  [HEALTH.OFF_TRACK]: 'Off track',
  [HEALTH.NO_TARGET]: 'No target date',
  [HEALTH.NO_DATA]:   'Not enough data',
};

// Thresholds in WEEKS of forecast slip against the target date. Round numbers chosen
// to be explicable rather than tuned: inside a week is noise at sprint granularity,
// and a month late is a different conversation from a fortnight late.
export const T = {
  atRiskWeeks:   1,    // forecast later than target by more than this → at risk
  offTrackWeeks: 4,    // …by more than this → off track
  minSprintsForVelocity: 2,  // fewer completed sprints than this and a rate is a coin toss
  velocityWindow: 6,   // trailing completed sprints the rate is measured over
  snapshotKeep:  12,   // weeks of history kept per project
  // Past this many weeks out, a forecast date is false precision. Real example from
  // this dataset: a project moving at 0.1 SP/week forecasts to 2038. The arithmetic is
  // right and the date is useless — what it actually means is "barely moving". Beyond
  // the horizon the date is flagged so the UI states the rate instead.
  horizonWeeks: 104,   // two years
};

const MS_PER_WEEK = 7 * 24 * 60 * 60 * 1000;

const iso = d => (d instanceof Date && !isNaN(d) ? d.toISOString().split('T')[0] : null);
const toDate = v => {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(v);
  return isNaN(d) ? null : d;
};

// ─── Per-project aggregation ──────────────────────────────────────────────────
// One pass over the rows. Completion is bucketed by sprint so the velocity series
// below has something to stand on.
export function aggregateProjects(rows) {
  const byProject = new Map();

  (rows || []).forEach(row => {
    // Trimmed: at least one real project is stored as "TM-00443 Operational Risk Suite  "
    // and the trailing spaces would split it from its own tracked entry.
    const key = getProject(row).trim();
    if (!key) return;
    let p = byProject.get(key);
    if (!p) {
      p = {
        project: key,
        totalSP: 0, completedSP: 0,
        items: 0, doneItems: 0,
        unpointedItems: 0,
        sprints: new Set(),
        // sprint name → { total, done } story points
        bySprint: new Map(),
      };
      byProject.set(key, p);
    }

    const sp = getSP(row);
    const sprint = getSprint(row);
    const done = isDone(getStatus(row));

    p.totalSP += sp;
    p.items += 1;
    if (sp === 0) p.unpointedItems += 1;
    if (done) { p.completedSP += sp; p.doneItems += 1; }

    if (sprint) {
      p.sprints.add(sprint);
      let s = p.bySprint.get(sprint);
      if (!s) { s = { total: 0, done: 0 }; p.bySprint.set(sprint, s); }
      s.total += sp;
      if (done) s.done += sp;
    }
  });

  return byProject;
}

// ─── Velocity ─────────────────────────────────────────────────────────────────
// Story points completed per week, measured over the trailing N sprints that have
// actually ENDED. Sprints still running are excluded: a half-finished sprint drags the
// rate down and would forecast every project late every time.
//
// Returns null rather than 0 when there is nothing to measure. The difference matters:
// 0 means "this project has stopped", null means "we cannot say", and they lead to
// different sentences on screen.
export function velocityOf(project, { now = new Date(), window = T.velocityWindow } = {}) {
  const ended = [];
  project.bySprint.forEach((sp, name) => {
    const d = parseSprintDates(name);
    if (d && d.end <= now) ended.push({ name, end: d.end, start: d.start, done: sp.done });
  });
  if (ended.length < T.minSprintsForVelocity) {
    return { spPerWeek: null, sprintsUsed: ended.length, reason: 'too-few-sprints' };
  }

  ended.sort((a, b) => a.end - b.end);
  const recent = ended.slice(-window);
  const doneSP = recent.reduce((n, s) => n + s.done, 0);

  // Span the window rather than summing sprint lengths: gaps between sprints are real
  // calendar time in which nothing was delivered, and a forecast that ignores them is
  // optimistic by exactly the size of the gaps.
  const spanMs = recent[recent.length - 1].end - recent[0].start;
  const weeks = spanMs / MS_PER_WEEK;
  if (!(weeks > 0)) return { spPerWeek: null, sprintsUsed: recent.length, reason: 'zero-span' };

  return {
    spPerWeek: doneSP / weeks,
    sprintsUsed: recent.length,
    windowStart: recent[0].start,
    windowEnd: recent[recent.length - 1].end,
    doneInWindow: doneSP,
    reason: null,
  };
}

// ─── Calendar span ────────────────────────────────────────────────────────────
// Where a project sits on a calendar: the earliest start and latest end across its
// sprints. Derived from the sprint names for the same reason velocity is — the rows
// carry no dates of their own. A project whose sprints are all undated has no span,
// and says so with nulls rather than collapsing onto today.
export function spanOf(project) {
  let min = null, max = null;
  project.bySprint.forEach((_, name) => {
    const d = parseSprintDates(name);
    if (!d) return;
    if (!min || d.start < min) min = d.start;
    if (!max || d.end > max) max = d.end;
  });
  return { startDate: iso(min), endDate: iso(max) };
}

// Stretches of calendar where at least `minProjects` run at once. This is the finding
// the old overlap panel was reaching for and could not show: it drew a fixed rainbow
// gradient carrying no data, with the concurrency as a faint wash on top and no way to
// tell WHICH projects collided.
//
// Sampled weekly — finer resolution would imply a precision sprint-level dates do not
// have — and adjacent samples are merged so one long crunch reads as one band.
export function concurrencyWindows(portfolio, { minProjects = 3, stepDays = 7 } = {}) {
  const spans = portfolio
    .filter(p => p.startDate && p.endDate)
    .map(p => ({ start: new Date(p.startDate), end: new Date(p.endDate), project: p.project }));
  if (!spans.length) return [];

  const min = new Date(Math.min(...spans.map(s => s.start)));
  const max = new Date(Math.max(...spans.map(s => s.end)));
  const stepMs = stepDays * 24 * 60 * 60 * 1000;

  const windows = [];
  for (let t = min.getTime(); t <= max.getTime(); t += stepMs) {
    const at = new Date(t);
    const live = spans.filter(s => at >= s.start && at <= s.end);
    if (live.length < minProjects) continue;
    const last = windows[windows.length - 1];
    if (last && t - new Date(last.end).getTime() <= stepMs) {
      last.end = iso(new Date(t + stepMs));
      if (live.length > last.count) { last.count = live.length; last.projects = live.map(s => s.project); }
    } else {
      windows.push({ start: iso(at), end: iso(new Date(t + stepMs)), count: live.length, projects: live.map(s => s.project) });
    }
  }
  return windows;
}

// The single worst moment, for the headline. Null when nothing ever overlaps.
export function peakConcurrency(portfolio, opts = {}) {
  const windows = concurrencyWindows(portfolio, { ...opts, minProjects: 2 });
  if (!windows.length) return null;
  return windows.reduce((best, w) => (w.count > best.count ? w : best), windows[0]);
}

// ─── Forecast + health ────────────────────────────────────────────────────────
export function assessProject(project, { targetDate, now = new Date(), velocityWindow = T.velocityWindow, ongoing = false } = {}) {
  const remainingSP = Math.max(0, project.totalSP - project.completedSP);
  const percentComplete = project.totalSP > 0
    ? (project.completedSP / project.totalSP) * 100
    : project.items > 0 ? (project.doneItems / project.items) * 100 : 0;

  const vel = velocityOf(project, { now, window: velocityWindow });
  const target = toDate(targetDate);

  const base = {
    project: project.project,
    totalSP: f1(project.totalSP),
    completedSP: f1(project.completedSP),
    remainingSP: f1(remainingSP),
    items: project.items,
    doneItems: project.doneItems,
    unpointedItems: project.unpointedItems,
    percentComplete: Math.round(percentComplete),
    sprintCount: project.sprints.size,
    spPerWeek: vel.spPerWeek == null ? null : f1(vel.spPerWeek),
    sprintsUsed: vel.sprintsUsed,
    velocityReason: vel.reason,
    targetDate: iso(target),
    forecastDate: null,
    varianceWeeks: null,
    requiredSpPerWeek: null,
    health: HEALTH.NO_DATA,
    // True when the forecast lands past T.horizonWeeks: the date is arithmetically
    // correct but too far out to mean anything, so the UI should quote the rate.
    beyondHorizon: false,
    weeksRemaining: null,
    ongoing: false,
    // Set when the project has work but no way to date it — the honest reason a
    // forecast is missing, so the UI never has to invent one.
    note: null,
  };

  // Ongoing work is not going anywhere, so "will it hit its date" is the wrong
  // question and "% complete" is a meaningless denominator — the backlog refills by
  // design. It is marked ongoing and reported on throughput instead. This outranks
  // every other state, including Done: a support queue that happens to be empty today
  // has not finished.
  if (ongoing) {
    return {
      ...base,
      ongoing: true,
      health: HEALTH.ONGOING,
      note: vel.spPerWeek == null
        ? 'Ongoing work — no delivery rate measurable yet.'
        : null,
    };
  }

  // Nothing left to do is a fact, not a forecast. It outranks every other state,
  // including a missing target date.
  if (project.items > 0 && remainingSP === 0 && project.doneItems === project.items) {
    return { ...base, health: HEALTH.DONE, percentComplete: 100 };
  }

  if (vel.spPerWeek == null) {
    return {
      ...base,
      health: target ? HEALTH.NO_DATA : HEALTH.NO_TARGET,
      note: vel.reason === 'too-few-sprints'
        ? `Needs ${T.minSprintsForVelocity} completed sprints with dated names to forecast; has ${vel.sprintsUsed}.`
        : 'Sprint dates do not span any calendar time, so no rate can be measured.',
    };
  }

  // A stalled project cannot be forecast by division — the answer is infinity. Say it
  // is stalled instead, which is the actionable statement anyway.
  if (vel.spPerWeek <= 0) {
    return {
      ...base,
      spPerWeek: 0,
      health: target ? HEALTH.OFF_TRACK : HEALTH.NO_TARGET,
      note: `No story points completed in the last ${vel.sprintsUsed} sprints.`,
    };
  }

  const weeksRemaining = remainingSP / vel.spPerWeek;
  const forecast = new Date(now.getTime() + weeksRemaining * MS_PER_WEEK);
  const beyondHorizon = weeksRemaining > T.horizonWeeks;
  const withForecast = {
    ...base,
    forecastDate: iso(forecast),
    weeksRemaining: f1(weeksRemaining),
    beyondHorizon,
  };

  if (!target) {
    return { ...withForecast, health: HEALTH.NO_TARGET };
  }

  const varianceWeeks = (forecast - target) / MS_PER_WEEK;
  const weeksToTarget = (target - now) / MS_PER_WEEK;
  const requiredSpPerWeek = weeksToTarget > 0 ? remainingSP / weeksToTarget : null;

  let health;
  if (varianceWeeks > T.offTrackWeeks) health = HEALTH.OFF_TRACK;
  else if (varianceWeeks > T.atRiskWeeks) health = HEALTH.AT_RISK;
  else health = HEALTH.ON_TRACK;

  return {
    ...withForecast,
    varianceWeeks: f1(varianceWeeks),
    requiredSpPerWeek: requiredSpPerWeek == null ? null : f1(requiredSpPerWeek),
    health,
  };
}

// ─── Portfolio ────────────────────────────────────────────────────────────────
// `tracked` decides what appears: a project you are not tracking is not your problem,
// even if it has rows in the dataset.
export function buildPortfolio(rows, {
  tracked = null,             // array of project keys, or null for "everything in the data"
  projectTargets = {},        // { [projectKey]: 'YYYY-MM-DD' }
  projectMeta = {},           // { [projectKey]: { owner, note } }
  now = new Date(),
  velocityWindow = T.velocityWindow,
} = {}) {
  const agg = aggregateProjects(rows);
  const trackedSet = tracked ? new Set(tracked) : null;

  const list = [];
  agg.forEach((p, key) => {
    if (trackedSet && !trackedSet.has(key)) return;
    const meta = projectMeta[key] || {};
    const assessed = assessProject(p, {
      targetDate: projectTargets[key], now, velocityWindow, ongoing: !!meta.ongoing,
    });
    list.push({
      ...assessed,
      ...spanOf(p),
      // Two different notes, kept apart: forecastNote is why the maths could not run,
      // note is what a person typed about the project.
      forecastNote: assessed.note,
      note: meta.note || null,
      owner: meta.owner || '',
    });
  });

  // A tracked project with no rows at all still deserves a line — that absence is
  // itself information ("nothing has been logged against it yet").
  if (trackedSet) {
    trackedSet.forEach(key => {
      if (agg.has(key)) return;
      list.push({
        project: key, totalSP: 0, completedSP: 0, remainingSP: 0,
        items: 0, doneItems: 0, unpointedItems: 0, percentComplete: 0,
        sprintCount: 0, spPerWeek: null, sprintsUsed: 0, velocityReason: 'no-rows',
        targetDate: projectTargets[key] ? iso(toDate(projectTargets[key])) : null,
        forecastDate: null, varianceWeeks: null, requiredSpPerWeek: null,
        startDate: null, endDate: null,
        health: (projectMeta[key] || {}).ongoing ? HEALTH.ONGOING : HEALTH.NO_DATA,
        ongoing: !!(projectMeta[key] || {}).ongoing,
        owner: (projectMeta[key] || {}).owner || '',
        note: (projectMeta[key] || {}).note || null,
        forecastNote: 'No issues in the current dataset for this project.',
      });
    });
  }

  // Worst news first: that is the order a status meeting actually needs.
  const order = {
    [HEALTH.OFF_TRACK]: 0, [HEALTH.AT_RISK]: 1, [HEALTH.NO_DATA]: 2,
    [HEALTH.NO_TARGET]: 3, [HEALTH.ON_TRACK]: 4, [HEALTH.ONGOING]: 5, [HEALTH.DONE]: 6,
  };
  list.sort((a, b) =>
    (order[a.health] - order[b.health]) ||
    ((b.varianceWeeks ?? -Infinity) - (a.varianceWeeks ?? -Infinity)) ||
    a.project.localeCompare(b.project));

  return list;
}

// ─── Discovery ────────────────────────────────────────────────────────────────
// What Jira has that you are not yet watching. `ignored` is remembered separately from
// `tracked` so a project you dismissed does not reappear every week — dismissing is a
// decision, and re-asking would train you to ignore the strip entirely.
//
// Matching is key-OR-name because the two sides of this comparison do not speak the
// same language. Jira's API returns { key: 'CS00451', name: 'Crypto Currencies' }, but
// the issue rows store a single Project string that is the display name, often with the
// key glued to the front: "CS00451 - Crypto Currencies". Comparing keys to those
// strings matches nothing, which makes every project look new AND every tracked
// project look like it has no data. Hence the three rules below.
export function projectMatches(identifier, { key, name }) {
  if (!identifier) return false;
  const id = identifier.trim().toLowerCase();
  const k = (key || '').trim().toLowerCase();
  const n = (name || '').trim().toLowerCase();
  if (k && id === k) return true;
  if (n && id === n) return true;
  // "CS00451 - Crypto Currencies" belongs to key CS00451. Require a boundary after the
  // key so CS0045 does not claim CS00451's rows.
  if (k && id.startsWith(k) && /^[\s\-_:.]/.test(id.slice(k.length))) return true;
  return false;
}

// `configured` is JIRA_CONFIG.projects — the keys already in the fetch scope. They are
// emphatically NOT new: they are projects you set up deliberately that happen to have
// no issues inside the dataset's date window. Without them here the strip listed 58
// "new" projects on a real instance, nearly all of them long-configured, which buries
// the handful that genuinely appeared since you last looked.
export function findNewProjects(jiraProjects, { tracked = [], ignored = [], configured = [] } = {}) {
  const known = [...tracked, ...ignored, ...configured];
  return (jiraProjects || [])
    .map(p => ({
      key: (p.key || p.projectKey || '').trim(),
      name: (p.name || p.projectName || p.key || '').trim(),
    }))
    .filter(p => p.key && !known.some(id => projectMatches(id, p)))
    .sort((a, b) => a.key.localeCompare(b.key));
}

// The projects the dataset actually contains — the natural starting portfolio, and the
// right seed because these strings are exactly what the rows carry. Seeding from
// JIRA_CONFIG.projects instead would seed KEYS, which match no row.
//
// 'Unknown' is what getProject() returns for a row carrying no project at all. It is a
// real bucket and aggregateProjects still forms it, but it is not seeded into the
// portfolio: "set a target date for Unknown" is not a question worth asking. Track it
// by hand if that unattributed work ever needs watching.
export const UNKNOWN_PROJECT = 'Unknown';

export function projectsInData(rows) {
  const set = new Set();
  (rows || []).forEach(r => {
    const name = getProject(r).trim();
    if (name && name !== UNKNOWN_PROJECT) set.add(name);
  });
  return Array.from(set).sort();
}

// ─── Weekly snapshots ─────────────────────────────────────────────────────────
// Scope change cannot be read from the data: the rows carry no dates, so there is no
// way to know when a ticket joined a project. The only honest way to report "scope
// moved this week" is to write down what we saw and compare next time. One entry per
// ISO week, so opening the dashboard five times on a Tuesday does not create five.
export function isoWeekKey(date = new Date()) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  // ISO weeks run Monday–Sunday and belong to the year containing their Thursday.
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((d - yearStart) / 86400000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

// The Monday of an ISO week, derived rather than stored. Storing the write date made
// the saved value differ every day, so the settings MERGE saw a changed CLOB and wrote
// the whole ~120KB history on every new day even when no number had moved — defeating
// the "skip unchanged rows" guarantee the settings table relies on. Nothing in a
// snapshot may vary with WHEN it was written, only with WHAT was measured.
export function weekStartDate(weekKey) {
  const m = /^(\d{4})-W(\d{2})$/.exec(weekKey || '');
  if (!m) return null;
  const [, year, week] = m;
  // 4 January is always in ISO week 1; step back to that week's Monday, then forward.
  const jan4 = new Date(Date.UTC(Number(year), 0, 4));
  const monday1 = new Date(jan4);
  monday1.setUTCDate(jan4.getUTCDate() - ((jan4.getUTCDay() || 7) - 1));
  const d = new Date(monday1);
  d.setUTCDate(monday1.getUTCDate() + (Number(week) - 1) * 7);
  return iso(d);
}

export function updateSnapshots(previous, portfolio, { now = new Date(), keep = T.snapshotKeep } = {}) {
  const week = isoWeekKey(now);
  const next = { ...(previous || {}) };

  portfolio.forEach(p => {
    const history = [...(next[p.project] || [])];
    const entry = {
      week,
      totalSP: p.totalSP,
      completedSP: p.completedSP,
      percentComplete: p.percentComplete,
      health: p.health,
    };
    const at = history.findIndex(h => h.week === week);
    if (at >= 0) history[at] = entry;   // same week → overwrite, never append
    else history.push(entry);
    next[p.project] = history.slice(-keep);
  });

  return next;
}

// The most recent entry from a WEEK BEFORE this one. Deliberately not "the previous
// array element": that would be this week's own entry once it has been written.
export function previousSnapshot(history, { now = new Date() } = {}) {
  const week = isoWeekKey(now);
  const earlier = (history || []).filter(h => h.week < week);
  return earlier.length ? earlier[earlier.length - 1] : null;
}

// What changed for one project since its last weekly snapshot. Returns null when there
// is no prior week to compare against — the first run has no story to tell, and
// inventing "+0" would read as a real finding.
export function weekOverWeek(project, history, { now = new Date() } = {}) {
  const prev = previousSnapshot(history, { now });
  if (!prev) return null;
  return {
    since: weekStartDate(prev.week),
    scopeDeltaSP: f1(project.totalSP - prev.totalSP),
    completedDeltaSP: f1(project.completedSP - prev.completedSP),
    percentDelta: Math.round(project.percentComplete - prev.percentComplete),
    healthChanged: prev.health !== project.health ? { from: prev.health, to: project.health } : null,
  };
}
