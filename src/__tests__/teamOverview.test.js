import { describe, it, expect } from 'vitest';
import { assessPerson, trendOf, buildOverview, T } from '../utils/teamOverview';

// The Overview turns numbers into statements about people, so the thing worth testing
// is not the arithmetic (that is teamEngine's job) but the judgement: does a signal fire
// when it should, stay quiet when it should not, and never fire on delivery rate alone.

const ctx = {
  rateMedian: 1.0,
  cycleNorm: 2.0,          // team norm: 2 working days per point
  wipNorm: 2.0,
  staleThreshold: 20,
  allSprintsRated: true,
  trendOf: () => null,
};

// A person with nothing remarkable about them in either direction.
const baseRow = (over = {}) => ({
  name: 'Base', tickets: 12, sp: 12, sprintsActive: 3, sprintCount: 6,
  spPerDay: 1.0, spPerDayCI: [0.8, 1.2],
  cyclePerSP: 2.0, cycleDays: 4, openWip: 2.0,
  openNow: 2, staleNow: 0, reopenRate: 0, blockedShare: 0.05,
  unpointedShare: 0.1, sizeMix: { Small: 4, Medium: 4, Large: 4 },
  suppressed: false, allocUnknown: false, presentButQuiet: false,
  suppressReason: '',
  ...over,
});

describe('assessPerson — concerns', () => {
  it('stays silent on an unremarkable person', () => {
    const p = assessPerson(baseRow(), ctx);
    expect(p.concerns).toHaveLength(0);
    expect(p.strengths).toHaveLength(0);
    expect(p.group).toBe('steady');
  });

  it('flags stalled work and asks about the blocker, not the person', () => {
    const p = assessPerson(baseRow({ staleNow: 3, openNow: 5 }), ctx);
    const c = p.concerns.find(x => x.tag === 'stalled');
    expect(c).toBeTruthy();
    expect(c.text).toContain('flow problem, not an output problem');
    expect(c.ask).toMatch(/blocking/i);
    expect(p.group).toBe('attention');
  });

  it('does not flag a single stale ticket', () => {
    const p = assessPerson(baseRow({ staleNow: 1, openNow: 5 }), ctx);
    expect(p.concerns.find(x => x.tag === 'stalled')).toBeFalsy();
  });

  it('flags rework at the reopen threshold', () => {
    const p = assessPerson(baseRow({ reopenRate: T.reopen }), ctx);
    expect(p.concerns.find(x => x.tag === 'rework')).toBeTruthy();
  });

  it('treats a null reopen rate as unknown, not as zero rework', () => {
    const p = assessPerson(baseRow({ reopenRate: null }), ctx);
    expect(p.concerns.find(x => x.tag === 'rework')).toBeFalsy();
  });

  it('flags slow cycle time relative to the team norm', () => {
    const p = assessPerson(baseRow({ cyclePerSP: 2.0 * T.slowCycle }), ctx);
    const c = p.concerns.find(x => x.tag === 'slow');
    expect(c).toBeTruthy();
    expect(c.text).toContain('sitting rather than failing');
  });

  it('treats heavy unpointed work as a visibility gap, not as a concern about them', () => {
    const p = assessPerson(baseRow({ unpointedShare: 0.7, hours: 60 }), ctx);
    expect(p.concerns).toHaveLength(0);
    const v = p.visibility.find(x => x.tag === 'invisible');
    expect(v).toBeTruthy();
    expect(v.countersRate).toBe(true);
    expect(p.group).toBe('invisible');
  });

  it('does not claim unpointed work when no hours were logged at all', () => {
    const p = assessPerson(baseRow({ unpointedShare: 0.9, hours: 0 }), ctx);
    expect(p.visibility).toHaveLength(0);
  });

  it('suppresses the quiet signal when part of the window could not be measured', () => {
    const quiet = baseRow({ presentButQuiet: true });
    expect(assessPerson(quiet, ctx).visibility.find(x => x.tag === 'quiet')).toBeTruthy();
    expect(assessPerson(quiet, { ...ctx, allSprintsRated: false }).visibility).toHaveLength(0);
  });

  it('will not quote a percentage off a sample too small to quote one from', () => {
    const small = { tickets: 6, reopenRate: 0.5, blockedShare: 1.0, cyclePerSP: 9 };
    expect(assessPerson(baseRow(small), ctx).concerns).toHaveLength(0);
    const big = { ...small, tickets: 12 };
    expect(assessPerson(baseRow(big), ctx).concerns.length).toBeGreaterThan(0);
  });

  it('ranks a stalled person above a merely slow one', () => {
    const stalled = assessPerson(baseRow({ staleNow: 3, openNow: 5 }), ctx);
    const slow = assessPerson(baseRow({ openWip: 4.0 }), ctx);
    expect(stalled.severity).toBeGreaterThan(slow.severity);
  });

  it('flags excessive work in flight only when it is both high and above the norm', () => {
    expect(assessPerson(baseRow({ openWip: 4.0 }), ctx).concerns.find(x => x.tag === 'wip')).toBeTruthy();
    // 1.75x the norm but only 2.6 tickets — below the absolute floor, so it stays quiet
    expect(assessPerson(baseRow({ openWip: 2.6 }), { ...ctx, wipNorm: 1.4 }).concerns.find(x => x.tag === 'wip')).toBeFalsy();
  });

  it('never raises a concern from a low delivery rate on its own', () => {
    const p = assessPerson(baseRow({ spPerDay: 0.2, spPerDayCI: [0.1, 0.3] }), ctx);
    expect(p.concerns).toHaveLength(0);
  });
});

describe('assessPerson — strengths', () => {
  it('credits a rate that clears the team median even at the pessimistic end', () => {
    const p = assessPerson(baseRow({ spPerDay: 1.8, spPerDayCI: [1.4, 2.2] }), ctx);
    expect(p.strengths.find(x => x.tag === 'delivery')).toBeTruthy();
    expect(p.group).toBe('standout');
  });

  it('does not credit a high rate whose range still overlaps the team median', () => {
    const p = assessPerson(baseRow({ spPerDay: 1.4, spPerDayCI: [0.9, 1.9] }), ctx);
    expect(p.strengths.find(x => x.tag === 'delivery')).toBeFalsy();
  });

  it('credits full-window consistency only with a real sample', () => {
    const consistent = { sprintsActive: 6, sprintCount: 6, staleNow: 0, reopenRate: 0, tickets: 14 };
    expect(assessPerson(baseRow(consistent), ctx).strengths.find(x => x.tag === 'consistency')).toBeTruthy();
    expect(assessPerson(baseRow({ ...consistent, tickets: 4 }), ctx).strengths.find(x => x.tag === 'consistency')).toBeFalsy();
  });

  it('credits absorbing the largest tickets', () => {
    const p = assessPerson(baseRow({ sizeMix: { Small: 2, Medium: 2, Large: 8 }, tickets: 12 }), ctx);
    expect(p.strengths.find(x => x.tag === 'hard-work')).toBeTruthy();
  });

  it('puts someone with both strengths and concerns into attention, not standout', () => {
    const p = assessPerson(baseRow({ spPerDay: 1.8, spPerDayCI: [1.4, 2.2], staleNow: 4 }), ctx);
    expect(p.strengths.length).toBeGreaterThan(0);
    expect(p.concerns.length).toBeGreaterThan(0);
    expect(p.group).toBe('attention');
  });
});

describe('trendOf', () => {
  const series = vals => vals.map(v => ({ Ann: v }));

  it('needs at least four sprints before calling a direction', () => {
    expect(trendOf(series([1, 2, 3]), 'Ann')).toBeNull();
  });

  it('detects a rise and a fall, and stays neutral on noise', () => {
    expect(trendOf(series([1, 1, 2, 2]), 'Ann').dir).toBe(1);
    expect(trendOf(series([2, 2, 1, 1]), 'Ann').dir).toBe(-1);
    expect(trendOf(series([1, 1.1, 1, 1.05]), 'Ann').dir).toBe(0);
  });

  it('ignores sprints the person was absent for', () => {
    const t = trendOf([{ Ann: 1 }, { Ann: null }, { Ann: 1 }, { Ann: 2 }, { Ann: 2 }], 'Ann');
    expect(t.n).toBe(4);
    expect(t.dir).toBe(1);
  });
});

describe('buildOverview', () => {
  const M = {
    team: { spPerDay: 1.0, spPerDayMedian: 1.0, cyclePerSPMedian: 2.0, cycleDaysMedian: 4, openWipMedian: 2.0 },
    queue: { staleThreshold: 20, stale: 1, open: 8 },
    trend: { data: [] },
    bySprint: [
      { name: 'S1', label: 'S1', rated: true, sp: 20, tickets: 10, medianCycle: 4, stale: 0, present: 3, of: 3, pointingCoverage: 1, spPerDay: 1.0 },
      { name: 'S2', label: 'S2', rated: true, sp: 30, tickets: 14, medianCycle: 5, stale: 1, present: 3, of: 3, pointingCoverage: 1, spPerDay: 1.2 },
      { name: 'S3', label: 'S3', rated: false, sp: 0, tickets: 0, medianCycle: null, stale: 0, present: 3, of: 3, pointingCoverage: 0.4, spPerDay: null },
      { name: 'S4', label: 'S4', rated: true, sp: 24, tickets: 12, medianCycle: 4, stale: 0, present: 3, of: 3, pointingCoverage: 1, spPerDay: 1.1 },
    ],
    rows: [
      baseRow({ name: 'Ann', spPerDay: 1.8, spPerDayCI: [1.4, 2.2] }),
      baseRow({ name: 'Bob', spPerDay: 1.0, spPerDayCI: [0.7, 1.3] }),
      baseRow({ name: 'Cat', suppressed: true, spPerDay: null, spPerDayCI: [NaN, NaN], tickets: 3, suppressReason: 'n=3 of 10' }),
    ],
  };

  it('ranks only assessable people, highest first', () => {
    const O = buildOverview(M);
    expect(O.ranked.map(r => r.name)).toEqual(['Ann', 'Bob']);
  });

  it('reports how many people are actually distinguishable from typical', () => {
    const O = buildOverview(M);
    expect(O.distinguishable).toBe(1);          // Ann clears it; Bob's range straddles the median
    expect(O.ranked[1].separation).toBe('typical');
  });

  it('excludes unrated sprints from the typical-sprint figure but still lists them', () => {
    const O = buildOverview(M);
    expect(O.sprints).toHaveLength(4);
    expect(O.ratedSprints).toHaveLength(3);
    expect(O.typicalSP).toBe(24);               // median of 20/30/24, not of 20/30/0/24
    expect(O.measuredCount).toBe(3);
    expect(O.sprintCount).toBe(4);
  });

  it('compares each sprint against the previous MEASURED one, skipping dropped sprints', () => {
    const O = buildOverview(M);
    expect(O.sprints[0].deltaSP).toBeNull();      // nothing before it
    expect(O.sprints[1].deltaSP).toBeCloseTo(0.5);
    expect(O.sprints[2].deltaSP).toBeNull();      // itself unmeasured — no comparison
    // S4 compares against S2 (30), not against the dropped S3 (0) — which would read -100%/+∞
    expect(O.sprints[3].deltaSP).toBeCloseTo((24 - 30) / 30);
  });

  it('puts people with no establishable rate in their own group, not last in the ranking', () => {
    const O = buildOverview(M);
    expect(O.groups.unknown.map(p => p.name)).toContain('Cat');
    expect(O.ranked.map(r => r.name)).not.toContain('Cat');
  });

  it('flags a ranked rate as misleading when most of their hours went to unpointed work', () => {
    const O = buildOverview({
      ...M,
      rows: [
        baseRow({ name: 'Ann', spPerDay: 1.8, spPerDayCI: [1.4, 2.2] }),
        baseRow({ name: 'Dee', spPerDay: 0.6, spPerDayCI: [0.4, 0.8], unpointedShare: 0.6, hours: 200 }),
      ],
    });
    expect(O.ranked.find(r => r.name === 'Dee').rateMisleading).toBe(true);
    expect(O.ranked.find(r => r.name === 'Ann').rateMisleading).toBe(false);
  });
});
