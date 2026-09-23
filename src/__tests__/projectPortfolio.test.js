import { describe, it, expect } from 'vitest';
import {
  aggregateProjects, velocityOf, assessProject, buildPortfolio,
  findNewProjects, isoWeekKey, updateSnapshots, previousSnapshot, weekOverWeek,
  projectMatches, projectsInData, weekStartDate,
  spanOf, concurrencyWindows, peakConcurrency,
  HEALTH, T,
} from '../utils/projectPortfolio';

// What is worth testing here is the judgement, not the arithmetic: does a project get
// called at risk only when the forecast actually says so, does an unmeasurable project
// say "cannot forecast" instead of guessing, and does the week-over-week diff stay
// silent when it has nothing to compare against.

// Sprint names must carry dates — that encoding is the only time signal that survives
// the Oracle round trip (rows have no date fields at all).
const sprint = (n, from, to) => `Sprint ${n} ${from} to ${to}`;
const S1 = sprint(1, '05-01-26', '16-01-26');   // ends 2026-01-16
const S2 = sprint(2, '19-01-26', '30-01-26');   // ends 2026-01-30
const S3 = sprint(3, '02-02-26', '13-02-26');   // ends 2026-02-13
const RUNNING = sprint(9, '01-06-26', '12-06-26');

const NOW = new Date('2026-02-20T00:00:00Z');

const t = (over = {}) => ({
  'Issue key': 'P-1', Project: 'PROJ', Status: 'Done',
  'Story Points': '5', Sprint: S1, 'Issue Type': 'Story', ...over,
});

const projectOf = rows => aggregateProjects(rows).get('PROJ');

describe('aggregateProjects', () => {
  it('splits points into done and total, and buckets them by sprint', () => {
    const p = projectOf([
      t({ 'Story Points': '5', Status: 'Done',        Sprint: S1 }),
      t({ 'Story Points': '3', Status: 'In Progress', Sprint: S1 }),
      t({ 'Story Points': '8', Status: 'Done',        Sprint: S2 }),
    ]);
    expect(p.totalSP).toBe(16);
    expect(p.completedSP).toBe(13);
    expect(p.bySprint.get(S1)).toEqual({ total: 8, done: 5 });
    expect(p.bySprint.get(S2)).toEqual({ total: 8, done: 8 });
  });

  it('counts unpointed work rather than silently treating it as zero scope', () => {
    const p = projectOf([t({ 'Story Points': '' }), t({ 'Story Points': '5' })]);
    expect(p.unpointedItems).toBe(1);
    expect(p.items).toBe(2);
  });

  it('reads the column-letter fallbacks the parser can emit', () => {
    const agg = aggregateProjects([{ B: 'FALLBACK', Status: 'Done', 'Story Points': '2', G: S1 }]);
    expect(agg.get('FALLBACK').completedSP).toBe(2);
  });
});

describe('velocityOf', () => {
  it('measures points per week across the span of the window', () => {
    // 10 SP done between 05-01 (S1 start) and 30-01 (S2 end) = 25 days ≈ 3.57 weeks
    const p = projectOf([
      t({ 'Story Points': '5', Sprint: S1 }),
      t({ 'Story Points': '5', Sprint: S2 }),
    ]);
    const v = velocityOf(p, { now: NOW });
    expect(v.sprintsUsed).toBe(2);
    expect(v.doneInWindow).toBe(10);
    expect(v.spPerWeek).toBeGreaterThan(2.5);
    expect(v.spPerWeek).toBeLessThan(3.5);
  });

  // A half-finished sprint drags the rate down and would forecast everything late.
  it('ignores a sprint that has not ended yet', () => {
    const p = projectOf([
      t({ 'Story Points': '5', Sprint: S1 }),
      t({ 'Story Points': '5', Sprint: S2 }),
      t({ 'Story Points': '0', Sprint: RUNNING, Status: 'In Progress' }),
    ]);
    expect(velocityOf(p, { now: NOW }).sprintsUsed).toBe(2);
  });

  // null and 0 mean different things and lead to different sentences on screen.
  it('returns null, not zero, when there are too few sprints to measure', () => {
    const p = projectOf([t({ Sprint: S1 })]);
    const v = velocityOf(p, { now: NOW });
    expect(v.spPerWeek).toBeNull();
    expect(v.reason).toBe('too-few-sprints');
  });

  it('returns a real zero when sprints ran but nothing was completed', () => {
    const p = projectOf([
      t({ 'Story Points': '5', Status: 'In Progress', Sprint: S1 }),
      t({ 'Story Points': '5', Status: 'To Do',       Sprint: S2 }),
    ]);
    expect(velocityOf(p, { now: NOW }).spPerWeek).toBe(0);
  });

  it('ignores sprints whose names carry no dates', () => {
    const p = projectOf([
      t({ Sprint: 'Backlog grooming' }),
      t({ Sprint: 'Another undated sprint' }),
    ]);
    expect(velocityOf(p, { now: NOW }).spPerWeek).toBeNull();
  });
});

describe('assessProject — health', () => {
  // ~2.8 SP/week measured; the target decides the verdict.
  const rows = [
    t({ 'Story Points': '5', Status: 'Done', Sprint: S1 }),
    t({ 'Story Points': '5', Status: 'Done', Sprint: S2 }),
    t({ 'Story Points': '10', Status: 'To Do', Sprint: S3 }),
  ];

  it('is on track when the forecast lands before the target', () => {
    const r = assessProject(projectOf(rows), { targetDate: '2026-12-31', now: NOW });
    expect(r.health).toBe(HEALTH.ON_TRACK);
    expect(r.varianceWeeks).toBeLessThan(0);
    expect(r.forecastDate).toBeTruthy();
  });

  it('is off track when the forecast slips well past the target', () => {
    const r = assessProject(projectOf(rows), { targetDate: '2026-02-21', now: NOW });
    expect(r.health).toBe(HEALTH.OFF_TRACK);
    expect(r.varianceWeeks).toBeGreaterThan(T.offTrackWeeks);
  });

  it('states the rate it used and the rate that would be needed', () => {
    const r = assessProject(projectOf(rows), { targetDate: '2026-04-30', now: NOW });
    expect(r.spPerWeek).toBeGreaterThan(0);
    expect(r.requiredSpPerWeek).toBeGreaterThan(0);
    expect(r.remainingSP).toBe(10);
  });

  it('reports no target rather than inventing one', () => {
    const r = assessProject(projectOf(rows), { targetDate: null, now: NOW });
    expect(r.health).toBe(HEALTH.NO_TARGET);
    expect(r.forecastDate).toBeTruthy();   // it can still forecast, it just has nothing to judge against
    expect(r.varianceWeeks).toBeNull();
  });

  it('says it cannot forecast, and why, when there is too little history', () => {
    // Work outstanding, but only one ended sprint to measure a rate from.
    const thin = projectOf([t({ Sprint: S1, Status: 'To Do', 'Story Points': '8' })]);
    const r = assessProject(thin, { targetDate: '2026-06-01', now: NOW });
    expect(r.health).toBe(HEALTH.NO_DATA);
    expect(r.forecastDate).toBeNull();
    expect(r.note).toMatch(/completed sprints/i);
  });

  // "Complete" is a statement about the work, not about how long we have watched it:
  // one ticket, done, is done — it must not be reported as unforecastable.
  it('calls a single finished ticket complete rather than unforecastable', () => {
    const r = assessProject(projectOf([t({ Sprint: S1 })]), { targetDate: '2026-06-01', now: NOW });
    expect(r.health).toBe(HEALTH.DONE);
    expect(r.percentComplete).toBe(100);
  });

  // Dividing by a zero rate is infinity; "stalled" is the useful sentence instead.
  it('calls a stalled project off track instead of dividing by zero', () => {
    const stalled = projectOf([
      t({ 'Story Points': '5', Status: 'In Progress', Sprint: S1 }),
      t({ 'Story Points': '5', Status: 'To Do',       Sprint: S2 }),
    ]);
    const r = assessProject(stalled, { targetDate: '2026-06-01', now: NOW });
    expect(r.health).toBe(HEALTH.OFF_TRACK);
    expect(r.forecastDate).toBeNull();
    expect(r.note).toMatch(/No story points completed/i);
  });

  it('calls a finished project complete, target date or not', () => {
    const doneRows = [t({ 'Story Points': '5', Sprint: S1 }), t({ 'Story Points': '5', Sprint: S2 })];
    expect(assessProject(projectOf(doneRows), { targetDate: null, now: NOW }).health).toBe(HEALTH.DONE);
    expect(assessProject(projectOf(doneRows), { targetDate: '2020-01-01', now: NOW }).health).toBe(HEALTH.DONE);
  });
});

describe('buildPortfolio', () => {
  const rows = [
    t({ Project: 'ALPHA', 'Story Points': '5', Status: 'Done', Sprint: S1 }),
    t({ Project: 'ALPHA', 'Story Points': '5', Status: 'Done', Sprint: S2 }),
    t({ Project: 'ALPHA', 'Story Points': '40', Status: 'To Do', Sprint: S3 }),
    t({ Project: 'BETA',  'Story Points': '5', Status: 'Done', Sprint: S1 }),
    t({ Project: 'BETA',  'Story Points': '5', Status: 'Done', Sprint: S2 }),
    t({ Project: 'GAMMA', 'Story Points': '5', Status: 'Done', Sprint: S1 }),
  ];

  it('shows only tracked projects', () => {
    const list = buildPortfolio(rows, { tracked: ['ALPHA'], now: NOW });
    expect(list.map(p => p.project)).toEqual(['ALPHA']);
  });

  it('includes every project when tracking is not restricted', () => {
    const list = buildPortfolio(rows, { now: NOW });
    expect(list.map(p => p.project).sort()).toEqual(['ALPHA', 'BETA', 'GAMMA']);
  });

  // The absence is the information: a tracked project with nothing logged is a finding.
  it('keeps a line for a tracked project that has no rows', () => {
    const list = buildPortfolio(rows, { tracked: ['ALPHA', 'GHOST'], now: NOW });
    const ghost = list.find(p => p.project === 'GHOST');
    expect(ghost).toBeTruthy();
    expect(ghost.items).toBe(0);
    expect(ghost.forecastNote).toMatch(/No issues/i);
  });

  it('puts the worst news first', () => {
    const list = buildPortfolio(rows, {
      tracked: ['ALPHA', 'BETA', 'GAMMA'],
      projectTargets: { ALPHA: '2026-02-21', BETA: '2026-12-31' },
      now: NOW,
    });
    expect(list[0].project).toBe('ALPHA');          // off track
    expect(list[0].health).toBe(HEALTH.OFF_TRACK);
    expect(list[list.length - 1].health).toBe(HEALTH.DONE);  // BETA finished
  });

  it('carries the owner and note a person typed, separately from the forecast note', () => {
    const list = buildPortfolio(rows, {
      tracked: ['ALPHA'],
      projectMeta: { ALPHA: { owner: 'Nikoletta Kopana', note: 'Waiting on vendor' } },
      now: NOW,
    });
    expect(list[0].owner).toBe('Nikoletta Kopana');
    expect(list[0].note).toBe('Waiting on vendor');
  });
});

describe('findNewProjects', () => {
  const jira = [
    { key: 'ALPHA', name: 'Alpha' },
    { key: 'NEWONE', name: 'Brand New' },
    { key: 'DISMISSED', name: 'Not Mine' },
  ];

  it('returns only what is neither tracked nor ignored', () => {
    const out = findNewProjects(jira, { tracked: ['ALPHA'], ignored: ['DISMISSED'] });
    expect(out).toEqual([{ key: 'NEWONE', name: 'Brand New' }]);
  });

  // Re-asking about a dismissed project every week trains you to ignore the strip.
  it('does not re-offer a project that was dismissed', () => {
    expect(findNewProjects(jira, { tracked: [], ignored: ['ALPHA', 'NEWONE', 'DISMISSED'] })).toEqual([]);
  });

  it('survives a missing or malformed Jira response', () => {
    expect(findNewProjects(null, { tracked: [] })).toEqual([]);
    expect(findNewProjects([{ name: 'no key' }], { tracked: [] })).toEqual([]);
  });
});

describe('weekly snapshots', () => {
  const portfolio = [{ project: 'ALPHA', totalSP: 50, completedSP: 10, percentComplete: 20, health: HEALTH.AT_RISK }];
  const tue = new Date('2026-02-17T09:00:00Z');
  const thu = new Date('2026-02-19T17:00:00Z');   // same ISO week
  const nextWeek = new Date('2026-02-24T09:00:00Z');

  it('gives the same key to two days in one ISO week, and a new one the next', () => {
    expect(isoWeekKey(tue)).toBe(isoWeekKey(thu));
    expect(isoWeekKey(nextWeek)).not.toBe(isoWeekKey(tue));
  });

  // Opening the dashboard five times on a Tuesday must not create five entries.
  it('overwrites within a week instead of appending', () => {
    let snaps = updateSnapshots({}, portfolio, { now: tue });
    snaps = updateSnapshots(snaps, portfolio, { now: thu });
    expect(snaps.ALPHA).toHaveLength(1);
    snaps = updateSnapshots(snaps, portfolio, { now: nextWeek });
    expect(snaps.ALPHA).toHaveLength(2);
  });

  it('keeps history bounded', () => {
    let snaps = {};
    for (let i = 0; i < T.snapshotKeep + 5; i++) {
      const d = new Date(tue.getTime() + i * 7 * 86400000);
      snaps = updateSnapshots(snaps, portfolio, { now: d });
    }
    expect(snaps.ALPHA).toHaveLength(T.snapshotKeep);
  });

  it('ignores this week when looking for the previous snapshot', () => {
    const snaps = updateSnapshots({}, portfolio, { now: tue });
    expect(previousSnapshot(snaps.ALPHA, { now: thu })).toBeNull();
    expect(previousSnapshot(snaps.ALPHA, { now: nextWeek })).toMatchObject({ totalSP: 50 });
  });

  // The first run has no story; "+0 SP" would read as a real finding.
  it('reports nothing when there is no earlier week to compare against', () => {
    const snaps = updateSnapshots({}, portfolio, { now: tue });
    expect(weekOverWeek(portfolio[0], snaps.ALPHA, { now: thu })).toBeNull();
  });

  it('reports scope and progress movement against the previous week', () => {
    const snaps = updateSnapshots({}, portfolio, { now: tue });
    const nowProject = { project: 'ALPHA', totalSP: 54, completedSP: 18, percentComplete: 33, health: HEALTH.ON_TRACK };
    const wow = weekOverWeek(nowProject, snaps.ALPHA, { now: nextWeek });
    expect(wow.scopeDeltaSP).toBe(4);
    expect(wow.completedDeltaSP).toBe(8);
    expect(wow.percentDelta).toBe(13);
    expect(wow.healthChanged).toEqual({ from: HEALTH.AT_RISK, to: HEALTH.ON_TRACK });
  });

  it('says nothing about health when it did not change', () => {
    const snaps = updateSnapshots({}, portfolio, { now: tue });
    const same = { ...portfolio[0], completedSP: 12 };
    expect(weekOverWeek(same, snaps.ALPHA, { now: nextWeek }).healthChanged).toBeNull();
  });
});

describe('forecast horizon', () => {
  // Real case from this dataset: a project moving at ~0.1 SP/week forecast to 2038.
  // The date is arithmetically right and practically meaningless.
  it('flags a forecast too far out to be meaningful', () => {
    const crawling = projectOf([
      t({ 'Story Points': '1', Status: 'Done',  Sprint: S1 }),
      t({ 'Story Points': '0', Status: 'Done',  Sprint: S2 }),
      t({ 'Story Points': '400', Status: 'To Do', Sprint: S3 }),
    ]);
    const r = assessProject(crawling, { targetDate: '2026-06-01', now: NOW });
    expect(r.beyondHorizon).toBe(true);
    expect(r.weeksRemaining).toBeGreaterThan(T.horizonWeeks);
    expect(r.health).toBe(HEALTH.OFF_TRACK);
    expect(r.spPerWeek).toBeGreaterThan(0);   // the rate is still the useful number
  });

  it('does not flag an ordinary near-term forecast', () => {
    const normal = projectOf([
      t({ 'Story Points': '10', Status: 'Done', Sprint: S1 }),
      t({ 'Story Points': '10', Status: 'Done', Sprint: S2 }),
      t({ 'Story Points': '10', Status: 'To Do', Sprint: S3 }),
    ]);
    const r = assessProject(normal, { targetDate: '2026-06-01', now: NOW });
    expect(r.beyondHorizon).toBe(false);
    expect(r.weeksRemaining).toBeLessThan(T.horizonWeeks);
  });
});

// Jira's API and the issue rows do not speak the same language: Jira returns
// { key: 'CS00451', name: 'Crypto Currencies' } while a row's Project field is the
// display string 'CS00451 - Crypto Currencies'. Comparing keys to those strings
// matched nothing, which made every project look new and every tracked project look
// like it had no data.
describe('projectMatches — keys vs display names', () => {
  const jira = { key: 'CS00451', name: 'Crypto Currencies' };

  it('matches on the bare key', () => {
    expect(projectMatches('CS00451', jira)).toBe(true);
  });

  it('matches on the bare name, case-insensitively', () => {
    expect(projectMatches('crypto currencies', jira)).toBe(true);
  });

  it('matches the combined form the rows actually store', () => {
    expect(projectMatches('CS00451 - Crypto Currencies', jira)).toBe(true);
    expect(projectMatches('CS00451-Crypto Currencies', jira)).toBe(true);
    expect(projectMatches('CS00451: Crypto Currencies', jira)).toBe(true);
  });

  it('tolerates the trailing whitespace real project names carry', () => {
    expect(projectMatches('CS00451 - Crypto Currencies  ', jira)).toBe(true);
  });

  // A prefix match without a boundary would let CS0045 swallow CS00451's rows.
  it('does not let a shorter key claim a longer one', () => {
    expect(projectMatches('CS004512 - Something Else', { key: 'CS00451', name: 'x' })).toBe(false);
    expect(projectMatches('CS0045', jira)).toBe(false);
  });

  it('matches nothing on an empty identifier', () => {
    expect(projectMatches('', jira)).toBe(false);
    expect(projectMatches(null, jira)).toBe(false);
  });
});

describe('findNewProjects with real-world identifiers', () => {
  const jira = [
    { key: 'CS00451', name: 'Crypto Currencies' },
    { key: 'WTR1', name: 'Web Transformation Phase 1' },
    { key: 'BRANDNEW', name: 'Brand New Project' },
  ];

  it('recognises a tracked project stored under its display name', () => {
    const out = findNewProjects(jira, {
      tracked: ['CS00451 - Crypto Currencies', 'Web Transformation Phase 1'],
      ignored: [],
    });
    expect(out.map(p => p.key)).toEqual(['BRANDNEW']);
  });
});

describe('projectsInData', () => {
  it('lists the distinct project strings the rows carry, trimmed and sorted', () => {
    const list = projectsInData([t({ Project: 'Beta  ' }), t({ Project: 'Alpha' }), t({ Project: 'Beta' })]);
    expect(list).toEqual(['Alpha', 'Beta']);
  });

  // getProject() calls a project-less row 'Unknown'. It is a real bucket, but asking
  // someone to set a target date for "Unknown" is not a question worth putting on screen.
  it('does not seed the portfolio with the Unknown bucket', () => {
    expect(projectsInData([t({ Project: '', B: '' }), t({ Project: 'Alpha' })])).toEqual(['Alpha']);
  });

  it('survives an empty dataset', () => {
    expect(projectsInData([])).toEqual([]);
    expect(projectsInData(null)).toEqual([]);
  });
});

// On the real instance this strip listed 58 "new" projects, nearly all of them
// long-configured ones that simply had no issues inside the dataset's date window.
describe('findNewProjects respects the fetch config', () => {
  const jira = [
    { key: 'AFMS', name: 'ais-Funds Management Support' },   // configured, no recent rows
    { key: 'BRANDNEW', name: 'Brand New Project' },
  ];

  it('does not call a configured project new just because it has no rows', () => {
    const out = findNewProjects(jira, { tracked: [], ignored: [], configured: ['AFMS', 'WTR1'] });
    expect(out.map(p => p.key)).toEqual(['BRANDNEW']);
  });

  it('still flags something absent from config, tracking and dismissals', () => {
    expect(findNewProjects(jira, { configured: ['AFMS'] }).map(p => p.key)).toEqual(['BRANDNEW']);
  });
});

// ── Database safety ───────────────────────────────────────────────────────────
// SAD_SETTINGS keys on SETTING_KEY (primary key) and its MERGE only updates a row
// whose CLOB actually differs (commit 4e17a0e). That guarantee is worth nothing if the
// value we send changes for reasons unrelated to the data, so these tests pin the
// property the storage layer depends on: identical inputs must serialise identically,
// whatever day they were written.
describe('snapshot payloads are stable', () => {
  const portfolio = [
    { project: 'ALPHA', totalSP: 50, completedSP: 10, percentComplete: 20, health: HEALTH.AT_RISK },
    { project: 'BETA', totalSP: 30, completedSP: 30, percentComplete: 100, health: HEALTH.DONE },
  ];

  it('serialises identically when written on a different day of the same week', () => {
    const mon = JSON.stringify(updateSnapshots({}, portfolio, { now: new Date('2026-09-21T09:00:00Z') }));
    const wed = JSON.stringify(updateSnapshots({}, portfolio, { now: new Date('2026-09-23T17:30:00Z') }));
    expect(mon).toBe(wed);
  });

  it('holds no field that varies with the write time', () => {
    const snap = updateSnapshots({}, portfolio, { now: new Date('2026-09-23T17:30:00Z') });
    const keys = Object.keys(snap.ALPHA[0]);
    expect(keys).not.toContain('date');
    expect(keys).not.toContain('writtenAt');
    expect(keys.sort()).toEqual(['completedSP', 'health', 'percentComplete', 'totalSP', 'week']);
  });

  it('does change when a number actually moves', () => {
    const before = JSON.stringify(updateSnapshots({}, portfolio, { now: new Date('2026-09-21T09:00:00Z') }));
    const moved = [{ ...portfolio[0], completedSP: 18 }, portfolio[1]];
    const after = JSON.stringify(updateSnapshots({}, moved, { now: new Date('2026-09-21T09:00:00Z') }));
    expect(after).not.toBe(before);
  });

  // The payload is a single CLOB, so its size is bounded by retention alone.
  it('stays bounded no matter how long it runs', () => {
    let snaps = {};
    for (let i = 0; i < 200; i++) {
      snaps = updateSnapshots(snaps, portfolio, { now: new Date(Date.UTC(2026, 0, 5) + i * 7 * 86400000) });
    }
    expect(snaps.ALPHA).toHaveLength(T.snapshotKeep);
    expect(Object.keys(snaps)).toHaveLength(2);   // one entry per project, never more
  });
});

describe('weekStartDate', () => {
  it('returns the Monday of an ISO week', () => {
    expect(weekStartDate('2026-W39')).toBe('2026-09-21');   // Monday
    expect(weekStartDate('2026-W01')).toBe('2025-12-29');   // ISO week 1 of 2026 starts in 2025
  });

  it('round-trips with isoWeekKey', () => {
    const d = new Date('2026-02-19T12:00:00Z');
    expect(weekStartDate(isoWeekKey(d))).toBe('2026-02-16');
  });

  it('returns null for a malformed key rather than an invalid date', () => {
    expect(weekStartDate('nonsense')).toBeNull();
    expect(weekStartDate(null)).toBeNull();
  });
});

// ── Ongoing projects ──────────────────────────────────────────────────────────
// Continuous work — support queues, BAU streams — is not trying to finish. Judging it
// against a target date manufactures a deadline nobody set, and "% complete" drifts
// downwards as the queue is fed, which reads as going backwards.
describe('ongoing projects', () => {
  const rows = [
    t({ 'Story Points': '5', Status: 'Done', Sprint: S1 }),
    t({ 'Story Points': '5', Status: 'Done', Sprint: S2 }),
    t({ 'Story Points': '40', Status: 'To Do', Sprint: S3 }),
  ];

  it('is never judged against a target date', () => {
    const p = projectOf(rows);
    const judged = assessProject(p, { targetDate: '2026-02-21', now: NOW });
    const ongoing = assessProject(p, { targetDate: '2026-02-21', now: NOW, ongoing: true });
    expect(judged.health).toBe(HEALTH.OFF_TRACK);
    expect(ongoing.health).toBe(HEALTH.ONGOING);
    expect(ongoing.varianceWeeks).toBeNull();
    expect(ongoing.forecastDate).toBeNull();
  });

  it('still measures a delivery rate, which is what it is reported on', () => {
    const r = assessProject(projectOf(rows), { now: NOW, ongoing: true });
    expect(r.spPerWeek).toBeGreaterThan(0);
    expect(r.ongoing).toBe(true);
  });

  // An empty support queue today has not finished; it refills tomorrow.
  it('outranks Complete — finished work that is ongoing is still ongoing', () => {
    const allDone = projectOf([t({ Sprint: S1 }), t({ Sprint: S2 })]);
    expect(assessProject(allDone, { now: NOW }).health).toBe(HEALTH.DONE);
    expect(assessProject(allDone, { now: NOW, ongoing: true }).health).toBe(HEALTH.ONGOING);
  });

  it('says so when it cannot even measure throughput', () => {
    const thin = projectOf([t({ Sprint: 'undated', Status: 'To Do' })]);
    const r = assessProject(thin, { now: NOW, ongoing: true });
    expect(r.health).toBe(HEALTH.ONGOING);
    expect(r.note).toMatch(/no delivery rate measurable/i);
  });

  it('reads the flag from projectMeta through buildPortfolio', () => {
    const list = buildPortfolio(rows, {
      tracked: ['PROJ'],
      projectTargets: { PROJ: '2026-02-21' },
      projectMeta: { PROJ: { ongoing: true } },
      now: NOW,
    });
    expect(list[0].health).toBe(HEALTH.ONGOING);
    expect(list[0].ongoing).toBe(true);
  });

  it('sorts below everything that needs a decision', () => {
    const list = buildPortfolio([
      ...rows.map(r => ({ ...r, Project: 'LATE' })),
      ...rows.map(r => ({ ...r, Project: 'BAU' })),
    ], {
      tracked: ['LATE', 'BAU'],
      projectTargets: { LATE: '2026-02-21' },
      projectMeta: { BAU: { ongoing: true } },
      now: NOW,
    });
    expect(list[0].project).toBe('LATE');
    expect(list[0].health).toBe(HEALTH.OFF_TRACK);
    expect(list[1].health).toBe(HEALTH.ONGOING);
  });
});

// ── Calendar spans and concurrency ────────────────────────────────────────────
// The finding the old overlap panel was reaching for and could not show: how many
// projects run at once, when, and which ones.
describe('spanOf', () => {
  it('spans the earliest sprint start to the latest sprint end', () => {
    const p = projectOf([t({ Sprint: S2 }), t({ Sprint: S1 }), t({ Sprint: S3 })]);
    expect(spanOf(p)).toEqual({ startDate: '2026-01-05', endDate: '2026-02-13' });
  });

  // Collapsing an undated project onto today would place a bar on the chart that
  // asserts a schedule nobody has.
  it('reports nulls rather than inventing a span', () => {
    expect(spanOf(projectOf([t({ Sprint: 'undated sprint' })]))).toEqual({ startDate: null, endDate: null });
    expect(spanOf(projectOf([t({ Sprint: '' })]))).toEqual({ startDate: null, endDate: null });
  });

  it('is carried on every portfolio entry', () => {
    const list = buildPortfolio([t({ Project: 'A', Sprint: S1 })], { tracked: ['A'], now: NOW });
    expect(list[0].startDate).toBe('2026-01-05');
    expect(list[0].endDate).toBe('2026-01-16');
  });
});

describe('concurrencyWindows', () => {
  const span = (project, startDate, endDate) => ({ project, startDate, endDate });

  it('finds the stretch where enough projects run at once', () => {
    const w = concurrencyWindows([
      span('A', '2026-01-01', '2026-06-30'),
      span('B', '2026-03-01', '2026-06-30'),
      span('C', '2026-03-01', '2026-06-30'),
    ], { minProjects: 3 });
    expect(w.length).toBeGreaterThan(0);
    expect(new Date(w[0].start) >= new Date('2026-02-25')).toBe(true);
    expect(w[0].count).toBe(3);
    expect(w[0].projects.sort()).toEqual(['A', 'B', 'C']);
  });

  it('stays silent when the threshold is never reached', () => {
    expect(concurrencyWindows([
      span('A', '2026-01-01', '2026-02-01'),
      span('B', '2026-06-01', '2026-07-01'),
    ], { minProjects: 3 })).toEqual([]);
  });

  // One long crunch should read as one band, not fifty weekly slivers.
  it('merges adjacent samples into a single band', () => {
    const w = concurrencyWindows([
      span('A', '2026-01-01', '2026-12-31'),
      span('B', '2026-01-01', '2026-12-31'),
      span('C', '2026-01-01', '2026-12-31'),
    ], { minProjects: 3 });
    expect(w).toHaveLength(1);
  });

  it('ignores projects with no span instead of throwing', () => {
    const w = concurrencyWindows([
      span('A', '2026-01-01', '2026-12-31'),
      { project: 'NODATES', startDate: null, endDate: null },
    ], { minProjects: 1 });
    expect(w.every(x => !x.projects.includes('NODATES'))).toBe(true);
  });

  it('survives an empty portfolio', () => {
    expect(concurrencyWindows([], { minProjects: 3 })).toEqual([]);
    expect(peakConcurrency([])).toBeNull();
  });
});

describe('peakConcurrency', () => {
  it('names the worst moment and who is in it', () => {
    const peak = peakConcurrency([
      { project: 'A', startDate: '2026-01-01', endDate: '2026-12-31' },
      { project: 'B', startDate: '2026-06-01', endDate: '2026-08-31' },
      { project: 'C', startDate: '2026-06-01', endDate: '2026-08-31' },
      { project: 'D', startDate: '2026-06-01', endDate: '2026-08-31' },
    ]);
    expect(peak.count).toBe(4);
    expect(new Date(peak.start) >= new Date('2026-05-25')).toBe(true);
  });
});
