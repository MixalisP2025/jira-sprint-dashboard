import { describe, it, expect, beforeAll } from 'vitest';
import { computeTeam } from '../utils/teamEngine';
import { resolveAvailability, computePointingCoverage } from '../utils/teamAllocation';
import { workingDaysInclusive } from '../utils/workingDays';

// Reconciliation harness. Builds a dataset shaped like the one under review — two early
// sprints where most completed work was never pointed, four well-pointed sprints, people
// with different presence, a service account and an unassigned queue — then checks that
// every published figure adds up and that no ratio spans two populations.

const HOURS_PER_DAY = 8;
const DAY = 86400000;

function makeSprints(n = 6, startUTC = Date.UTC(2026, 3, 27)) {
  const out = [];
  let cur = new Date(startUTC);
  for (let i = 0; i < n; i++) {
    const start = new Date(cur);
    const end = new Date(cur); end.setUTCDate(end.getUTCDate() + 13);
    out.push({ name: `Sprint ${23 + i}`, start, end });
    cur = new Date(end); cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return out;
}
const sprints = makeSprints();
const midOf = (s, offset = 3) => new Date(s.start.getTime() + offset * DAY).toISOString();

let ticket = 0;
const mkTicket = ({ sprint, assignee, sp, status = 'Done', resolved, start, type = 'Story' }) => ({
  'Issue key': `T-${++ticket}`,
  'Issue Type': type,
  'Status': status,
  'Assignee': assignee,
  'Story Points': sp,
  'Resolved': resolved ?? (sprint ? midOf(sprint, 5) : null),
  'Start date': start ?? (sprint ? midOf(sprint, 1) : null),
  'Created': sprint ? midOf(sprint, 0) : null,
  'Updated': sprint ? midOf(sprint, 6) : null,
});

const PEOPLE = ['Sotirios', 'Giorgos', 'Nikoletta', 'Antonios'];

function buildDataset() {
  const tickets = [];
  sprints.forEach((s, i) => {
    const earlySprint = i < 2;                 // S23/S24 — pointing barely applied
    PEOPLE.forEach(name => {
      // Giorgos only joins from S25
      if (name === 'Giorgos' && i < 2) return;
      const count = 6;
      for (let k = 0; k < count; k++) {
        // early sprints: only ~1 in 6 completed tickets carries a point
        const pointed = earlySprint ? k === 0 : k < 6;
        tickets.push(mkTicket({ sprint: s, assignee: name, sp: pointed ? (k % 3) + 1 : 0 }));
      }
    });
  });
  // a service account with logged time but nothing completed
  tickets.push(mkTicket({ sprint: sprints[0], assignee: 'Agent A', sp: 0, status: 'To Do' }));
  // unassigned queue, still in progress, very old
  for (let k = 0; k < 5; k++) {
    tickets.push(mkTicket({
      sprint: null, assignee: 'Unassigned', sp: 3, status: 'In Progress',
      start: new Date(sprints[0].start.getTime() - 30 * DAY).toISOString(), resolved: null,
    }));
  }
  // a genuinely stale in-progress ticket owned by a person
  tickets.push(mkTicket({
    sprint: null, assignee: 'Sotirios', sp: 5, status: 'In Progress',
    start: new Date(sprints[0].start.getTime()).toISOString(), resolved: null,
  }));
  return tickets;
}

function run({ coverageMin = 0.7, excluded = ['Unassigned', 'Agent A'] } = {}) {
  const scoped = buildDataset();
  const isDone = s => ['done', 'completed', 'closed', 'resolved'].includes(String(s).toLowerCase());
  const sprintOfDate = d => sprints.find(s => d >= s.start && d <= s.end) || null;
  const attrSprintOf = t => {
    const rd = t['Resolved']; if (!rd) return null;
    const d = new Date(rd); if (isNaN(d)) return null;
    const s = sprintOfDate(d); return s ? s.name : null;
  };
  const windowFor = date => { const d = new Date(date); const s = isNaN(d) ? null : sprintOfDate(d); return s ? s.name : null; };

  const coverage = computePointingCoverage(
    scoped.filter(t => isDone(t['Status'])).map(t => ({ sprint: attrSprintOf(t), pointed: parseFloat(t['Story Points']) > 0 })),
    sprints.map(s => s.name), coverageMin, s => s
  );

  const completedTickets = scoped.filter(t => {
    if (!isDone(t['Status']) || !(parseFloat(t['Story Points']) > 0)) return false;
    const s = attrSprintOf(t);
    return !!s && coverage.ratedNames.has(s);
  });

  // worklogs: everyone logs a little every sprint, well under capacity
  const worklog = new Map();
  scoped.filter(t => isDone(t['Status'])).forEach(t => {
    const s = attrSprintOf(t); if (!s) return;
    const sp = sprints.find(x => x.name === s);
    worklog.set(t['Issue key'], [{ author: t['Assignee'], started: midOf(sp, 4), seconds: 3600 * 2 }]);
  });

  const excludedSet = new Set(excluded);
  const names = [...new Set(scoped.map(t => t['Assignee']))].filter(n => !excludedSet.has(n));
  const availability = resolveAvailability({
    windowSprints: sprints, names, worklogByKey: worklog,
    doneEvents: completedTickets.map(t => ({ name: t['Assignee'], date: t['Resolved'] })),
    allocationPctOf: () => 1, allocationBasisOf: () => 'portfolio',
    ratedSprintNames: coverage.ratedNames,
  });

  return computeTeam({
    completedTickets, scoped, worklog, changelog: null, availability, excludedSet,
    windowSprints: sprints,
    workingDaysInWindow: sprints.reduce((a, s) => a + workingDaysInclusive(s.start, s.end), 0),
    windowStart: sprints[0].start, windowEnd: sprints[sprints.length - 1].end,
    hoursPerDay: HOURS_PER_DAY, attrSprintOf, windowFor, splitByHours: false,
    today: new Date(sprints[sprints.length - 1].end.getTime() + DAY), coverage,
  });
}

let M, Mungated;
beforeAll(() => { M = run(); Mungated = run({ coverageMin: 0 }); });

describe('pointing-coverage gate', () => {
  it('excludes the two sprints where pointing was barely applied', () => {
    expect(M.coverage.excluded.map(e => e.label)).toEqual(['Sprint 23', 'Sprint 24']);
    expect(M.coverage.ratedCount).toBe(4);
  });

  it('reports the coverage that caused each exclusion', () => {
    M.coverage.excluded.forEach(e => {
      expect(e.coverage).toBeLessThan(0.7);
      expect(e.all).toBeGreaterThan(0);
      expect(e.pointed).toBeLessThan(e.all);
    });
  });

  it('gives excluded sprints no rate at all, while keeping their volume visible', () => {
    const dropped = M.bySprint.filter(s => !s.rated);
    expect(dropped).toHaveLength(2);
    dropped.forEach(s => {
      expect(s.spPerDay).toBeNull();
      expect(s.medianCycle).toBeNull();
      expect(s.availDays).toBeGreaterThan(0);      // people were really there
      expect(s.pointingCoverage).toBeLessThan(0.7);
    });
  });

  it('raises the window rate once the unpointed sprints are out — the headline change', () => {
    expect(M.team.spPerDay).toBeGreaterThan(Mungated.team.spPerDay);
  });

  it('removes excluded sprints from the denominator, not just the numerator', () => {
    expect(M.team.totalAllocDays).toBeLessThan(Mungated.team.totalAllocDays);
  });
});

describe('populations reconcile', () => {
  it('contributor breakdown sums to the whole', () => {
    expect(M.assessableCount + M.suppressedCount).toBe(M.rows.length);
  });

  it('team rate is exactly assessable points over assessable days', () => {
    expect(M.team.spPerDay).toBeCloseTo(M.team.assessableSP / M.team.totalAllocDays, 9);
  });

  it('logging completeness draws both sides from the assessable set only', () => {
    const assessable = M.rows.filter(r => !r.suppressed);
    const num = assessable.reduce((a, r) => a + (r.hours || 0), 0);
    const den = assessable.reduce((a, r) => a + (r._allocDays || 0), 0) * HOURS_PER_DAY;
    expect(M.team.loggedHours).toBeCloseTo(num, 6);
    expect(M.team.capacityHours).toBeCloseTo(den, 6);
    expect(M.team.loggingCompleteness).toBeCloseTo(num / den, 9);
  });

  it('reports the all-contributor logging figure separately, never blended', () => {
    const all = M.rows.reduce((a, r) => a + (r.hours || 0), 0);
    expect(M.team.allLoggedHours).toBeCloseTo(all, 6);
    expect(M.team.allLoggedHours).toBeGreaterThanOrEqual(M.team.loggedHours);
  });

  it('takes the logging spread over assessable people only', () => {
    const assessable = M.rows.filter(r => !r.suppressed && r.completeness != null);
    const lo = Math.min(...assessable.map(r => r.completeness));
    expect(M.completenessSpread[0]).toBeCloseTo(lo, 9);
    expect(M.completenessSpread[0]).toBeGreaterThan(0);   // no 0% floor from a bot account
  });

  it('shares within the assessable set sum to one', () => {
    const total = M.rows.filter(r => !r.suppressed).reduce((a, r) => a + r.shareSP, 0);
    expect(total).toBeCloseTo(1, 6);
  });
});

describe('excluded accounts', () => {
  it('keeps Unassigned and the service account out of the contributor list', () => {
    const names = M.rows.map(r => r.name);
    expect(names).not.toContain('Unassigned');
    expect(names).not.toContain('Agent A');
  });

  it('keeps them out of the capacity denominator', () => {
    const summed = M.rows.reduce((a, r) => a + (r._allocDays || 0), 0);
    expect(M.team.allContribDays).toBeCloseTo(summed, 6);
  });

  it('surfaces the unassigned queue separately instead', () => {
    expect(M.unassignedBacklog.open).toBe(5);
    expect(M.unassignedBacklog.sp).toBeGreaterThan(0);
    expect(M.unassignedBacklog.stale).toBeGreaterThan(0);
  });

  it('does not let the unassigned queue reach the team WIP figure', () => {
    M.rows.forEach(r => { if (r.openWip != null) expect(r.openWip).toBeLessThan(20); });
  });
});

describe('queue and Little\'s Law', () => {
  it('counts the in-progress queue over assessable people, with an all-shown variant', () => {
    expect(M.queue.open).toBeGreaterThan(0);
    expect(M.queue.allShown.open).toBeGreaterThanOrEqual(M.queue.open);
  });

  it('ages the queue and flags what is stale', () => {
    expect(M.queue.stale).toBeGreaterThan(0);
    expect(M.queue.medianAge).toBeGreaterThan(0);
    expect(M.queue.oldest).not.toBeNull();
    expect(M.queue.staleThreshold).toBe(20);
  });

  it('reconciles observed queue against throughput x cycle time', () => {
    if (!M.littlesLaw) return;
    expect(M.littlesLaw.impliedWip).toBeGreaterThan(0);
    expect(M.littlesLaw.ratio).toBeCloseTo(M.littlesLaw.observedWip / M.littlesLaw.impliedWip, 9);
    expect(M.littlesLaw.breached).toBe(M.littlesLaw.ratio > 2);
  });
});

describe('working days', () => {
  it('counts sprint days inclusively, so a full-window person gets every day', () => {
    const full = sprints.reduce((a, s) => a + workingDaysInclusive(s.start, s.end), 0);
    expect(Mungated.team.workingDaysInWindow).toBe(full);
    // 6 two-week sprints from 27 Apr 2026, less 1 May and 1 Jun
    expect(full).toBe(58);
  });
});

describe('trend claims', () => {
  it('never reports a direction it has not tested', () => {
    expect(M.paceTrend).toBeTruthy();
    if (!M.paceTrend.testable) expect(M.paceTrend.trending).toBe(false);
    if (M.paceTrend.trending) expect(M.paceTrend.pValue).toBeLessThan(0.10);
    else expect(M.paceTrend.direction).toBe(0);
  });

  it('tests only the sprints that survived the coverage gate', () => {
    expect(M.paceTrend.n).toBe(M.bySprint.filter(s => s.rated && s.spPerDay != null).length);
  });
});

describe('per-sprint view', () => {
  it('emits one row per sprint plus a window total', () => {
    expect(M.bySprint).toHaveLength(sprints.length);
    expect(M.windowTotals.spPerDay).toBeCloseTo(M.team.spPerDay, 9);
  });

  it('exposes per-person volume only, with no rate at person-sprint level', () => {
    const p = M.bySprint.find(s => s.rated).people[0];
    expect(p).toHaveProperty('tickets');
    expect(p).toHaveProperty('sp');
    expect(p).not.toHaveProperty('spPerDay');
    expect(p).not.toHaveProperty('spPerDayCI');
  });

  it('prints a checkable working-day derivation per sprint', () => {
    expect(M.dayDerivation).toHaveLength(sprints.length);
    const total = M.dayDerivation.reduce((a, d) => a + d.workingDays, 0);
    expect(total).toBe(58);
  });
});

describe('trend chart data', () => {
  it('marks an absent sprint as a gap rather than a zero', () => {
    // Giorgos only joins from Sprint 25
    const early = M.trend.data.find(d => d.label.includes('23')) || M.trend.data[0];
    if (M.trend.names.includes('Giorgos')) {
      expect(early.Giorgos).toBeNull();
      expect(early._absent.Giorgos).toBe(true);
    }
  });
});
